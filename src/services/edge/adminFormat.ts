/**
 * Pure presentation helpers for the Owner Control Console.
 *
 * Kept separate from the components so they can be unit-tested without a DOM,
 * and so the console's UI modules export components only (Fast Refresh).
 *
 * Every helper here works on values the SERVER returned. None of them invent a
 * value: an unknown percentage is `null`, which renders as “unavailable”, never
 * as 0% or 100%.
 */

/** Percentage of `part` in `whole`, or null when there is no honest base. */
export function rate(part: number | null | undefined, whole: number | null | undefined): number | null {
  if (part === null || part === undefined || whole === null || whole === undefined) return null
  if (!Number.isFinite(part) || !Number.isFinite(whole)) return null
  // A zero denominator means "nothing to measure", not "0%".
  if (whole <= 0) return null
  return Math.min(100, Math.max(0, (part / whole) * 100))
}

/** Formats a rate for display, e.g. `42.5%`. Null renders as an em dash. */
export function formatRate(value: number | null, locale = 'en-US', digits = 1): string {
  if (value === null) return '—'
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)}%`
}

/** Truncates a series to the last `days` entries (never mutates the input). */
export function lastDays<T>(series: T[], days: number): T[] {
  if (days <= 0) return []
  return series.slice(Math.max(0, series.length - days))
}

/** Sums a numeric field of a series. */
export function sumBy<T>(series: T[], pick: (item: T) => number): number {
  return series.reduce((total, item) => total + (Number.isFinite(pick(item)) ? pick(item) : 0), 0)
}

/** Short `MM/DD` (or `DD/MM` for Arabic) label for a `YYYY-MM-DD` day key. */
export function dayLabel(isoDay: string, language: 'en' | 'ar'): string {
  // Parsed as parts, not via Date: a date-only string is UTC midnight, which
  // can shift a day in negative-offset zones.
  const [, month = '', day = ''] = isoDay.split('-')
  return language === 'ar' ? `${day}/${month}` : `${month}/${day}`
}

/** Whole days between an ISO timestamp and `now`. Null for a missing value. */
export function daysSince(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return null
  return Math.max(0, Math.floor((now - time) / 86_400_000))
}

export type ActivityStatus = 'active' | 'idle' | 'never'

/**
 * Activity status derived from the last heartbeat.
 *
 * An account with no heartbeat is `never`, NOT `idle`: the console must not
 * claim inactivity it cannot observe.
 */
export function activityStatus(lastSeenAt: string | null | undefined, now: number = Date.now()): ActivityStatus {
  const days = daysSince(lastSeenAt, now)
  if (days === null) return 'never'
  return days <= 7 ? 'active' : 'idle'
}

/**
 * Parses one CSV line produced by the server's `directory` action.
 *
 * The server emits RFC 4180 quoting (doubled quotes, quoted cells), so a naive
 * `split(',')` would break on any address containing a comma — or on a display
 * name containing one, which is common. This parser honours quoted cells.
 */
export function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') { current += '"'; index++ }
        else quoted = false
      } else current += char
      continue
    }
    if (char === '"') { quoted = true; continue }
    if (char === ',') { cells.push(current); current = ''; continue }
    current += char
  }
  cells.push(current)
  return cells
}

/** Normalises a header to a CSV-safe label. */
export function csvHeaders(columns: string[]): string[] {
  return columns.map((column) => column.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`))
}

/** Escapes one cell for RFC 4180 output built in the browser. */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  // Neutralise spreadsheet formula injection before quoting.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

/** Joins server-provided header/row arrays into a complete CSV document. */
export function toCsv(headers: string[], rows: string[]): string {
  return [headers.map(csvCell).join(','), ...rows].join('\r\n')
}
