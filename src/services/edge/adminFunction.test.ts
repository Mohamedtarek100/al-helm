import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
// Vite 8 ships `transformWithOxc`, which strips TypeScript without needing
// esbuild installed separately (esbuild's deprecated path fails here).
import { transformWithOxc } from 'vite'

/**
 * CORS contract of the `admin` Edge Function.
 *
 * Shipped bug: the handler checked `Authorization: Bearer` BEFORE looking at the
 * method. Browsers never send that header on an OPTIONS preflight, so every
 * preflight got 403 and the real POST was never issued — the admin tools simply
 * never appeared after sign-in, and production logs showed 100% 4XX.
 *
 * The Deno function cannot be imported into vitest (it calls Deno.serve at
 * module scope), so the REAL handler source is executed here with a minimal
 * Deno shim. This runs the actual code — not a re-implementation — including
 * the real auth guard, so a regression in either CORS or auth fails the test.
 */

const SOURCE = readFileSync('supabase/functions/admin/index.ts', 'utf8')

interface HandlerResult {
  status: number
  headers: Record<string, string>
  body: string
}

const ADMIN_EMAIL = 'mm642898t@gmail.com'

/**
 * Evaluates the module and returns its request handler.
 * Only `Deno.serve`, `Deno.env` and the supabase-js import are stubbed.
 */
/** A thenable query that answers every chained call the handlers use. */
function emptyQuery(result: { data?: unknown; error?: unknown; count?: number } = {}) {
  // Defaults come from the shared shape, then the caller overrides them; that
  // order avoids declaring `data`/`error` twice in one object literal.
  const base = { data: [] as unknown, count: 0, error: null as unknown }
  const resolved = { ...base, ...result }
  const chain: Record<string, unknown> = {}
  const proxy: unknown = new Proxy(chain, {
    get: (_target, prop: string) => {
      if (prop === 'then') return (resolve: (value: unknown) => void) => resolve(resolved)
      // Any PostgREST builder method returns the same queryable chain.
      return () => proxy
    },
  })
  return proxy
}

async function loadHandler(): Promise<(req: Request) => Promise<Response>> {
  const userClient = (authHeader: string) => ({
    auth: {
      getUser: async () => {
        // Mirrors the real verification: a bearer token identifies a user,
        // anything else is rejected before authorization is consulted.
        if (!authHeader.startsWith('Bearer ')) return { data: { user: null }, error: { message: 'no token' } }
        const token = authHeader.slice('Bearer '.length)
        if (token === 'owner-token') return { data: { user: { id: 'u-owner', email: ADMIN_EMAIL } }, error: null }
        if (token === 'other-token') return { data: { user: { id: 'u-other', email: 'someone@example.com' } }, error: null }
        return { data: { user: null }, error: { message: 'invalid token' } }
      },
    },
    from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }),
  })

  const adminClient = () => ({
    auth: {
      admin: {
        listUsers: async () => ({
          data: { users: [{ id: 'u-owner', email: ADMIN_EMAIL, created_at: '2026-01-01T00:00:00Z', last_sign_in_at: null, user_metadata: {} }] },
          error: null,
        }),
      },
    },
    from: (table: string) => ({
      // The handlers use several different query shapes (count-only selects,
      // ordered limits, filtered lists). A proxy answers all of them from one
      // definition instead of a bespoke chain per endpoint.
      select: () => emptyQuery(),
      upsert: async () => ({ error: null }),
      insert: (row: unknown) => {
        // Recorded so tests can assert what the handler actually persists.
        insertCalls.push(row)
        // `insert` is awaited directly by most handlers and chained by `send`
        // (`.insert(...).select().single()`). A thenable proxy satisfies BOTH:
        // awaiting it yields the result, chaining it still builds a query.
        // `only` scopes a failure to one table so a failing AUDIT write can be
        // tested without also failing the announcement insert.
        const failure = insertError && (!insertError.only || insertError.only === table) ? insertError : null
        return emptyQuery({ data: { id: 'a' }, error: failure })
      },
    }),
  })

  const env: Record<string, string> = { ADMIN_EMAILS: ADMIN_EMAIL, SUPABASE_URL: 'https://example.supabase.co' }

  // The function is TypeScript, so strip types for real (regex stripping broke
  // on interface declarations). esbuild ships with Vite, so no new dependency.
  // Replace the import with a local binding BEFORE transforming, so the
  // transformer never sees a module statement it must preserve.
  const sourced = SOURCE.replace(
    /^\s*import\s*\{([^}]*)\}\s*from\s*['"][^'"]*['"];?[^\n]*/m,
    (_match, names: string) => {
      const bindings = names
        .split(',')
        .map((n) => n.trim())
        // Drop `type`-only imports: they have no runtime value to bind.
        .filter((n) => n && !n.startsWith('type '))
        .join(', ')
      return `const { ${bindings} } = globalThis.__supabase;`
    },
  )

  const js = (await transformWithOxc(sourced, 'admin.ts')).code
  const code = js
    .replace(/^[^\n]*require\([^\n]*\n/gm, '')
    .replace(/^exports\.[^\n]*\n/gm, '')
    .replace('Deno.serve(', 'globalThis.__serve(')
    .replace(/Deno\.env\.get\(([^)]+)\)/g, 'globalThis.__env[$1]')

  let handler: ((req: Request) => Promise<Response>) | null = null
  const shim = {
    __serve: (fn: (req: Request) => Promise<Response>) => { handler = fn },
    __env: env,
    __supabase: {
      createClient: (_url: string, _key: string, opts?: { global?: { headers?: Record<string, string> } }) =>
        opts?.global?.headers ? userClient(opts.global.headers.Authorization ?? '') : adminClient(),
    },
  }

  // eslint-disable-next-line no-new-func
  new Function('globalThis', code)(shim)
  if (!handler) throw new Error('handler was not registered')
  return handler
}

