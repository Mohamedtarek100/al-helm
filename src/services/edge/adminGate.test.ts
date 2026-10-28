import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Admin gate: server-confirmed visibility.
 *
 * The gate is a NAVIGATION hint only — the Edge Function still authorizes every
 * privileged call. These tests pin the client's handling of each server answer
 * and, importantly, that the answer is re-resolved when the account changes so
 * one account's authorisation can never leak to another.
 */

const cloud = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email?: string } },
  gateResult: { isAdmin: false, email: null as string | null } as { isAdmin: boolean; email: string | null; error?: string },
  gateThrows: null as null | string,
  gateCalls: 0,
  listeners: [] as Array<(event: string, session: unknown) => void>,
}))

vi.mock('../persistence/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: cloud.session }, error: null }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        cloud.listeners.push(cb)
        return { data: { subscription: { unsubscribe: () => undefined } } }
      },
    },
  },
}))

vi.mock('./admin', () => ({
  getAdminGate: async () => {
    cloud.gateCalls += 1
    if (cloud.gateThrows) throw new Error(cloud.gateThrows)
    return cloud.gateResult
  },
}))

const gateModule = await import('./adminGate')

beforeEach(() => {
  cloud.session = null
  cloud.gateResult = { isAdmin: false, email: null }
  cloud.gateThrows = null
  cloud.gateCalls = 0
  cloud.listeners = []
  gateModule.__resetAdminGate()
})

describe('gate states', () => {
  it('reports signed-out without calling the server', async () => {
    cloud.session = null
    const state = await gateModule.refreshAdminGate()
    expect(state.state).toBe('signed-out')
    expect(cloud.gateCalls).toBe(0)
  })

  it('reports authorized only when the server says so', async () => {
    cloud.session = { user: { id: 'u1' } }
    cloud.gateResult = { isAdmin: true, email: 'owner@example.com' }
    const state = await gateModule.refreshAdminGate()
    expect(state.state).toBe('authorized')
    expect(state.email).toBe('owner@example.com')
  })

  it('reports denied for a signed-in non-owner', async () => {
    cloud.session = { user: { id: 'u2' } }
    cloud.gateResult = { isAdmin: false, email: 'someone@example.com' }
    const state = await gateModule.refreshAdminGate()
    expect(state.state).toBe('denied')
  })

  it('distinguishes an unconfigured allow-list from a denial', async () => {
    cloud.session = { user: { id: 'u1' } }
    cloud.gateResult = { isAdmin: false, email: 'owner@example.com', error: 'not_configured' }
    const state = await gateModule.refreshAdminGate()
    expect(state.state).toBe('unconfigured')
  })

  it('reports a backend error without granting access', async () => {
    cloud.session = { user: { id: 'u1' } }
    cloud.gateThrows = 'Request failed (502)'
    const state = await gateModule.refreshAdminGate()
    expect(state.state).toBe('error')
    expect(state.error).toContain('502')
    // An error is never treated as authorisation.
    expect(state.state).not.toBe('authorized')
  })

  it('treats an expired token as signed-out, not as an error', async () => {
    cloud.session = { user: { id: 'u1' } }
    cloud.gateThrows = 'Unauthenticated.'
    const state = await gateModule.refreshAdminGate()
    expect(state.state).toBe('signed-out')
  })
})

describe('account changes', () => {
  it('re-resolves the gate when the auth state fires', async () => {
    cloud.session = { user: { id: 'u1' } }
    cloud.gateResult = { isAdmin: true, email: 'owner@example.com' }
    const teardown = gateModule.initAdminGate()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(gateModule.getAdminGateState().state).toBe('authorized')

    // A different account signs in.
    cloud.session = { user: { id: 'u2' } }
    cloud.gateResult = { isAdmin: false, email: 'other@example.com' }
    const session = { user: { id: 'u2' } }
    cloud.listeners.forEach((cb) => cb('SIGNED_IN', session))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(gateModule.getAdminGateState().state).toBe('denied')
    teardown()
  })

  it('clears authorisation immediately on sign-out', async () => {
    cloud.session = { user: { id: 'u1' } }
    cloud.gateResult = { isAdmin: true, email: 'owner@example.com' }
    const teardown = gateModule.initAdminGate()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(gateModule.getAdminGateState().state).toBe('authorized')

    cloud.listeners.forEach((cb) => cb('SIGNED_OUT', null))
    expect(gateModule.getAdminGateState().state).toBe('signed-out')
    expect(gateModule.getAdminGateState().gate).toBeNull()
    teardown()
  })

  it('a slow response for a previous session cannot overwrite the current one', async () => {
    cloud.session = { user: { id: 'u1' } }
    cloud.gateResult = { isAdmin: true, email: 'owner@example.com' }
    const first = gateModule.refreshAdminGate()

    // New account resolves first.
    cloud.gateResult = { isAdmin: false, email: 'other@example.com' }
    const second = gateModule.refreshAdminGate()
    await Promise.all([first, second])

    // The latest request wins; the stale one is discarded.
    expect(gateModule.getAdminGateState().state).toBe('denied')
  })
})
