import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Notification lifecycle.
 *
 * The reported defects were: read state not persisting, a badge that updated
 * late, deletes that came back after reload, and a sync that could overwrite a
 * locally confirmed read. Each is pinned here against the REAL store, with the
 * cloud adapter mocked (there is no live Supabase in this environment — this is
 * a unit/integration test of the logic, not a production verification).
 */

const cloud = vi.hoisted(() => ({
  saveThrows: null as string | null,
  session: true,
  feed: [] as Array<{ id: string; title: string; body: string; createdAt: string; deliveredAt: string; readAt: string | null }>,
  markReadCalls: [] as string[],
  markReadOk: true,
}))

// The REAL localStorage adapter is used (not a stub): "survives a reload" is
// only a meaningful assertion if the same persistence path production uses is
// the one under test.
vi.mock('./persistence/adapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./persistence/adapter')>()
  return { dataAdapter: new actual.LocalStorageAdapter() }
})

vi.mock('./persistence/supabase', () => ({
  supabase: {},
  cloudAdapter: () => ({
    label: 'cloud',
    kind: 'cloud' as const,
    load: async () => null,
    save: async () => { if (cloud.saveThrows) throw new Error(cloud.saveThrows) },
    clear: async () => undefined,
    userId: async () => 'user-1',
    hasSession: async () => cloud.session,
    isCloudEmpty: async () => true,
  }),
}))

vi.mock('./edge/admin', () => ({
  getAnnouncementFeed: async () => ({ feed: cloud.feed }),
  markAnnouncementRead: async (id: string) => {
    cloud.markReadCalls.push(id)
    return cloud.markReadOk ? { ok: true as const } : ({ ok: false } as unknown as { ok: true })
  },
}))

vi.mock('./edge/adminGate', () => ({ refreshAdminGate: async () => undefined }))

const store = await import('./store')

const announcement = (id: string, readAt: string | null = null) => ({
  id,
  title: `Announcement ${id}`,
  body: 'Body',
  createdAt: '2026-10-01T10:00:00.000Z',
  deliveredAt: '2026-10-01T10:00:00.000Z',
  readAt,
})

beforeEach(async () => {
  localStorage.clear()
  cloud.saveThrows = null
  cloud.session = true
  cloud.feed = []
  cloud.markReadCalls = []
  cloud.markReadOk = true
  await store.initStore(true)
  await store.authenticateCloudUser('user-1')
})

describe('creating and reading notifications', () => {
  it('adds a notification immediately with stable identity and unread state', () => {
    const created = store.pushNotification({ kind: 'system', title: 'Hello', body: 'World' })
    const list = store.getState().notifications
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(created.id)
    expect(list[0].read).toBe(false)
    expect(list[0].createdAt).toBeTruthy()
  })

  it('derives the unread count from state, not from a separate counter', async () => {
    await store.addNotification({ kind: 'system', title: 'A', body: '' })
    await store.addNotification({ kind: 'system', title: 'B', body: '', read: true })
    const unread = store.getState().notifications.filter((item) => !item.read)
    expect(unread).toHaveLength(1)
  })
})

describe('mark as read', () => {
  it('persists a read state that survives a reload', async () => {
    const item = await store.addNotification({ kind: 'system', title: 'Read me', body: '' })
    await store.markNotificationRead(item.id, true)
    expect(store.getState().notifications.find((n) => n.id === item.id)?.read).toBe(true)

    // What the DEVICE holds after the write — this is what a restart reads back.
    // Asserting on storage (not on a re-`initStore`) is the honest check here:
    // `initStore` re-enters cloud mode, whose `load()` legitimately returns the
    // ACCOUNT copy, not the device copy, so it is not a restart simulation.
    const stored = JSON.parse(localStorage.getItem('alhelm.v1.notifications') || '[]') as Array<{ id: string; read: boolean }>
    expect(stored.find((n) => n.id === item.id)?.read).toBe(true)
  })

  it('can be toggled back to unread', async () => {
    const item = await store.addNotification({ kind: 'system', title: 'Toggle', body: '' })
    await store.markNotificationRead(item.id, true)
    await store.markNotificationRead(item.id, false)
    expect(store.getState().notifications.find((n) => n.id === item.id)?.read).toBe(false)
  })

  it('marks every notification read, idempotently', async () => {
    await store.addNotification({ kind: 'system', title: 'A', body: '' })
    await store.addNotification({ kind: 'system', title: 'B', body: '' })
    await store.markAllNotificationsRead()
    expect(store.getState().notifications.every((item) => item.read)).toBe(true)
    // A second call must not fail or change anything.
    await expect(store.markAllNotificationsRead()).resolves.toBeDefined()
    expect(store.getState().notifications.every((item) => item.read)).toBe(true)
  })
})

