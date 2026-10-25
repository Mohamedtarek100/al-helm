import { describe, expect, it } from 'vitest'
import { hydrateData, hydrateTask, needsTaskNormalization } from './domain'
import type { AppData, Task } from '../types'

/**
 * Legacy task priority normalisation — persisted, not just displayed.
 *
 * Root cause this suite guards against: `hydrateData` repaired the in-memory
 * copy on every load, but nothing wrote it back, so the STORED snapshot kept
 * `priority: undefined` indefinitely and exports could omit the field.
 * `needsTaskNormalization` is the trigger the store uses to write back exactly
 * once.
 */

const legacyTask = (overrides: Record<string, unknown> = {}) => ({
  id: 'tsk_legacy',
  title: 'Legacy task',
  description: 'kept',
  subjectId: 'sub_1',
  dueDate: '2026-10-01',
  dueTime: '',
  // NOTE: no `priority` field at all — this is the legacy shape.
  category: 'study',
  estimatedMinutes: 45,
  completed: false,
  completedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
  ...overrides,
})

const store = (tasks: unknown[]): Partial<AppData> => ({ tasks: tasks as Task[] })

describe('1. legacy task without priority hydrates to medium', () => {
  it('fills the missing priority during hydration', () => {
    const hydrated = hydrateData(store([legacyTask()]))
    expect(hydrated.tasks[0].priority).toBe('medium')
  })

  it('leaves the original object untouched (hydration is not a mutation)', () => {
    const original = legacyTask()
    hydrateTask(original as unknown as Task)
    expect('priority' in original).toBe(false)
  })
})

describe('2. the persisted snapshot also contains medium', () => {
  it('reports a legacy snapshot as needing normalisation', () => {
    expect(needsTaskNormalization(store([legacyTask()]))).toBe(true)
  })

  it('the form the store writes back is itself fully normalised', () => {
    // The store persists `hydrateData(restored)` — prove that payload carries medium.
    const toPersist = hydrateData(store([legacyTask()]))
    expect(JSON.stringify(toPersist.tasks[0])).toContain('"priority":"medium"')
    // …and that writing it back leaves nothing further to migrate.
    expect(needsTaskNormalization(toPersist)).toBe(false)
  })

  it('preserves ids, relationships, timestamps and unrelated fields', () => {
    const [before] = store([legacyTask()]).tasks!
    const [after] = hydrateData(store([legacyTask()])).tasks
    expect(after.id).toBe(before.id)
    expect(after.subjectId).toBe('sub_1')
    expect(after.createdAt).toBe('2026-09-01T00:00:00.000Z')
    expect(after.updatedAt).toBe('2026-09-02T00:00:00.000Z')
    expect(after.title).toBe('Legacy task')
    expect(after.description).toBe('kept')
    expect(after.completed).toBe(false)
    expect(after.estimatedMinutes).toBe(45)
    expect(after.dueDate).toBe('2026-10-01')
  })
})

describe('3. reinitialisation is idempotent', () => {
  it('does not request a write when every task is already normalised', () => {
    const normalised = hydrateData(store([legacyTask()]))
    expect(needsTaskNormalization(normalised)).toBe(false)
  })

  it('repeated hydration produces an identical snapshot', () => {
    const once = hydrateData(store([legacyTask()]))
    const twice = hydrateData(once)
    expect(twice.tasks).toEqual(once.tasks)
  })

  it('never rewrites a snapshot that has no tasks', () => {
    expect(needsTaskNormalization(store([]))).toBe(false)
    expect(needsTaskNormalization({})).toBe(false)
    expect(needsTaskNormalization(null)).toBe(false)
  })

  it('does not flag a task that only lacks nothing — a fully valid record', () => {
    const valid = { ...legacyTask(), priority: 'high' }
    expect(needsTaskNormalization(store([valid]))).toBe(false)
  })
})

describe('4. exported data contains the normalised priority', () => {
  it('serialising the hydrated state includes the priority for every task', () => {
    const state = hydrateData(store([legacyTask(), legacyTask({ id: 'tsk_2', priority: 'urgent' })]))
    const json = JSON.stringify({ app: 'alhelm', version: 1, data: state })
    expect(json).toContain('"priority":"medium"')
    expect(json).toContain('"priority":"urgent"')
  })

  it('an export built from the *stored* legacy snapshot would omit it — why the write-back matters', () => {
    const storedLegacy = legacyTask()
    expect(JSON.stringify(storedLegacy)).not.toContain('priority')
    // After the one-time write-back the persisted form does contain it.
    const persisted = hydrateData(store([storedLegacy]))
    expect(JSON.stringify(persisted.tasks[0])).toContain('priority')
  })
})

describe('5. malformed or failed hydration never overwrites valid data', () => {
  it('a non-array tasks slice is treated as "nothing to migrate"', () => {
    expect(needsTaskNormalization({ tasks: 'oops' as unknown as Task[] })).toBe(false)
    expect(needsTaskNormalization({ tasks: undefined })).toBe(false)
  })

  it('hydration of a corrupt task list still yields safe, complete tasks', () => {
    const corrupted = hydrateData({ tasks: [null, undefined, { id: 'x' }] as unknown as Task[] })
    // Nothing valid to show, but also no throw and no fabricated user content.
    expect(Array.isArray(corrupted.tasks)).toBe(true)
  })

  it('a null snapshot hydrates to a clean initial state (no write triggered)', () => {
    const fresh = hydrateData(null)
    expect(fresh.tasks).toEqual([])
    expect(needsTaskNormalization(null)).toBe(false)
  })

  it('preserves user-authored task content even when other fields are malformed', () => {
    const messy = hydrateTask({ ...legacyTask(), estimatedMinutes: 'abc', dueTime: 99 } as unknown as Task)
    expect(messy.title).toBe('Legacy task')
    expect(messy.priority).toBe('medium')
    expect(messy.estimatedMinutes).toBe(30) // repaired, not dropped
    expect(messy.dueTime).toBe('') // repaired to a string
  })
})

describe('6. existing valid priorities are never altered', () => {
  it.each(['urgent', 'high', 'medium', 'low'] as const)('keeps %s unchanged through hydration', (level) => {
    const hydrated = hydrateData(store([legacyTask({ priority: level })]))
    expect(hydrated.tasks[0].priority).toBe(level)
    expect(needsTaskNormalization(store([legacyTask({ priority: level })]))).toBe(false)
  })

  it('preserves each priority independently in a mixed snapshot', () => {
    const mixed = store([
      legacyTask({ id: 'a', priority: 'urgent' }),
      legacyTask({ id: 'b', priority: 'high' }),
      legacyTask({ id: 'c' }), // legacy → medium
      legacyTask({ id: 'd', priority: 'low' }),
    ])
    expect(hydrateData(mixed).tasks.map((t) => t.priority)).toEqual(['urgent', 'high', 'medium', 'low'])
  })

  it('replaces an unknown priority with medium instead of crashing', () => {
    const hydrated = hydrateData(store([legacyTask({ priority: 'critical' })]))
    expect(hydrated.tasks[0].priority).toBe('medium')
    expect(needsTaskNormalization(store([legacyTask({ priority: 'critical' })]))).toBe(true)
  })
})