/** Rows the handler inserted during the CURRENT request (reset per call). */
const insertCalls: unknown[] = []
/**
 * Forces inserts to fail. `only` scopes the failure to one table, so tests can
 * prove that a failing AUDIT write does not break the operation it accompanies
 * (a global failure would fail the announcement insert too and prove nothing).
 */
let insertError: { message: string; code?: string; only?: string } | null = null

async function call(init: RequestInit, path = '/admin/gate'): Promise<HandlerResult> {
  insertCalls.length = 0
  const handler = await loadHandler()
  const req = new Request('https://example.supabase.co/functions/v1' + path, init)
  const res = await handler(req)
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: await res.text() }
}

beforeEach(() => {
  // loadHandler builds a fresh sandbox per call; these capture its side effects.
  insertCalls.length = 0
  insertError = null
})

describe('CORS preflight', () => {
  it('OPTIONS without Authorization succeeds instead of 403', async () => {
    const res = await call({ method: 'OPTIONS' })
    expect([200, 204]).toContain(res.status)
  })

  it('OPTIONS echoes an allow-origin header', async () => {
    const res = await call({ method: 'OPTIONS' })
    expect(res.headers['access-control-allow-origin']).toBeTruthy()
  })

  it('OPTIONS allows the headers the client actually sends', async () => {
    const res = await call({ method: 'OPTIONS' })
    const allowed = (res.headers['access-control-allow-headers'] ?? '').toLowerCase()
    for (const header of ['authorization', 'apikey', 'x-client-info', 'content-type']) {
      expect(allowed, `missing ${header}`).toContain(header)
    }
  })

  it('preflight works for the heartbeat route too', async () => {
    const res = await call({ method: 'OPTIONS' }, '/admin/heartbeat')
    expect([200, 204]).toContain(res.status)
  })
})

describe('authentication is unchanged', () => {
  it('POST without a bearer token is still 403, and carries CORS', async () => {
    const res = await call({ method: 'POST', body: JSON.stringify({ action: 'gate' }) })
    expect(res.status).toBe(403)
    expect(res.headers['access-control-allow-origin']).toBeTruthy()
    expect(JSON.parse(res.body).error).toMatch(/bearer/i)
  })

  it('POST with an invalid token is 403 with CORS', async () => {
    const res = await call({
      method: 'POST',
      headers: { Authorization: 'Bearer bogus', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'gate' }),
    })
    expect(res.status).toBe(403)
    expect(res.headers['access-control-allow-origin']).toBeTruthy()
  })

  it('the owner account is authorized by the server allowlist', async () => {
    const res = await call({
      method: 'POST',
      headers: { Authorization: 'Bearer owner-token', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'gate' }),
    })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ isAdmin: true, email: ADMIN_EMAIL })
    expect(res.headers['access-control-allow-origin']).toBeTruthy()
  })

  it('a non-owner is denied, with CORS, and sees no admin data', async () => {
    const res = await call({
      method: 'POST',
      headers: { Authorization: 'Bearer other-token', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'gate' }),
    })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ isAdmin: false })
    expect(res.headers['access-control-allow-origin']).toBeTruthy()
  })

  it('privileged actions are still rejected for a non-owner', async () => {
    const res = await call({
      method: 'POST',
      headers: { Authorization: 'Bearer other-token', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'metrics' }),
    })
    expect(res.status).toBe(403)
    expect(JSON.parse(res.body).error).toMatch(/not an authorized admin/i)
    expect(res.headers['access-control-allow-origin']).toBeTruthy()
  })
})

