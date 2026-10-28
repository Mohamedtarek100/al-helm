import { beforeEach, describe, expect, it } from 'vitest'
import { createExam, deleteExam, getState, initStore, updateExam } from './store'
import { cairoLocalInputToIso, isoToCairoLocalInput } from './timezone'
import { isValidDateInput, toValidDate } from './date'

/**
 * Exams: date handling and CRUD.
 *
 * The blank-screen crash had two halves, both covered here:
 *
 *  - the form converted the input with `new Date(value).toISOString()`, which
 *    throws RangeError for an empty/invalid value;
 *  - rendering formatted any stored value with Intl, which throws
 *    `RangeError: Invalid time value` for an unparsable date.
 *
 * Every conversion below must therefore return null / a safe fallback rather
 * than throwing, and the store must refuse to persist a value it cannot read.
 */

const draft = (examAt: string, title = 'Physics midterm') => ({ title, subjectId: null, examAt, timezone: 'Africa/Cairo', notes: '' })

beforeEach(async () => {
  localStorage.clear()
  await initStore(true)
})

describe('safe date parsing', () => {
  it.each(['', '   ', 'not-a-date', '2026-13-45', null, undefined])('rejects %s without throwing', (value) => {
    expect(toValidDate(value as string)).toBeNull()
    expect(isValidDateInput(value as string)).toBe(false)
  })

  it('reads a date key as a local calendar day, not UTC midnight', () => {
    const parsed = toValidDate('2026-12-06')
    expect(parsed?.getFullYear()).toBe(2026)
    expect(parsed?.getMonth()).toBe(11)
    expect(parsed?.getDate()).toBe(6)
  })
})

describe('Africa/Cairo conversion', () => {
  it('converts a Cairo wall-clock time to the correct UTC instant (UTC+2)', () => {
    expect(cairoLocalInputToIso('2026-12-06T10:00')).toBe('2026-12-06T08:00:00.000Z')
  })

  it('round-trips back to the same wall-clock value the user typed', () => {
    const iso = cairoLocalInputToIso('2026-12-11T08:45')
    expect(iso).toBeTruthy()
    expect(isoToCairoLocalInput(iso as string)).toBe('2026-12-11T08:45')
  })

  it('uses the summer offset (UTC+3) after the DST switch', () => {
    // Egypt reintroduced DST in 2023: 2026-06-15 is UTC+3.
    expect(cairoLocalInputToIso('2026-06-15T10:00')).toBe('2026-06-15T07:00:00.000Z')
  })

  it.each(['', 'tomorrow', '2026-02-31T10:00', '2026-12-06T25:00', '10:00', '2026-12-06'])(
    'returns null for the impossible input %s',
    (value) => {
      expect(cairoLocalInputToIso(value)).toBeNull()
    },
  )

  it('does not throw on an unparsable stored value', () => {
    expect(isoToCairoLocalInput('garbage')).toBe('')
    expect(isoToCairoLocalInput('')).toBe('')
  })
})

describe('exam CRUD', () => {
  it('creates an exam with the Cairo timestamp and timezone', async () => {
    const exam = await createExam(draft('2026-12-11T06:45:00.000Z'))
    expect(exam.examAt).toBe('2026-12-11T06:45:00.000Z')
    expect(exam.timezone).toBe('Africa/Cairo')
    // …and shows back as 08:45 Cairo wall time in the form.
    expect(isoToCairoLocalInput(exam.examAt)).toBe('2026-12-11T08:45')
    const stored = JSON.parse(localStorage.getItem('alhelm.v1.exams') || '[]')
    expect(stored).toHaveLength(1)
  })

  it('edits an exam and keeps it unique', async () => {
    const exam = await createExam(draft('2026-12-11T06:45:00.000Z'))
    await updateExam(exam.id, { title: 'Physics final', examAt: '2026-12-12T08:15:00.000Z' })
    const current = getState().exams
    expect(current).toHaveLength(1)
    expect(current[0]).toMatchObject({ title: 'Physics final', examAt: '2026-12-12T08:15:00.000Z' })
  })

  it('deletes an exam', async () => {
    const exam = await createExam(draft('2026-12-11T06:45:00.000Z'))
    await deleteExam(exam.id)
    expect(getState().exams).toHaveLength(0)
  })

  it('reloads exams from storage', async () => {
    await createExam(draft('2026-12-11T06:45:00.000Z', 'Chemistry'))
    await initStore(true)
    expect(getState().exams.map((exam) => exam.title)).toEqual(['Chemistry'])
  })
})

describe('the store refuses values it cannot store', () => {
  it('rejects an empty exam date instead of throwing RangeError', async () => {
    await expect(createExam(draft(''))).rejects.toThrow(/valid date/i)
    expect(getState().exams).toHaveLength(0)
  })

  it('rejects an unparsable exam date', async () => {
    await expect(createExam(draft('not-a-date'))).rejects.toThrow(/valid date/i)
  })

  it('rejects an empty title', async () => {
    await expect(createExam(draft('2026-12-11T06:45:00.000Z', '  '))).rejects.toThrow(/title/i)
  })

  it('validates on update too, leaving the stored exam untouched', async () => {
    const exam = await createExam(draft('2026-12-11T06:45:00.000Z'))
    await expect(updateExam(exam.id, { examAt: 'garbage' })).rejects.toThrow(/valid date/i)
    expect(getState().exams[0].examAt).toBe('2026-12-11T06:45:00.000Z')
  })
})
