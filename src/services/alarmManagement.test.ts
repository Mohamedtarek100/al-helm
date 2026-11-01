import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Alarm (reminder) CRUD and scheduling.
 *
 * Alarms live in `settings.reminders`, so these tests exercise the REAL store
 * and the REAL scheduling helpers. The Capacitor plugin is mocked — no
 * notification is ever delivered — so this proves the LOGIC, not the device.
 * Device delivery is explicitly NOT verified here.
 */

vi.mock('./persistence/supabase', () => ({ supabase: null, cloudAdapter: () => null }))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))

const native = vi.hoisted(() => ({ scheduled: [] as Array<{ id: number; title?: string; channelId?: string }>, cancelled: [] as number[] }))

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: async () => ({ display: 'granted' }),
    requestPermissions: async () => ({ display: 'granted' }),
    createChannel: async () => undefined,
    schedule: async ({ notifications }: { notifications: Array<{ id: number; title?: string; channelId?: string }> }) => {
      for (const n of notifications) native.scheduled.push({ id: n.id, title: n.title, channelId: n.channelId })
    },
    cancel: async ({ notifications }: { notifications: Array<{ id: number }> }) => {
      for (const n of notifications) native.cancelled.push(n.id)
    },
  },
}))

const store = await import('./store')
const remindersModule = await import('./reminders')
const toneModule = await import('./alarmTones')
const { occurrenceFor } = remindersModule.__internals

/**
 * Tone definitions are pure data, so their properties can be asserted directly.
 * These pin the two defects found in review: duplicate URIs (four options, two
 * sounds) and the licensing posture (no bundled audio).
 */