describe('delete', () => {
  it('removes an item and keeps it removed after a reload', async () => {
    const item = await store.addNotification({ kind: 'system', title: 'Delete me', body: '' })
    await store.deleteNotification(item.id)
    expect(store.getState().notifications).toHaveLength(0)

    // The deletion must be gone from the DEVICE copy too, or a restart would
    // resurrect it (the reported "deleted notification comes back" defect).
    const stored = JSON.parse(localStorage.getItem('alhelm.v1.notifications') || '[]') as Array<{ id: string }>
    expect(stored.find((n) => n.id === item.id)).toBeUndefined()
  })

  it('restores the item when the LOCAL write fails, instead of a false success', async () => {
    const item = await store.addNotification({ kind: 'system', title: 'Sticky', body: '' })
    // Fail the device write itself. This is the case where nothing at all was
    // stored, so the notification MUST come back — otherwise the UI reports a
    // deletion the next launch contradicts.
    const adapter = await import('./persistence/adapter')
    const real = adapter.dataAdapter as unknown as { save: (d: unknown) => Promise<void> }
    const original = real.save
    real.save = async () => { throw new Error('quota exceeded') }
    try {
      await expect(store.deleteNotification(item.id)).rejects.toThrow(/quota exceeded/)
      expect(store.getState().notifications.some((n) => n.id === item.id)).toBe(true)
    } finally {
      ;(adapter.dataAdapter as unknown as { save: unknown }).save = original
    }
  })

  it('deleting a missing id is a no-op, not an error', async () => {
    await expect(store.deleteNotification('does-not-exist')).resolves.toBeDefined()
  })
})

describe('server announcement sync', () => {
  it('mirrors a new announcement as unread', async () => {
    cloud.feed = [announcement('a1')]
    const added = await store.syncServerAnnouncements()
    expect(added).toBe(1)
    const mirrored = store.getState().notifications.find((n) => n.id === 'ann-a1')
    expect(mirrored?.read).toBe(false)
    expect(mirrored?.kind).toBe('announcement')
  })

  it('does not duplicate an announcement that is already mirrored', async () => {
    cloud.feed = [announcement('a1')]
    await store.syncServerAnnouncements()
    const second = await store.syncServerAnnouncements()
    expect(second).toBe(0)
    expect(store.getState().notifications.filter((n) => n.id === 'ann-a1')).toHaveLength(1)
  })

  it('REGRESSION: a locally read announcement stays read after a re-sync', async () => {
    // This is the reported bug: the server still reports read_at = null for a
    // moment, and a naive sync would rewrite `read` back to false.
    cloud.feed = [announcement('a1')]
    await store.syncServerAnnouncements()
    await store.markNotificationRead('ann-a1', true)
    expect(store.getState().notifications.find((n) => n.id === 'ann-a1')?.read).toBe(true)

    // Server has NOT caught up yet.
    cloud.feed = [announcement('a1', null)]
    await store.syncServerAnnouncements()
    expect(store.getState().notifications.find((n) => n.id === 'ann-a1')?.read).toBe(true)
  })

  it('adopts a read performed on another device', async () => {
    cloud.feed = [announcement('a1')]
    await store.syncServerAnnouncements()
    expect(store.getState().notifications.find((n) => n.id === 'ann-a1')?.read).toBe(false)

    // Another device marked it read.
    cloud.feed = [announcement('a1', '2026-10-02T09:00:00.000Z')]
    await store.syncServerAnnouncements()
    expect(store.getState().notifications.find((n) => n.id === 'ann-a1')?.read).toBe(true)
  })

  it('marks an announcement read on the server and reports a failure honestly', async () => {
    cloud.feed = [announcement('a1')]
    await store.syncServerAnnouncements()
    await store.markAnnouncementReadEverywhere('a1')
    expect(cloud.markReadCalls).toEqual(['a1'])

    cloud.markReadOk = false
    await expect(store.markAnnouncementReadEverywhere('a1')).rejects.toThrow(/could not be marked as read/i)
  })

  it('keeps local notifications when the feed request fails', async () => {
    await store.addNotification({ kind: 'system', title: 'Mine', body: '' })
    const admin = await import('./edge/admin')
      ; (admin as unknown as { getAnnouncementFeed: () => Promise<unknown> }).getAnnouncementFeed = async () => { throw new Error('offline') }
    await expect(store.syncServerAnnouncements()).resolves.toBe(0)
    expect(store.getState().notifications).toHaveLength(1)
  })
})
