/**
 * Subject helpers - normalisation, duplicate detection and the "create on the
 * fly" flow shared by every subject selector.
 *
 * Duplicate policy (single, well-defined rule):
 *  - names are compared case-insensitively,
 *  - Arabic diacritics/tatweel are stripped,
 *  - Unicode compatibility forms are normalised (NFKC),
 *  - runs of whitespace collapse to a single space,
 *  - surrounding whitespace is ignored.
 * So "Math", " math " and "MATH" are the same subject; "Math 2" is not.
 */

import type { Subject, SubjectColorKey } from '../types'
import { SUBJECT_COLOR_KEYS } from './domain'

export function normalizeSubjectName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[\u0617-\u061A\u064B-\u0652\u0670\u06D6-\u06ED]/g, '') // Arabic diacritics
    .replace(/\u0640/g, '') // tatweel
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Canonical comparison key for a subject name.
 *
 * The rule: conflate PRESENTATION differences only, never SEMANTIC ones.
 *
 *   1. NFKC  - folds compatibility forms: full-width latin (Ｃ -> C), full-width
 *              punctuation (＋ -> +), ligatures and presentation forms
 *              (ﻣ -> م). Arabic-Indic digits are PRESERVED (١٢٣ stays ١٢٣);
 *              NFKC does NOT map them to ASCII digits.
 *   2. Remove ONLY supported Arabic combining marks (harakat / tanween /
 *              shadda / sukun) and tatweel. Other scripts keep their marks.
 *   3. Lower-case - Unicode simple case folding, locale independent.
 *   4. Collapse runs of whitespace to one space, then trim.
 *
 * Punctuation, symbols and digits are PRESERVED: "C++" and "C#" are two
 * different subjects, and so are "Math 1" and "Math1", and "Physics (A)"
 * vs "Physics A". An earlier version deleted whole Unicode categories, which
 * silently merged those pairs. Because NFKC runs first, "Ｃ＋" agrees with
 * "C++" — and both stay distinct from "C#".
 *
 * Mirrored in SQL by public.subject_name_key() (migration 007), which uses
 * PostgreSQL's native normalize(..., NFKC) — available on PG13+ with a UTF-8
 * database. The display name is never altered by this function.
 */
export function subjectNameKey(name: string): string {
  // A lone surrogate or non-string must never break a render or a save.
  if (typeof name !== 'string') return ''
  try {
    return cleanSubjectName(name)
      .normalize('NFKC')
    // Arabic harakat/tanween/shadda/sukun (U+0617-061A, U+064B-0652, U+0670,
    // U+06D6-06ED) and tatweel (U+0640, technically a letter).
    .replace(/[\u0617-\u061A\u064B-\u0652\u0670\u06D6-\u06ED\u0640]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
      .trim()
  } catch {
    return ''
  }
}

/** The canonical display form stored in the record. */
export function cleanSubjectName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

export interface SubjectOption {
  id: string
  name: string
  color: SubjectColorKey
  archived: boolean
}

/** Subjects offered in pickers: archived ones hidden, alphabetical, stable. */
export function subjectOptions(subjects: Subject[]): SubjectOption[] {
  return subjects
    .filter((subject) => !subject.archived)
    .map((subject) => ({ id: subject.id, name: subject.name, color: subject.color, archived: subject.archived }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function findSubjectByName(subjects: Subject[], name: string): Subject | undefined {
  const key = normalizeSubjectName(name)
  if (!key) return undefined
  return subjects.find((subject) => normalizeSubjectName(subject.name) === key)
}

/**
 * Finds whichever subject already owns this name, including archived ones.
 * Archived subjects still hold the name they were given, so re-creating that
 * name would put two rows with the same display name in the same account.
 */
export function findSubjectIncludingArchived(subjects: Subject[], name: string): Subject | undefined {
  return findSubjectByName(subjects, name)
}

export class SubjectDuplicateError extends Error {
  /** If a record was reused instead of created, its id is carried here. */
  readonly existingId: string | undefined
  constructor(existingId?: string) {
    super('A subject with this name already exists.')
    this.name = 'SubjectDuplicateError'
    this.existingId = existingId
  }
}

export interface SubjectSearchResult {
  matches: SubjectOption[]
  /** Exact duplicate (normalised) - creating again must reuse it. */
  exact: SubjectOption | null
  /** The trimmed text the user could create, or null when it is empty/duplicate. */
  createName: string | null
}

export function searchSubjects(subjects: Subject[], query: string): SubjectSearchResult {
  const options = subjectOptions(subjects)
  const raw = cleanSubjectName(query)
  const key = normalizeSubjectName(query)
  if (!key) return { matches: options, exact: null, createName: null }
  const exact = options.find((option) => normalizeSubjectName(option.name) === key) ?? null
  const matches = options.filter((option) => normalizeSubjectName(option.name).includes(key))
  // Never offer "Create X" when X is merely an abbreviation of an existing
  // subject: typing "math" while "Mathematics" exists (and is the only match)
  // should let the user pick it, not silently create a second subject. The
  // create row only appears when nothing matches at all.
  const createName = matches.length === 0 && !exact ? (raw || null) : null
  return { matches, exact, createName }
}

/** Picks a colour for a new subject, preferring unused palette entries. */
export function nextSubjectColor(subjects: Subject[]): SubjectColorKey {
  const used = new Set(subjects.map((subject) => subject.color))
  return SUBJECT_COLOR_KEYS.find((key) => !used.has(key)) ?? SUBJECT_COLOR_KEYS[subjects.length % SUBJECT_COLOR_KEYS.length]
}
