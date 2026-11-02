import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Task serialization contract — the production P0.
 *
 * CONFIRMED PRODUCTION FAILURE (from the Supabase PostgreSQL logs):
 *
 *   POST /rest/v1/tasks  ->  HTTP 400
 *   invalid input syntax for type time: ""     SQLSTATE 22007
 *
 * `tasks.due_time` is `TIME WITHOUT TIME ZONE` and nullable. The task form lets
 * the user leave the time empty and stores `''`; the generic camelCase mapper
 * carried that empty string straight into the INSERT, so **every task created
 * without a time was rejected by the server**. Because the adapter writes the
 * whole snapshot in one pass, the failure took the entire save down with it.
 *
 * These tests drive the REAL `SupabaseAdapter.save()` against a fake PostgREST
 * client that records the exact rows it is handed and — like PostgreSQL — throws
 * on an empty string for a TIME column. A mock that bypasses the mapper would
 * prove nothing, so the assertions are made on the payload that would be sent.
 */

type Row = Record<string, unknown>

/** Records every upsert payload, per table. */
const sent = vi.hoisted(() => ({ rows: {} as Record<string, Row[]>, failSave: null as string | null }))

/** Columns PostgreSQL would reject if given `''` instead of NULL. */
const TIME_COLUMNS = new Set(['due_time', 'start_time', 'end_time'])

vi.mock('@supabase/supabase-js', () => {
  /** Behaves like PostgREST + PostgreSQL for the cases under test. */
  const table = (name: string) => ({
    select: () => ({
      eq: Object.assign(async () => ({ data: [], error: null }), {
        maybeSingle: async () => ({ data: null, error: null }),
      }),
    }),
    upsert: async (payload: Row | Row[], _options?: { onConflict?: string }) => {
      // `profiles` / `user_preferences` upsert a single object; slices upsert arrays.
      const rows: Row[] = Array.isArray(payload) ? payload : [payload]
      for (const row of rows) {
        for (const column of TIME_COLUMNS) {
          if (row[column] === '') {
            return { error: { message: 'invalid input syntax for type time: ""', code: '22007' } }
          }
          if (column in row && row[column] !== null && typeof row[column] !== 'string') {
            return { error: { message: `invalid input syntax for type time: ${String(row[column])}`, code: '22007' } }
          }
        }
      }
      if (sent.failSave) return { error: { message: sent.failSave, code: '08006' } }
      const tableRows = (sent.rows[name] ?? [])
      sent.rows[name] = [...tableRows, ...rows]
      return { error: null }
    },
    delete: () => ({ eq: () => ({ in: async () => ({ error: null }) }) }),
  })

  return {
    createClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: 'user-qa', user_metadata: { display_name: 'QA' } } }, error: null }),
        getSession: async () => ({ data: { session: { user: { id: 'user-qa' } } }, error: null }),
      },
      from: (name: string) => table(name),
      storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null }) }) },
    }),
  }
})

vi.mock('import.meta.env', () => ({ VITE_SUPABASE_URL: 'https://qa.supabase.co', VITE_SUPABASE_ANON_KEY: 'qa-anon' }))

const { SupabaseAdapter, normalizeOptionalTime } = await import('./supabase')
const { hydrateData } = await import('../domain')

/** A complete document snapshot; only `tasks` matters to the assertions. */
function snapshot(tasks: Row[]) {
  const base = hydrateData(null)
  return {
    ...base,
    tasks: tasks.map((task) => ({
      id: 'tsk_1',
      title: 'Read chapter one',
      description: '',
      subjectId: null,
      dueDate: '2026-11-05',
      priority: 'medium',
      category: 'study',
      estimatedMinutes: 30,
      completed: false,
      completedAt: null,
      createdAt: '2026-11-02T10:00:00.000Z',
      updatedAt: '2026-11-02T10:00:00.000Z',
      ...task,
    })),
  } as never
}

function taskRow(): Row {
  const rows = sent.rows.tasks ?? []
  expect(rows.length).toBeGreaterThan(0)
  return rows[rows.length - 1]
}

beforeEach(() => {
  sent.rows = {}
  sent.failSave = null
})

describe('normalizeOptionalTime', () => {
  it('turns blank, whitespace and absent values into NULL', () => {
    expect(normalizeOptionalTime('')).toBeNull()
    expect(normalizeOptionalTime('   ')).toBeNull()
    expect(normalizeOptionalTime(undefined)).toBeNull()
    expect(normalizeOptionalTime(null)).toBeNull()
    expect(normalizeOptionalTime(42)).toBeNull()
  })

  it('preserves real times verbatim', () => {
    expect(normalizeOptionalTime('09:30')).toBe('09:30')
    expect(normalizeOptionalTime('14:45')).toBe('14:45')
    expect(normalizeOptionalTime(' 14:45 ')).toBe('14:45')
    expect(normalizeOptionalTime('23:59')).toBe('23:59')
  })
})

