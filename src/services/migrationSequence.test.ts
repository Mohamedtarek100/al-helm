import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Pending-migration set and ordering.
 *
 * Guards the release-blocking defect found in the previous migration review:
 * migration 008 added a SECOND before-write trigger (`subjects_verify_name_key_trg`)
 * on the same table. PostgreSQL fires same-timing triggers in name order, and
 * `subjects_set_name_key_trg` (006) sorts FIRST — it overwrites `new.name_key`
 * with the SQL-derived value — so 008's verifier then compared a value it had
 * itself just produced. The check could never fail, and the client key was
 * silently discarded.
 *
 * 008 was therefore removed. One trigger derives the key; one unique index
 * enforces it; nothing overwrites anything.
 */

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
const read = (name: string) => readFileSync(join(MIGRATIONS, name), 'utf8')

describe('pending migration set', () => {
  it('contains the expected ordered sequence', () => {
    expect(files.map((f) => f.slice(0, 12))).toEqual([
      '202610190001',
      '202610190002',
      '202610190003',
      '202610190004',
      '202610240005',
      '202610250006',
      '202610250007',
    ])
  })

  it('does not contain the superseded 008 verifier', () => {
    expect(files.some((f) => f.includes('202610250008'))).toBe(false)
  })

  it('ships exactly one subject-key trigger across all migrations', () => {
    const triggerCreates = files
      .map((f) => read(f))
      .join('\n')
      .match(/create trigger\s+subjects_[a-z_]*trg/gi) ?? []
    expect(triggerCreates).toHaveLength(1)
    expect(triggerCreates[0]).toMatch(/subjects_set_name_key_trg/)
  })

  it('creates exactly one user-scoped unique index for the key', () => {
    const indexes = files
      .filter((f) => f.startsWith('202610250006') || f.startsWith('202610250007'))
      .map(read)
      .join('\n')
      .match(/create unique index[^;]*subjects_user_name_key_uidx[^;]*;/gi) ?? []
    // 006 creates it, 007 drops and recreates it — but each definition is
    // scoped by (user_id, name_key) so different accounts may share a name.
    expect(indexes.length).toBeGreaterThan(0)
    for (const sql of indexes) expect(sql).toMatch(/\(user_id,\s*name_key\)/)
  })
})

describe('industry-safe migration content', () => {
  it('never deletes or renames subjects to satisfy a constraint', () => {
    const all = files.map(read).join('\n')
    expect(all).not.toMatch(/delete\s+from\s+public\.subjects/i)
    expect(all).not.toMatch(/update\s+public\.subjects[\s\S]{0,120}set\s+name\s*=/i)
  })

  it('never touches migrations 001-004', () => {
    const applied = ['202610190001', '202610190002', '202610190003', '202610190004']
    for (const prefix of applied) {
      const file = files.find((f) => f.startsWith(prefix))
      expect(file, `applied migration ${prefix} must still exist`).toBeTruthy()
    }
  })

  it('005 widens the priority constraint to include urgent', () => {
    const sql = read(files.find((f) => f.startsWith('202610240005')) as string)
    expect(sql).toMatch(/tasks_priority_check/)
    expect(sql).toMatch(/'urgent'/)
  })

  it('007 applies native NFKC before stripping marks', () => {
    const sql = read(files.find((f) => f.startsWith('202610250007')) as string)
    expect(sql).toMatch(/normalize\(coalesce\(raw, ''\), NFKC\)/)
    // NFKC must happen before mark stripping, so marks survive to be removed.
    expect(sql.indexOf('normalize(')).toBeLessThan(sql.indexOf('\\u0617'))
  })

  it('007 drops the unique index before recomputing keys', () => {
    const sql = read(files.find((f) => f.startsWith('202610250007')) as string)
    const drop = sql.indexOf('drop index if exists public.subjects_user_name_key_uidx')
    const update = sql.indexOf('update public.subjects')
    const recreate = sql.lastIndexOf('create unique index if not exists')
    expect(drop).toBeGreaterThan(-1)
    expect(drop).toBeLessThan(update)
    expect(update).toBeLessThan(recreate)
  })
})
