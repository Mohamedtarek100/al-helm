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
    const privileged = ['metrics', 'users', 'send', 'history']
    for (const action of privileged) {
      const index = serverSource.indexOf(`action === '${action}'`)
      const allowlistCheck = serverSource.indexOf('if (!email || !admins.includes(email)) return deny')
      expect(index).toBeGreaterThan(-1)
      expect(allowlistCheck).toBeGreaterThan(-1)
      expect(index).toBeGreaterThan(allowlistCheck)
    }
  })

  it('never returns admin data for an unconfigured allowlist', () => {
    expect(serverSource).toMatch(/if \(admins\.length === 0\) return deny/)
  })

  it('does not contain a service-role key literal', () => {
    expect(serverSource).not.toMatch(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{20,}/)
    expect(serverSource).toMatch(/Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)/)
  })
})
