import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { generateKeyPairSync } from 'node:crypto'
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
      if (prop === 'maybeSingle') {
        return async () => ({
          ...resolved,
          data: Array.isArray(resolved.data) ? resolved.data[0] ?? null : resolved.data,
        })
      }
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
    from: () => ({ select: () => emptyQuery() }),
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
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args })
      return Promise.resolve({ error: null })
    },
    from: (table: string) => ({
      // The handlers use several different query shapes (count-only selects,
      // ordered limits, filtered lists). A proxy answers all of them from one
      // definition instead of a bespoke chain per endpoint.
      select: () => emptyQuery(
        table === 'announcements' && existingAnnouncement
          ? { data: existingAnnouncement }
          : table === 'announcement_delivery'
            ? { data: announcementDeliveryRows, count: announcementDeliveryRows.length }
          : table === 'push_subscriptions'
            ? { data: pushRows }
            : table === 'fcm_push_tokens'
              ? { data: fcmRows }
            : table === 'announcement_push_deliveries'
              ? { data: retryRows, count: retryRows.length }
            : {},
      ),
      upsert: (row: unknown, options?: unknown) => {
        upsertCalls.push({ table, row, options })
        if (table === 'announcement_delivery' && Array.isArray(row)) {
          for (const candidate of row) {
            const delivery = candidate as { announcement_id: string; user_id: string }
            if (!announcementDeliveryRows.some((existing) =>
              existing.announcement_id === delivery.announcement_id && existing.user_id === delivery.user_id)) {
              announcementDeliveryRows.push(delivery)
            }
          }
        }
        return Promise.resolve({ error: null })
      },
      update: (values: unknown) => {
        updateCalls.push({ table, values })
        if (table === 'announcement_push_deliveries'
          && (values as { status?: string }).status === 'pending'
          && retryRows.length) {
          return emptyQuery({ data: retryRows.shift() })
        }
        return emptyQuery()
      },
      delete: () => {
        deleteCalls.push(table)
        return emptyQuery()
      },
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

  const env: Record<string, string> = {
    ADMIN_EMAILS: ADMIN_EMAIL,
    SUPABASE_URL: 'https://example.supabase.co',
    ...pushEnvironment,
  }

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
    .replace(/import\(["']npm:web-push@3\.6\.7["']\)/g, 'Promise.resolve({ default: globalThis.__webpush })')
    .replace('Deno.serve(', 'globalThis.__serve(')
    .replace(/Deno\.env\.get\(([^)]+)\)/g, 'globalThis.__env[$1]')

  let handler: ((req: Request) => Promise<Response>) | null = null
  const shim = {
    __serve: (fn: (req: Request) => Promise<Response>) => { handler = fn },
    __env: env,
    __webpush: webPushMock,
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
const upsertCalls: unknown[] = []
const rpcCalls: { name: string; args: Record<string, unknown> }[] = []
/**
 * Forces inserts to fail. `only` scopes the failure to one table, so tests can
 * prove that a failing AUDIT write does not break the operation it accompanies
 * (a global failure would fail the announcement insert too and prove nothing).
 */
let insertError: { message: string; code?: string; only?: string } | null = null
let pushEnvironment: Record<string, string> = {}
let existingAnnouncement: Record<string, unknown> | null = null
let pushRows: { id: string; user_id: string; subscription: unknown }[] = []
let fcmRows: { token_hash: string; user_id: string; device_id?: string; token: string }[] = []
let retryRows: { user_id: string; subscription_id: string; attempt_count: number; provider?: string }[] = []
let deleteCalls: string[] = []
let updateCalls: { table: string; values: unknown }[] = []
let announcementDeliveryRows: { announcement_id: string; user_id: string }[] = []
type WebPushMock = {
  setVapidDetails: (...args: string[]) => void
  sendNotification: (subscription: unknown, payload: string, options?: unknown) => Promise<{ statusCode: number }>
}
let webPushMock: WebPushMock = {
  setVapidDetails: () => undefined,
  sendNotification: async () => ({ statusCode: 201 }),
}

async function call(init: RequestInit, path = '/admin/gate'): Promise<HandlerResult> {
  insertCalls.length = 0
  upsertCalls.length = 0
  rpcCalls.length = 0
  const handler = await loadHandler()
  const req = new Request('https://example.supabase.co/functions/v1' + path, init)
  const res = await handler(req)
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: await res.text() }
}

beforeEach(() => {
  // loadHandler builds a fresh sandbox per call; these capture its side effects.
  insertCalls.length = 0
  upsertCalls.length = 0
  rpcCalls.length = 0
  insertError = null
  pushEnvironment = {}
  existingAnnouncement = null
  pushRows = []
  fcmRows = []
  retryRows = []
  deleteCalls = []
  updateCalls = []
  announcementDeliveryRows = []
  webPushMock = {
    setVapidDetails: () => undefined,
    sendNotification: async () => ({ statusCode: 201 }),
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
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

describe('recipient announcement dismissal', () => {
  const VALID_ID = '11111111-2222-4333-8444-555555555555'

  it('allows an authenticated recipient to dismiss only their own delivery', async () => {
    const res = await call({
      method: 'POST',
      headers: OTHER,
      body: JSON.stringify({ action: 'dismiss', announcementIds: [VALID_ID] }),
    }, '/admin/dismiss')

    expect(res.status, res.body).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, dismissed: 0 })
    expect(updateCalls).toContainEqual({
      table: 'announcement_delivery',
      values: expect.objectContaining({ dismissed_at: expect.any(String) }),
    })
    const source = readFileSync('supabase/functions/admin/index.ts', 'utf8')
    const block = source.slice(source.indexOf("action === 'dismiss'"), source.indexOf("action === 'read'"))
    expect(block).toMatch(/\.eq\('user_id', user\.id\)/)
    expect(block).toMatch(/\.in\('announcement_id', ids\)/)
  })

  it('rejects malformed ids and unauthenticated callers', async () => {
    const malformed = await call({
      method: 'POST',
      headers: OTHER,
      body: JSON.stringify({ action: 'dismiss', announcementIds: ['not-a-uuid'] }),
    }, '/admin/dismiss')
    expect(malformed.status).toBe(400)

    const unauthenticated = await call({
      method: 'POST',
      body: JSON.stringify({ action: 'dismiss', announcementIds: [VALID_ID] }),
    }, '/admin/dismiss')
    expect(unauthenticated.status).toBe(403)
  })

  it('excludes dismissed rows from the feed and returns tombstones for other devices', async () => {
    const source = readFileSync('supabase/functions/admin/index.ts', 'utf8')
    const feedStart = source.indexOf("action === 'feed'")
    const feedEnd = source.indexOf("action === 'dismiss'")
    const block = source.slice(feedStart, feedEnd)
    expect(block).toMatch(/\.is\('dismissed_at', null\)/)
    expect(block).toMatch(/dismissedIds/)
    expect(block).toMatch(/dismissed_at\.not\.is\.null/)
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
    'analytics', 'audit', 'audit:log', 'health', 'history', 'send', 'push:retry', 'metrics',
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
      body: JSON.stringify({
        action: 'send',
        title: 'Hello',
        message: 'Body',
        audience: 'all',
        requestId: '11111111-2222-4333-8444-555555555555',
      }),
    }, '/admin/send')
    // Surface the real response when this fails, instead of a bare status diff.
    expect(res.status, `send body: ${res.body}`).toBe(200)
    const payload = JSON.parse(res.body)
    expect(payload.ok).toBe(true)
    expect(payload.push.status).toBe('not_configured')
  })
})

describe('browser push subscription and announcement idempotency', () => {
  const validSubscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-token',
    keys: { p256dh: 'public-key', auth: 'auth-secret' },
  }

  it('only registers a validated subscription for the authenticated account', async () => {
    pushEnvironment = {
      VAPID_PUBLIC_KEY: 'public-key',
      VAPID_PRIVATE_KEY: 'private-key',
      VAPID_SUBJECT: 'https://example.test/',
    }
    const res = await call({
      method: 'POST',
      headers: { Authorization: 'Bearer other-token', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'push:register', subscription: validSubscription }),
    }, '/admin/push:register')
    expect(res.status, res.body).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    expect(upsertCalls).toHaveLength(1)
    const saved = upsertCalls[0] as { table: string; row: Record<string, unknown> }
    expect(saved.table).toBe('push_subscriptions')
    expect(saved.row.user_id).toBe('u-other')
    expect(saved.row.endpoint).toBe(validSubscription.endpoint)
    expect(saved.row.id).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects subscription endpoints outside known HTTPS push providers', async () => {
    pushEnvironment = {
      VAPID_PUBLIC_KEY: 'public-key',
      VAPID_PRIVATE_KEY: 'private-key',
      VAPID_SUBJECT: 'https://example.test/',
    }
    const res = await call({
      method: 'POST',
      headers: { Authorization: 'Bearer other-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'push:register',
        subscription: { ...validSubscription, endpoint: 'https://attacker.example/push' },
      }),
    }, '/admin/push:register')
    expect(res.status).toBe(400)
    expect(upsertCalls).toHaveLength(0)
  })

  it('refuses browser subscription registration until server VAPID secrets are configured', async () => {
    const res = await call({
      method: 'POST',
      headers: { Authorization: 'Bearer other-token', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'push:register', subscription: validSubscription }),
    }, '/admin/push:register')
    expect(res.status).toBe(503)
    expect(upsertCalls).toHaveLength(0)
  })

  it('repairs a partial announcement fan-out when a send request is retried', async () => {
    existingAnnouncement = {
      id: 'existing-announcement',
      audience: 'all',
      push_status: 'sent',
      push_attempted: 2,
      push_accepted: 1,
      push_failed: 1,
      push_expired: 0,
    }
    const res = await call({
      method: 'POST',
      headers: OWNER,
      body: JSON.stringify({
        action: 'send',
        title: 'Hello',
        message: 'Body',
        audience: 'all',
        requestId: '11111111-2222-4333-8444-555555555555',
      }),
    }, '/admin/send')
    expect(res.status, res.body).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({
      duplicate: true,
      announcementId: 'existing-announcement',
      recipientCount: 1,
      push: { status: 'already_processed', originalStatus: 'sent', attempted: 2, accepted: 1, failed: 1 },
    })
    expect(insertCalls).toHaveLength(0)
    expect(announcementDeliveryRows).toEqual([
      { announcement_id: 'existing-announcement', user_id: 'u-owner' },
    ])
    expect(upsertCalls).toContainEqual({
      table: 'announcement_delivery',
      row: [{ announcement_id: 'existing-announcement', user_id: 'u-owner' }],
      options: { onConflict: 'announcement_id,user_id', ignoreDuplicates: true },
    })
  })

  it('records provider acceptance without claiming the device displayed the push', async () => {
    pushEnvironment = {
      VAPID_PUBLIC_KEY: 'public-key',
      VAPID_PRIVATE_KEY: 'private-key',
      VAPID_SUBJECT: 'https://example.test/',
    }
    pushRows = [{
      id: 'subscription-1',
      user_id: 'u-owner',
      subscription: validSubscription,
    }]
    const vapidCalls: string[][] = []
    const sendCalls: { payload: string; options: unknown }[] = []
    webPushMock = {
      setVapidDetails: (...args) => { vapidCalls.push(args) },
      sendNotification: async (_subscription, payload, options) => {
        sendCalls.push({ payload, options })
        return { statusCode: 201 }
      },
    }

    const res = await call({
      method: 'POST',
      headers: OWNER,
      body: JSON.stringify({
        action: 'send',
        title: 'Hello',
        message: 'Body',
        audience: 'all',
        requestId: '11111111-2222-4333-8444-555555555555',
      }),
    }, '/admin/send')

    expect(res.status, res.body).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({
      ok: true,
      push: { status: 'sent', attempted: 1, accepted: 1, failed: 0, expired: 0 },
    })
    expect(vapidCalls).toEqual([['https://example.test/', 'public-key', 'private-key']])
    expect(sendCalls).toHaveLength(1)
    expect(JSON.parse(sendCalls[0].payload)).toMatchObject({
      title: 'Hello',
      body: 'Body',
      url: '#/notifications?announcementId=a',
      announcementId: 'a',
    })
    expect(JSON.parse(res.body).push).not.toHaveProperty('delivered')
  })

  it('does not claim there are no registrations when one configured provider is missing', async () => {
    pushEnvironment = {
      VAPID_PUBLIC_KEY: 'public-key',
      VAPID_PRIVATE_KEY: 'private-key',
      VAPID_SUBJECT: 'https://example.test/',
    }
    fcmRows = [{ token_hash: 'b'.repeat(64), user_id: 'u-owner', token: 'long-test-fcm-token-123456789' }]

    const res = await call({
      method: 'POST',
      headers: OWNER,
      body: JSON.stringify({
        action: 'send',
        title: 'Hello',
        message: 'Body',
        audience: 'opted_in',
        requestId: '11111111-2222-4333-8444-555555555555',
      }),
    }, '/admin/send')

    expect(res.status, res.body).toBe(200)
    expect(JSON.parse(res.body).push).toMatchObject({ status: 'not_configured', attempted: 0 })
  })

  it('removes expired endpoints after recording the provider response', async () => {
    pushEnvironment = {
      VAPID_PUBLIC_KEY: 'public-key',
      VAPID_PRIVATE_KEY: 'private-key',
      VAPID_SUBJECT: 'https://example.test/',
    }
    pushRows = [{ id: 'subscription-1', user_id: 'u-owner', subscription: validSubscription }]
    webPushMock = {
      setVapidDetails: () => undefined,
      sendNotification: async () => {
        throw Object.assign(new Error('expired endpoint'), { statusCode: 410 })
      },
    }

    const res = await call({
      method: 'POST',
      headers: OWNER,
      body: JSON.stringify({
        action: 'send',
        title: 'Hello',
        message: 'Body',
        audience: 'all',
        requestId: '11111111-2222-4333-8444-555555555555',
      }),
    }, '/admin/send')

    expect(res.status, res.body).toBe(200)
    expect(JSON.parse(res.body).push).toMatchObject({
      status: 'failed',
      attempted: 1,
      accepted: 0,
      expired: 1,
    })
    expect(deleteCalls).toContain('push_subscriptions')
  })

  it('claims and retries a failed subscription without resending accepted rows', async () => {
    pushEnvironment = {
      VAPID_PUBLIC_KEY: 'public-key',
      VAPID_PRIVATE_KEY: 'private-key',
      VAPID_SUBJECT: 'https://example.test/',
    }
    existingAnnouncement = {
      id: 'existing-announcement',
      title: 'Hello',
      body: 'Body',
      revoked_at: null,
      push_attempted: 2,
      push_accepted: 1,
      push_failed: 1,
      push_expired: 0,
    }
    retryRows = [{ user_id: 'u-owner', subscription_id: 'subscription-1', attempt_count: 1, provider: 'webpush' }]
    pushRows = [{ id: 'subscription-1', user_id: 'u-owner', subscription: validSubscription }]
    let sendCount = 0
    webPushMock = {
      setVapidDetails: () => undefined,
      sendNotification: async () => {
        sendCount += 1
        return { statusCode: 201 }
      },
    }

    const res = await call({
      method: 'POST',
      headers: OWNER,
      body: JSON.stringify({ action: 'push:retry', announcementId: '11111111-2222-4333-8444-555555555555' }),
    }, '/admin/push:retry')

    expect(res.status, res.body).toBe(200)
    expect(JSON.parse(res.body).push).toMatchObject({
      status: 'sent',
      attempted: 1,
      accepted: 1,
      failed: 0,
      remaining: 0,
    })
    expect(sendCount).toBe(1)
    expect(updateCalls.some((call) => (
      call.table === 'announcement_push_deliveries'
      && (call.values as { status?: string }).status === 'pending'
    ))).toBe(true)
    expect(rpcCalls).toContainEqual({
      name: 'record_announcement_push_summary',
      args: {
        p_announcement_id: '11111111-2222-4333-8444-555555555555',
        p_status: 'sent',
        p_attempted: 1,
        p_accepted: 1,
        p_failed: 0,
        p_expired: 0,
        p_resolved_failed: 1,
      },
    })
  })

  it('never retries a recalled announcement', async () => {
    pushEnvironment = {
      VAPID_PUBLIC_KEY: 'public-key',
      VAPID_PRIVATE_KEY: 'private-key',
      VAPID_SUBJECT: 'https://example.test/',
    }
    existingAnnouncement = {
      id: 'existing-announcement',
      title: 'Hello',
      body: 'Body',
      revoked_at: '2026-01-01T00:00:00Z',
      push_attempted: 1,
      push_accepted: 0,
      push_failed: 1,
      push_expired: 0,
    }
    retryRows = [{ user_id: 'u-owner', subscription_id: 'subscription-1', attempt_count: 1 }]

    const res = await call({
      method: 'POST',
      headers: OWNER,
      body: JSON.stringify({ action: 'push:retry', announcementId: '11111111-2222-4333-8444-555555555555' }),
    }, '/admin/push:retry')

    expect(JSON.parse(res.body).push.status).toBe('recalled')
    expect(updateCalls).toHaveLength(0)
  })
})

