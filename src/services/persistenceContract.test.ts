import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Persistence contract for the store.
 *
 * The rules these tests pin down:
 *
 *  1. A confirmed cloud write reports `cloud`; a local-only write reports
 *     `local`. Neither ever reports the other.
 *  2. A failed cloud write keeps the user's work on this device and records a
 *     pending error, so nothing can claim the account copy is current.
 *  3. A retry re-attempts the cloud write and clears the pending error only
 *     once the server confirmed it.
 *  4. A failed LOCAL write rolls the in-memory state back (the change was not
 *     stored anywhere).
 *  5. Account changes void any slow in-flight save rather than letting the
 *     result land on the wrong account.
 *
 * Supabase is mocked: these are contract tests, not network tests.
 */

const cloudState = vi.hoisted(() => ({
  /** What the fake cloud adapter does on the next save. */
  saveMode: 'ok' as 'ok' | 'fail' | 'slow-ok',
  saveCalls: 0,
  remote: null as unknown,
  userId: 'user-a',
}))

vi.mock('./persistence/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: cloudState.userId } }, error: null } }),
    },
  },
  cloudAdapter: () => ({
    label: 'mock cloud',
    kind: 'cloud' as const,
    hasSession: async () => true,
    userId: async () => cloudState.userId,
    isCloudEmpty: async () => cloudState.remote === null,
    load: async () => cloudState.remote,
    clear: async () => undefined,
    save: async () => {
      cloudState.saveCalls += 1
      if (cloudState.saveMode === 'fail') throw new Error('new row violates check constraint "tasks_priority_check"')
      if (cloudState.saveMode === 'slow-ok') {
        // Succeeds, but only after the test has switched accounts.
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
    },
  }),
}))
vi.mock('./syncStatus', () => ({
  markSyncing: () => undefined,
  markSynced: () => undefined,
  markSyncFailed: () => undefined,
  reconcileWithStore: () => undefined,
}))

const store = await import('./store')

type Priority = 'urgent' | 'high' | 'medium' | 'low'

const newTask = (priority: Priority) => ({
  title: `Task ${priority}`,
  description: '',
  subjectId: null,
  dueDate: '2026-12-01',
  dueTime: '',
  priority,
  category: 'study' as const,
  estimatedMinutes: 30,
})

/** A cloud account snapshot that authenticate() will accept as populated. */
const remoteAccount = (tasks: unknown[] = []) => ({
  profile: { displayName: 'A', motto: '', journeyStart: '2026-01-01', avatarSeed: 'alhelm' },
  settings: { language: 'en', theme: 'light', storage: 'cloud', reminders: [] },
  subjects: [],
  sessions: [],
  tasks,
  focusSessions: [],
  journal: [],
  goals: [],
  artworks: [],
  challenges: [],
  letters: [],
  notifications: [],
  exams: [],
})

const seedTask = {
  ...newTask('medium'),
  id: 'seed',
  completed: false,
  completedAt: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
}

beforeEach(async () => {
  localStorage.clear()
  cloudState.saveMode = 'ok'
  cloudState.saveCalls = 0
  cloudState.remote = null
  cloudState.userId = 'user-a'
  await store.initStore(true)
})

describe('local mode', () => {
  it('writes to the device and never claims a cloud save', async () => {
    await store.createTask(newTask('high'))
    expect(store.activePersistenceMode()).toBe('local')
    expect(store.getPendingCloudError()).toBeNull()
    const stored = JSON.parse(localStorage.getItem('alhelm.v1.tasks') || '[]')
    expect(stored).toHaveLength(1)
    expect(stored[0].priority).toBe('high')
    // No cloud adapter was ever asked to save.
    expect(cloudState.saveCalls).toBe(0)
  })

  it('persistCurrent reports where the change landed', async () => {
    expect(await store.persistCurrent()).toBe('local')
  })

  it('records a local persistence error and does not claim success', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded') })
    try {
      await expect(store.persistCurrent()).rejects.toThrow('quota exceeded')
      expect(store.getPersistenceError()).toContain('quota exceeded')
      expect(store.getPendingCloudError()).toBeNull()
    } finally {
      setItem.mockRestore()
    }
  })

  it('rolls the in-memory state back when the local write fails', async () => {
    const before = store.getState().tasks.length
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded') })
    try {
      await expect(store.createTask(newTask('low'))).rejects.toThrow('quota exceeded')
    } finally {
      setItem.mockRestore()
    }
    // Nothing was stored anywhere, so the task must not appear in state either.
    expect(store.getState().tasks.length).toBe(before)
  })
})

