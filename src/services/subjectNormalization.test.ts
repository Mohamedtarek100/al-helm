import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
    // NFKC folds fullwidth characters to their ASCII equivalents. Verified by
    // code point: Ｍａｔｈ ２ (Math 2 in fullwidth) -> "math 2".
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
  })
})

describe('fullwidth Plus (U+FF0B) NFKC folding', () => {
  const FF_C = String.fromCharCode(0xff23)
  const FF_PLUS = String.fromCharCode(0xff0b)

  it('folds FULLWIDTH PLUS SIGN to ASCII plus under NFKC', () => {
    // Verified empirically: U+FF0B normalises to U+002B.
    expect(FF_PLUS.normalize('NFKC')).toBe('+')
    expect(FF_C.normalize('NFKC')).toBe('C')
  })

  it('Ｃ＋ (two fullwidth pluses) equals C++', () => {
    // Regression: the previous test compared a single fullwidth plus against
    // two ASCII pluses, which can never be equal and proved nothing.
    expect(subjectNameKey(FF_C + FF_PLUS + FF_PLUS)).toBe(subjectNameKey('C++'))
  })

  it('a single fullwidth plus is C+, which is NOT the same subject as C++', () => {
    expect(subjectNameKey(FF_C + FF_PLUS)).toBe(subjectNameKey('C+'))
    expect(subjectNameKey(FF_C + FF_PLUS)).not.toBe(subjectNameKey('C++'))
  })

  it('still keeps C++ distinct from C#', () => {
    expect(subjectNameKey('C++')).not.toBe(subjectNameKey('C#'))
  })
})

/* ------------------------------------------------------------------ */
/* Client/SQL parity                                                   */
/* ------------------------------------------------------------------ */

describe('mandatory regression cases', () => {
  const FF_C = String.fromCharCode(0xff23) // Ｃ
  const FF_PLUS = String.fromCharCode(0xff0b) // ＋

  it('Ｃ＋ and C++ produce the same key (NFKC folds before comparison)', () => {
    expect(subjectNameKey(FF_C + FF_PLUS + FF_PLUS)).toBe(subjectNameKey('C++'))
    expect(subjectNameKey(FF_C + FF_PLUS + FF_PLUS)).toBe('c++')
  })

  it('Ｃ＋ and C++ remain distinct (one operator is not two)', () => {
    expect(subjectNameKey(FF_C + FF_PLUS)).toBe('c+')
    expect(subjectNameKey(FF_C + FF_PLUS)).not.toBe(subjectNameKey('C++'))
  })

  it('Ｃ＋ and C+ are the same subject', () => {
    expect(subjectNameKey(FF_C + FF_PLUS)).toBe(subjectNameKey('C+'))
  })

  it('other fullwidth compatibility characters fold to their ASCII form', () => {
    expect(subjectNameKey('Ｍａｔｈ ２')).toBe('math 2')
    expect(subjectNameKey('ＡＢＣ')).toBe('abc')
  })

  it('Arabic presentation forms fold to their base letters', () => {
    // U+FEE3 is the isolated presentation form of ARABIC LETTER MEEM.
    const presentationMeem = String.fromCharCode(0xfee3)
    expect(subjectNameKey(presentationMeem + 'حاسبة')).toBe(subjectNameKey('محاسبة'))
  })

  it('English case differences normalise consistently', () => {
    expect(subjectNameKey('Chemistry')).toBe(subjectNameKey('CHEMISTRY'))
    expect(subjectNameKey('Chemistry')).toBe(subjectNameKey('  chemistry  '))
  })
})

const migration007 = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '202610250007_subject_name_key_correction.sql'),
  'utf8',
)

/**
 * The SQL function cannot be executed here (no database), so parity is asserted
 * against the documented contract: the SQL must implement every rule the
 * client applies. Any drift between the two would let two devices create
 * "different" names that the database then treats as the same, or vice versa.
 */
describe('SQL subject_name_key() implements the same contract as the client', () => {
  const body = migration007.slice(migration007.indexOf('create or replace function public.subject_name_key'))

  it('applies Unicode NFKC normalisation server-side', () => {
    // This is the step whose absence caused the original divergence.
    expect(body).toMatch(/normalize\(/i)
    expect(body).toMatch(/, NFKC\)/i)
  })

  it('lower-cases', () => {
    expect(body).toContain('lower(')
  })

  it('trims and collapses whitespace to a single space', () => {
    expect(body).toContain('btrim(')
    expect(body).toContain('[[:space:]]+')
  })

  it('strips the same Arabic mark ranges and tatweel as the client', () => {
    expect(body).toContain(String.raw`\u0617-\u061A`)
    expect(body).toContain(String.raw`\u064B-\u0652`)
    expect(body).toContain(String.raw`\u0670`)
    expect(body).toContain(String.raw`\u06D6-\u06ED`)
    expect(body).toContain(String.raw`\u0640`)
  })

  it('preserves punctuation, symbols and digits (no broad category stripping)', () => {
    expect(body).not.toMatch(/\\p\{[PSMZ]\}/)
  })

  it('does not claim to be missing NFKC support', () => {
    expect(migration007).not.toMatch(/does NOT apply NFKC/i)
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
