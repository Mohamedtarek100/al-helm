/**
 * Tasks selectors — filtering, sorting and overdue helpers.
 * Pure functions so the same logic serves the dashboard and the tasks page.
 */

import type { Task, TaskPriority } from '../types'
import { timeToMinutes, todayKey } from './date'

export type TaskStatusFilter = 'all' | 'open' | 'done' | 'overdue' | 'today'
export type TaskSortKey = 'due' | 'priority' | 'created'

const priorityWeight: Record<TaskPriority, number> = { urgent: 4, high: 3, medium: 2, low: 1 }

/** A task is overdue when its due date/time has passed and it is not done. */
export function isTaskOverdue(task: Task, now: Date = new Date()): boolean {
  if (task.completed || !task.dueDate) return false
  const today = todayKey()
  if (task.dueDate < today) return true
  if (task.dueDate === today && task.dueTime) {
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    return timeToMinutes(task.dueTime) < nowMinutes
  }
  return false
}

export function isTaskToday(task: Task): boolean {
  return task.dueDate === todayKey()
}

export interface TaskFilter {
  status: TaskStatusFilter
  subjectId: string | 'all'
  priority: TaskPriority | 'all'
  /** yyyy-mm-dd or '' for "any date". */
  date: string
}

export const emptyTaskFilter: TaskFilter = {
  status: 'all',
  subjectId: 'all',
  priority: 'all',
  date: '',
}

export function filterTasks(tasks: Task[], filter: TaskFilter, now: Date = new Date()): Task[] {
  return tasks.filter((task) => {
    if (filter.status === 'open' && task.completed) return false
    if (filter.status === 'done' && !task.completed) return false
    if (filter.status === 'overdue' && !isTaskOverdue(task, now)) return false
    if (filter.status === 'today' && !(isTaskToday(task) && !task.completed)) return false
    if (filter.subjectId !== 'all' && task.subjectId !== filter.subjectId) return false
    if (filter.priority !== 'all' && task.priority !== filter.priority) return false
    if (filter.date && task.dueDate !== filter.date) return false
    return true
  })
}

export function sortTasks(tasks: Task[], sort: TaskSortKey): Task[] {
  const copy = [...tasks]
  copy.sort((a, b) => {
    if (sort === 'priority') {
      const diff = priorityWeight[b.priority] - priorityWeight[a.priority]
      if (diff !== 0) return diff
      return compareDue(a, b)
    }
    if (sort === 'created') return b.createdAt.localeCompare(a.createdAt)
    return compareDue(a, b)
  })
  return copy
}

function compareDue(a: Task, b: Task): number {
  if (a.completed !== b.completed) return a.completed ? 1 : -1
  const aKey = `${a.dueDate || '9999-99-99'}T${a.dueTime || '23:59'}`
  const bKey = `${b.dueDate || '9999-99-99'}T${b.dueTime || '23:59'}`
  return aKey.localeCompare(bKey)
}

export interface TaskCounts {
  total: number
  completed: number
  open: number
  overdue: number
  today: number
}

export function countTasks(tasks: Task[], now: Date = new Date()): TaskCounts {
  let completed = 0
  let overdue = 0
  let today = 0
  for (const task of tasks) {
    if (task.completed) completed += 1
    if (isTaskOverdue(task, now)) overdue += 1
    if (isTaskToday(task) && !task.completed) today += 1
  }
  return { total: tasks.length, completed, open: tasks.length - completed, overdue, today }
}

/** The tasks worth showing on the dashboard right now. */
export function todaysFocusTasks(tasks: Task[], now: Date = new Date(), limit = 5): Task[] {
  const relevant = tasks.filter(
    (task) => !task.completed && (isTaskToday(task) || isTaskOverdue(task, now)),
  )
  return sortTasks(relevant, 'due').slice(0, limit)
}