describe('announcement recall', () => {
  /**
   * Recall is owner-only and server-authoritative: it stamps `revoked_at` on
   * the delivery rows for ONE announcement. These tests prove it refuses
   * anything else and never touches a different announcement.
   */
  const VALID_ID = '11111111-2222-3333-4444-555555555555'

  it('rejects a non-owner', async () => {
    const res = await call({
      method: 'POST',
      headers: OTHER,
      body: JSON.stringify({ action: 'recall', announcementId: VALID_ID }),
    }, '/admin/recall')
    expect(res.status).toBe(403)
    expect(JSON.parse(res.body).error).toMatch(/not an authorized admin/i)
  })

  it('rejects an unauthenticated request', async () => {
    const res = await call({ method: 'POST', body: JSON.stringify({ action: 'recall', announcementId: VALID_ID }) })
    expect(res.status).toBe(403)
  })

  it('rejects a malformed or missing announcement id', async () => {
    for (const announcementId of ['', 'not-a-uuid', '123', "' or 1=1--"]) {
      const res = await call({
        method: 'POST',
        headers: OWNER,
        body: JSON.stringify({ action: 'recall', announcementId }),
      }, '/admin/recall')
      expect(res.status, announcementId).toBe(400)
    }
  })

  it('is routed below the authorization gate', async () => {
    // A handler placed above the gate would run for a non-owner; the 403 above
    // proves it does not.
    const source = readFileSync('supabase/functions/admin/index.ts', 'utf8')
    const gate = source.indexOf('if (!email || !admins.includes(email)) return deny')
    const recall = source.indexOf("action === 'recall'")
    expect(gate).toBeGreaterThan(-1)
    expect(recall).toBeGreaterThan(gate)
  })

  it('scopes the delivery update to one announcement', async () => {
    // Deleting every notification would be catastrophic; the update must be
    // filtered by announcement_id.
    const source = readFileSync('supabase/functions/admin/index.ts', 'utf8')
    const recallBlock = source.slice(source.indexOf("action === 'recall'"), source.indexOf("action === 'analytics'"))
    expect(recallBlock).toMatch(/\.eq\('announcement_id', announcementId\)/)
    // It must never issue an unconditional delete.
    expect(recallBlock).not.toMatch(/\.delete\(\)/)
  })

  it('hides recalled rows from the recipient feed', async () => {
    // The feed filter is what actually makes a recall visible to users, so it
    // is asserted rather than assumed.
    const source = readFileSync('supabase/functions/admin/index.ts', 'utf8')
    const feedStart = source.indexOf("action === 'feed'")
    const feedEnd = source.indexOf("action === 'read'")
    expect(source.slice(feedStart, feedEnd)).toMatch(/\.is\('revoked_at', null\)/)
  })
})

