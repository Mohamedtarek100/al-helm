/**
 * Timetable validation and conflict detection.
 * Pure functions so they can be unit tested and reused by dashboard + schedule.
 */

import type { StudySession } from '../types'
import { timeToMinutes } from './date'

export interface TimeRange {
  start: string
  end: string
}

export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  const aStart = timeToMinutes(a.start)
  const aEnd = timeToMinutes(a.end)
  const bStart = timeToMinutes(b.start)
  const bEnd = timeToMinutes(b.end)
  if ([aStart, aEnd, bStart, bEnd].some(Number.isNaN)) return false
  return aStart < bEnd && bStart < aEnd
}

/** Sessions occurring on a given weekday, ignoring one-off sessions. */
export function weeklySessionsOn(sessions: StudySession[], weekday: number): StudySession[] {
  return sessions.filter(
    (session) => session.recurrence === 'weekly' && session.weekday === weekday,
  )
}

export interface SessionConflict {
  session: StudySession
  other: StudySession
  message: string
}

/**
 * Finds overlapping sessions on the same weekday. Returns one entry per
 * conflicting pair, with calm Arabic copy (no blame, just a heads-up).
 */
export function findWeeklyConflicts(sessions: StudySession[]): SessionConflict[] {
  const conflicts: SessionConflict[] = []
  for (let day = 0; day < 7; day += 1) {
    const daySessions = weeklySessionsOn(sessions, day)
    for (let i = 0; i < daySessions.length; i += 1) {
      for (let j = i + 1; j < daySessions.length; j += 1) {
        if (rangesOverlap(daySessions[i], daySessions[j])) {
          conflicts.push({
            session: daySessions[i],
            other: daySessions[j],
            message: `«${daySessions[i].title}» و«${daySessions[j].title}» متداخلين في الوقت.`,
          })
        }
      }
    }
  }
  return conflicts
}

/** Conflicts for a single day, used by the day agenda view. */
export function findDayConflicts(sessions: StudySession[], weekday: number): SessionConflict[] {
  return findWeeklyConflicts(sessions).filter(
    (conflict) => conflict.session.weekday === weekday,
  )
}

export interface SessionValidationResult {
  ok: boolean
  errors: Partial<Record<'title' | 'startTime' | 'endTime', string>>
}

export function validateSessionInput(input: {
  title: string
  startTime: string
  endTime: string
}): SessionValidationResult {
  const errors: SessionValidationResult['errors'] = {}
  if (!input.title.trim()) errors.title = 'اكتبي اسم الجلسة.'

  const start = timeToMinutes(input.startTime)
  const end = timeToMinutes(input.endTime)
  if (Number.isNaN(start)) errors.startTime = 'وقت البداية مش صحيح.'
  if (Number.isNaN(end)) errors.endTime = 'وقت النهاية مش صحيح.'
  if (!Number.isNaN(start) && !Number.isNaN(end) && end <= start) {
    errors.endTime = 'وقت النهاية لازم يكون بعد وقت البداية.'
  }

  return { ok: Object.keys(errors).length === 0, errors }
}

export function durationMinutes(session: Pick<StudySession, 'startTime' | 'endTime'>): number {
  const start = timeToMinutes(session.startTime)
  const end = timeToMinutes(session.endTime)
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0
  return end - start
}

/** Converts "HH:mm" to minutes from midnight; safe fallback of 0. */
export function toMinutes(value: string): number {
  const minutes = timeToMinutes(value)
  return Number.isNaN(minutes) ? 0 : minutes
}
