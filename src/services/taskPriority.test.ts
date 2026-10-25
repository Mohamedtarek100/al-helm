import { describe, expect, it } from 'vitest'
import { hydrateData, hydrateTask, TASK_PRIORITY_LABELS, TASK_PRIORITY_ORDER } from './domain'
import { countTasks, emptyTaskFilter, filterTasks, isTaskOverdue, sortTasks } from './taskSelectors'
import type { Task, TaskPriority } from '../types'

/**
 * Task priority: model, defaults and selection behaviour.
 *
 * Priority is persisted data (localStorage slice, backup JSON, Supabase
 * `tasks.priority`, migration 005), never a display-only tag. These tests pin
 * the four levels, the default-medium upgrade path for legacy records, and the
 * filter/sort semantics users see in My Tasks.
 */

const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  title: `Task ${id}`,
  description: '',
  subjectId: null,
  dueDate: '2026-10-20',
  dueTime: '',
  priority: 'medium',
  category: 'study',
  estimatedMinutes: 30,
  completed: false,
  completedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
})

describe('priority model', () => {
  it('defines exactly four levels, ordered highest-first', () => {
    expect([...TASK_PRIORITY_ORDER]).toEqual(['urgent', 'high', 'medium', 'low'])
    expect(Object.keys(TASK_PRIORITY_LABELS)).toEqual(expect.arrayContaining(['urgent', 'high', 'medium', 'low']))
  })

  it('has a human label for every level (colour is never the only cue)', () => {
    for (const level of TASK_PRIORITY_ORDER) {
      expect(TASK_PRIORITY_LABELS[level]).toBeTruthy()
    }
  })
})

describe('hydrateTask: legacy-record upgrade', () => {
  it('defaults a missing priority to medium', () => {
    const legacy = { id: 't1', title: 'Old', description: '', subjectId: null, dueDate: '2026-01-01', dueTime: '', category: 'study', estimatedMinutes: 30, completed: false, completedAt: null, createdAt: 'x', updatedAt: 'x' } as unknown as Task
    expect(hydrateTask(legacy).priority).toBe('medium')
  })

  it('preserves an existing valid priority', () => {
    for (const level of TASK_PRIORITY_ORDER) {
      expect(hydrateTask(task('t', { priority: level })).priority).toBe(level)
    }
  })

  it('replaces an unknown priority value with medium instead of crashing', () => {
    const weird = task('t', { priority: 'critical' as unknown as TaskPriority })
    expect(hydrateTask(weird).priority).toBe('medium')
  })

  it('repairs other missing task fields without losing content', () => {
    const partial = { id: 't9', title: 'Keep me', priority: 'high' } as unknown as Task
    const healed = hydrateTask(partial)
    expect(healed.title).toBe('Keep me')
    expect(healed.priority).toBe('high')
    expect(healed.category).toBe('study')
    expect(healed.estimatedMinutes).toBe(30)
    expect(healed.dueTime).toBe('')
  })
})

describe('hydrateData: whole-snapshot compatibility', () => {
  it('upgrades every legacy task in a stored snapshot', () => {
    const snapshot = hydrateData({
      tasks: [
        { id: 'a', title: 'A', description: '', subjectId: null, dueDate: '2026-01-01', dueTime: '', category: 'study', estimatedMinutes: 30, completed: false, completedAt: null, createdAt: 'x', updatedAt: 'x' },
        { id: 'b', title: 'B', description: '', subjectId: null, dueDate: '2026-01-02', dueTime: '', priority: 'urgent', category: 'art', estimatedMinutes: 10, completed: true, completedAt: 'x', createdAt: 'x', updatedAt: 'x' },
      ] as unknown as Task[],
    })
    expect(snapshot.tasks.map((t) => t.priority)).toEqual(['medium', 'urgent'])
    expect(snapshot.tasks[1].completed).toBe(true) // user content untouched
  })

  it('is idempotent: re-hydrating a hydrated snapshot changes nothing', () => {
    const once = hydrateData({ tasks: [task('a', { priority: 'low' })] })
    const twice = hydrateData(once)
    expect(twice.tasks).toEqual(once.tasks)
  })

  it('does not invent tasks for a brand-new account', () => {
    expect(hydrateData(null).tasks).toEqual([])
  })
})

describe('filterTasks: priority filtering', () => {
  const tasks = [
    task('u', { priority: 'urgent' }),
    task('h', { priority: 'high' }),
    task('m', { priority: 'medium' }),
    task('l', { priority: 'low' }),
    task('done', { priority: 'urgent', completed: true }),
  ]

  it('"all priorities" returns everything', () => {
    expect(filterTasks(tasks, { ...emptyTaskFilter, status: 'all' })).toHaveLength(5)
  })

  it.each(['urgent', 'high', 'medium', 'low'] as const)('filters to only %s tasks', (level) => {
    const result = filterTasks(tasks, { ...emptyTaskFilter, priority: level })
    expect(result.every((t) => t.priority === level)).toBe(true)
    expect(result.length).toBeGreaterThan(0)
  })

  it('combines priority with completion status', () => {
    const result = filterTasks(tasks, { ...emptyTaskFilter, status: 'open', priority: 'urgent' })
    expect(result.map((t) => t.id)).toEqual(['u'])
  })

  it('returns nothing when no task has that priority', () => {
    expect(filterTasks([task('a', { priority: 'low' })], { ...emptyTaskFilter, priority: 'urgent' })).toEqual([])
  })
})

describe('sortTasks: priority ordering', () => {
  it('sorts urgent → high → medium → low', () => {
    const tasks = [task('l', { priority: 'low' }), task('u', { priority: 'urgent' }), task('m', { priority: 'medium' }), task('h', { priority: 'high' })]
    expect(sortTasks(tasks, 'priority').map((t) => t.priority)).toEqual(['urgent', 'high', 'medium', 'low'])
  })

  it('breaks priority ties by due date', () => {
    const tasks = [
      task('late', { priority: 'high', dueDate: '2026-12-01' }),
      task('soon', { priority: 'high', dueDate: '2026-11-01' }),
      task('urgent', { priority: 'urgent', dueDate: '2026-12-20' }),
    ]
    expect(sortTasks(tasks, 'priority').map((t) => t.id)).toEqual(['urgent', 'soon', 'late'])
  })

  it('keeps completed tasks last in due-date sorting', () => {
    const tasks = [task('done', { completed: true, dueDate: '2026-01-01' }), task('open', { dueDate: '2026-12-01' })]
    expect(sortTasks(tasks, 'due').map((t) => t.id)).toEqual(['open', 'done'])
  })

  it('does not mutate the input array', () => {
    const tasks = [task('b', { priority: 'low' }), task('a', { priority: 'urgent' })]
    const snapshot = [...tasks]
    sortTasks(tasks, 'priority')
    expect(tasks).toEqual(snapshot)
  })
})

describe('overdue & counts still behave with priorities', () => {
  it('treats a past open task as overdue regardless of priority', () => {
    expect(isTaskOverdue(task('a', { dueDate: '2020-01-01', priority: 'low' }))).toBe(true)
    expect(isTaskOverdue(task('b', { dueDate: '2020-01-01', completed: true }))).toBe(false)
  })

  it('counts open/completed/overdue correctly', () => {
    const tasks = [task('a', { dueDate: '2020-01-01' }), task('b', { completed: true }), task('c', { dueDate: '2999-01-01' })]
    const counts = countTasks(tasks)
    expect(counts).toMatchObject({ total: 3, completed: 1, open: 2, overdue: 1 })
  })
})
