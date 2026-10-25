import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SubjectDuplicateError, findSubjectIncludingArchived, subjectNameKey } from './subjects'
import type { Subject } from '../types'

/**
 * Subject uniqueness — client contract + static migration validation.
 *
 * Two independent guarantees are checked here:
 *   1. The CLIENT key (`subjectNameKey`) folds exactly the variations that
 *      previously produced duplicates across devices.
 *   2. The SQL migration implements the same folding and refuses to run when
 *      existing collisions would be silently merged.
 *
 * No SQL is executed: there is no database in this environment. The SQL side
 * is validated statically, and that distinction is reflected in the test names.
 */

const subject = (id: string, name: string, extra: Partial<Subject> = {}): Subject => ({
  id, name, color: 'terracotta', notes: '', weeklyTargetMinutes: 0, archived: false,
  createdAt: 'x', updatedAt: 'x', ...extra,
})

describe('subjectNameKey: canonical identity', () => {
  it('ignores casing', () => {
    expect(subjectNameKey('Mathematics')).toBe(subjectNameKey('mathematics'))
    expect(subjectNameKey('MATH')).toBe(subjectNameKey('Math'))
  })

  it('ignores surrounding and repeated whitespace', () => {
    expect(subjectNameKey('  Math   Two  ')).toBe(subjectNameKey('math two'))
    expect(subjectNameKey('Math\tTwo\n')).toBe(subjectNameKey('math two'))
  })

  it('strips Arabic diacritics (harakat)', () => {
    expect(subjectNameKey('مُحَاسَبَة')).toBe(subjectNameKey('محاسبة'))
  })

  it('strips tatweel', () => {
    expect(subjectNameKey('مـحـاسـبة')).toBe(subjectNameKey('محاسبة'))
  })

  it('PRESERVES punctuation so meaning-bearing names stay distinct', () => {
    // Superseded behaviour: an earlier key deleted punctuation, merging these.
    expect(subjectNameKey('Math!')).not.toBe(subjectNameKey('Math'))
    expect(subjectNameKey('Math (I)')).not.toBe(subjectNameKey('Math I'))
    expect(subjectNameKey('C++')).not.toBe(subjectNameKey('C#'))
    expect(subjectNameKey('Math 1')).not.toBe(subjectNameKey('Math1'))
  })

  it('keeps genuinely different names distinct', () => {
    expect(subjectNameKey('Math')).not.toBe(subjectNameKey('Math 2'))
    expect(subjectNameKey('Physics')).not.toBe(subjectNameKey('Mathematics'))
  })

  it('is idempotent', () => {
    const once = subjectNameKey('Mُath   I')
    expect(subjectNameKey(once)).toBe(once)
  })

  it('never mutates the display name', () => {
    const name = '  Mathematics   II '
    subjectNameKey(name)
    expect(name).toBe('  Mathematics   II ')
  })
})

describe('cross-device duplicate scenarios now collapse to one key', () => {
  const cases: Array<[string, string]> = [
    ['Math', ' math '],
    ['Math', 'MATH'],
    ['محاسبة', 'مُحَاسَبَة'],
    ['محاسبة', 'مـحـاسـبة'],
    ['Advanced Math', 'Advanced   Math'],
  ]
  it.each(cases)('%s ≡ %s', (a, b) => {
    expect(subjectNameKey(a)).toBe(subjectNameKey(b))
  })
})

describe('findSubjectIncludingArchived', () => {
  it('finds an archived subject so its name is not re-created', () => {
    const list = [subject('a1', 'Biology', { archived: true })]
    expect(findSubjectIncludingArchived(list, 'biology')?.id).toBe('a1')
  })

  it('returns undefined when no subject owns the name', () => {
    expect(findSubjectIncludingArchived([subject('a1', 'Biology')], 'Chemistry')).toBeUndefined()
  })
})

describe('SubjectDuplicateError', () => {
  it('carries the id of the existing record for reuse', () => {
    const error = new SubjectDuplicateError('sub_1')
    expect(error).toBeInstanceOf(Error)
    expect(error.existingId).toBe('sub_1')
    expect(error.name).toBe('SubjectDuplicateError')
  })
})

/* ===================================================================== */
/* Static validation of migration 006 (no database is executed)          */
/* ===================================================================== */

const migrationPath = join(process.cwd(), 'supabase', 'migrations', '202610250006_subject_name_uniqueness.sql')
const sql = readFileSync(migrationPath, 'utf8')
const all = readFileSync(join(process.cwd(), 'supabase', 'ALL_MIGRATIONS.sql'), 'utf8')
const code = sql.replace(/--[^\n]*/g, '').toLowerCase()

