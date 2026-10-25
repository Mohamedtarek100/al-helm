import { describe, expect, it, vi } from 'vitest'

/**
 * Google OAuth: redirect construction and error translation.
 *
 * The production failure was `Unsupported provider: provider is not enabled`,
 * a *server-side configuration* state — no client code can enable a provider.
 * What client code CAN get wrong (and previously did) is the redirect URL: the
 * app is a HashRouter, and passing `.../#/` as `redirectTo` makes Supabase
 * append its params into the hash, producing `.../#/?code=...` which the auth
 * client never parses. These tests pin the corrected contract.
 */

const oauthSpy: { call: any } = vi.hoisted(() => ({ call: null }))

vi.mock('./persistence/supabase', () => ({
  supabase: {
    auth: {
      signInWithOAuth: async (opts: { provider: string; options: Record<string, unknown> }) => {
        oauthSpy.call = opts
        return { data: { url: 'https://example.test/oauth' }, error: null }
      },
      signUp: vi.fn(), signInWithPassword: vi.fn(), resetPasswordForEmail: vi.fn(), signOut: vi.fn(),
    },
  },
}))

const { authRedirectUrl, consumeNextRoute, describeAuthError, signInWithGoogle } = await import('./auth')

describe('authRedirectUrl never contains a hash fragment', () => {
  it('returns a bare origin+path URL', () => {
    // jsdom default URL is http://localhost:3000/
    const url = authRedirectUrl()
    expect(url).toBe(`${window.location.origin}${window.location.pathname}`)
    expect(url).not.toContain('#')
  })

  it('carries the intended destination as a query param, not a hash', () => {
    const url = authRedirectUrl('/studio')
    expect(url).toContain('next=%2Fstudio')
    expect(url).not.toContain('#')
  })

  it('is a valid absolute URL that Supabase appending params to will preserve', () => {
    const url = new URL(authRedirectUrl())
    url.searchParams.set('code', 'abc123')
    // The resulting URL must keep `code` as a query parameter, which is what
    // the auth client looks for.
    expect(url.searchParams.get('code')).toBe('abc123')
    expect(url.hash).toBe('')
  })
})

describe('signInWithGoogle', () => {
  it('requests the google provider with the bare redirect URL', async () => {
    await signInWithGoogle('/tasks')
    expect(oauthSpy.call?.provider).toBe('google')
    const redirectTo = String(oauthSpy.call?.options.redirectTo)
    expect(redirectTo).not.toContain('#')
    expect(redirectTo).toContain('next=%2Ftasks')
  })

  it('requests an explicit account picker', async () => {
    await signInWithGoogle()
    expect(oauthSpy.call?.options.queryParams).toEqual({ prompt: 'select_account' })
  })
})

describe('consumeNextRoute', () => {
  it('returns null when no destination was recorded', () => {
    window.history.replaceState({}, '', '/')
    expect(consumeNextRoute()).toBeNull()
  })

  it('extracts and strips a same-app destination', () => {
    window.history.replaceState({}, '', '/?next=%2Fstudio')
    expect(consumeNextRoute()).toBe('/studio')
    expect(window.location.search).toBe('')
  })

  it('rejects an external URL (open-redirect guard)', () => {
    window.history.replaceState({}, '', '/?next=https%3A%2F%2Fevil.test')
    expect(consumeNextRoute()).toBeNull()
  })
})

describe('describeAuthError', () => {
  it('explains a disabled provider without leaking the raw backend string', () => {
    const message = describeAuthError({ message: 'Unsupported provider: provider is not enabled' })
    expect(message).toMatch(/not enabled/i)
    expect(message).not.toContain('provider is not enabled')
  })

  it('explains a disallowed redirect', () => {
    expect(describeAuthError({ message: 'redirect_uri is not allowed' })).toMatch(/redirect/i)
  })

  it('explains bad credentials, unconfirmed email and rate limits', () => {
    expect(describeAuthError({ message: 'Invalid login credentials' })).toMatch(/incorrect/i)
    expect(describeAuthError({ message: 'Email not confirmed', code: 'email_not_confirmed' })).toMatch(/confirm/i)
    expect(describeAuthError({ message: 'too many requests' })).toMatch(/too many/i)
  })

  it('explains a network failure', () => {
    expect(describeAuthError({ message: 'Failed to fetch', status: 0 })).toMatch(/connection|reach/i)
  })

  it('falls back to a generic, safe message', () => {
    const message = describeAuthError({ message: 'internal error 0xDEADBEEF' })
    expect(message).toBeTruthy()
    expect(message).not.toContain('0xDEADBEEF')
  })

  it('returns null for no error', () => {
    expect(describeAuthError(null)).toBeNull()
  })
})