describe('Phase 2–4 endpoints enforce the same gate', () => {
  /**
   * Every endpoint added for the newer console screens is exercised against the
   * REAL handler, with a valid non-owner token. All of them must answer 403 and
   * must not leak a payload — this is the check that catches a new handler being
   * added above the allowlist check.
   */
  const PRIVILEGED_ACTIONS = [
    'overview', 'users', 'user', 'directory', 'export', 'recipients',
    'analytics', 'audit', 'audit:log', 'health', 'history', 'send', 'metrics',
  ]

  for (const action of PRIVILEGED_ACTIONS) {
    it(`denies a non-owner calling ${action}`, async () => {
      const res = await call({
        method: 'POST',
        headers: { Authorization: 'Bearer other-token', 'content-type': 'application/json' },
        body: JSON.stringify({ action, userId: 'u-owner' }),
      })
      expect(res.status).toBe(403)
      const payload = JSON.parse(res.body) as Record<string, unknown>
      expect(payload.error).toMatch(/not an authorized admin/i)
      // Nothing that looks like data may accompany the denial.
      for (const key of ['users', 'entries', 'checks', 'history', 'rows', 'registrations', 'recentUsers']) {
        expect(payload).not.toHaveProperty(key)
      }
      expect(res.headers['access-control-allow-origin']).toBeTruthy()
    })
  }

  it('an unauthenticated request cannot reach any of them either', async () => {
    for (const action of PRIVILEGED_ACTIONS) {
      const res = await call({ method: 'POST', body: JSON.stringify({ action }) })
      expect(res.status, action).toBe(403)
      expect(JSON.parse(res.body).error).toMatch(/bearer/i)
    }
  })

  it('a successful preflight does not authorize the request that follows it', async () => {
    // The bug this pins: answering OPTIONS 200 must not be mistaken for an
    // authorization step, and the real POST still needs a verified owner.
    const preflight = await call({ method: 'OPTIONS' })
    expect([200, 204]).toContain(preflight.status)

    const real = await call({
      method: 'POST',
      headers: { Authorization: 'Bearer other-token', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'overview' }),
    })
    expect(real.status).toBe(403)
  })

  it('an unknown action is rejected rather than silently accepted', async () => {
    const res = await call({
      method: 'POST',
      headers: { Authorization: 'Bearer owner-token', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'drop_everything' }),
    })
    expect(res.status).toBe(400)
    expect(JSON.parse(res.body).error).toMatch(/unknown action/i)
  })

  it('the audit:log endpoint refuses action names outside its whitelist', async () => {
    const res = await call({
      method: 'POST',
      headers: { Authorization: 'Bearer owner-token', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'audit:log', actionName: 'arbitrary_text' }),
    })
    expect(res.status).toBe(400)
    expect(JSON.parse(res.body).error).toMatch(/unknown audit action/i)
  })
})

/* ------------------------------------------------------------------ */
/* Audit endpoint — behaviour, not source strings                      */
/* ------------------------------------------------------------------ */

/**
 * These execute the REAL handler and inspect the rows it actually tried to
 * insert. That is the only way to prove the detail object is constructed
 * server-side rather than forwarded: a source-string assertion would still
 * pass if the forwarded object were stored under a different name.
 */

const OWNER = { Authorization: 'Bearer owner-token', 'content-type': 'application/json' }
const OTHER = { Authorization: 'Bearer other-token', 'content-type': 'application/json' }

