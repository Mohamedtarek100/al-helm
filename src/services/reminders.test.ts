import { describe, expect, it } from 'vitest'
import { __internals } from './reminders'

const { parseTime, nextOccurrence, hashId } = __internals

describe('reminder scheduling helpers', () => {
  it('parses valid HH:mm times and rejects malformed ones', () => {
    expect(parseTime('07:30')).toEqual({ hours: 7, minutes: 30 })
    expect(parseTime('23:59')).toEqual({ hours: 23, minutes: 59 })
    expect(parseTime('7:05')).toEqual({ hours: 7, minutes: 5 })
    expect(parseTime('24:00')).toBeNull()
    expect(parseTime('12:60')).toBeNull()
    expect(parseTime('abc')).toBeNull()
    expect(parseTime('')).toBeNull()
  })

  it('schedules the next occurrence later today when the time has not passed', () => {
    const from = new Date(2026, 9, 21, 6, 0, 0, 0)
    const next = nextOccurrence('07:30', from)
    expect(next).not.toBeNull()
    expect(next!.getHours()).toBe(7)
    expect(next!.getMinutes()).toBe(30)
    expect(next!.getDate()).toBe(21)
  })

  it('rolls over to tomorrow when the time already passed', () => {
    const from = new Date(2026, 9, 21, 8, 0, 0, 0)
    const next = nextOccurrence('07:30', from)
    expect(next).not.toBeNull()
    expect(next!.getDate()).toBe(22)
    expect(next!.getHours()).toBe(7)
  })

  it('returns null for invalid reminder times', () => {
    expect(nextOccurrence('not-a-time')).toBeNull()
  })

  it('produces stable int32 notification ids for the same reminder id', () => {
    const first = hashId('rem_morning')
    const second = hashId('rem_morning')
    expect(first).toBe(second)
    expect(Number.isInteger(first)).toBe(true)
    expect(first).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThanOrEqual(0x7fffffff)
  })
})
