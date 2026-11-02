import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Pending-write recovery.
 *
 * THE RISK THIS PINS
 *   The store writes a local recovery snapshot BEFORE it attempts the cloud
 *   save. If the cloud save is rejected (for example the production
 *   `invalid input syntax for type time: ""` failure), the device copy is the
 *   ONLY copy of the user's task. The coordinator then, on the next cold start,
 *   replaced the local snapshot wholesale with the server snapshot:
 *
 *       this.state = { data: hydrateData(remote), mode: 'cloud', ... }
 *
 *   so the task the user watched being added silently vanished after a restart.
 *   Nothing was logged and nothing was shown, which is exactly how the owner
 *   came to report "tasks are not being saved".
 *
 * THE CONTRACT NOW
 *   - A record that exists ONLY on this device is queued as pending, kept in the
 *     local recovery snapshot and merged into the loaded state so it stays
 *     visible after a restart.
 *   - A record that exists on BOTH sides takes the SERVER value: a stale local
 *     copy must never overwrite a newer server record.
 *   - The same id is never duplicated.
 *   - The merge is bounded, so a device that has drifted years out of date cannot
 *     resurrect records the user deleted on another device.
 */

const cloud = vi.hoisted(() => ({
  remote: null as Record<string, unknown> | null,
  saves: 0,
  failSave: false,
}))

vi.mock('./adapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./adapter')>()
  return { dataAdapter: new actual.LocalStorageAdapter() }
})

const task = (id: string, title: string, stamp: string) => ({
  id,
  title,
  description: '',
  subjectId: null,
  dueDate: '2026-11-05',
  dueTime: '',
  priority: 'medium',
  category: 'study',
  estimatedMinutes: 30,
  completed: false,
  completedAt: null,
  createdAt: stamp,
  updatedAt: stamp,
})

const { PersistenceCoordinator } = await import('./coordinator')
const { hydrateData, createInitialData } = await import('../domain')
const { dataAdapter } = await import('./adapter')

function serverSnapshot(tasks: unknown[]) {
  return { ...createInitialData(), tasks } as never
}

let coordinator: InstanceType<typeof PersistenceCoordinator>

beforeEach(async () => {
  await dataAdapter.clear()
  cloud.remote = null
  cloud.saves = 0
  cloud.failSave = false

  const cloudAdapter = {
    label: 'cloud',
    kind: 'cloud' as const,
    load: async () => (cloud.remote ? structuredClone(cloud.remote) as never : null),
    save: async () => {
      cloud.saves += 1
      if (cloud.failSave) throw new Error('invalid input syntax for type time: ""')
    },
    clear: async () => undefined,
    userId: async () => 'user-qa',
    hasSession: async () => true,
    isCloudEmpty: async () => false,
  }
  coordinator = new PersistenceCoordinator(dataAdapter, cloudAdapter as never)
  coordinator.useMarkerStorage(null)
})

/** Simulates the store's write-through before a cloud failure. */
async function saveLocally(tasks: unknown[]) {
  const snapshot = hydrateData(serverSnapshot(tasks))
  await dataAdapter.save({ ...snapshot, settings: { ...snapshot.settings, storage: 'local' } } as never)
}

describe('a locally saved task survives a cold start after a rejected cloud write', () => {
  it('keeps the device-only task visible when the server has other content', async () => {
    // The server already holds one task (so the account is NOT treated as new).
    cloud.remote = serverSnapshot([task('tsk_server', 'Server task', '2026-11-01T09:00:00.000Z')])
    // The user adds a second task while the server write fails.
    await saveLocally([
      task('tsk_server', 'Server task', '2026-11-01T09:00:00.000Z'),
      task('tsk_pending', 'Never reached the server', '2026-11-02T10:00:00.000Z'),
    ])

    const state = await coordinator.authenticate('user-qa')
    const titles = state.data.tasks.map((entry) => entry.title)
    expect(titles).toContain('Never reached the server')
    // The server record is still there and is not duplicated.
    expect(state.data.tasks.filter((entry) => entry.id === 'tsk_server')).toHaveLength(1)
  })

  it('reports the queued record so the UI can say "waiting to sync"', async () => {
    cloud.remote = serverSnapshot([task('tsk_server', 'Server task', '2026-11-01T09:00:00.000Z')])
    await saveLocally([
      task('tsk_server', 'Server task', '2026-11-01T09:00:00.000Z'),
      task('tsk_pending', 'Waiting', '2026-11-02T10:00:00.000Z'),
    ])
    const state = await coordinator.authenticate('user-qa')
    expect(coordinator.pendingUploadCount()).toBe(1)
    void state
  })

  it('never lets a stale local copy overwrite a newer server record', async () => {
    cloud.remote = serverSnapshot([task('tsk_shared', 'Renamed on another device', '2026-11-03T12:00:00.000Z')])
    // The device still holds the older title for the same id.
    await saveLocally([task('tsk_shared', 'Old title', '2026-11-01T09:00:00.000Z')])

    const state = await coordinator.authenticate('user-qa')
    expect(state.data.tasks).toHaveLength(1)
    expect(state.data.tasks[0].title).toBe('Renamed on another device')
  })

  it('does not resurrect a record the server deleted long ago', async () => {
    cloud.remote = serverSnapshot([task('tsk_fresh', 'Fresh', '2026-11-03T12:00:00.000Z')])
    // A very old device-only record: the user deleted it elsewhere a year ago.
    await saveLocally([task('tsk_ancient', 'Deleted elsewhere', '2025-01-01T00:00:00.000Z')])

    const state = await coordinator.authenticate('user-qa')
    expect(state.data.tasks.map((entry) => entry.id)).not.toContain('tsk_ancient')
  })

  it('merge is deterministic: authenticating twice yields the same result', async () => {
    cloud.remote = serverSnapshot([task('tsk_server', 'Server task', '2026-11-01T09:00:00.000Z')])
    await saveLocally([
      task('tsk_server', 'Server task', '2026-11-01T09:00:00.000Z'),
      task('tsk_pending', 'Pending', '2026-11-02T10:00:00.000Z'),
    ])

    const first = await coordinator.authenticate('user-qa')
    const second = await coordinator.authenticate('user-qa')
    expect(second.data.tasks.map((entry) => entry.id).sort()).toEqual(first.data.tasks.map((entry) => entry.id).sort())
  })

  it('an empty device gains nothing from the merge', async () => {
    cloud.remote = serverSnapshot([task('tsk_server', 'Server task', '2026-11-01T09:00:00.000Z')])
    const state = await coordinator.authenticate('user-qa')
    expect(state.data.tasks.map((entry) => entry.id)).toEqual(['tsk_server'])
    expect(coordinator.pendingUploadCount()).toBe(0)
  })
})