describe('cloud mode', () => {
  beforeEach(async () => {
    cloudState.remote = remoteAccount([seedTask])
    await store.authenticateCloudUser('user-a')
    expect(store.activePersistenceMode()).toBe('cloud')
    cloudState.saveCalls = 0
  })

  it('reports "cloud" only for a confirmed cloud write', async () => {
    await store.createTask(newTask('high'))
    expect(await store.persistCurrent()).toBe('cloud')
    expect(cloudState.saveCalls).toBeGreaterThan(0)
    expect(store.getPendingCloudError()).toBeNull()
  })

  it('a failed cloud write keeps the work locally and records a pending error', async () => {
    cloudState.saveMode = 'fail'
    // High is the realistic server-rejection case in production today: it is
    // valid client-side but the whole snapshot upsert is refused by the DB.
    await expect(store.createTask(newTask('high'))).rejects.toThrow(/tasks_priority_check/)

    // The change is still in memory (not rolled back) …
    expect(store.getState().tasks.some((task) => task.title === 'Task high')).toBe(true)
    // … and on this device.
    const stored = JSON.parse(localStorage.getItem('alhelm.v1.tasks') || '[]')
    expect(stored.some((task: { title: string }) => task.title === 'Task high')).toBe(true)
    // … and the account copy is explicitly known to be behind.
    expect(store.getPendingCloudError()).toContain('tasks_priority_check')
  })

  it('does not issue a redundant second write for one edit', async () => {
    vi.useFakeTimers()
    try {
      const write = store.createTask(newTask('high'))
      await vi.runAllTimersAsync()
      await write
      // One edit => one cloud save. A debounce that re-persisted would double it.
      expect(cloudState.saveCalls).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a successful write after a failure clears the pending error', async () => {
    cloudState.saveMode = 'fail'
    await expect(store.createTask(newTask('high'))).rejects.toThrow()
    expect(store.getPendingCloudError()).not.toBeNull()

    cloudState.saveMode = 'ok'
    expect(await store.persistCurrent()).toBe('cloud')
    expect(store.getPendingCloudError()).toBeNull()
  })
})

describe('retry', () => {
  beforeEach(async () => {
    cloudState.remote = remoteAccount([seedTask])
    await store.authenticateCloudUser('user-a')
    cloudState.saveCalls = 0
  })

  it('actually re-attempts the cloud write and clears the error on success', async () => {
    cloudState.saveMode = 'fail'
    await expect(store.createTask(newTask('high'))).rejects.toThrow()
    expect(store.getPendingCloudError()).not.toBeNull()

    cloudState.saveMode = 'ok'
    const callsBefore = cloudState.saveCalls
    expect(await store.retryPersistence()).toBe('cloud')
    expect(cloudState.saveCalls).toBeGreaterThan(callsBefore)
    expect(store.getPendingCloudError()).toBeNull()
    expect(store.getPersistenceError()).toBeNull()
  })

  it('throws and keeps the pending error when the retry also fails', async () => {
    cloudState.saveMode = 'fail'
    await expect(store.createTask(newTask('high'))).rejects.toThrow()
    await expect(store.retryPersistence()).rejects.toThrow()
    expect(store.getPendingCloudError()).not.toBeNull()
  })

  it('refuses to retry into a different signed-in account', async () => {
    cloudState.saveMode = 'fail'
    await expect(store.createTask(newTask('high'))).rejects.toThrow()
    // A different account signs in on this device.
    cloudState.userId = 'user-b'
    await expect(store.retryPersistence()).rejects.toThrow(/different account|sign in/i)
  })
})

describe('account changes', () => {
  it('a slow save from a previous account cannot record its result', async () => {
    cloudState.remote = remoteAccount()
    await store.authenticateCloudUser('user-a')
    cloudState.saveMode = 'slow-ok'

    const pending = store.createTask(newTask('high'))
    // Let the write actually start (it is queued), THEN switch accounts.
    await new Promise((resolve) => setTimeout(resolve, 5))
    // Switch accounts while the write is in flight.
    cloudState.remote = null
    await store.authenticateCloudUser('user-b')
    await expect(pending).rejects.toThrow()

    // Account B must not inherit A's pending cloud failure.
    expect(store.getPendingCloudError()).toBeNull()
  })

  it('logout clears the pending cloud error', async () => {
    cloudState.remote = remoteAccount([seedTask])
    await store.authenticateCloudUser('user-a')
    cloudState.saveMode = 'fail'
    await expect(store.createTask(newTask('high'))).rejects.toThrow()
    expect(store.getPendingCloudError()).not.toBeNull()

    await store.logoutCloudUser()
    expect(store.getPendingCloudError()).toBeNull()
    expect(store.activePersistenceMode()).toBe('local')
  })
})
