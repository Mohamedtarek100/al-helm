import { describe, expect, it } from 'vitest'
import { summarise } from './adminHealth'

/**
 * Admin health summary.
 *
 * THE BUG THIS PINS
 *   The console header showed `status={{ tone: 'ok', label: 'VERIFIED' }}`
 *   unconditionally, while the Security panel listed checks as "Not checked".
 *   The badge asserted something no check had established. The header is now
 *   derived from the real check results through `summarise`, and this file
 *   fixes the mapping so "verified" can never again mean "the page loaded".
 */

const report = (checks: Array<{ id: string; ok: boolean }>) => ({
  checkedAt: '2026-11-01T10:00:00.000Z',
  elapsedMs: 12,
  checks: checks.map((check) => ({ ...check, label: check.id, detail: null })),
  runtime: {
    adminAllowlistConfigured: true,
    ownerEmail: 'owner@example.com',
    serviceRoleConfigured: true,
    anonKeyConfigured: true,
  },
})

describe('summarise', () => {
  it('reports unknown when no check has run', () => {
    // Absence of evidence is not a pass — this is the regression.
    expect(summarise(null)).toBe('unknown')
    expect(summarise(report([]))).toBe('unknown')
  })

  it('reports healthy only when every check passed', () => {
    expect(summarise(report([{ id: 'a', ok: true }, { id: 'b', ok: true }]))).toBe('healthy')
  })

  it('reports failed when every check failed', () => {
    expect(summarise(report([{ id: 'a', ok: false }, { id: 'b', ok: false }]))).toBe('failed')
  })

  it('reports degraded when results are mixed', () => {
    // One broken dependency must not read as "all systems down".
    expect(summarise(report([{ id: 'a', ok: true }, { id: 'b', ok: false }]))).toBe('degraded')
  })

  it('never reports healthy for an empty check list', () => {
    expect(summarise(report([]))).not.toBe('healthy')
  })
})
