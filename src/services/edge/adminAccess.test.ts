import { describe, expect, it } from 'vitest'
import { normalizeAdminEmail } from './adminGate'

/**
 * Admin access normalisation.
 *
 * The server is authoritative (ADMIN_EMAILS in the Edge Function). These tests
 * pin the normalisation BOTH sides now apply, which is what previously made an
 * authorised owner appear unauthorised:
 *
 *   - Google returns the email with mixed case.
 *   - ADMIN_EMAILS pasted into the dashboard can carry a trailing space.
 *
 * The server code is also asserted statically, because it cannot be executed
 * here without a Deno runtime.
 */

const serverSource = await import('node:fs').then((fs) =>
  fs.readFileSync('supabase/functions/admin/index.ts', 'utf8'),
)

describe('client normalisation', () => {
  it('lower-cases and trims', () => {
    expect(normalizeAdminEmail('  MM642898T@Gmail.COM  ')).toBe('mm642898t@gmail.com')
  })

  it('makes mixed-case variants compare equal to the configured owner', () => {
    const owner = normalizeAdminEmail('mm642898t@gmail.com')
    expect(normalizeAdminEmail('MM642898T@GMAIL.COM')).toBe(owner)
    expect(normalizeAdminEmail(' Mm642898t@Gmail.com ')).toBe(owner)
  })

  it('handles a missing email without throwing', () => {
    expect(normalizeAdminEmail(null)).toBe('')
    expect(normalizeAdminEmail(undefined)).toBe('')
  })

  it('does not confuse a look-alike address with the owner', () => {
    expect(normalizeAdminEmail('mm642898t@gmail.com.evil.com')).not.toBe('mm642898t@gmail.com')
    expect(normalizeAdminEmail('mm642898t+x@gmail.com')).not.toBe('mm642898t@gmail.com')
  })
})

describe('server-side enforcement', () => {
  it('normalises the allow-list entries', () => {
    expect(serverSource).toContain("raw.split(',').map((s) => s.trim().toLowerCase())")
  })

  it('normalises the authenticated user email', () => {
    expect(serverSource).toMatch(/\(user\.email \?\? ''\)\.trim\(\)\.toLowerCase\(\)/)
  })

  it('denies every privileged action before the allowlist check passes', () => {
    // `gate`/`heartbeat`/`feed`/`read` are the only non-privileged actions.
    // Every action added in Phases 2–4 must appear in this list, so a new
    // privileged handler cannot be forgotten by omission.
    const privileged = [
      'metrics', 'users', 'user', 'directory', 'export', 'send', 'recipients',
      'history', 'analytics', 'audit', 'audit:log', 'health', 'overview',
    ]
    for (const action of privileged) {
      const index = serverSource.indexOf(`action === '${action}'`)
      const allowlistCheck = serverSource.indexOf('if (!email || !admins.includes(email)) return deny')
      expect(index, `missing handler for ${action}`).toBeGreaterThan(-1)
      expect(allowlistCheck).toBeGreaterThan(-1)
      expect(index, `${action} runs before the allowlist check`).toBeGreaterThan(allowlistCheck)
    }
  })

  it('keeps the authorization check in a single place', () => {
    // Exactly one allowlist gate, evaluated once per request. A second copy is
    // how one endpoint ends up weaker than the others.
    const matches = serverSource.match(/if \(!email \|\| !admins\.includes\(email\)\) return deny/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('authorizes from ADMIN_EMAILS only, never from the admin_allowlist table', () => {
    // The table exists in migration 003, but a table is not an authoritative
    // source of privilege while the secret is the documented allowlist.
    expect(serverSource).not.toMatch(/from\('admin_allowlist'\)/)
  })

  it('creates the shared admin client for privileged actions after the authorization gate', () => {
    const gateIndex = serverSource.indexOf('if (!email || !admins.includes(email)) return deny')
    const adminClientCreation = serverSource.indexOf('const admin = adminClient()', gateIndex)
    expect(gateIndex).toBeGreaterThan(-1)
    expect(adminClientCreation).toBeGreaterThan(gateIndex)
  })

  it('scopes authenticated self-service operations to the verified user', () => {
    expect(serverSource).toMatch(/if \(action === 'heartbeat'\)[\s\S]*?user_id: user\.id/)
    expect(serverSource).toMatch(/if \(action === 'push:register'\)[\s\S]*?user_id: user\.id/)
    expect(serverSource).toMatch(/if \(action === 'push:status'\)[\s\S]*?\.eq\('user_id', user\.id\)/)
    expect(serverSource).toMatch(/if \(action === 'push:delete'\)[\s\S]*?\.eq\('user_id', user\.id\)/)
    expect(serverSource).toMatch(/if \(action === 'fcm:register'\)[\s\S]*?user_id: user\.id/)
    expect(serverSource).toMatch(/if \(action === 'fcm:status'\)[\s\S]*?\.eq\('user_id', user\.id\)/)
    expect(serverSource).toMatch(/if \(action === 'fcm:delete'\)[\s\S]*?\.eq\('user_id', user\.id\)/)
  })

  it('does not route admin:log through a client-writable audit table', () => {
    // Audit rows are inserted with the service-role client only; clients never
    // hold an INSERT grant (migration 010 asserts the same from the SQL side).
    expect(serverSource).toMatch(/from\('admin_audit_log'\)\.insert/)
    expect(serverSource).not.toMatch(/userClient\([^)]*\)[\s\S]{0,80}admin_audit_log/)
  })

  it('bounds what an export can return', () => {
    expect(serverSource).toMatch(/MAX_EXPORT\s*=\s*\d+/)
    // Only an explicit column list may be exported.
    expect(serverSource).toMatch(/ALLOWED_COLUMNS/)
  })

  it('never returns admin data for an unconfigured allowlist', () => {
    expect(serverSource).toMatch(/if \(admins\.length === 0\) return deny/)
  })

  it('does not contain a service-role key literal', () => {
    expect(serverSource).not.toMatch(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{20,}/)
    expect(serverSource).toMatch(/Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)/)
  })
})
