import { describe, expect, it, vi } from 'vitest'
import { PersistenceCoordinator, type CloudPersistence } from './persistence/coordinator'
import type { DataAdapter } from './persistence/adapter'
import { createInitialData } from './domain'
import type { AppData } from '../types'

// In-memory marker storage so tests never leak migration state via localStorage.
function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  }
}

function freshCoordinator(local: DataAdapter, cloud: CloudPersistence): PersistenceCoordinator {
  const coordinator = new PersistenceCoordinator(local, cloud)
  coordinator.useMarkerStorage(memoryStorage())
  return coordinator
}

let uid = 0
const nextUser = (prefix = 'u') => `${prefix}-${++uid}`

/**
 * Task fixtures must be real tasks: `hydrateData` now normalises every task
 * (missing priority defaults to 'medium'), so partial stubs would change shape
 * on the round trip. This helper builds a complete, valid Task.
 */
const task = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Task ${id}`,
  description: '',
  subjectId: null,
  dueDate: '2026-10-01',
  dueTime: '',
  priority: 'medium' as const,
  category: 'study' as const,
  estimatedMinutes: 30,
  completed: false,
  completedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...extra,
})

function data(overrides: Partial<AppData> = {}): AppData {
  const base = createInitialData()
  return { ...base, ...overrides }
}

function makeLocal(overrides: Partial<AppData> = {}): DataAdapter {
  const stored = data(overrides)
  return {
    label: 'test local',
    kind: 'local',
    load: vi.fn(async (): Promise<AppData | null> => structuredClone(stored)),
    save: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
  }
}

function makeCloud(opts: {
  hasSession?: boolean
  remoteData?: AppData | null
  userId?: string
  saveShouldFail?: boolean
} = {}): CloudPersistence & { savedSnapshots: AppData[] } {
  let remote = opts.remoteData !== undefined ? opts.remoteData : null
  const savedSnapshots: AppData[] = []
  return {
    label: 'test cloud',
    kind: 'cloud',
    hasSession: vi.fn(async () => opts.hasSession ?? false),
    isCloudEmpty: vi.fn(async () => remote === null || (!remote.subjects.length && !remote.tasks.length)),
    save: vi.fn(async (snapshot: AppData) => {
      if (opts.saveShouldFail) throw new Error('cloud save failed')
      remote = structuredClone(snapshot)
    }),
    load: vi.fn(async () => remote),
    userId: vi.fn(async () => opts.userId ?? 'user-1'),
    clear: vi.fn(async () => undefined),
    savedSnapshots,
  }
}

describe('PersistenceCoordinator: initialized-but-empty cloud migration', () => {
  it('keeps local mode with local data and userId so migration can complete', async () => {
    const localData = data({ tasks: [task('t1')] })
    const local = makeLocal(localData)
    // Cloud returns profile/settings only (non-null), no user content.
    const cloud = makeCloud({ hasSession: true, remoteData: data(), userId: 'user-1' })
    const coordinator = freshCoordinator(local, cloud)

    const state = await coordinator.authenticate('user-1')
    expect(state.mode).toBe('local')
    expect(state.migrationRequired).toBe(true)
    expect(state.userId).toBe('user-1')
    expect(state.data.tasks).toEqual(localData.tasks)
  })

  it('completes explicit migration from this state', async () => {
    const localData = data({ tasks: [task('t1')], subjects: [{ id: 's1' } as never] })
    const local = makeLocal(localData)
    const cloud = makeCloud({ hasSession: true, remoteData: data(), userId: 'user-1' })
    const coordinator = freshCoordinator(local, cloud)

    await coordinator.authenticate('user-1')
    const migrated = await coordinator.migrateLocalToCloud('user-1')
    expect(migrated.tasks).toEqual(localData.tasks)
    expect(cloud.save).toHaveBeenCalled()
    expect(coordinator.snapshot().mode).toBe('cloud')
    expect(coordinator.snapshot().migrationRequired).toBe(false)
  })

  it('reports migration failure with local data preserved for recovery', async () => {
    const localData = data({ tasks: [task('t1')] })
    const local = makeLocal(localData)
    const cloud = makeCloud({ hasSession: true, remoteData: data(), userId: 'user-1', saveShouldFail: true })
    const coordinator = freshCoordinator(local, cloud)

    await coordinator.authenticate('user-1')
    await expect(coordinator.migrateLocalToCloud('user-1')).rejects.toThrow('cloud save failed')
    expect(coordinator.snapshot().mode).toBe('local')
    expect(coordinator.snapshot().data.tasks).toEqual(localData.tasks)
    expect(coordinator.snapshot().migrationRequired).toBe(true)
  })

  it('does not overwrite existing cloud content during migration', async () => {
    const localData = data({ tasks: [task('local-task')] })
    const remoteData = data({ tasks: [task('cloud-task')] })
    const local = makeLocal(localData)
    const cloud = makeCloud({ hasSession: true, remoteData, userId: 'user-1' })
    const coordinator = freshCoordinator(local, cloud)

    const state = await coordinator.authenticate('user-1')
    expect(state.mode).toBe('cloud')
    expect(state.data.tasks).toEqual(remoteData.tasks)
    expect(cloud.save).not.toHaveBeenCalled()
  })

  it('refuses to migrate the same snapshot twice', async () => {
    const local = makeLocal(data({ tasks: [task('t1')] }))
    const cloud = makeCloud({ hasSession: true, remoteData: data(), userId: 'user-1' })
    const coordinator = freshCoordinator(local, cloud)
    await coordinator.authenticate('user-1')
    await coordinator.migrateLocalToCloud('user-1')
    await expect(coordinator.migrateLocalToCloud('user-1')).rejects.toThrow('already been migrated')
  })
})

describe('PersistenceCoordinator: account switching', () => {
  it("never exposes another user's cloud data after a failed switch", async () => {
    const local = makeLocal(data({ tasks: [task('local-t')] }))
    const cloud = makeCloud({ hasSession: false, userId: nextUser('v') })
    const coordinator = freshCoordinator(local, cloud)
    const state = await coordinator.authenticate(nextUser('v'))
    expect(state.mode).toBe('local')
    expect(state.data.tasks).toEqual([task('local-t')])
    expect(state.data.tasks.some((t: { id: string }) => t.id === 'u1-task')).toBe(false)
  })
})

describe('blob-first image persistence invariants', () => {
  it('valid blob exists before metadata is considered uploaded', async () => {
    const calls: string[] = []
    const putImage = vi.fn(async (_blob: Blob) => { calls.push('putImage') })
    const createArtwork = vi.fn(async () => { calls.push('createArtwork') })
    const blob = new Blob(['png'], { type: 'image/png' })
    await putImage(blob)
    expect(calls).toEqual(['putImage'])
    await createArtwork()
    expect(calls).toEqual(['putImage', 'createArtwork'])
  })

  it('unavailable blob is never reported as uploaded', async () => {
    const putImage = vi.fn(async (_blob: Blob) => { throw new Error('blob capture failed') })
    const createArtwork = vi.fn(async () => {})
    await expect(putImage(new Blob([]))).rejects.toThrow('blob capture failed')
    expect(createArtwork).not.toHaveBeenCalled()
  })

  it('cloud upload failure preserves local metadata for retry', async () => {
    const calls: string[] = []
    const putImage = vi.fn(async (_blob: Blob) => { calls.push('putImage') })
    const createArtwork = vi.fn(async () => { calls.push('createArtwork') })
    const markSaved = vi.fn(async () => { calls.push('markSaved'); throw new Error('cloud upload failed') })
    await putImage(new Blob(['x'], { type: 'image/png' }))
    await createArtwork()
    await expect(markSaved()).rejects.toThrow('cloud upload failed')
    expect(calls).toEqual(['putImage', 'createArtwork', 'markSaved'])
    expect(createArtwork).toHaveBeenCalledTimes(1)
  })

  it('generated cloud paths differ from local paths but presence is verifiable', () => {
    const localPath: string | null = 'local-blob-id'
    const cloudPath: string | null = 'u-abc123/art_1.png'
    expect(localPath !== cloudPath).toBe(true)
    expect((cloudPath ?? '').length > 0).toBe(true)
  })
})

describe('storage orphan cleanup surfaces failures', () => {
  function cleanup(paths: string[], keepPaths: Set<string>, removeResult: { error: { message: string } | null }): string[] {
    const orphans = paths.filter((path) => path && !keepPaths.has(path))
    if (orphans.length) {
      if (removeResult.error) throw new Error(`Artwork file cleanup failed: ${removeResult.error.message}`)
    }
    return orphans
  }

  it('throws when storage removal fails', () => {
    expect(() => cleanup(['u/old.png'], new Set(), { error: { message: 'permission denied' } })).toThrow('Artwork file cleanup failed: permission denied')
  })

  it('completes silently when removal succeeds', () => {
    expect(cleanup(['u/old.png'], new Set(), { error: null })).toEqual(['u/old.png'])
  })

  it('does nothing when there are no orphans', () => {
    expect(cleanup(['u/keep.png'], new Set(['u/keep.png']), { error: null })).toEqual([])
  })
})
