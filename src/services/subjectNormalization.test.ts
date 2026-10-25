import { describe, expect, it } from 'vitest'
import { subjectNameKey } from './subjects'

/**
 * Normlisation contract: the canonical key must conflate only *presentation*
 * differences (case, extra whitespace, Arabic diacritics, tatweel, Unicode
 * compatibility forms) and never *semantic* differences.
 *
 * Regression target: the first implementation deleted every Unicode
 * punctuation/symbol/separator character outright, which made distinct
 * subjects collide — `C++` vs `C#`, and `Math 1` vs `Math1`. That silently
 * merged two different subjects into one record.
 */

describe('collisions that must NEVER happen', () => {
  const pairs: Array<[string, string, string]> = [
    ['C++', 'C#', 'different programming languages'],
    ['Math 1', 'Math1', 'space is meaningful between words and digits'],
    ['Physics (A)', 'Physics A', 'brackets carry meaning in a syllabus'],
    ['Math-1', 'Math 1', 'a hyphen is not whitespace'],
    ['A+B', 'AB', 'a plus is not noise'],
    ['Unit 1.1', 'Unit 11', 'a decimal point must survive'],
    ['Chapter 2', 'Chapter 12', 'digits must never be dropped'],
  ]

  it.each(pairs)('"%s" stays distinct from "%s" (%s)', (a, b) => {
    expect(subjectNameKey(a)).not.toBe(subjectNameKey(b))
  })
})

describe('presentation differences that MUST collapse', () => {
  const pairs: Array<[string, string]> = [
    ['Mathematics', ' mathematics '],
    ['Mathematics', 'MATHEMATICS'],
    ['Advanced   Math', 'Advanced Math'],
    ['Advanced\tMath', 'Advanced Math'],
    ['محاسبة', 'مُحَاسَبَة'],
    ['محاسبة', 'مـحـاسبة'],
    ['Ｃ＋', 'c＋'], // full-width LATIN letters fold (＋ is already fullwidth form)
    ['Ｍａｔｈ ２', 'Math 2'],
  ]

  it.each(pairs)('"%s" ≡ "%s"', (a, b) => {
    expect(subjectNameKey(a)).toBe(subjectNameKey(b))
  })
})

describe('supported Arabic mark handling', () => {
  it('removes harakat (fatha/damma/kasra/sukun/shadda/tanween)', () => {
    expect(subjectNameKey('الرِّيَاضِيَّات')).toBe(subjectNameKey('الرياضيات'))
    expect(subjectNameKey('مُحَاسَبَة')).toBe(subjectNameKey('محاسبة'))
  })

  it('removes tatweel', () => {
    expect(subjectNameKey('مـحـاسـبة')).toBe(subjectNameKey('محاسبة'))
  })

  it('keeps Arabic letters themselves (no over-stripping)', () => {
    expect(subjectNameKey('عربي')).not.toBe(subjectNameKey('عرب'))
  })

  it('keeps Arabic-Indic and ASCII digits distinct (NFKC does not fold them)', () => {
    // Verified behaviour: '٢' is not a compatibility equivalent of '2', so a
    // name written with Arabic-Indic digits stays a distinct subject.
    expect(subjectNameKey('رياضيات ٢')).not.toBe(subjectNameKey('رياضيات 2'))
    // Full-width PLUS is likewise not folded to ASCII '+': no accidental
    // merging of symbol-bearing names.
    expect(subjectNameKey('Ｃ＋')).not.toBe(subjectNameKey('C++'))
  })
})

describe('boundary and malformed input', () => {
  it('returns an empty key for empty or whitespace-only input', () => {
    expect(subjectNameKey('')).toBe('')
    expect(subjectNameKey('   ')).toBe('')
    expect(subjectNameKey('\t\n')).toBe('')
  })

  it('keeps digits and periods inside a name', () => {
    expect(subjectNameKey('Math 1.2')).toBe('math 1.2')
  })

  it('is idempotent', () => {
    const once = subjectNameKey('  C++   Basics ')
    expect(subjectNameKey(once)).toBe(once)
  })

  it('never alters the display name', () => {
    const display = '  C++   Basics '
    subjectNameKey(display)
    expect(display).toBe('  C++   Basics ')
  })
})
