import { EGYPT_TIME_ZONE, toValidDate } from './date'

/**
 * Wall-clock conversions for `Africa/Cairo`.
 *
 * Exams are entered as a local wall-clock time ("2026-12-06T10:00") but stored
 * as an absolute instant (`exam_at timestamptz`). Two rules keep that honest:
 *
 *  - The values the user typed are never reinterpreted through the *device's*
 *    timezone. A student travelling, or a browser reporting UTC, must still see
 *    "10:00" for an exam entered as 10:00 Cairo time.
 *  - Any conversion that cannot be performed returns `null` instead of an
 *    invalid Date. Callers validate before saving, so a malformed value
 *    becomes a form error rather than a crash.
 */

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: EGYPT_TIME_ZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** Milliseconds that `timeZone` is ahead of UTC at the given instant. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant))
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  const asUtc = Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'), read('second'))
  return asUtc - instant
}

/** `2026-12-06`, in Cairo, for an absolute instant. */
export function cairoDateKey(instant: Date | string): string | null {
  const date = toValidDate(instant)
  if (!date) return null
  const parts = formatter.formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  const year = get('year')
  const month = get('month')
  const day = get('day')
  if (!year || !month || !day) return null
  return `${year}-${month}-${day}`
}

/** `HH:mm` in Cairo for an absolute instant. */
export function cairoTimeKey(instant: Date | string): string | null {
  const date = toValidDate(instant)
  if (!date) return null
  const parts = formatter.formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  const hour = get('hour')
  const minute = get('minute')
  if (!hour || !minute) return null
  // 'en-US' with hour12:false can emit 24 for midnight; normalise to 00.
  return `${hour === '24' ? '00' : hour}:${minute}`
}

/**
 * Converts a `datetime-local` value (`yyyy-MM-ddTHH:mm`, optional seconds) —
 * interpreted as Africa/Cairo wall-clock time — into an ISO instant.
 *
 * Returns null for malformed or impossible input instead of throwing.
 */
export function cairoLocalInputToIso(value: string, timeZone = EGYPT_TIME_ZONE): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!match) return null
  const [, y, mo, d, h, mi, s] = match
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  const hour = Number(h)
  const minute = Number(mi)
  const second = Number(s ?? '0')
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null

  // Validate the calendar day itself (rejects e.g. 2026-02-31).
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null

  // Interpret the wall-clock value as if it were UTC, then subtract the offset
  // that the zone actually has at that moment (handles DST transitions).
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  let instant = asUtc - zoneOffsetMs(asUtc, timeZone)
  // One refinement pass settles values that straddle a DST boundary.
  instant = asUtc - zoneOffsetMs(instant, timeZone)
  const result = new Date(instant)
  return Number.isNaN(result.getTime()) ? null : result.toISOString()
}

/**
 * Converts a stored ISO instant back to the `datetime-local` value a form
 * shows — Cairo wall-clock time, not the device's.
 */
export function isoToCairoLocalInput(instant: string, timeZone = EGYPT_TIME_ZONE): string {
  const date = toValidDate(instant)
  if (!date) return ''
  if (timeZone === EGYPT_TIME_ZONE) {
    const day = cairoDateKey(date)
    const time = cairoTimeKey(date)
    return day && time ? `${day}T${time}` : ''
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  const hour = get('hour') === '24' ? '00' : get('hour')
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`
}