describe('SupabaseAdapter task payloads', () => {
  it('sends due_time: null when the task has no time', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const instance = new SupabaseAdapter(createClient('u', 'k') as never)
    await instance.save(snapshot([{ dueTime: '' }]))
    expect(taskRow().due_time).toBeNull()
  })

  it('sends due_time: null when the time is only whitespace or missing', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const instance = new SupabaseAdapter(createClient('u', 'k') as never)

    await instance.save(snapshot([{ id: 'tsk_ws', dueTime: '   ' }]))
    expect(taskRow().due_time).toBeNull()

    sent.rows = {}
    await instance.save(snapshot([{ id: 'tsk_missing' }]))
    expect(taskRow().due_time).toBeNull()
  })

  it('sends an exact time unchanged', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const instance = new SupabaseAdapter(createClient('u', 'k') as never)
    await instance.save(snapshot([{ dueTime: '14:30' }]))
    expect(taskRow().due_time).toBe('14:30')
  })

  it('sends NULL when an existing task clears its time', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const instance = new SupabaseAdapter(createClient('u', 'k') as never)
    await instance.save(snapshot([{ dueTime: '09:30' }]))
    expect(taskRow().due_time).toBe('09:30')

    // The user clears the field and saves again (UPSERT of the same id).
    await instance.save(snapshot([{ dueTime: '' }]))
    const latest = (sent.rows.tasks ?? []).at(-1) as Row
    expect(latest.id).toBe('tsk_1')
    expect(latest.due_time).toBeNull()
  })

  it('persists a task with no time at all without a server rejection', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const instance = new SupabaseAdapter(createClient('u', 'k') as never)
    // The fake server returns SQLSTATE 22007 for '' — this must not happen.
    await expect(instance.save(snapshot([{ dueTime: '' }]))).resolves.toBeUndefined()
    expect(taskRow()).toMatchObject({ title: 'Read chapter one', due_time: null, user_id: 'user-qa' })
  })

  it('a failed cloud write is surfaced, never reported as synced', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const instance = new SupabaseAdapter(createClient('u', 'k') as never)
    sent.failSave = 'connection reset'
    await expect(instance.save(snapshot([{ dueTime: '' }]))).rejects.toMatchObject({ message: 'connection reset' })
    // Nothing was recorded, so nothing can be mistaken for a synced row.
    expect(sent.rows.tasks ?? []).toHaveLength(0)
  })
})

describe('round trip', () => {
  it('restores the stored task, including a NULL time', async () => {
    // Reads come back as snake_case rows; fromDb maps them to app state.
    const { createClient } = await import('@supabase/supabase-js')
    const row = {
      id: 'tsk_1',
      user_id: 'user-qa',
      title: 'Read chapter one',
      description: '',
      subject_id: null,
      due_date: '2026-11-05',
      due_time: null,
      priority: 'medium',
      category: 'study',
      estimated_minutes: 30,
      completed: false,
      completed_at: null,
      created_at: '2026-11-02T10:00:00.000Z',
      updated_at: '2026-11-02T10:00:00.000Z',
    }

    const instance = new SupabaseAdapter(createClient('u', 'k') as never)
      // Point the read path at this row.
      ; (instance as unknown as { client: Record<string, unknown> }).client = {
        auth: {
          getUser: async () => ({ data: { user: { id: 'user-qa', user_metadata: {} } }, error: null }),
          getSession: async () => ({ data: { session: { user: { id: 'user-qa' } } }, error: null }),
        },
        from: (name: string) => ({
          // `select(columns, { count, head })` — the options argument must not break
          // the chain the adapter builds.
          // `select(...)` -> `eq(...)` -> a result that is BOTH awaitable and
          // provides `maybeSingle()`, exactly as PostgREST's builder does.
          select: (_columns?: string, options?: { head?: boolean; count?: string }) => ({
            eq: () => {
              const result = {
                data: options?.head ? null : (name === 'tasks' ? [row] : []),
                count: options?.count ? 0 : null,
                error: null,
                maybeSingle: async () => ({ data: null, error: null }),
              }
              return Object.assign(Promise.resolve(result), result)
            },
          }),
        }),
        storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null }) }) },
      }

    const loaded = await instance.load()
    const task = (loaded as unknown as { tasks: Row[] }).tasks[0]
    expect(task.id).toBe('tsk_1')
    expect(task.dueTime).toBeNull()
    expect(task.dueDate).toBe('2026-11-05')
    expect(task.title).toBe('Read chapter one')
  })
})