describe('migration 006 (static): user-scoped uniqueness', () => {
  it('creates the unique index over (user_id, name_key), never name alone', () => {
    expect(code).toContain('create unique index if not exists subjects_user_name_key_uidx')
    expect(code).toMatch(/unique index[^;]*on public\.subjects \(user_id, name_key\)/s)
    // A global unique on the display name is explicitly forbidden.
    expect(code).not.toMatch(/unique[^;]*\(\s*name\s*\)/)
  })

  it('adds the key column additively', () => {
    expect(code).toContain('add column if not exists name_key text')
    expect(code).not.toContain('drop column')
  })

  it('maintains the key through a BEFORE INSERT/UPDATE trigger', () => {
    expect(code).toContain('before insert or update of name')
    expect(code).toContain('new.name_key := public.subject_name_key(new.name)')
  })

  it('derives the key from Unicode format categories (superseded by 007)', () => {
    // Migration 006 used the broad \p{P}\p{S}\p{M}\p{Z} classes. That was too
    // aggressive and is replaced by migration 007; this assertion merely pins
    // what 006 did so the history stays understandable.
    expect(code).toContain('\\p{p}\\p{s}\\p{m}\\p{z}\\u0640')
    expect(code).toContain('lower(')
    expect(code).toContain('btrim(')
  }),

  it('backfills existing rows', () => {
    expect(code).toContain('update public.subjects')
    expect(code).toContain('where name_key is distinct from')
  })

  it('aborts on pre-existing collisions instead of merging or deleting', () => {
    expect(code).toContain('raise exception')
    expect(code).toContain('having count(*) > 1')
    for (const forbidden of ['delete from public.subjects', 'drop table', 'truncate']) {
      expect(code).not.toContain(forbidden)
    }
  })

  it('checks collisions BEFORE creating the unique index', () => {
    const checkAt = code.indexOf('raise exception')
    const indexAt = code.indexOf('create unique index')
    expect(checkAt).toBeGreaterThan(-1)
    expect(indexAt).toBeGreaterThan(checkAt)
  })

  it('does not weaken RLS or grants', () => {
    expect(code).not.toContain('disable row level security')
    expect(code).not.toContain('create policy')
    expect(code).not.toContain('drop policy')
  })

  it('is present in ALL_MIGRATIONS.sql after migration 005', () => {
    const prev = all.indexOf('Migration: 202610240005_task_priority_and_drawing_model.sql')
    const thisOne = all.indexOf('Migration: 202610250006_subject_name_uniqueness.sql')
    expect(prev).toBeGreaterThan(-1)
    expect(thisOne).toBeGreaterThan(prev)
  })

  it('documents the NFKC limitation instead of pretending to enforce it', () => {
    expect(sql).toContain('NFKC is NOT applied here')
    expect(sql).toContain('subjectNameKey()')
  })
})

/* ===================================================================== */
/* Migration 007 — corrected key (static validation, no DB execution)     */
/* ===================================================================== */

const sql007 = readFileSync(join(process.cwd(), 'supabase', 'migrations', '202610250007_subject_name_key_correction.sql'), 'utf8')
const code007 = sql007.replace(/--[^\n]*/g, '').toLowerCase()

describe('migration 007 (static): corrected canonical key', () => {
  it('drops the broad Unicode-category deletion in favour of explicit Arabic ranges', () => {
    expect(code007).not.toContain('\\p{p}')
    expect(code007).not.toContain('\\p{s}')
    // Arabic harakat + shadda/sukun ranges and tatweel are explicitly listed.
    expect(code007).toContain('\\u0617-\\u061a')
    expect(code007).toContain('\\u064b-\\u0652')
    expect(code007).toContain('\\u0640')
  })

  it('keeps whitespace collapsing and lower-casing', () => {
    expect(code007).toContain('[[:space:]]+')
    expect(code007).toContain('lower(')
  })

  it('recomputes existing keys before enforcing anything', () => {
    const updateAt = code007.indexOf('update public.subjects')
    const checkAt = code007.indexOf('raise exception')
    expect(updateAt).toBeGreaterThan(-1)
    expect(checkAt).toBeGreaterThan(updateAt)
  })

  it('drops the old index before the collision check and recreates it after', () => {
    const dropAt = code007.indexOf('drop index if exists')
    const checkAt = code007.indexOf('raise exception')
    const createAt = code007.indexOf('create unique index')
    expect(dropAt).toBeGreaterThan(-1)
    expect(checkAt).toBeGreaterThan(dropAt)
    expect(createAt).toBeGreaterThan(checkAt)
  })

  it('aborts instead of merging or deleting colliding subjects', () => {
    expect(code007).toContain('raise exception')
    for (const forbidden of ['delete from public.subjects', 'drop table', 'truncate', 'update public.subjects set name =']) {
      expect(code007).not.toContain(forbidden)
    }
  })

  it('remains user-scoped, never global', () => {
    expect(code007).toMatch(/on public\.subjects \(user_id, name_key\)/)
  })

  it('does not touch RLS, policies or grants', () => {
    expect(code007).not.toContain('create policy')
    expect(code007).not.toContain('disable row level security')
    expect(code007).not.toContain('revoke')
  })
})
