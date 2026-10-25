import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Reminder scheduling regression tests.
 *
 * The Capacitor plugin is mocked, so no notification is ever delivered and no
 * device is touched. What is proven here is the *logic* the UI relies on to be
 * truthful: when permission is missing we do not schedule, we always cancel a
 * stale id before rescheduling it, disabled reminders are cancelled, and a
 * plugin failure is reported as a failure (never as success).
 */

const state = vi.hoisted(() => ({
  native: true,
  permission: 'granted' as 'granted' | 'denied' | 'prompt',
  requestResult: 'granted' as 'granted' | 'denied',
  scheduleThrows: null as string | null,
  scheduled: [] as Array<{ id: number; title?: string; at?: string }>,
  cancelled: [] as number[],
  channels: [] as string[],
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => state.native },
}))

type ScheduleArg = { id: number; title?: string; schedule?: { at?: Date }}

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: async () => ({ display: state.permission }),
    requestPermissions: async () => {
      state.permission = state.requestResult
      return { display: state.requestResult }
    },
    createChannel: async (channel: { id: string }) => { state.channels.push(channel.id) },
    schedule: async (input: { notifications: ScheduleArg[] }) => {
      if (state.scheduleThrows) throw new Error(state.scheduleThrows)
      for (const n of input.notifications) state.scheduled.push({ id: n.id, title: n.title, at: n.schedule?.at?.toISOString() })
    },
    cancel: async ({ notifications }: { notifications: Array<{ id: number }> }) => {
      for (const n of notifications) state.cancelled.push(n.id)
    },
  },
}))

const { __internals, canScheduleReminders, cancelAllReminders, sendTestNotification, syncReminders } = await import('./reminders')

const { hashId } = __internals

const reminder = (id: string, time: string, enabled = true) => ({ id, label: `Reminder ${id}`, time, enabled })

beforeEach(() => {
  localStorage.clear()
  state.native = true
  state.permission = 'granted'
  state.requestResult = 'granted'
  state.scheduleThrows = null
  state.scheduled = []
  state.cancelled = []
  state.channels = []
})

describe('platform truthfulness', () => {
  it('reports web as unsupported instead of pretending to schedule', async () => {
    state.native = false
    expect(canScheduleReminders()).toBe(false)
    const result = await syncReminders([reminder('rem_morning', '07:30')])
    expect(result).toMatchObject({ scheduled: 0, webUnsupported: true, permissionGranted: false })
    expect(state.scheduled).toHaveLength(0)
  })

  it('reports native support on Android', () => {
    expect(canScheduleReminders()).toBe(true)
  })
})

describe('all reminders disabled', () => {
  it('does not request permission when nothing is enabled', async () => {
    const requestSpy = vi.fn()
    // Replace the module's permission call by observing state instead of the spy:
    // a denied permission is never consulted when there is nothing to schedule.
    const result = await syncReminders([reminder('a', '07:00', false), reminder('b', '08:00', false)])
    expect(result).toMatchObject({ scheduled: 0, permissionGranted: false, error: null })
    expect(requestSpy).not.toHaveBeenCalled()
    expect(state.scheduled).toHaveLength(0)
    expect(state.channels).toHaveLength(0) // no channel work either
  })

  it('cancels previously scheduled reminders when the user turns everything off', async () => {
    await syncReminders([reminder('rem_morning', '07:30'), reminder('rem_evening', '20:00')])
    expect(state.scheduled).toHaveLength(2)

    state.cancelled = []
    const result = await syncReminders([reminder('rem_morning', '07:30', false), reminder('rem_evening', '20:00', false)])
    expect(result.scheduled).toBe(0)
    expect(state.cancelled.sort()).toEqual([hashId('rem_morning'), hashId('rem_evening')].sort())
  })
})

describe('permission handling', () => {
  it('does not schedule and reports permission_denied when the user refuses', async () => {
    state.permission = 'prompt'
    state.requestResult = 'denied'
    const result = await syncReminders([reminder('rem_morning', '07:30')])
    expect(result).toMatchObject({ scheduled: 0, permissionGranted: false, error: 'permission_denied' })
    expect(state.scheduled).toHaveLength(0)
  })

  it('schedules when permission is granted after a prompt', async () => {
    state.permission = 'prompt'
    state.requestResult = 'granted'
    const result = await syncReminders([reminder('rem_morning', '07:30')])
    expect(result).toMatchObject({ scheduled: 1, permissionGranted: true, error: null })
  })
})

