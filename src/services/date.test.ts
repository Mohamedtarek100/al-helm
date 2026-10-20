import { describe, expect, it } from 'vitest'
import { describeDueDate, formatMinutes, formatTime, parseDateKey, toDateKey } from './date'

describe('date helpers', () => {
  it('parses date keys in local calendar time without a UTC day shift', () => {
    expect(toDateKey(parseDateKey('2026-10-19'))).toBe('2026-10-19')
  })
  it('formats times and durations using the selected locale', () => {
    expect(formatTime('16:30', 'en-US')).toMatch(/4:30/)
    expect(formatMinutes(90, 'en-US')).toBe('1 hr 30 min')
    expect(formatMinutes(90, 'ar-EG')).toContain('س')
  })
  it('returns English relative due-date labels', () => {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
    const key = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
    expect(describeDueDate(key, 'en-US')).toBe('Tomorrow')
  })
})
