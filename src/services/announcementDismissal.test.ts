import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Announcement dismissal queue.
 *
 * Real-device defects this pins:
 *   1. "Deleted notifications come back" — a dismissal that failed to reach the
 *      server left the local item removed, so the next feed sync re-inserted it
 *      and the list silently grew back.
 *   2. "Deleted notifications come back" AFTER RELOAD — the queue itself was
 *      memory-only, so a reload lost the pending deletion.
 *
 * The contract: a dismissal is written to a per-account queue BEFORE the local
 * list changes, flushed idempotently, and any announcement in the queue is
 * filtered out of incoming feed rows until the server confirms it.
 */

const state = vi.hoisted(() => ({
  // Which account the fake auth session currently represents. Sign-out and
  // account switching must be modelled for real, or the cross-account guards
  // in the store cannot be exercised at all.
  user: 'user-a',
  feed: [] as Array<{ id: string; title: string; body: string; createdAt: string; deliveredAt: string; readAt: string | null }>,
  dismissedIds: [] as string[],
  dismissCalls: [] as string[][],
  dismissFails: false,
  feedFails: false,
}))

vi.mock('./persistence/adapter', () => {
  const key = '__dismissal_snapshot__'
  const adapter = {
    label: 'local',
    kind: 'local',
    load: async () => {
      const raw = window.localStorage.getItem(key)
      return raw ? JSON.parse(raw) : null
    },
    save: async (data: unknown) => window.localStorage.setItem(key, JSON.stringify(data)),
    clear: async () => window.localStorage.removeItem(key),
  }
  return { dataAdapter: adapter }
})

vi.mock('./persistence/supabase', () => {
  const cloudAdapter = () => ({
    label: 'cloud',
    kind: 'cloud' as const,
    load: async () => {
      const { createInitialData } = await import('./domain')
      return createInitialData()
    },
    save: async () => undefined,
    clear: async () => undefined,
    userId: async () => state.user,
    hasSession: async () => true,
    isCloudEmpty: async () => true,
  })
  return { supabase: {}, cloudAdapter }
})

vi.mock('./guestMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./guestMode')>()
  return { ...actual, isGuestSession: () => false }
})

vi.mock('./edge/admin', () => ({
  getAnnouncementFeed: async () => {
    if (state.feedFails) throw new Error('network down')
    return { feed: state.feed, dismissedIds: state.dismissedIds }
  },
  markAnnouncementRead: async () => ({ ok: true }),
  dismissAnnouncements: async (ids: string[]) => {
    state.dismissCalls.push(ids)
    if (state.dismissFails) throw new Error('dismiss failed')
    state.dismissedIds = [...new Set([...state.dismissedIds, ...ids])]
    // A real dismissal removes the row from the feed.
    state.feed = state.feed.filter((row) => !ids.includes(row.id))
    return { ok: true as const, dismissed: ids.length }
  },
}))

vi.mock('./edge/adminGate', () => ({ refreshAdminGate: async () => undefined }))

const store = await import('./store')

const row = (id: string) => ({
  id,
  title: `Announcement ${id}`,
  body: 'body',
  createdAt: '2026-11-01T10:00:00Z',
  deliveredAt: '2026-11-01T10:00:00Z',
  readAt: null,
})

const announcementIds = () => store.getState().notifications
  .filter((item) => item.id.startsWith('ann-'))
  .map((item) => item.id.slice(4))

beforeEach(async () => {
  localStorage.clear()
  state.user = 'user-a'
  state.feed = [row('a1'), row('a2')]
  state.dismissedIds = []
  state.dismissCalls = []
  state.dismissFails = false
  state.feedFails = false
  await store.initStore(true)
  await store.authenticateCloudUser('user-a')
  await store.syncServerAnnouncements()
})

