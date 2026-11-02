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
  const key = '__task_creation_snapshot__'
  const adapter = {
    label: 'local',
    kind: 'local',
    load: async () => {
      const raw = window.localStorage.getItem(key)
      return raw ? JSON.parse(raw) : null
    },
    save: async (data: unknown) => window.localStorage.setItem(key, JSON.stringify(data)),
    clear: async () => window.localStorage.removeItem(key),
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
    load: async () => {
      const { createInitialData } = await import('./domain')
      return createInitialData()
    },
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
    expect(created.writeResult).toBe('cloud')
    expect(cloud.saveCalls).toBe(1)
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

  it('does not require a retry after a cloud failure when the task is already local', async () => {
    cloud.saveThrows = 'network timeout'
    const task = await store.createTask(taskInput('No duplicates please'))
    // The local-only result prevents a false failure message that could prompt
    // the user to retry and create a second task.
    expect(task.writeResult).toBe('local-only')
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

  it('reports a real failure when the DEVICE write fails while cloud mode is active', async () => {
    // REGRESSION — the "tasks are not saved" report.
    //
    // `persistCloudSnapshot` writes the device copy first, then the cloud copy.
    // Its catch block used to run the "localSaved" branch whenever cloud mode
    // was active, so a DEVICE write failure (quota, private mode, a locked
    // profile) returned 'local' — "saved on this device" — for a task that
    // existed only in memory, and the next reload lost it with no error ever
    // shown. A failed device write must always be an error.
    expect(store.activePersistenceMode()).toBe('cloud')
    const adapter = await import('./persistence/adapter')
    const mutable = adapter.dataAdapter as unknown as { save: (data: unknown) => Promise<void> }
    const originalSave = mutable.save
    mutable.save = async () => { throw new Error('device storage full') }
    try {
      await expect(store.createTask(taskInput('Device write fails'))).rejects.toThrow(/device storage full/)
      // Nothing durable exists, so nothing must remain in the list either.
      expect(store.getState().tasks.filter((t) => t.title === 'Device write fails')).toHaveLength(0)
    } finally {
      mutable.save = originalSave
    }
  })

  it('persists task details with a subject, category, priority, and selected due date', async () => {
    const input = {
      ...taskInput('Practice algebra'),
      subjectId: 'subject-algebra',
      category: 'practice' as const,
      priority: 'urgent' as const,
      dueDate: '2026-11-09',
    }

    const created = await store.createTask(input)

    expect(created).toMatchObject({
      subjectId: 'subject-algebra',
      category: 'practice',
      priority: 'urgent',
      dueDate: '2026-11-09',
    })
    expect(store.getState().tasks).toContainEqual(expect.objectContaining({ id: created.id, ...input }))
  })

  it.each(['study', 'homework', 'revision', 'practice', 'art', 'other'] as const)(
    'persists the %s category',
    async (category) => {
      const created = await store.createTask({ ...taskInput(`Category ${category}`), category })
      expect(store.getState().tasks.find((task) => task.id === created.id)?.category).toBe(category)
    },
  )

  it.each(['urgent', 'high', 'medium', 'low'] as const)('persists the %s priority', async (priority) => {
    const created = await store.createTask({ ...taskInput(`Priority ${priority}`), priority })
    expect(store.getState().tasks.find((task) => task.id === created.id)?.priority).toBe(priority)
  })

  it('restores a locally saved task after store reinitialization', async () => {
    cloud.session = false
    await store.logoutCloudUser()
    await store.initStore(true)
    const created = await store.createTask(taskInput('Survives reload'))

    await store.initStore(true)

    expect(store.getState().tasks).toContainEqual(expect.objectContaining({
      id: created.id,
      title: 'Survives reload',
      dueDate: '2026-11-05',
    }))
  })

  it('preserves the task locally and reports a cloud RLS rejection', async () => {
    cloud.saveThrows = 'new row violates row-level security policy'

    const created = await store.createTask(taskInput('Keep after RLS failure'))

    expect(created.writeResult).toBe('local-only')
    expect(store.getState().tasks).toContainEqual(expect.objectContaining({ id: created.id }))
    expect(store.getPendingCloudError()).toContain('row-level security')
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

  it('persists edits, rescheduling, completion, reopening, and deletion', async () => {
    const created = await store.createTask(taskInput('Manage all task changes'))
    const updatedWrite = await store.updateTask(created.id, { title: 'Updated task', dueDate: '2026-11-12' })
    expect(updatedWrite).toBe('cloud')
    expect(store.getState().tasks.find((item) => item.id === created.id)).toMatchObject({
      title: 'Updated task',
      dueDate: '2026-11-12',
    })

    await store.rescheduleTask(created.id, '2026-11-13')
    expect(store.getState().tasks.find((item) => item.id === created.id)?.dueDate).toBe('2026-11-13')

    const completeWrite = await store.setTaskCompleted(created.id, true)
    expect(completeWrite).toBe('cloud')
    expect(store.getState().tasks.find((item) => item.id === created.id)?.completed).toBe(true)

    await store.setTaskCompleted(created.id, false)
    expect(store.getState().tasks.find((item) => item.id === created.id)?.completed).toBe(false)

    const deleteWrite = await store.deleteTask(created.id)
    expect(deleteWrite).toBe('cloud')
    expect(store.getState().tasks.some((item) => item.id === created.id)).toBe(false)
  })

  it('returns the result of the current edit instead of a stale create result', async () => {
    const created = await store.createTask(taskInput('Result must be current'))
    cloud.saveThrows = 'network timeout'

    const result = await store.updateTask(created.id, { title: 'Edited locally' })

    expect(result).toBe('local-only')
    expect(store.getLastWriteResult()).toBe('local-only')
  })
})
