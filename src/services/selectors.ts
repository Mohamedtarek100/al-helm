/**
 * Timetable helpers: conflict detection, ordering and "what's next" queries.
 * Pure functions — easy to unit test and reused by the dashboard and the
 * timetable screen.
 */

import type { StudySession, Task } from '../types'
import { timeToMinutes, todayKey, weekdayOf } from './date'

export interface SessionConflict {
  sessionId: string
  conflictsWithId: string
  message: string
}

/** Sessions that fall on a given weekday, sorted by start time. */
export function sessionsForWeekday(sessions: StudySession[], weekday: number): StudySession[] {
  return sessions
    .filter((session) => session.weekday === weekday)
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))
}

/** Sessions that occur on a specific calendar day (weekly + one-off). */
export function sessionsForDate(sessions: StudySession[], dateKey: string): StudySession[] {
  const weekday = weekdayOf(dateKey)
  return sessions
    .filter((session) =>
      session.recurrence === 'weekly' ? session.weekday === weekday : session.date === dateKey,
    )
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))
}

function overlaps(a: StudySession, b: StudySession): boolean {
  const aStart = timeToMinutes(a.startTime)
  const aEnd = timeToMinutes(a.endTime)
  const bStart = timeToMinutes(b.startTime)
  const bEnd = timeToMinutes(b.endTime)
  return aStart < bEnd && bStart < aEnd
}

/**
 * Finds conflicting sessions on the same day. Exams are allowed to clash with
 * nothing, so the warning copy stays calm and non-blocking.
 */
export function findConflicts(sessions: StudySession[]): SessionConflict[] {
  const conflicts: SessionConflict[] = []
  const byDay = new Map<string, StudySession[]>()

  for (const session of sessions) {
    const key = session.recurrence === 'weekly' ? `w${session.weekday}` : `d${session.date}`
    const bucket = byDay.get(key) ?? []
    bucket.push(session)
    byDay.set(key, bucket)
  }

  for (const bucket of byDay.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        if (overlaps(bucket[i], bucket[j])) {
          conflicts.push({
            sessionId: bucket[i].id,
            conflictsWithId: bucket[j].id,
            message: `«${bucket[i].title}» و«${bucket[j].title}» متداخلين في الوقت.`,
          })
        }
      }
    }
  }

  return conflicts
}

export interface SessionValidation {
  valid: boolean
  errors: Partial<Record<'title' | 'startTime' | 'endTime' | 'date', string>>
}

export function validateSession(input: {
  title: string
  startTime: string
  endTime: string
  recurrence: 'weekly' | 'once'
  date: string
}): SessionValidation {
  const errors: SessionValidation['errors'] = {}
  if (!input.title.trim()) errors.title = 'اكتبي اسم الجلسة.'
  const start = timeToMinutes(input.startTime)
  const end = timeToMinutes(input.endTime)
  if (Number.isNaN(start)) errors.startTime = 'وقت البداية مش صحيح.'
  if (Number.isNaN(end)) errors.endTime = 'وقت النهاية مش صحيح.'
  if (!Number.isNaN(start) && !Number.isNaN(end) && end <= start) {
    errors.endTime = 'وقت النهاية لازم يكون بعد وقت البداية.'
  }
  if (input.recurrence === 'once' && !input.date) errors.date = 'اختاري تاريخ الجلسة.'
  return { valid: Object.keys(errors).length === 0, errors }
}

/** The next upcoming session today, or the first one tomorrow. */
export function nextSession(sessions: StudySession[], now: Date): StudySession | null {
  const today = todayKey()
  const minutesNow = now.getHours() * 60 + now.getMinutes()
  const todays = sessionsForDate(sessions, today)
  const upcoming = todays.find((session) => timeToMinutes(session.startTime) >= minutesNow)
  if (upcoming) return upcoming
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  return sessionsForDate(sessions, todayKeyFromDate(tomorrow))[0] ?? null
}

function todayKeyFromDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function isTaskOverdue(task: Task, now: Date): boolean {
  if (task.completed || !task.dueDate) return false
  const today = todayKey()
  if (task.dueDate < today) return true
  if (task.dueDate === today && task.dueTime) {
    return timeToMinutes(task.dueTime) < now.getHours() * 60 + now.getMinutes()
  }
  return false
}

export function isTaskToday(task: Task): boolean {
  return !task.completed && task.dueDate === todayKey()
}

/** Minutes of scheduled study per weekday — drives the timetable summary bar. */
export function weeklyLoadMinutes(sessions: StudySession[]): number[] {
  const totals = [0, 0, 0, 0, 0, 0, 0]
  for (const session of sessions) {
    if (session.recurrence !== 'weekly') continue
    const minutes = timeToMinutes(session.endTime) - timeToMinutes(session.startTime)
    if (minutes > 0) totals[session.weekday] += minutes
  }
  return totals
}
