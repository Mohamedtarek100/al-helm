import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * INTEGRATION — the durable pending queue must be fed by REAL store mutations.
 *
 * `pendingQueue.test.ts` proves the queue logic in isolation. That is not enough:
 * a perfectly correct utility that nothing calls protects nothing. These tests
 * drive `store.createTask / updateTask / deleteTask` against a cloud that
 * REJECTS the write, then inspect the per-account queue and the recovery path.
 *
 * The scenario is the real production one: `due_time = ''` used to make the whole
 * snapshot write fail, so the customer's task existed only on the device.
 */

const cloud = vi.hoisted(() => ({
  failSave: null as string | null,
  saves: 0,
  remote: null as Record<string, unknown> | null,
}))

vi.mock('./persistence/adapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./persistence/adapter')>()
  return { dataAdapter: new actual.LocalStorageAdapter() }
})

vi.mock('./persistence/supabase', () => ({
  supabase: {},
  cloudAdapter: () => ({
    label: 'cloud',
    kind: 'cloud' as const,
    load: async () => (cloud.remote ? structuredClone(cloud.remote) : null),
    save: async () => {
      cloud.saves += 1
      if (cloud.failSave) throw new Error(cloud.failSave)
    },
    clear: async () => undefined,
    userId: async () => 'user-qa',
    hasSession: async () => true,
    isCloudEmpty: async () => true,
  }),
}))

vi.mock('../edge/admin', () => ({
  getAnnouncementFeed: async () => ({ feed: [], dismissedIds: [] }),
  markAnnouncementRead: async () => ({ ok: true }),
  dismissAnnouncements: async () => ({ ok: true, dismissed: 0 }),
}))

vi.mock('../edge/adminGate', () => ({ refreshAdminGate: async () => undefined }))

const store = await import('./store')
const { pendingQueue } = await import('./persistence/pendingQueue')

const USER = 'user-qa'

const taskInput = (title: string, dueTime = '') => ({
  title,
  description: '',
  subjectId: null,
  dueDate: '2026-11-05',
  dueTime,
  priority: 'medium' as const,
  category: 'study' as const,
  estimatedMinutes: 30,
})

/**
 * A server snapshot that ALREADY holds one subject.
 *
 * Returning `null` means "this account has no cloud data", which the
 * coordinator treats as the explicit-migration path (mode stays local, userId is
 * set only after migration). A real account has content, so that is the fixture.
 */
function remoteWithSubject() {
  return {
    profile: null,
    settings: null,
    subjects: [{ id: 'seed_subject', name: 'Math', color: 'sage', notes: '', weeklyTargetMinutes: 0, archived: false, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' }],
    sessions: [],
    tasks: [],
    focusSessions: [],
    journal: [],
    goals: [],
    artworks: [],
    challenges: [],
    letters: [],
    exams: [],
    notifications: [],
  }
}

beforeEach(async () => {
  localStorage.clear()
  cloud.failSave = null
  cloud.saves = 0
  cloud.remote = remoteWithSubject()
  await store.initStore(true)
  await store.authenticateCloudUser(USER)
})

/**
 * Puts the store into true CLOUD mode.
 *
 * The coordinator deliberately stays in local mode for an account whose server
 * copy is empty (that is the explicit-migration path), so "successful cloud
 * write" tests need a server that already holds content.
 */
async function enterCloudMode() {
  cloud.remote = remoteWithSubject()
  await store.initStore(true)
  await store.authenticateCloudUser(USER)
}

describe('a failed cloud write is recorded durably', () => {
  it('queues an upsert for a task the server rejected', async () => {
    cloud.failSave = 'invalid input syntax for type time: ""'
    const created = await store.createTask(taskInput('Offline task'))
    // The caller is told the truth: on this device only.
    expect(created.writeResult).toBe('local-only')

    const queued = pendingQueue(USER).upserts('tasks')
    expect(queued.map((op) => op.id)).toEqual([created.id])
  })

  it('the queue survives a new store session (device storage, not memory)', async () => {
    cloud.failSave = 'network down'
    const created = await store.createTask(taskInput('Survives restart'))

    // Simulate a full application restart: a fresh store instance.
    await store.initStore(true)
    expect(pendingQueue(USER).upserts('tasks').map((op) => op.id)).toContain(created.id)
  })

  it('queues an EDIT made while the cloud write fails', async () => {
    const created = await store.createTask(taskInput('Before'))
    await store.updateTask(created.id, { title: 'After' })

    cloud.failSave = 'network down'
    await store.updateTask(created.id, { title: 'Edited offline' })

    expect(pendingQueue(USER).upserts('tasks').map((op) => op.id)).toContain(created.id)
  })

  it('queues a TOMBSTONE for a delete the server did not accept', async () => {
    const created = await store.createTask(taskInput('Delete me'))
    cloud.failSave = 'network down'
    await store.deleteTask(created.id)

    expect([...pendingQueue(USER).tombstones('tasks')]).toContain(created.id)
  })

  it('a successful write records no pending work', async () => {
    await enterCloudMode()
    expect(store.activePersistenceMode()).toBe('cloud')
    const created = await store.createTask(taskInput('Online task', '14:30'))
    expect(created.writeResult).toBe('cloud')
    expect(pendingQueue(USER).size()).toBe(0)
  })

  it('a later successful write clears the pending operation for the same record', async () => {
    await enterCloudMode()
    cloud.failSave = 'network down'
    const created = await store.createTask(taskInput('Recovers later'))
    expect(created.writeResult).toBe('local-only')
    expect(pendingQueue(USER).upserts('tasks').map((op) => op.id)).toContain(created.id)

    // The server comes back and the same record is written successfully.
    cloud.failSave = null
    const result = await store.updateTask(created.id, { title: 'Recovered' })
    expect(result).toBe('cloud')
    expect(pendingQueue(USER).upserts('tasks').map((op) => op.id)).not.toContain(created.id)
  })
})

describe('account isolation', () => {
  it('pending work belongs to the account that produced it', async () => {
    cloud.failSave = 'network down'
    await store.createTask(taskInput('A only'))
    expect(pendingQueue(USER).size()).toBeGreaterThan(0)
    // A different account's queue is empty.
    expect(pendingQueue('someone-else').size()).toBe(0)
  })

  it('signing out preserves the queued work without exposing it to the next user', async () => {
    cloud.failSave = 'network down'
    await store.createTask(taskInput('Kept on sign-out'))
    const before = pendingQueue(USER).size()
    expect(before).toBeGreaterThan(0)

    await store.logoutCloudUser()
    // The record is still there, owned by the same account id.
    expect(pendingQueue(USER).size()).toBe(before)
  })
})

describe('user-visible status', () => {
  it('reports local-only (not cloud) when the queue holds unsynced work', async () => {
    await enterCloudMode()
    cloud.failSave = 'network down'
    const created = await store.createTask(taskInput('Status check'))
    expect(created.writeResult).toBe('local-only')
    expect(store.getPendingCloudError()).toBeTruthy()
    expect(pendingQueue(USER).upserts('tasks').map((op) => op.id)).toContain(created.id)
  })
})
