import type { TaskPriority } from '../types'

/**
 * The single definition of the supported task priorities.
 *
 * The database constrains `tasks.priority` to exactly these four values
 * (`tasks_priority_check`, widened by migration 005 to include `urgent`). The
 * client must never invent a fifth value: a priority the database rejects fails
 * the *whole* snapshot upsert, which surfaced to users as a bare "Try again".
 *
 * TypeScript, this list and the SQL constraint are kept in step deliberately —
 * the mapping to the database column is plain text, so a mismatch is only ever
 * caught at write time.
 */
export const TASK_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const

/**
 * Display/sort order, highest priority first.
 *
 * Re-exported by components/Priority.tsx and services/domain.ts so there is ONE
 * list in the codebase. Previously the same four values were hard-coded in four
 * separate modules; adding or renaming a level silently missed the others.
 */
export const TASK_PRIORITY_ORDER = TASK_PRIORITIES

const SUPPORTED = new Set<string>(TASK_PRIORITIES)

/** True when `value` is one of the four priorities the server accepts. */
export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && SUPPORTED.has(value)
}

/**
 * Coerces anything to a valid priority.
 *
 * Legacy records (no priority) and rows written by an older build default to
 * `medium`; an unknown value must never be forwarded to the database.
 */
export function normalizeTaskPriority(value: unknown): TaskPriority {
  return isTaskPriority(value) ? value : 'medium'
}
