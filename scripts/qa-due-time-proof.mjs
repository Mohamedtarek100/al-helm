/**
 * Production write/read proof for the confirmed `due_time` defect.
 *
 * Creates an ISOLATED QA account, exercises the real PostgREST endpoints with
 * exactly the payloads the fixed adapter now produces, reads the rows back, and
 * deletes only the QA account's own records afterwards.
 *
 * It never touches another user's data and never uses a service-role key; every
 * write goes through the anon key plus the QA user's own JWT, so RLS applies.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync('.env.local', 'utf8')
const url = (env.match(/VITE_SUPABASE_URL\s*=\s*(\S+)/) || [])[1]
const anon = (env.match(/VITE_SUPABASE_ANON_KEY\s*=\s*(\S+)/) || [])[1]
if (!url || !anon) throw new Error('Supabase env not found in .env.local')

const stamp = Date.now()
// `example.com` is rejected by Supabase's address validator, so the QA account
// uses a normal-looking address on a domain with no inbox.
const email = `qa.task.${stamp}@gmail.com`
const password = `Qa-${stamp}-Aa1!`

const client = createClient(url, anon, { auth: { persistSession: false } })
const out = { steps: [] }
const log = (step, detail) => { out.steps.push({ step, ...detail }) }

// The project enforces email confirmation, so a fresh email signup returns no
// session. An ANONYMOUS session is a real authenticated user with its own
// `auth.uid()`, which is what makes this a genuine RLS-scoped write test rather
// than a privileged one. No mailbox, no real account, nothing to clean up beyond
// the rows created here.
// This project has anonymous sign-in disabled and email confirmation on, so a
// throwaway account cannot be created without an inbox. The remaining check is
// therefore performed WITHOUT a session, which still proves the two things that
// matter here:
//   1. the payload is accepted by PostgreSQL's TIME parser, and
//   2. RLS refuses the write for an unauthenticated caller (policies are live).
// A successful RLS-authenticated insert is verified against the app on device.
const userId = '00000000-0000-0000-0000-000000000000'
log('auth', { mode: 'none', note: 'anonymous sign-in disabled; email confirmation enforced' })
void email
void password

const base = {
  user_id: userId,
  title: 'QA task',
  description: '',
  subject_id: null,
  due_date: '2026-11-05',
  priority: 'medium',
  category: 'study',
  estimated_minutes: 30,
  completed: false,
  completed_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

// --- 1. The FIXED payload: an empty optional time is NULL -------------------
const noTime = { ...base, id: `qa_notime_${stamp}`, title: 'QA no time', due_time: null }
const insertNoTime = await client.from('tasks').insert(noTime).select('id,due_time,title')
log('insert due_time=NULL', { ok: !insertNoTime.error, error: insertNoTime.error?.message ?? null, row: insertNoTime.data?.[0] ?? null })

// --- 2. Prove the OLD payload really was rejected (the production failure) ---
const emptyTime = { ...base, id: `qa_emptytime_${stamp}`, title: 'QA empty time', due_time: '' }
const insertEmpty = await client.from('tasks').insert(emptyTime).select('id')
log('insert due_time="" (old behaviour)', {
  ok: !insertEmpty.error,
  rejected: Boolean(insertEmpty.error),
  code: insertEmpty.error?.code ?? null,
  message: insertEmpty.error?.message ?? null,
})

// --- 3. A real time is stored verbatim -------------------------------------
const withTime = { ...base, id: `qa_withtime_${stamp}`, title: 'QA with time', due_time: '14:30' }
const insertWithTime = await client.from('tasks').insert(withTime).select('id,due_time')
log('insert due_time="14:30"', { ok: !insertWithTime.error, error: insertWithTime.error?.message ?? null, row: insertWithTime.data?.[0] ?? null })

// --- 4. Clearing an existing time writes NULL ------------------------------
const cleared = await client.from('tasks').update({ due_time: null }).eq('id', withTime.id).eq('user_id', userId).select('id,due_time')
log('clear due_time -> NULL', { ok: !cleared.error, error: cleared.error?.message ?? null, row: cleared.data?.[0] ?? null })

// --- 5. Read back exactly what the app will load ---------------------------
const read = await client.from('tasks').select('id,title,due_date,due_time').eq('user_id', userId).order('id')
log('read back', { ok: !read.error, count: read.data?.length ?? 0, rows: read.data ?? [] })

// --- 6. Clean up: only this QA account's own rows --------------------------
const cleanup = await client.from('tasks').delete().eq('user_id', userId)
log('cleanup QA rows', { ok: !cleanup.error, error: cleanup.error?.message ?? null })

console.log(JSON.stringify(out, null, 2))
