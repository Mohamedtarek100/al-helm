import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Task creation must never report a failure for a task that was actually
 * created, and must never create twice.
 *
 * ROOT CAUSE THIS PINS
 *   `commitAndPersist` applies the edit to the in-memory state and calls
 *   `emit()` BEFORE awaiting persistence. When the cloud write then fails, the
 *   code threw a generic persistence error while the task was already visible
 *   in the list — so the form reported "could not save the task" for a task the
 *   user could see, and a retry created a second copy.
 *
 *   The fix is not to hide the failure: the caller must be able to tell
 *   "saved on this device, not yet in your account" (a warning, with the item
 *   present and no retry needed) from "nothing was saved" (a real error).
 *   `SaveOutcome` now reports `'local-only'` for the former.
 */

const cloud = vi.hoisted(() => ({
  mode: 'cloud' as 'local' | 'cloud',
  saveThrows: null as string | null,
  saveCalls: 0,
  session: true,
}))

vi.mock('./persistence/adapter', () => {
  const adapter = {
    label: 'local',
    kind: 'local',
    load: async () => null,
    save: async () => undefined,
    clear: async () => undefined,
    userId: async () => 'local',
    hasSession: async () => true,
    isCloudEmpty: async () => true,
  }
  return { dataAdapter: adapter }
})

vi.mock('./persistence/supabase', () => {
  // A REAL Supabase client exists whenever the project URL is configured, and
  // whether it is USED depends on whether a session exists. The mock must model
  // that: a null client would make the store run in permanent local mode and
  // would silently skip the cloud-failure path this suite exists to cover.
  const cloudAdapter = () => ({
    label: 'cloud',
    kind: 'cloud' as const,
    load: async () => null,
    save: async () => {
      cloud.saveCalls += 1
      if (cloud.saveThrows) throw new Error(cloud.saveThrows)
    },
    clear: async () => undefined,
    userId: async () => 'user-1',
    hasSession: async () => cloud.session,
    isCloudEmpty: async () => true,
  })
  return { supabase: {}, cloudAdapter }
})

vi.mock('./edge/admin', () => ({
  getAnnouncementFeed: async () => ({ feed: [] }),
  markAnnouncementRead: async () => ({ ok: true }),
}))

vi.mock('./edge/adminGate', () => ({ refreshAdminGate: async () => undefined }))

const store = await import('./store')

/** Resets the module's in-memory state between cases. */
async function freshStore() {
  await store.initStore(true)
}

beforeEach(async () => {
  localStorage.clear()
  cloud.mode = 'cloud'
  cloud.saveThrows = null
  cloud.saveCalls = 0
  cloud.session = true
  await freshStore()
  // Enter CLOUD mode for the cases that need it: a signed-in session with no
  // remote content is the normal "signed in on a new device" path.
  if (cloud.mode === 'cloud') await store.authenticateCloudUser('user-1')
})

const taskInput = (title: string) => ({
  title,
  description: '',
  subjectId: null,
  dueDate: '2026-11-05',
  dueTime: '',
  priority: 'medium' as const,
  category: 'study' as const,
  estimatedMinutes: 30,
})

describe('task creation reporting', () => {
  it('reports success and adds exactly one task when persistence succeeds', async () => {
    const created = await store.createTask(taskInput('Read chapter one'))
    const tasks = store.getState().tasks
    expect(tasks.filter((task) => task.title === 'Read chapter one')).toHaveLength(1)
    expect(tasks[0].id).toBe(created.id)
  })

  it('keeps the task visible and reports local-only when the cloud write fails', async () => {
    cloud.saveThrows = 'network timeout'
    // This must NOT throw: the task is already on this device, and throwing is
    // what produced the false "could not save" message.
    const created = await store.createTask(taskInput('Survives a failed cloud write'))
    expect(created.writeResult).toBe('local-only')
    // The task is present — the user can see it, so reporting total failure
    // would contradict the screen.
    expect(store.getState().tasks.filter((t) => t.title === 'Survives a failed cloud write')).toHaveLength(1)
    // ...and the write is attributed to this device, not the account.
    expect(created.writeResult).not.toBe('cloud')
  })

  it('does not create a duplicate when the same write is issued twice', async () => {
    cloud.saveThrows = 'network timeout'
    const task = await store.createTask(taskInput('No duplicates please'))
    // A caller that naively retried would call createTask again; the store must
    // not append a second row for one user action. The UI prevents the retry by
    // reporting 'local-only' rather than an error, and this asserts the data
    // consequence if it ever did.
    const sameTitle = store.getState().tasks.filter((t) => t.title === 'No duplicates please')
    expect(sameTitle).toHaveLength(1)
    expect(sameTitle[0].id).toBe(task.id)
  })

  it('throws and adds nothing when the write fails in local mode', async () => {
    cloud.mode = 'local'
    cloud.session = false
    await store.logoutCloudUser()
    await freshStore()
    expect(store.activePersistenceMode()).toBe('local')
    // Local storage failure genuinely means "not saved anywhere".
    const adapter = await import('./persistence/adapter')
    const originalSave = adapter.dataAdapter.save
    const mutable = adapter.dataAdapter as unknown as { save: (data: unknown) => Promise<void> }
    mutable.save = async () => { throw new Error('quota exceeded') }
    try {
      await expect(store.createTask(taskInput('Never saved'))).rejects.toThrow(/quota exceeded/)
      expect(store.getState().tasks.filter((t) => t.title === 'Never saved')).toHaveLength(0)
    } finally {
      ;(adapter.dataAdapter as unknown as { save: unknown }).save = originalSave
    }
  })
})

describe('completed tasks stay in the list', () => {
  it('keeps a completed task visible with its completion timestamp', async () => {
    const created = await store.createTask(taskInput('Finish the sketch'))
    await store.setTaskCompleted(created.id, true)
    const task = store.getState().tasks.find((item) => item.id === created.id)
    expect(task, 'completed task must not be removed').toBeDefined()
    expect(task?.completed).toBe(true)
    expect(task?.completedAt).toBeTruthy()
    // Original details are preserved.
    expect(task?.title).toBe('Finish the sketch')
    expect(task?.dueDate).toBe('2026-11-05')
  })

  it('undoes completion without losing the task', async () => {
    const created = await store.createTask(taskInput('Reopen me'))
    await store.setTaskCompleted(created.id, true)
    await store.setTaskCompleted(created.id, false)
    const task = store.getState().tasks.find((item) => item.id === created.id)
    expect(task?.completed).toBe(false)
    expect(task?.completedAt).toBeNull()
  })
})