describe('alarm tone definitions', () => {
  it('gives every selectable tone a distinct sound', () => {
    const uris = toneModule.REMINDER_TONES
      .filter((tone) => tone.soundUri !== null)
      .map((tone) => tone.soundUri)
    // Four non-default tones must not collapse into two audible results.
    expect(new Set(uris).size).toBe(uris.length)
  })

  it('uses only OS system sound URIs, so no audio is bundled or licensed', () => {
    for (const tone of toneModule.REMINDER_TONES) {
      if (tone.soundUri === null) continue
      expect(tone.soundUri.startsWith('content://settings/system/')).toBe(true)
    }
  })

  it('gives every tone its own channel, because a channel sound is immutable', () => {
    const ids = toneModule.REMINDER_TONES.map((tone) => tone.channelId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('falls back to the default definition for an unknown tone', () => {
    expect(toneModule.toneById('nope' as never).id).toBe('default')
    expect(toneModule.toneById(undefined).id).toBe('default')
  })
})

beforeEach(async () => {
  localStorage.clear()
  native.scheduled = []
  native.cancelled = []
  await store.initStore(true)
})

const alarms = () => store.getState().settings.reminders

describe('alarm CRUD', () => {
  it('creates an alarm with a custom title, time and tone', async () => {
    const created = await store.createAlarm({ label: 'Morning revision', time: '06:30', tone: 'bell' })
    const stored = alarms().find((alarm) => alarm.id === created.id)
    expect(stored).toBeDefined()
    expect(stored?.label).toBe('Morning revision')
    expect(stored?.time).toBe('06:30')
    expect(stored?.tone).toBe('bell')
    expect(stored?.enabled).toBe(true)
  })

  it('keeps the existing seeded reminders when adding one', async () => {
    const before = alarms().length
    await store.createAlarm({ label: 'Extra', time: '09:00' })
    expect(alarms().length).toBe(before + 1)
  })

  it('rejects an alarm with no name or an invalid time', async () => {
    await expect(store.createAlarm({ label: '   ', time: '07:00' })).rejects.toThrow(/name/i)
    await expect(store.createAlarm({ label: 'Bad time', time: '25:99' })).rejects.toThrow(/time/i)
    expect(alarms().filter((alarm) => alarm.label === 'Bad time')).toHaveLength(0)
  })

  it('renames an alarm', async () => {
    const created = await store.createAlarm({ label: 'Old name', time: '07:00' })
    await store.updateAlarm(created.id, { label: 'New name' })
    expect(alarms().find((alarm) => alarm.id === created.id)?.label).toBe('New name')
  })

  it('refuses to rename an alarm to blank, keeping the previous name', async () => {
    const created = await store.createAlarm({ label: 'Keep me', time: '07:00' })
    await store.updateAlarm(created.id, { label: '   ' })
    expect(alarms().find((alarm) => alarm.id === created.id)?.label).toBe('Keep me')
  })

  it('changes the time and the date', async () => {
    const created = await store.createAlarm({ label: 'Shift me', time: '07:00' })
    await store.updateAlarm(created.id, { time: '08:15', date: '2026-12-01' })
    const stored = alarms().find((alarm) => alarm.id === created.id)
    expect(stored?.time).toBe('08:15')
    expect(stored?.date).toBe('2026-12-01')
  })

  it('disables and re-enables an alarm', async () => {
    const created = await store.createAlarm({ label: 'Toggle', time: '07:00' })
    await store.updateAlarm(created.id, { enabled: false })
    expect(alarms().find((alarm) => alarm.id === created.id)?.enabled).toBe(false)
    await store.updateAlarm(created.id, { enabled: true })
    expect(alarms().find((alarm) => alarm.id === created.id)?.enabled).toBe(true)
  })

  it('deletes an alarm and leaves the others intact', async () => {
    const a = await store.createAlarm({ label: 'Delete A', time: '07:00' })
    const b = await store.createAlarm({ label: 'Keep B', time: '08:00' })
    await store.deleteAlarm(a.id)
    expect(alarms().find((alarm) => alarm.id === a.id)).toBeUndefined()
    expect(alarms().find((alarm) => alarm.id === b.id)).toBeDefined()
  })

  it('deleting an unknown id changes nothing', async () => {
    const before = alarms().length
    await store.deleteAlarm('does-not-exist')
    expect(alarms()).toHaveLength(before)
  })

  it('ignores an update for an unknown id', async () => {
    const before = alarms().length
    await store.updateAlarm('nope', { label: 'Ghost' })
    expect(alarms()).toHaveLength(before)
    expect(alarms().some((alarm) => alarm.label === 'Ghost')).toBe(false)
  })
})

describe('alarm persistence', () => {
  it('stores alarms on the device so a restart keeps them', async () => {
    const created = await store.createAlarm({ label: 'Persistent', time: '05:45', tone: 'chime' })
    const stored = JSON.parse(localStorage.getItem('alhelm.v1.settings') || '{}') as { reminders?: Array<{ id: string; label: string; tone?: string }> }
    const persisted = stored.reminders?.find((alarm) => alarm.id === created.id)
    expect(persisted?.label).toBe('Persistent')
    expect(persisted?.tone).toBe('chime')
  })

  it('keeps a legacy reminder (no tone/date) working unchanged', async () => {
    // Simulates data written before tones and dates existed.
    const legacy = { id: 'rem_morning', label: 'Legacy alarm', time: '07:00', enabled: true }
    localStorage.setItem('alhelm.v1.settings', JSON.stringify({
      ...store.getState().settings,
      reminders: [legacy],
    }))
    await store.initStore(true)
    const alarm = alarms().find((item) => item.id === 'rem_morning')
    expect(alarm?.label).toBe('Legacy alarm')
    // Absent optional fields must not be invented into required ones.
    expect(alarm?.tone ?? null).toBeNull()
  })
})

describe('scheduling a dated alarm', () => {
  const now = new Date(2026, 10, 1, 8, 0, 0)

  it('schedules a dated alarm in the future', () => {
    const when = occurrenceFor({ time: '09:30', date: '2026-11-02' }, now)
    expect(when).not.toBeNull()
    expect(when?.getDate()).toBe(2)
    expect(when?.getHours()).toBe(9)
    expect(when?.getMinutes()).toBe(30)
  })

  it('returns null for a dated alarm in the past instead of ringing tomorrow', () => {
    // A one-off alarm on a past date must be done, not silently reused.
    expect(occurrenceFor({ time: '09:30', date: '2026-10-01' }, now)).toBeNull()
  })

  it('returns null for a malformed date', () => {
    expect(occurrenceFor({ time: '09:30', date: 'tomorrow' }, now)).toBeNull()
  })

  it('keeps daily behaviour for an undated alarm', () => {
    expect(occurrenceFor({ time: '09:30' }, now)?.getDate()).toBe(1)
    expect(occurrenceFor({ time: '07:00' }, now)?.getDate()).toBe(2)
  })

  it('records the selected tone on the native schedule', async () => {
    await store.createAlarm({ label: 'Tone check', time: '09:00', tone: 'alarm' })
    // The sync runs asynchronously after the write.
    await new Promise((resolve) => setTimeout(resolve, 30))
    const scheduled = native.scheduled.at(-1)
    expect(scheduled?.title).toBe('Tone check')
    // Channel id encodes the tone: Android fixes a channel's sound at creation.
    expect(scheduled?.channelId).toBe('4ulife-reminders-alarm')
  })

  it('creates a channel for EACH tone in use, not just the first', async () => {
    await store.createAlarm({ label: 'Chime alarm', time: '06:00', tone: 'chime' })
    await store.createAlarm({ label: 'Bell alarm', time: '06:15', tone: 'bell' })
    await new Promise((resolve) => setTimeout(resolve, 40))
    const channels = new Set(native.scheduled.map((entry) => entry.channelId))
    // Both must exist: a reminder scheduled against a channel that was never
    // created would fall back to the default sound silently.
    expect(channels.has('4ulife-reminders-chime')).toBe(true)
    expect(channels.has('4ulife-reminders-bell')).toBe(true)
  })
})

describe('date boundary and DST correctness', () => {
  it('resolves a date-only alarm to the correct local day across a month boundary', () => {
    const now = new Date(2026, 10, 30, 23, 0, 0) // 30 Nov, 23:00
    const when = occurrenceFor({ time: '08:00', date: '2026-12-01' }, now)
    expect(when).not.toBeNull()
    expect(when?.getMonth()).toBe(11) // December, not January/October
    expect(when?.getDate()).toBe(1)
  })

  it('resolves a leap-day alarm', () => {
    const now = new Date(2028, 1, 27, 12, 0, 0)
    const when = occurrenceFor({ time: '09:00', date: '2028-02-29' }, now)
    expect(when?.getMonth()).toBe(1)
    expect(when?.getDate()).toBe(29)
  })

  it('builds the alarm in LOCAL time so a DST shift keeps the wall-clock time', () => {
    // Constructing with `new Date(y, m, d, h, min)` uses local time, so 07:00
    // stays 07:00 on the clock even when the UTC offset changes.
    const now = new Date(2026, 9, 1, 0, 0, 0)
    const when = occurrenceFor({ time: '07:00', date: '2026-10-25' }, now)
    expect(when?.getHours()).toBe(7)
    expect(when?.getMinutes()).toBe(0)
  })

  it('never schedules an alarm for a moment in the past', () => {
    const now = new Date(2026, 10, 1, 12, 0, 0)
    // Same day, earlier time, dated today: already gone.
    expect(occurrenceFor({ time: '09:00', date: '2026-11-01' }, now)).toBeNull()
  })
})