/** The single audit row the handler attempted to persist. */
function auditRows(): Record<string, unknown>[] {
  return insertCalls.filter(
    (row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && (row as Record<string, unknown>).action !== undefined && !('title' in (row as object) && 'body' in (row as object)),
  )
}

async function auditLog(body: Record<string, unknown>, headers: Record<string, string> = OWNER): Promise<HandlerResult> {
  return call({ method: 'POST', headers, body: JSON.stringify({ action: 'audit:log', ...body }) }, '/admin/audit:log')
}

describe('audit endpoint authorization', () => {
  it('lets the owner append an allowed action', async () => {
    const res = await auditLog({ actionName: 'app_open', detail: { viewport: 1280 } })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    const rows = auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('app_open')
  })

  it('rejects a non-owner and inserts nothing', async () => {
    const res = await auditLog({ actionName: 'app_open' }, OTHER)
    expect(res.status).toBe(403)
    expect(JSON.parse(res.body).error).toMatch(/not an authorized admin/i)
    expect(auditRows()).toHaveLength(0)
  })

  it('rejects an unauthenticated request and inserts nothing', async () => {
    const res = await call({ method: 'POST', body: JSON.stringify({ action: 'audit:log', actionName: 'app_open' }) })
    expect(res.status).toBe(403)
    expect(auditRows()).toHaveLength(0)
  })

  it('rejects an action outside the whitelist', async () => {
    for (const actionName of ['delete_everything', 'announcement_send_but_wrong', '', 'APP_OPEN']) {
      const res = await auditLog({ actionName })
      expect(res.status, actionName).toBe(400)
      expect(JSON.parse(res.body).error).toMatch(/unknown audit action/i)
    }
    expect(auditRows()).toHaveLength(0)
  })

  it('derives the actor from the verified JWT, never from the request body', async () => {
    // A caller claiming to be someone else must not change attribution.
    const res = await auditLog({
      actionName: 'app_open',
      actor_id: 'attacker-controlled-id',
      actor_email: 'attacker@example.com',
      user: { id: 'spoofed' },
    })
    expect(res.status).toBe(200)
    const row = auditRows()[0]
    expect(row.actor_id).toBe('u-owner')
    expect(row.actor_email).toBe(ADMIN_EMAIL)
  })
})

describe('audit detail is constructed server-side', () => {
  it('never persists an arbitrary client object', async () => {
    await auditLog({
      actionName: 'app_open',
      detail: { nested: { a: 1 }, list: [1, 2, 3], anything: 'arbitrary' },
    })
    const detail = auditRows()[0].detail as Record<string, unknown> | null
    // Nothing declared by `app_open` was supplied, so no detail is stored.
    expect(detail).toBeNull()
  })

  it('keeps only the fields the action declares', async () => {
    await auditLog({
      actionName: 'user_export',
      detail: { exported: 42, total: 100, password: 'hunter2', token: 'eyJhbGci', columns: ['email'] },
    })
    const detail = auditRows()[0].detail as Record<string, unknown>
    expect(detail).toEqual({ exported: 42, total: 100, columns: ['email'] })
    // Sensitive-looking keys cannot survive: they are not part of the shape.
    expect(JSON.stringify(detail)).not.toMatch(/hunter2|eyJhbGci/)
  })

  it('drops values that are present but invalid', async () => {
    await auditLog({
      actionName: 'user_export',
      detail: { exported: -1, total: 'N/A', columns: ['not valid!', 'EMAIL'] },
    })
    const detail = auditRows()[0].detail
    expect(detail).toBeNull()
  })

  it('bounds numeric values', async () => {
    await auditLog({ actionName: 'recipients_preview', detail: { audience: 'all', count: 1e12 } })
    const detail = auditRows()[0].detail as Record<string, unknown>
    expect(detail).toEqual({ audience: 'all' })
  })

  it('rejects oversized strings instead of storing them truncated', async () => {
    // A 10k-character target must not be persisted at all.
    await auditLog({ actionName: 'app_open', target: 'x'.repeat(10_000) })
    expect(auditRows()[0].target).toBeNull()

    // The same applies to a settings key.
    await auditLog({ actionName: 'settings_update', detail: { key: 'k'.repeat(500) } })
    expect(auditRows()[0].detail).toBeNull()
  })

  it('refuses control characters in a target', async () => {
    await auditLog({ actionName: 'app_open', target: 'ok\u0000bad\nline' })
    expect(auditRows()[0].target).toBeNull()
  })

  it('stores an allowed target and its validated detail', async () => {
    await auditLog({ actionName: 'settings_update', target: 'pageSize', detail: { key: 'pageSize', value: 50 } })
    const row = auditRows()[0]
    expect(row.target).toBe('pageSize')
    expect(row.detail).toEqual({ key: 'pageSize', value: 50 })
  })
})

describe('audit write failures stay best-effort', () => {
  it('reports a safe message without leaking the database error', async () => {
    insertError = { message: 'relation "public.admin_audit_log" does not exist', code: '42P01' }
    const res = await auditLog({ actionName: 'app_open' })
    expect(res.status).toBe(500)
    expect(JSON.parse(res.body).error).toMatch(/pending migrations/i)
    // The raw PostgREST text must not reach the client.
    expect(res.body).not.toContain('relation "public.admin_audit_log"')
  })

  it('a failing audit insert does not fail an announcement send', async () => {
    // The announcement insert succeeds, the audit insert fails: the owner must
    // still be told the send worked, or they will retry and send it twice.
    insertError = { message: 'permission denied for table admin_audit_log', only: 'admin_audit_log' }
    const res = await call({
      method: 'POST',
      headers: OWNER,
      body: JSON.stringify({ action: 'send', title: 'Hello', message: 'Body', audience: 'all' }),
    }, '/admin/send')
    // Surface the real response when this fails, instead of a bare status diff.
    expect(res.status, `send body: ${res.body}`).toBe(200)
    const payload = JSON.parse(res.body)
    expect(payload.ok).toBe(true)
  })
})
