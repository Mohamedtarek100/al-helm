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
    from: () => ({
      select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
      upsert: async () => ({ error: null }),
      insert: async () => ({ data: { id: 'a' }, error: null }),
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

async function call(init: RequestInit, path = '/admin/gate'): Promise<HandlerResult> {
  const handler = await loadHandler()
  const req = new Request('https://example.supabase.co/functions/v1' + path, init)
  const res = await handler(req)
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: await res.text() }
}

beforeEach(() => {
  // Nothing to reset: loadHandler builds a fresh sandbox per call.
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
