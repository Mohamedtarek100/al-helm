import { describe, expect, it } from 'vitest'
import { subjectNameKey } from './subjects'

/**
 * Client/SQL canonical-key parity.
 *
 * This is a maintained fixture, not a one-off script: the SAME input set is
 * compared against (a) subjectNameKey() in TypeScript and (b) the expected
 * output that the SQL function in migration 007 must produce.
 *
 * The `sql` field below was produced by executing the exact migration-007
 * expression on the production PostgreSQL 17.11 instance (UTF8):
 *
 *   select lower(btrim(regexp_replace(regexp_replace(
 *     normalize(coalesce(x,''), NFKC),
 *     '[\u0617-\u061A\u064B-\u0652\u0670\u06D6-\u06ED\u0640]', '', 'g'),
 *     '[[:space:]]+', ' ', 'g')))
 *
 * Regenerate that column with scripts/verify-subject-key-parity.sql whenever
 * either implementation changes. If the two ever disagree, this test fails.
 */

interface Case {
  input: string
  sql: string
  why: string
}

const CASES: Case[] = [
  // Full-width compatibility folding (NFKC) — the case that 006/007/008 disagreed on.
  { input: ' Ｃ＋＋ ', sql: 'c++', why: 'fullwidth C and two fullwidth pluses fold to C++' },
  { input: 'C++', sql: 'c++', why: 'ASCII baseline' },
  { input: 'Ｃ＋', sql: 'c+', why: 'one fullwidth plus is one operator, not two' },
  { input: ' Ｃ＋ ', sql: 'c+', why: 'single fullwidth plus, whitespace trimmed' },
  { input: 'C+', sql: 'c+', why: 'single plus' },
  { input: 'C#', sql: 'c#', why: 'hash is preserved and distinct from plus' },
  { input: 'Ｍａｔｈ ２', sql: 'math 2', why: 'fullwidth latin and digit fold' },
  { input: 'ＡＢＣ', sql: 'abc', why: 'fullwidth latin folds' },

  // Semantic differences that must survive.
  { input: 'Math 1', sql: 'math 1', why: 'space before a digit is meaningful' },
  { input: 'Math1', sql: 'math1', why: 'no space is a different subject' },
  { input: 'Physics (A)', sql: 'physics (a)', why: 'brackets carry meaning' },
  { input: 'Physics A', sql: 'physics a', why: 'distinct from the bracketed form' },
  { input: 'Unit 1.1', sql: 'unit 1.1', why: 'the decimal point must survive' },
  { input: 'A+B', sql: 'a+b', why: 'a plus is not noise' },

  // Arabic marks and tatweel.
  { input: 'مُحَاسَبَة', sql: 'محاسبة', why: 'harakat are stripped' },
  { input: 'مـحـاسبة', sql: 'محاسبة', why: 'tatweel is stripped' },
  { input: 'الرِّيَاضِيَّات', sql: 'الرياضيات', why: 'shadda/tanween are stripped' },

  // Whitespace.
  { input: 'Advanced   Math', sql: 'advanced math', why: 'runs collapse to one space' },
  { input: '  Chemistry  ', sql: 'chemistry', why: 'leading/trailing whitespace trimmed' },
  { input: 'MAThematics', sql: 'mathematics', why: 'case folds consistently' },

  // Arabic-Indic digits are NOT ASCII (NFKC does not map them).
  { input: 'رياضيات ٢', sql: 'رياضيات ٢', why: 'Arabic-Indic digits are preserved' },
  { input: 'رياضيات 2', sql: 'رياضيات 2', why: 'ASCII digits are preserved' },
]

const ff = (code: number) => String.fromCharCode(code)

describe('client/SQL parity (fixture generated from production PostgreSQL)', () => {
  it.each(CASES.map((c) => [c.input, c.sql, c.why] as const))(
    '%j matches SQL (%s)',
    (input, expected) => {
      expect(subjectNameKey(input)).toBe(expected)
    },
  )

  it('the fixture itself encodes the required distinctions', () => {
    // Guard against a fixture that silently collapsed everything to one value.
    const distinct = new Set(CASES.map((c) => c.sql))
    expect(distinct.size).toBeGreaterThan(10)
  })

  it('Arabic-Indic and ASCII digits stay distinct in both layers', () => {
    const arabic = subjectNameKey('رياضيات ٢')
    const ascii = subjectNameKey('رياضيات 2')
    expect(arabic).not.toBe(ascii)
    // …and the SQL fixture agrees.
    expect(CASES.find((c) => c.input === 'رياضيات ٢')?.sql).not.toBe(CASES.find((c) => c.input === 'رياضيات 2')?.sql)
  })

  it('Ｃ＋ and C++ agree, while Ｃ＋ and C++ do not', () => {
    expect(subjectNameKey(ff(0xff23) + ff(0xff0b) + ff(0xff0b))).toBe(subjectNameKey('C++'))
    expect(subjectNameKey(ff(0xff23) + ff(0xff0b))).not.toBe(subjectNameKey('C++'))
  })
})
