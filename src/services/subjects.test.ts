import { describe, expect, it } from 'vitest'
import {
  cleanSubjectName, findSubjectByName, nextSubjectColor, normalizeSubjectName,
  searchSubjects, subjectOptions,
} from './subjects'
import type { Subject } from '../types'

/**
 * Subject normalisation & matching.
 *
 * The policy under test (one rule, used by every selector):
 *  - NFKC normalisation, Arabic diacritics/tatweel stripped, whitespace
 *    collapsed and trimmed, compared case-insensitively.
 *  - "Create …" is offered ONLY when nothing matches at all, so typing "math"
 *    while "Mathematics" exists selects it instead of creating a twin.
 */

const subject = (id: string, name: string, extra: Partial<Subject> = {}): Subject => ({
  id, name, color: 'terracotta', notes: '', weeklyTargetMinutes: 0, archived: false,
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...extra,
})

describe('normalizeSubjectName', () => {
  it('is case-insensitive', () => {
    expect(normalizeSubjectName('MATH')).toBe(normalizeSubjectName('math'))
    expect(normalizeSubjectName('MaTh')).toBe('math')
  })

  it('trims and collapses internal whitespace', () => {
    expect(normalizeSubjectName('  Math   Two  ')).toBe('math two')
    expect(normalizeSubjectName('Math\tTwo\n')).toBe('math two')
  })

  it('strips Arabic diacritics (harakat)', () => {
    expect(normalizeSubjectName('مُحَاسَبَة')).toBe(normalizeSubjectName('محاسبة'))
    expect(normalizeSubjectName('الرِّيَاضِيَّات')).toBe(normalizeSubjectName('الرياضيات'))
  })

  it('strips tatweel (kashida)', () => {
    expect(normalizeSubjectName('مـحـاسـبة')).toBe(normalizeSubjectName('محاسبة'))
  })

  it('applies NFKC so compatibility forms compare equal', () => {
    // Fullwidth latin "ＭＡＴＨ" normalises to plain "math".
    expect(normalizeSubjectName('\uFF2D\uFF21\uFF34\uFF28')).toBe('math')
    // Arabic presentation forms fold into their base letters.
    expect(normalizeSubjectName('\uFEA9').normalize('NFKC')).toBe(normalizeSubjectName('\uFEA9'))
  })

  it('returns an empty string for blank input', () => {
    expect(normalizeSubjectName('   ')).toBe('')
    expect(normalizeSubjectName('')).toBe('')
  })
})

describe('cleanSubjectName', () => {
  it('collapses whitespace but preserves the user\'s casing and letters', () => {
    expect(cleanSubjectName('  Mathematics   II ')).toBe('Mathematics II')
    expect(cleanSubjectName('مـحاسبة')).toBe('مـحاسبة') // display form keeps tatweel
  })
})

describe('findSubjectByName', () => {
  const subjects = [subject('s1', 'Mathematics'), subject('s2', 'Physics'), subject('s3', 'محاسبة')]

  it('finds a subject regardless of case/whitespace/diacritics', () => {
    expect(findSubjectByName(subjects, '  mathematics ')?.id).toBe('s1')
    expect(findSubjectByName(subjects, 'MATHEMATICS')?.id).toBe('s1')
    expect(findSubjectByName(subjects, 'مُحَاسَبَة')?.id).toBe('s3')
  })

  it('does not match a different subject', () => {
    expect(findSubjectByName(subjects, 'Math')).toBeUndefined()
    expect(findSubjectByName(subjects, '')).toBeUndefined()
  })
})

describe('searchSubjects — matches', () => {
  const subjects = [subject('s1', 'Mathematics'), subject('s2', 'Physics'), subject('s3', 'Advanced Mathematics')]

  it('returns every subject when the query is empty', () => {
    const result = searchSubjects(subjects, '   ')
    expect(result.matches.map((m) => m.id).sort()).toEqual(['s1', 's2', 's3'])
    expect(result.createName).toBeNull()
  })

  it('matches case-insensitively on a substring', () => {
    const result = searchSubjects(subjects, 'MATH')
    expect(result.matches.map((m) => m.id)).toEqual(expect.arrayContaining(['s1', 's3']))
    expect(result.matches.some((m) => m.id === 's2')).toBe(false)
  })

  it('reports the exact (normalised) match', () => {
    const result = searchSubjects(subjects, '  matheMATICS ')
    expect(result.exact?.id).toBe('s1')
  })
})

describe('searchSubjects — duplicate prevention (regression)', () => {
  const subjects = [subject('s1', 'Mathematics')]

  it('does NOT offer "Create" when the query is a prefix of an existing subject', () => {
    // Regression: typing "math" used to offer both the match AND "Create math",
    // which could create a second, near-duplicate subject.
    const result = searchSubjects(subjects, 'math')
    expect(result.matches).toHaveLength(1)
    expect(result.createName).toBeNull()
  })

  it('does NOT offer "Create" for an exact name in different casing', () => {
    expect(searchSubjects(subjects, 'MATHEMATICS').createName).toBeNull()
  })

  it('does NOT offer "Create" for an exact name with surrounding whitespace', () => {
    expect(searchSubjects(subjects, '   mathematics   ').createName).toBeNull()
  })

  it('does NOT offer "Create" for an Arabic variant with diacritics/tatweel', () => {
    const arabic = [subject('a1', 'محاسبة')]
    expect(searchSubjects(arabic, 'مُحَاسَبَة').createName).toBeNull()
    expect(searchSubjects(arabic, 'مـحـاسبة').createName).toBeNull()
  })

  it('offers "Create" with the cleaned name when nothing matches', () => {
    const result = searchSubjects(subjects, '  Organic   Chemistry ')
    expect(result.matches).toHaveLength(0)
    expect(result.createName).toBe('Organic Chemistry')
  })

  it('still offers several matches for a broader query', () => {
    const two = [subject('s1', 'Mathematics'), subject('s2', 'Math Lab')]
    const result = searchSubjects(two, 'math')
    expect(result.matches).toHaveLength(2)
    expect(result.createName).toBeNull()
  })
})

describe('subjectOptions & colour assignment', () => {
  it('hides archived subjects from pickers but keeps them in the store', () => {
    const all = [subject('s1', 'Active'), subject('s2', 'Archived', { archived: true })]
    expect(subjectOptions(all).map((o) => o.id)).toEqual(['s1'])
  })

  it('sorts options alphabetically', () => {
    const all = [subject('s1', 'Physics'), subject('s2', 'Algebra'), subject('s3', 'Chemistry')]
    expect(subjectOptions(all).map((o) => o.name)).toEqual(['Algebra', 'Chemistry', 'Physics'])
  })

  it('never reuses a palette colour while unused colours remain', () => {
    const used = [subject('s1', 'A', { color: 'terracotta' }), subject('s2', 'B', { color: 'sage' })]
    const picked = nextSubjectColor(used)
    expect(['terracotta', 'sage']).not.toContain(picked)
  })

  it('cycles the palette once every colour is taken', () => {
    const keys: Subject['color'][] = ['terracotta', 'sage', 'blush', 'dustyBlue', 'beige', 'charcoal', 'amber', 'plum']
    const used = keys.map((color, i) => subject(`s${i}`, `S${i}`, { color }))
    expect(keys).toContain(nextSubjectColor(used))
  })
})
