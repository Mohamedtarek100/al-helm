/**
 * Date, time and formatting helpers. All user-facing formatting uses the
 * `ar-EG` locale and Egypt (Africa/Cairo) time, per the product brief.
 */

import type { Weekday } from '../types'
import { WEEKDAY_LABELS } from './domain'

export const EGYPT_LOCALE = 'ar-EG'
export const EGYPT_TIME_ZONE = 'Africa/Cairo'

const dateFormatter = new Intl.DateTimeFormat(EGYPT_LOCALE, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  calendar: 'gregory',
  numberingSystem: 'arab',
  timeZone: EGYPT_TIME_ZONE,
})

const shortDateFormatter = new Intl.DateTimeFormat(EGYPT_LOCALE, {
  day: 'numeric',
  month: 'short',
  calendar: 'gregory',
  numberingSystem: 'arab',
  timeZone: EGYPT_TIME_ZONE,
})

const timeFormatter = new Intl.DateTimeFormat(EGYPT_LOCALE, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  numberingSystem: 'arab',
  timeZone: EGYPT_TIME_ZONE,
})

/** Long, human date in Arabic: «الأحد ١٨ أكتوبر ٢٠٢٦». */
export function formatLongDate(input: Date | string): string {
  const date = typeof input === 'string' ? parseDateKey(input) : input
  return dateFormatter.format(date)
}

export function formatShortDate(input: Date | string): string {
  const date = typeof input === 'string' ? parseDateKey(input) : input
  return shortDateFormatter.format(date)
}

/** «٠٧:٣٠ م» from an HH:mm string. */
export function formatTime(value: string): string {
  const [hours, minutes] = value.split(':').map(Number)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return value
  const date = new Date()
  date.setHours(hours, minutes, 0, 0)
  return timeFormatter.format(date)
}

export function formatMinutes(total: number): string {
  const minutes = Math.max(0, Math.round(total))
  if (minutes < 60) return `${toArabicDigits(minutes)} د`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (rest === 0) return `${toArabicDigits(hours)} س`
  return `${toArabicDigits(hours)} س ${toArabicDigits(rest)} د`
}

/** yyyy-mm-dd for a Date, computed in local time (never UTC-shifted). */
export function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Parses yyyy-mm-dd into a local Date at midnight (avoids UTC parsing drift). */
export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  if (!year || !month || !day) return new Date(NaN)
  return new Date(year, month - 1, day)
}

export function todayKey(): string {
  return toDateKey(new Date())
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function startOfWeek(date: Date): Date {
  const day = date.getDay() as Weekday
  return addDays(date, -day)
}

export function weekDates(reference: Date): string[] {
  const start = startOfWeek(reference)
  return Array.from({ length: 7 }, (_, index) => toDateKey(addDays(start, index)))
}

export function weekdayOf(dateKey: string): Weekday {
  return parseDateKey(dateKey).getDay() as Weekday
}

export function weekdayLabel(weekday: Weekday): string {
  return WEEKDAY_LABELS[weekday]
}

/** Converts «HH:mm» to minutes since midnight, or NaN when malformed. */
export function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return Number.NaN
  return hours * 60 + minutes
}

export function minutesToTime(total: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(total)))
  const hours = `${Math.floor(clamped / 60)}`.padStart(2, '0')
  const minutes = `${clamped % 60}`.padStart(2, '0')
  return `${hours}:${minutes}`
}

/** 25 -> «٢٥ دقيقة», used in copy where a unit word reads better than a symbol. */
export function minutesToWords(total: number): string {
  return `${toArabicDigits(Math.round(total))} دقيقة`
}

const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']

export function toArabicDigits(value: number | string): string {
  return String(value).replace(/\d/g, (digit) => arabicDigits[Number(digit)])
}

/** Relative day wording that never shames the student for being behind. */
export function describeDueDate(dueKey: string): string {
  if (!dueKey) return 'بدون تاريخ'
  const today = todayKey()
  if (dueKey === today) return 'النهارده'
  const diff = Math.round(
    (parseDateKey(dueKey).getTime() - parseDateKey(today).getTime()) / 86_400_000,
  )
  if (diff === 1) return 'بكرة'
  if (diff === -1) return 'امبارح'
  if (diff < -1) return `فات ${toArabicDigits(Math.abs(diff))} يوم`
  if (diff <= 7) return `بعد ${toArabicDigits(diff)} أيام`
  return formatShortDate(dueKey)
}

export function greetingForHour(hour: number): string {
  if (hour < 5) return 'سهرة خفيفة'
  if (hour < 12) return 'صباح الخير'
  if (hour < 17) return 'نهارك سعيد'
  if (hour < 21) return 'مساء الخير'
  return 'مساء الخير'
}

/** yyyy-mm-dd of the current week's Sunday..Saturday, keyed for lookups. */
export function isSameDateKey(a: string, b: string): boolean {
  return a === b
}
