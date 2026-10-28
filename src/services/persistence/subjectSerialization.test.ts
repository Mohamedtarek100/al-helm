import { describe, expect, it } from 'vitest'

/**
 * Subject serialization contract.
 *
 * Root cause this guards: the adapter used to attach a client-computed
 * `name_key` to every subject row. Production had no such column (migration 006
 * pending), so PostgREST rejected the whole snapshot write with
 * PGRST204 "column name_key does not exist" — which broke task saves too,
 * because the adapter writes every slice in one pass.
 *
 * The database now owns the key: the row must NOT carry name_key, and the
 * trigger derives it from `name`.
 */

const source = await import('node:fs').then((fs) =>
  fs.readFileSync('src/services/persistence/supabase.ts', 'utf8'),
)

describe('subjectsRow() no longer sends a client-computed key', () => {
  it('deletes name_key from the row it builds', () => {
    const body = source.slice(source.indexOf('const subjectsRow'))
    const fn = body.slice(0, body.indexOf('const fromDb'))
    expect(fn).toContain('delete mapped.name_key')
    expect(fn).not.toContain('mapped.name_key =')
  })

  it('contains no client-side key assignment anywhere in the adapter', () => {
    expect(source).not.toMatch(/\.name_key\s*=\s*subjectNameKey/)
  })

  it('does not depend on subjectNameKey at all', () => {
    expect(source).not.toMatch(/import\s*\{[^}]*subjectNameKey[^}]*\}/)
  })
})

describe('reads do not leak the derived column into app state', () => {
  it('fromDb drops name_key as well as user_id', () => {
    const body = source.slice(source.indexOf('const fromDb'))
    expect(body.slice(0, 300)).toContain("key !== 'name_key'")
  })
})

describe('hydration strips a legacy name_key from stored snapshots', () => {
  it('removes it when loading local data', async () => {
    const { hydrateData } = await import('../domain')
    const hydrated = hydrateData({
      subjects: [
        { id: 's1', name: 'Math', color: 'sage', notes: '', weeklyTargetMinutes: 0, archived: false, createdAt: 'x', updatedAt: 'x', name_key: 'math' },
      ] as never,
    })
    expect(hydrated.subjects[0]).not.toHaveProperty('name_key')
    // The real fields survive untouched.
    expect(hydrated.subjects[0]).toMatchObject({ id: 's1', name: 'Math' })
  })
})