describe('authenticated Android FCM registration', () => {
  const serviceAccount = JSON.stringify({
    project_id: 'ulife-e4b04',
    client_email: 'push-sender@ulife-e4b04.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\\nZmFrZQ==\\n-----END PRIVATE KEY-----',
  })

  it('stores a validated FCM token only against the verified user and reports server setup', async () => {
    pushEnvironment = { FCM_SERVICE_ACCOUNT_JSON: serviceAccount }
    const res = await call({
      method: 'POST',
      headers: { Authorization: 'Bearer other-token', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'fcm:register', token: 'long-valid-test-fcm-token-123456789', deviceId: 'device-01' }),
    }, '/admin/fcm:register')

    expect(res.status, res.body).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true, configured: true })
    const saved = upsertCalls.find((entry) => (entry as { table: string }).table === 'fcm_push_tokens') as { row: Record<string, unknown> }
    expect(saved.row.user_id).toBe('u-other')
    expect(saved.row.device_id).toBe('device-01')
    expect(saved.row.token).toBe('long-valid-test-fcm-token-123456789')
    expect(saved.row.token_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects malformed registration data without storing a token', async () => {
    const res = await call({
      method: 'POST',
      headers: { Authorization: 'Bearer other-token', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'fcm:register', token: 'short', deviceId: 'device-01' }),
    }, '/admin/fcm:register')

    expect(res.status).toBe(400)
    expect(upsertCalls).toHaveLength(0)
  })

  it('reports the authenticated account device status without exposing its token', async () => {
    pushEnvironment = { FCM_SERVICE_ACCOUNT_JSON: serviceAccount }
    fcmRows = [{
      token_hash: 'a'.repeat(64),
      user_id: 'u-other',
      device_id: 'device-01',
      token: 'secret-device-token',
    }]
    const res = await call({
      method: 'POST',
      headers: { Authorization: 'Bearer other-token', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'fcm:status', deviceId: 'device-01' }),
    }, '/admin/fcm:status')

    expect(res.status, res.body).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ configured: true, registered: true })
    expect(res.body).not.toContain('secret-device-token')
  })

  it('deletes the authenticated user device registration', async () => {
    const res = await call({
      method: 'POST',
      headers: { Authorization: 'Bearer other-token', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'fcm:delete', deviceId: 'device-01' }),
    }, '/admin/fcm:delete')

    expect(res.status, res.body).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    expect(deleteCalls).toContain('fcm_push_tokens')
  })

  it('sends an announcement through FCM and records provider acceptance without exposing the token', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    pushEnvironment = {
      FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({
        project_id: 'ulife-e4b04',
        client_email: 'push-sender@ulife-e4b04.iam.gserviceaccount.com',
        private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      }),
    }
    const fcmToken = 'long-test-fcm-token-never-returned-to-the-client'
    fcmRows = [{ token_hash: 'b'.repeat(64), user_id: 'u-owner', token: fcmToken }]
    const requests: { url: string; body: string }[] = []
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? String(init.body) : ''
      requests.push({ url, body })
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'test-access-token', expires_in: 3600 }), { status: 200 })
      }
      return new Response(JSON.stringify({ name: 'projects/ulife-e4b04/messages/message-1' }), { status: 200 })
    })

    const res = await call({
      method: 'POST',
      headers: OWNER,
      body: JSON.stringify({
        action: 'send',
        title: 'Hello',
        message: 'Body',
        audience: 'opted_in',
        requestId: '11111111-2222-4333-8444-555555555555',
      }),
    }, '/admin/send')

    expect(res.status, res.body).toBe(200)
    expect(JSON.parse(res.body).push).toMatchObject({ status: 'sent', attempted: 1, accepted: 1, failed: 0 })
    expect(requests.map((request) => request.url)).toEqual([
      'https://oauth2.googleapis.com/token',
      'https://fcm.googleapis.com/v1/projects/ulife-e4b04/messages:send',
    ])
    expect(JSON.parse(requests[1].body)).toMatchObject({
      message: { token: fcmToken, data: { announcementId: 'a' } },
    })
    expect(res.body).not.toContain(fcmToken)
    expect(rpcCalls.some((call) => call.name === 'record_announcement_push_summary')).toBe(true)
  })

  it('retries only the failed FCM registration and records the resolved failure', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    pushEnvironment = {
      FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({
        project_id: 'ulife-e4b04',
        client_email: 'push-sender@ulife-e4b04.iam.gserviceaccount.com',
        private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      }),
    }
    const tokenHash = 'c'.repeat(64)
    fcmRows = [{ token_hash: tokenHash, user_id: 'u-owner', token: 'long-test-fcm-token-for-retry-123456' }]
    retryRows = [{ user_id: 'u-owner', subscription_id: tokenHash, attempt_count: 1, provider: 'fcm' }]
    existingAnnouncement = {
      id: 'existing-announcement',
      title: 'Hello',
      body: 'Body',
      revoked_at: null,
    }
    vi.stubGlobal('fetch', async (input: string | URL | Request) => (
      String(input) === 'https://oauth2.googleapis.com/token'
        ? new Response(JSON.stringify({ access_token: 'test-access-token', expires_in: 3600 }), { status: 200 })
        : new Response(JSON.stringify({ name: 'projects/ulife-e4b04/messages/message-2' }), { status: 200 })
    ))

    const res = await call({
      method: 'POST',
      headers: OWNER,
      body: JSON.stringify({ action: 'push:retry', announcementId: '11111111-2222-4333-8444-555555555555' }),
    }, '/admin/push:retry')

    expect(res.status, res.body).toBe(200)
    expect(JSON.parse(res.body).push).toMatchObject({
      status: 'sent',
      attempted: 1,
      accepted: 1,
      failed: 0,
      remaining: 0,
    })
    expect(rpcCalls).toContainEqual({
      name: 'record_announcement_push_summary',
      args: {
        p_announcement_id: '11111111-2222-4333-8444-555555555555',
        p_status: 'sent',
        p_attempted: 1,
        p_accepted: 1,
        p_failed: 0,
        p_expired: 0,
        p_resolved_failed: 1,
      },
    })
  })
})
