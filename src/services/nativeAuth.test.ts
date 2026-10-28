import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as nativeAuth from './nativeAuth'

/**
 * Android OAuth return leg.
 *
 * Root cause this guards: without a custom-scheme intent filter the browser
 * never hands the callback back to the app, so the user stays stranded in
 * Chrome with an unauthenticated app. These tests cover the pure parsing and
 * dedupe logic; the actual `appUrlOpen` delivery needs a device.
 */

const authMock = vi.hoisted(() => ({
  exchangeCalls: [] as string[],
  setSessionCalls: [] as Array<{ access_token: string; refresh_token: string }>,
  exchangeError: null as null | string,
}))

vi.mock('./persistence/supabase', () => ({
  supabase: {
    auth: {
      exchangeCodeForSession: async (code: string) => {
        authMock.exchangeCalls.push(code)
        if (authMock.exchangeError) return { data: { session: null }, error: { message: authMock.exchangeError } }
        return { data: { session: { user: { id: 'user-1' } } }, error: null }
      },
      setSession: async (tokens: { access_token: string; refresh_token: string }) => {
        authMock.setSessionCalls.push(tokens)
        return { data: { session: { user: { id: 'user-2' } } }, error: null }
      },
    },
  },
}))

beforeEach(() => {
  authMock.exchangeCalls = []
  authMock.setSessionCalls = []
  authMock.exchangeError = null
  nativeAuth.__resetNativeAuthForTests()
})

describe('callback URL recognition', () => {
  it('uses the app custom scheme', () => {
    expect(nativeAuth.ANDROID_AUTH_CALLBACK).toBe('com.alhelm.studyplanner://auth-callback')
  })

  it('recognises only its own callback', () => {
    expect(nativeAuth.isAuthCallbackUrl('com.alhelm.studyplanner://auth-callback?code=x')).toBe(true)
    expect(nativeAuth.isAuthCallbackUrl('https://example.com/?code=x')).toBe(false)
    expect(nativeAuth.isAuthCallbackUrl('com.alhelm.studyplanner://other')).toBe(false)
  })

  it('redirects to the custom scheme on Android and to the page on web', () => {
    expect(nativeAuth.authRedirectFor('android')).toBe(nativeAuth.ANDROID_AUTH_CALLBACK)
    expect(nativeAuth.authRedirectFor('web')).toBe('')
  })
})

describe('parsing', () => {
  it('reads a PKCE code from the query string', () => {
    const parsed = nativeAuth.parseAuthCallback('com.alhelm.studyplanner://auth-callback?code=abc123')
    expect(parsed.code).toBe('abc123')
  })

  it('reads implicit-flow tokens from the fragment', () => {
    const parsed = nativeAuth.parseAuthCallback(
      'com.alhelm.studyplanner://auth-callback#access_token=at&refresh_token=rt&expires_in=3600',
    )
    expect(parsed.accessToken).toBe('at')
    expect(parsed.refreshToken).toBe('rt')
  })

  it('surfaces provider errors instead of a silent failure', () => {
    const parsed = nativeAuth.parseAuthCallback('com.alhelm.studyplanner://auth-callback?error=access_denied&error_description=User+cancelled')
    expect(parsed.error).toBe('access_denied')
    expect(parsed.errorDescription).toBe('User cancelled')
  })

  it('returns empty fields for a malformed URL instead of throwing', () => {
    expect(nativeAuth.parseAuthCallback('not a url').code).toBeNull()
    expect(nativeAuth.parseAuthCallback('').accessToken).toBeNull()
  })
})

describe('completing the session', () => {
  it('exchanges a PKCE code exactly once', async () => {
    const url = 'com.alhelm.studyplanner://auth-callback?code=abc'
    expect(await nativeAuth.handleAuthCallback(url)).toBe('user-1')
    // The OS can deliver the same URL twice; the second must be ignored.
    expect(await nativeAuth.handleAuthCallback(url)).toBeNull()
    expect(authMock.exchangeCalls).toEqual(['abc'])
  })

  it('restores an implicit-flow session from tokens', async () => {
    const url = 'com.alhelm.studyplanner://auth-callback#access_token=at&refresh_token=rt'
    expect(await nativeAuth.handleAuthCallback(url)).toBe('user-2')
    expect(authMock.setSessionCalls[0]).toEqual({ access_token: 'at', refresh_token: 'rt' })
  })

  it('ignores a URL that is not this app callback', async () => {
    expect(await nativeAuth.handleAuthCallback('https://example.com/?code=abc')).toBeNull()
    expect(authMock.exchangeCalls).toEqual([])
  })

  it('ignores a callback with no credentials', async () => {
    expect(await nativeAuth.handleAuthCallback('com.alhelm.studyplanner://auth-callback')).toBeNull()
  })

  it('throws a readable error when the code exchange fails', async () => {
    authMock.exchangeError = 'invalid grant'
    await expect(nativeAuth.handleAuthCallback('com.alhelm.studyplanner://auth-callback?code=bad')).rejects.toThrow('invalid grant')
  })

  it('throws when the provider reported an error (cancellation)', async () => {
    await expect(
      nativeAuth.handleAuthCallback('com.alhelm.studyplanner://auth-callback?error=access_denied&error_description=Cancelled'),
    ).rejects.toThrow('Cancelled')
  })
})