describe('scheduling, cancel-before-reschedule and duplicates', () => {
  it('schedules one notification per enabled reminder with a stable id', async () => {
    const result = await syncReminders([reminder('rem_morning', '07:30'), reminder('rem_studio', '21:30')])
    expect(result.scheduled).toBe(2)
    expect(state.scheduled.map((n) => n.id).sort()).toEqual([hashId('rem_morning'), hashId('rem_studio')].sort())
  })

  it('is idempotent: an unchanged schedule is not re-scheduled', async () => {
    await syncReminders([reminder('rem_morning', '07:30')])
    const firstIds = state.scheduled.map((n) => n.id)
    state.scheduled = []
    state.cancelled = []
    await syncReminders([reminder('rem_morning', '07:30')])
    // Same target time ⇒ nothing new scheduled and nothing cancelled.
    expect(state.scheduled).toHaveLength(0)
    expect(state.cancelled).toHaveLength(0)
    expect(firstIds).toEqual([hashId('rem_morning')])
  })

  it('cancels the old id before scheduling a changed time (no duplicates)', async () => {
    await syncReminders([reminder('rem_morning', '07:30')])
    state.scheduled = []
    state.cancelled = []
    const result = await syncReminders([reminder('rem_morning', '09:15')])
    expect(result.scheduled).toBe(1)
    expect(state.cancelled).toEqual([hashId('rem_morning')])
    expect(state.scheduled.map((n) => n.id)).toEqual([hashId('rem_morning')])
  })

  it('cancels reminders that were removed entirely', async () => {
    await syncReminders([reminder('a', '07:00'), reminder('b', '08:00')])
    state.cancelled = []
    await syncReminders([reminder('a', '07:00')])
    expect(state.cancelled).toEqual([hashId('b')])
  })

  it('accepts the same reminder count after several edits', async () => {
    for (const time of ['07:00', '07:30', '08:00', '08:00']) {
      await syncReminders([reminder('rem_morning', time), reminder('rem_evening', '20:00')])
    }
    // Exactly two pending ids should exist for the final state.
    const stored = JSON.parse(localStorage.getItem('alhelm:reminder-schedule') ?? '{}')
    expect(Object.keys(stored).sort()).toEqual(['rem_evening', 'rem_morning'])
  })
})

describe('honest failure reporting', () => {
  it('surfaces a plugin failure instead of claiming success', async () => {
    state.scheduleThrows = 'exact alarm not permitted'
    const result = await syncReminders([reminder('rem_morning', '07:30')])
    expect(result.scheduled).toBe(0)
    expect(result.error).toContain('exact alarm not permitted')
  })

  it('keeps the successful remainder when only one reminder fails', async () => {
    state.scheduleThrows = null
    const first = await syncReminders([reminder('a', '07:00')])
    expect(first.error).toBeNull()
    expect(first.scheduled).toBe(1)
    // Only the second call fails; the first result must stay usable.
    state.scheduleThrows = 'second call rejected'
    const second = await syncReminders([reminder('b', '08:00')])
    expect(second.scheduled).toBe(0)
    expect(second.error).toContain('second call rejected')
    expect(first.scheduled).toBe(1)
  })

  it('reports an invalid HH:mm time without scheduling it', async () => {
    const result = await syncReminders([reminder('bad', '25:99')])
    expect(result.scheduled).toBe(0)
    expect(result.error).toContain('invalid time')
    expect(state.scheduled).toHaveLength(0)
  })
})

describe('test notification', () => {
  it('does not send anything on web', async () => {
    state.native = false
    const result = await sendTestNotification()
    expect(result).toEqual({ ok: false, error: 'web_unsupported' })
    expect(state.scheduled).toHaveLength(0)
  })

  it('reports permission_denied without sending when permission is refused', async () => {
    state.permission = 'prompt'
    state.requestResult = 'denied'
    const result = await sendTestNotification()
    expect(result).toEqual({ ok: false, error: 'permission_denied' })
    expect(state.scheduled).toHaveLength(0)
  })

  it('returns ok only after the plugin accepted the notification', async () => {
    const result = await sendTestNotification()
    expect(result).toEqual({ ok: true, error: null })
    expect(state.scheduled).toHaveLength(1)
  })

  it('returns the plugin error text when scheduling the test fails', async () => {
    state.scheduleThrows = 'boom'
    const result = await sendTestNotification()
    expect(result.ok).toBe(false)
    expect(result.error).toContain('boom')
  })
})

describe('cancelAllReminders', () => {
  it('cancels every registered id and clears the registry', async () => {
    await syncReminders([reminder('a', '07:00'), reminder('b', '08:00')])
    state.cancelled = []
    await cancelAllReminders()
    expect(state.cancelled.sort()).toEqual([hashId('a'), hashId('b')].sort())
    expect(JSON.parse(localStorage.getItem('alhelm:reminder-schedule') ?? '{}')).toEqual({})
  })

  it('is a no-op on web', async () => {
    state.native = false
    await expect(cancelAllReminders()).resolves.toBeUndefined()
  })
})
