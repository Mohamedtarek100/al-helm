/** Date, time and formatting helpers with locale-aware English/Arabic output. */

import type { Weekday } from '../types'
import { WEEKDAY_LABELS } from './domain'

export const EGYPT_LOCALE = 'ar-EG'
export const ENGLISH_LOCALE = 'en-US'
export const EGYPT_TIME_ZONE = 'Africa/Cairo'

function localeDigits(locale: string): string | undefined {
  return locale === 'ar-EG' ? 'arab' : 'latn'
}

/** Long, human date in Arabic: «الأحد ١٨ أكتوبر ٢٠٢٦». */
export function formatLongDate(input: Date | string, locale = EGYPT_LOCALE): string {
  const date = typeof input === 'string' ? parseDateKey(input) : input
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', calendar: 'gregory', numberingSystem: localeDigits(locale) }).format(date)
}

export function formatShortDate(input: Date | string, locale = EGYPT_LOCALE): string {
  const date = typeof input === 'string' ? parseDateKey(input) : input
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', calendar: 'gregory', numberingSystem: localeDigits(locale) }).format(date)
}

/** «٠٧:٣٠ م» from an HH:mm string. */
export function formatTime(value: string, locale = EGYPT_LOCALE): string {
  const [hours, minutes] = value.split(':').map(Number)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return value
  const date = new Date(2000, 0, 1, hours, minutes)
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', hour12: locale === 'en-US', numberingSystem: localeDigits(locale) }).format(date)
}

export function formatMinutes(total: number, locale = EGYPT_LOCALE): string {
  const minutes = Math.max(0, Math.round(total))
  const digits = (value: number) => locale === 'ar-EG' ? toArabicDigits(value) : new Intl.NumberFormat('en-US').format(value)
  if (locale === 'en-US') {
    if (minutes < 60) return `${digits(minutes)} min`
    const hours = Math.floor(minutes / 60), rest = minutes % 60
    return rest ? `${digits(hours)} hr ${digits(rest)} min` : `${digits(hours)} hr`
  }
  if (minutes < 60) return `${digits(minutes)} د`
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  return rest === 0 ? `${digits(hours)} س` : `${digits(hours)} س ${digits(rest)} د`
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

/**
 * Returns a usable Date, or null when the input cannot be parsed.
 *
 * A bare yyyy-mm-dd is read as a local calendar day (never UTC midnight), so a
 * date key never shifts by a day depending on the machine's timezone. Every
 * caller that formats a stored date goes through here first: passing an invalid
 * Date straight to `Intl.DateTimeFormat.format()` throws
 * `RangeError: Invalid time value`, which used to blank the entire route.
 */
export function toValidDate(input: Date | string | null | undefined): Date | null {
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input
  if (typeof input !== 'string' || !input.trim()) return null
  const text = input.trim()
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? parseDateKey(text) : new Date(text)
  if (Number.isNaN(date.getTime())) return null
  // `new Date('2026-13-45')` does NOT throw — it silently rolls over to
  // 2027-02-14. Re-read the parsed components for a date-only key so an
  // impossible calendar date is rejected instead of being shifted.
  const keyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (keyMatch) {
    const [year, month, day] = [Number(keyMatch[1]), Number(keyMatch[2]), Number(keyMatch[3])]
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  }
  return date
}

/** True when `input` is a parseable date; the guard forms use before saving. */
export function isValidDateInput(input: Date | string | null | undefined): boolean {
  return toValidDate(input) !== null
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
export function describeDueDate(dueKey: string, locale = 'ar-EG'): string {
  if (!dueKey) return locale === 'en-US' ? 'No date' : 'بدون تاريخ'
  const today = todayKey()
  if (dueKey === today) return locale === 'en-US' ? 'Today' : 'النهارده'
  const diff = Math.round((parseDateKey(dueKey).getTime() - parseDateKey(today).getTime()) / 86_400_000)
  if (locale === 'en-US') {
    if (diff === 1) return 'Tomorrow'
    if (diff === -1) return 'Yesterday'
    if (diff < -1) return `${Math.abs(diff)} days ago`
    if (diff <= 7) return `In ${diff} days`
    return formatShortDate(dueKey, locale)
  }
  if (diff === 1) return 'بكرة'
  if (diff === -1) return 'امبارح'
  if (diff < -1) return `فات ${toArabicDigits(Math.abs(diff))} يوم`
  if (diff <= 7) return `بعد ${toArabicDigits(diff)} أيام`
  return formatShortDate(dueKey, locale)
}

export function greetingForHour(hour: number, locale = 'ar-EG'): string {
  if (locale === 'en-US') return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  if (hour < 5) return 'سهرة خفيفة'
  if (hour < 12) return 'صباح الخير'
  if (hour < 17) return 'نهارك سعيد'
  return 'مساء الخير'
}

/** yyyy-mm-dd of the current week's Sunday..Saturday, keyed for lookups. */
export function isSameDateKey(a: string, b: string): boolean {
  return a === b
}
