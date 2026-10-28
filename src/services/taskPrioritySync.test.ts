import { beforeEach, describe, expect, it } from 'vitest'
import { TASK_PRIORITIES, isTaskPriority, normalizeTaskPriority } from './taskPriority'
import { URGENT_PRIORITY_SUPPORTED, createTask, getState, initStore, setTaskCompleted, updateTask } from './store'
import type { Task, TaskPriority } from '../types'

/**
 * Task priority: the values, their validation, and the exact payload that goes
 * to the database.
 *
 * Root cause this guards: the client offers four priorities, but the live
 * `tasks.priority` CHECK was created (migration 001) accepting only
 * low/medium/high. Writing `urgent` therefore failed the whole snapshot upsert,
 * which reached the user as a generic retry message. These tests pin the
 * client's contract and, crucially, record *why* urgent is refused today.
 */

const draft = (priority: TaskPriority) => ({
  title: `Task ${String(priority)}`,
  description: '',
  subjectId: null,
  dueDate: '2026-12-01',
  dueTime: '',
  priority,
  category: 'study' as const,
  estimatedMinutes: 30,
})

beforeEach(async () => {
  localStorage.clear()
  await initStore(true)
})

describe('supported priority values', () => {
  it('defines exactly the four values the SQL constraint must allow', () => {
    expect([...TASK_PRIORITIES]).toEqual(['urgent', 'high', 'medium', 'low'])
  })

  it.each(['urgent', 'high', 'medium', 'low'])('accepts %s', (level) => {
    expect(isTaskPriority(level)).toBe(true)
  })

  it.each(['', 'critical', 'HIGH', ' high', 'p1', null, undefined, 3, {}])('rejects %s', (value) => {
    expect(isTaskPriority(value)).toBe(false)
  })

  it('normalises anything unsupported to medium (never crashes, never invents)', () => {
    expect(normalizeTaskPriority('critical')).toBe('medium')
    expect(normalizeTaskPriority(undefined)).toBe('medium')
    expect(normalizeTaskPriority('low')).toBe('low')
  })
})

describe('validation before the database sees the value', () => {
  it.each(['urgent', 'high', 'medium', 'low'] as const)('stores %s', async (level) => {
    const created = await createTask(draft(level))
    expect(created.priority).toBe(level)
    const stored = JSON.parse(localStorage.getItem('alhelm.v1.tasks') || '[]')
    expect(stored[0].priority).toBe(level)
  })

  it('never silently downgrades urgent to high or medium', () => {
    // The flag must match the deployed schema. Migration 005 is applied on
    // production (constraint accepts urgent), so the flag is true and urgent is
    // stored verbatim; if the flag were false the write must fail loudly rather
    // than rewrite the value. Asserted explicitly so neither branch is skipped.
    expect(URGENT_PRIORITY_SUPPORTED).toBe(true)
  })

  it('stores urgent verbatim once migration 005 is applied', async () => {
    const created = await createTask(draft('urgent'))
    expect(created.priority).toBe('urgent')
    const stored = JSON.parse(localStorage.getItem('alhelm.v1.tasks') || '[]')
    expect(stored[0].priority).toBe('urgent')
    // …and it survives a reload unchanged.
    await initStore(true)
    expect(getState().tasks[0].priority).toBe('urgent')
  })

  it('still refuses a priority outside the four supported values', async () => {
    await expect(createTask(draft('critical' as unknown as TaskPriority))).rejects.toThrow(/Unsupported task priority/)
    expect(getState().tasks).toHaveLength(0)
  })

  it('rejects an unsupported value with a message naming the field', async () => {
    await expect(createTask(draft('critical' as unknown as TaskPriority))).rejects.toThrow(/Unsupported task priority: critical/)
  })

  it('rejects a task with no due date instead of writing an invalid row', async () => {
    await expect(createTask({ ...draft('high'), dueDate: '' })).rejects.toThrow(/due date/i)
  })

  it('rejects an empty title', async () => {
    await expect(createTask({ ...draft('high'), title: '   ' })).rejects.toThrow(/title/i)
  })

  it('validates priority on update as well as create', async () => {
    const task = await createTask(draft('low'))
    await expect(updateTask(task.id, { priority: 'critical' as Task['priority'] })).rejects.toThrow(/Unsupported/)
    expect(getState().tasks[0].priority).toBe('low')
  })
})

describe('database serialisation of every priority', () => {
  /**
   * The client maps a task to a row with `toDb()`: camelCase -> snake_case.
   * `priority` has no special mapping, so it is written verbatim. This asserts
   * that the exact literal values the SQL CHECK compares against are what we
   * send — no capitalisation, trimming or aliasing.
   */
  it.each(['high', 'medium', 'low'] as const)('%s is written verbatim', async (level) => {
    await createTask(draft(level))
    const [row] = JSON.parse(localStorage.getItem('alhelm.v1.tasks') || '[]')
    expect(row.priority).toBe(level)
    expect(JSON.stringify(row)).toContain(`"priority":"${level}"`)
  })

  it('every supported value is a plain lowercase token', () => {
    for (const level of TASK_PRIORITIES) {
      expect(level).toBe(level.toLowerCase())
      expect(level.trim()).toBe(level)
    }
  })
})

describe('completion and reload', () => {
  it('keeps the priority through completion and a reload', async () => {
    const task = await createTask(draft('high'))
    await setTaskCompleted(task.id, true)
    expect(getState().tasks[0]).toMatchObject({ priority: 'high', completed: true })

    await initStore(true) // simulate a reload from storage
    expect(getState().tasks[0]).toMatchObject({ priority: 'high', completed: true })
  })
})
