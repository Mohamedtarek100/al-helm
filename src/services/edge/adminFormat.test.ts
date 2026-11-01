import { describe, expect, it } from 'vitest'
import {
  activityStatus,
  csvCell,
  dayLabel,
  daysSince,
  formatRate,
  lastDays,
  parseCsvLine,
  rate,
  sumBy,
  toCsv,
} from './adminFormat'

/**
 * Presentation maths for the Owner Control Center.
 *
 * The theme of these tests is the difference between "zero" and "unknown".
 * A console that prints 0% for an unmeasurable rate, or 0 for an unavailable
 * metric, is lying about the production database — which is exactly what this
 * layer exists to prevent.
 */

describe('rate', () => {
  it('computes a percentage for a real denominator', () => {
    expect(rate(25, 100)).toBe(25)
    expect(rate(1, 3)).toBeCloseTo(33.333, 3)
  })

  it('returns null — not 0 — when there is nothing to measure', () => {
    // 0/0 is "no data", and printing 0% would imply every user ignored it.
    expect(rate(0, 0)).toBeNull()
    expect(rate(5, 0)).toBeNull()
  })

  it('returns null for missing or non-finite inputs', () => {
    expect(rate(null, 10)).toBeNull()
    expect(rate(undefined, 10)).toBeNull()
    expect(rate(5, null)).toBeNull()
    expect(rate(Number.NaN, 10)).toBeNull()
    expect(rate(5, Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('clamps a nonsensical result into 0–100', () => {
    // A stale denominator must never render as 180% or a negative bar width.
    expect(rate(150, 100)).toBe(100)
    expect(rate(-5, 100)).toBe(0)
  })
})

describe('formatRate', () => {
  it('renders an em dash for an unknown rate', () => {
    expect(formatRate(null)).toBe('—')
  })

  it('formats with one decimal by default', () => {
    expect(formatRate(42.46)).toBe('42.5%')
  })
})

describe('dayLabel', () => {
  it('labels days month-first for English and day-first for Arabic', () => {
    expect(dayLabel('2026-03-07', 'en')).toBe('03/07')
    expect(dayLabel('2026-03-07', 'ar')).toBe('07/03')
  })

  it('does not shift the day through timezone conversion', () => {
    // Parsing "2026-01-01" as a Date yields UTC midnight, which is the previous
    // day in negative-offset zones; the label must still read 01/01.
    expect(dayLabel('2026-01-01', 'en')).toBe('01/01')
  })
})

describe('daysSince and activityStatus', () => {
  const now = Date.parse('2026-10-31T12:00:00.000Z')

  it('counts whole elapsed days', () => {
    expect(daysSince('2026-10-31T11:00:00.000Z', now)).toBe(0)
    expect(daysSince('2026-10-24T12:00:00.000Z', now)).toBe(7)
  })

  it('returns null for a missing or unparsable timestamp', () => {
    expect(daysSince(null, now)).toBeNull()
    expect(daysSince('not a date', now)).toBeNull()
  })

  it('treats a never-seen account as "never", not as idle', () => {
    // The server has no observation of this account; calling it idle would be
    // an invented claim.
    expect(activityStatus(null, now)).toBe('never')
    expect(activityStatus(undefined, now)).toBe('never')
  })

  it('splits active and idle on the 7-day boundary', () => {
    expect(activityStatus('2026-10-25T12:00:00.000Z', now)).toBe('active')
    expect(activityStatus('2026-10-20T12:00:00.000Z', now)).toBe('idle')
  })
})

describe('series helpers', () => {
  it('keeps only the most recent days without mutating the input', () => {
    const series = [1, 2, 3, 4, 5]
    expect(lastDays(series, 2)).toEqual([4, 5])
    expect(series).toHaveLength(5)
    expect(lastDays(series, 0)).toEqual([])
    expect(lastDays(series, 99)).toHaveLength(5)
  })

  it('sums a field and ignores non-numeric entries', () => {
    const rows = [{ n: 2 }, { n: 3 }, { n: Number.NaN }]
    expect(sumBy(rows, (row) => row.n)).toBe(5)
  })
})

describe('CSV handling', () => {
  it('parses quoted cells containing commas and escaped quotes', () => {
    // A display name like "Ali, the artist" is common; a naive split(',')
    // would shift every later column.
    expect(parseCsvLine('"a@b.c","Ali, the artist","2026-01-01",yes')).toEqual([
      'a@b.c',
      'Ali, the artist',
      '2026-01-01',
      'yes',
    ])
    expect(parseCsvLine('"say ""hi""",x')).toEqual(['say "hi"', 'x'])
  })

  it('neutralises spreadsheet formula injection', () => {
    // A cell starting with = + - or @ executes in Excel/Sheets. Prefixing with
    // an apostrophe keeps the value readable but inert.
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"')
    expect(csvCell('+1')).toBe('"\'+1"')
    expect(csvCell('@cmd')).toBe('"\'@cmd"')
  })

  it('quotes every cell and escapes embedded quotes', () => {
    expect(csvCell('plain')).toBe('"plain"')
    expect(csvCell('a"b')).toBe('"a""b"')
    expect(csvCell(null)).toBe('""')
  })

  it('writes a header row followed by the server-produced rows', () => {
    const csv = toCsv(['email', 'last_seen'], ['"a@b.c","2026-01-01"', '"d@e.f",""'])
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('"email","last_seen"')
    expect(lines[1]).toBe('"a@b.c","2026-01-01"')
    expect(lines).toHaveLength(3)
  })
})