describe('announcement dismissal', () => {
  it('mirrors the feed into the notification store', () => {
    expect(announcementIds().sort()).toEqual(['a1', 'a2'])
  })

  it('deleting an announcement removes it locally AND on the server', async () => {
    const result = await store.deleteNotification('ann-a1')
    expect(result === 'cloud' || result === 'local-pending').toBe(true)
    expect(announcementIds()).toEqual(['a2'])
    expect(state.dismissCalls).toContainEqual(['a1'])
  })

  it('a failed dismissal is queued, reported, and does not resurrect the item', async () => {
    state.dismissFails = true
    const result = await store.deleteNotification('ann-a1')
    expect(result).toBe('local-pending')
    // The item is gone from the inbox immediately...
    expect(announcementIds()).toEqual(['a2'])
    // ...and remains gone after a sync, even though the server still lists it.
    state.feed = [row('a1'), row('a2')]
    state.dismissedIds = []
    await store.syncServerAnnouncements()
    expect(announcementIds()).toEqual(['a2'])
    // The queue survived in device storage, so a reload retries it.
    const queued = window.localStorage.getItem('alhelm.v1.announcementDismissals.user-a')
    expect(queued).toContain('a1')
  })

  it('flushes the queue once the network recovers and then clears it', async () => {
    state.dismissFails = true
    await store.deleteNotification('ann-a1')
    state.dismissFails = false
    state.feed = [row('a1'), row('a2')]
    await store.syncServerAnnouncements()
    expect(state.dismissedIds).toContain('a1')
    expect(announcementIds()).toEqual(['a2'])
    const queued = window.localStorage.getItem('alhelm.v1.announcementDismissals.user-a')
    expect(queued === null || !queued.includes('a1')).toBe(true)
  })

  it('honours a server-reported dismissal after a reload (fresh device state)', async () => {
    // Simulates a dismissal confirmed by the server, then the app reopened.
    state.dismissedIds = ['a1']
    await store.initStore(true)
    await store.authenticateCloudUser('user-a')
    state.feed = [row('a1'), row('a2')]
    await store.syncServerAnnouncements()
    expect(announcementIds()).toEqual(['a2'])
  })

  it('flushes A\'s queued dismissal when A signs in again', async () => {
    state.dismissFails = true
    await store.deleteNotification('ann-a1')
    state.dismissFails = false
    await store.logoutCloudUser()
    state.user = 'user-a'
    await store.authenticateCloudUser('user-a')
    state.feed = [row('a1'), row('a2')]
    await store.syncServerAnnouncements()
    expect(state.dismissCalls.at(-1)).toContain('a1')
    expect(announcementIds()).toEqual(['a2'])
    expect(state.dismissedIds).toContain('a1')
  })

  it('keeps the queue per account so one user cannot hide another user\'s items', async () => {
    state.dismissFails = true
    await store.deleteNotification('ann-a1')
    state.dismissFails = false
    // A real account switch: log out of A, then sign in as B. (initStore alone
    // does not change the authenticated account.)
    await store.logoutCloudUser()
    // After signing out, the previous account's SERVER announcements must not be
    // shown to the next person who signs in on this device.
    expect(store.getState().notifications.filter((item) => (item.kind as string) === 'announcement')).toHaveLength(0)
    state.user = 'user-b'
    await store.authenticateCloudUser('user-b')
    state.feed = [row('a1'), row('a2')]
    state.dismissedIds = []
    // The calls A made are not B's business; this assertion is about what B's
    // own sync does, not about the whole call log.
    state.dismissCalls = []
    await store.syncServerAnnouncements()
    // Account B has deleted nothing, so it must receive BOTH announcements:
    // A's queued deletion is scoped to A and must not hide anything from B.
    expect(announcementIds().sort()).toEqual(['a1', 'a2'])
    expect(state.dismissCalls).not.toContainEqual(['a1'])
    const queuedA = window.localStorage.getItem('alhelm.v1.announcementDismissals.user-a')
    expect(queuedA).toContain('a1')
  })

  it('marking all read empties the unread count that feeds the header badge', async () => {
    expect(store.getState().notifications.filter((item) => !item.read)).toHaveLength(2)
    await store.markAllNotificationsRead()
    expect(store.getState().notifications.filter((item) => !item.read)).toHaveLength(0)
  })

  it('a failed feed refresh is reported and does not wipe the local inbox', async () => {
    state.feedFails = true
    await expect(store.syncServerAnnouncements()).rejects.toThrow(/network down/)
    expect(announcementIds().sort()).toEqual(['a1', 'a2'])
  })
})
