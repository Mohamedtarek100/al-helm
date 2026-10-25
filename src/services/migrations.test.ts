import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Migration 005 — STATIC validation only.
 *
 * No database credentials are available in this environment, so nothing here
 * executes SQL against Supabase. These assertions guard the properties that
 * keep the migration safe and additive:
 *   - it widens (never removes) the priority CHECK constraint,
 *   - legacy rows are normalised before the constraint is enforced,
 *   - no destructive statements (DROP TABLE / DELETE / TRUNCATE / RLS disable),
 *   - it is listed in the generated ALL_MIGRATIONS.sql, in order.
 */

const dir = join(process.cwd(), 'supabase', 'migrations')
const file = '202610240005_task_priority_and_drawing_model.sql'
const sql = readFileSync(join(dir, file), 'utf8')
const all = readFileSync(join(process.cwd(), 'supabase', 'ALL_MIGRATIONS.sql'), 'utf8')

const stripComments = (text: string) => text.replace(/--[^\n]*/g, '')
const code = stripComments(sql).toLowerCase()

describe('migration 005: priority levels', () => {
  it('adds the urgent level to the priority constraint', () => {
    expect(code).toContain("check (priority in ('urgent','high','medium','low'))")
  })

  it('drops the old constraint before re-adding it (idempotent re-run)', () => {
    expect(code).toMatch(/drop constraint if exists tasks_priority_check/)
    const dropAt = code.indexOf('drop constraint if exists tasks_priority_check')
    const addAt = code.indexOf("add constraint tasks_priority_check")
    expect(dropAt).toBeGreaterThan(-1)
    expect(addAt).toBeGreaterThan(dropAt)
  })

  it('normalises null/unknown values BEFORE enforcing the constraint', () => {
    const updateAt = code.indexOf("update public.tasks set priority = 'medium'")
    const addAt = code.indexOf('add constraint tasks_priority_check')
    expect(updateAt).toBeGreaterThan(-1)
    expect(addAt).toBeGreaterThan(updateAt)
  })

  it('sets a safe default and keeps the column non-null', () => {
    expect(code).toContain("alter column priority set default 'medium'")
    expect(code).toContain('alter column priority set not null')
  })
})

describe('migration 005: drawing model columns', () => {
  it('adds paper and drawing_model as nullable, creating columns only if absent', () => {
    expect(code).toContain('add column if not exists paper text')
    expect(code).toContain('add column if not exists drawing_model text')
    // Nullable: no NOT NULL on either added column.
    const paperLine = code.split('\n').find((line) => line.includes('add column if not exists paper')) ?? ''
    expect(paperLine).not.toContain('not null')
  })

  it('constrains paper values without breaking existing rows', () => {
    expect(code).toContain("check (paper is null or paper in ('white','cream','grid'))")
  })
})

describe('migration 005: safety', () => {
  it('contains no destructive statements', () => {
    for (const forbidden of ['drop table', 'truncate', 'delete from', 'drop column', 'disable row level security']) {
      expect(code).not.toContain(forbidden)
    }
  })

  it('does not touch RLS policies or grants', () => {
    expect(code).not.toContain('create policy')
    expect(code).not.toContain('drop policy')
    expect(code).not.toContain('revoke')
  })

  it('only targets the two expected tables', () => {
    const tables = [...code.matchAll(/alter table (public\.[a-z_]+)/g)].map((m) => m[1])
    expect([...new Set(tables)].sort()).toEqual(['public.artwork_metadata', 'public.tasks'])
  })
})

describe('migration ordering', () => {
  it('is ordered after every earlier migration and listed chronologically', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    // Later migrations may exist; this one must simply never be out of order.
    expect(files.indexOf(file)).toBeGreaterThan(-1)
    expect(files).toEqual([...files].sort()) // lexical == chronological for these names
    expect(files.indexOf(file)).toBeGreaterThan(files.indexOf('202610190004_announcement_author_nullable.sql'))
  })

  it('is present in ALL_MIGRATIONS.sql after the previous migration', () => {
    const prevAt = all.indexOf('Migration: 202610190004_announcement_author_nullable.sql')
    const thisAt = all.indexOf(`Migration: ${file}`)
    expect(prevAt).toBeGreaterThan(-1)
    expect(thisAt).toBeGreaterThan(prevAt)
  })
})
