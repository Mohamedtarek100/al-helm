import { useEffect, useState } from 'react'
import { supabase } from './persistence/supabase'

/**
 * Authentication service.
 *
 * OAuth redirect correctness (root cause of the broken Google sign-in):
 * Supabase appends its own `?code=...` (or `#access_token=...`) to the
 * `redirectTo` URL. The app is a HashRouter, so a redirect that already ends in
 * `#` or `#/` produces malformed URLs such as `.../#/?code=abc` or
 * `.../##access_token=...`, which the auth client cannot parse — the user
 * returns to the app with no session.
 *
 * `authRedirectUrl()` therefore returns the *bare* document URL (origin +
 * path, no hash) and preserves the intended in-app destination separately via
 * the `next` query parameter, which the app restores after the callback.
 */

export const authConfigured = Boolean(supabase)

/** Where the OAuth/provider should send the user back to (no hash fragment). */
export function authRedirectUrl(next?: string): string {
  const base = `${window.location.origin}${window.location.pathname}`
  if (!next) return base
  const url = new URL(base)
  url.searchParams.set('next', next)
  return url.toString()
}

/** Reads and clears the post-login destination recorded in the URL. */
export function consumeNextRoute(): string | null {
  try {
    const url = new URL(window.location.href)
    const next = url.searchParams.get('next')
    if (next) {
      url.searchParams.delete('next')
      window.history.replaceState({}, '', url.toString())
      // Only allow same-app hash routes to avoid an open redirect.
      return next.startsWith('/') ? next : null
    }
  } catch {
    /* ignore malformed URLs */
  }
  return null
}

/** Maps provider/auth failures to a user-facing message without leaking internals. */
export function describeAuthError(error: { message?: string; code?: string; status?: number } | null): string | null {
  if (!error) return null
  const message = error.message ?? ''
  const code = error.code ?? ''
  if (/provider is not enabled|unsupported provider/i.test(message)) {
    return 'Google sign-in is not enabled for this deployment yet. Please use email and password, or contact support.'
  }
  if (/redirect/i.test(message) && /not allowed|invalid/i.test(message)) {
    return 'The sign-in redirect is not allowed. Please contact support so the application URL can be authorised.'
  }
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(message)) {
    return 'Please confirm your email address, then sign in again.'
  }
  if (/invalid login credentials/i.test(message)) {
    return 'Email or password is incorrect.'
  }
  if (/rate limit|too many/i.test(message)) {
    return 'Too many attempts. Please wait a moment and try again.'
  }
  if (error.status === 0 || /failed to fetch|network/i.test(message)) {
    return 'Could not reach the sign-in service. Check your connection and try again.'
  }
  return 'Sign-in could not be completed. Please try again.'
}

export async function signUp(email: string, password: string, displayName: string) {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName }, emailRedirectTo: authRedirectUrl() },
  })
}

export async function signIn(email: string, password: string) {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase.auth.signInWithPassword({ email, password })
}

export async function signInWithGoogle(next?: string) {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: authRedirectUrl(next),
      // Ask Google for a fresh account choice instead of silently reusing the
      // previously consented account.
      queryParams: { prompt: 'select_account' },
    },
  })
}

export async function requestPasswordReset(email: string) {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase.auth.resetPasswordForEmail(email, { redirectTo: authRedirectUrl() })
}

export async function signOut() {
  if (!supabase) return
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export type AuthStatus =
  | 'loading'
  | 'signed-out'
  | 'authenticating'
  | 'authenticated'
  | 'local-only'
  | 'error'

/**
 * Single source of truth for auth UI state. Starts 'loading' so the app never
 * shows a signed-out user as authenticated before the session check finishes.
 * Falls back to 'local-only' when Supabase is not configured.
 */
export function useAuthStatus(): { status: AuthStatus; email: string | null; error: string | null } {
  const [state, setState] = useState<{ status: AuthStatus; email: string | null; error: string | null }>(() =>
    supabase ? { status: 'loading', email: null, error: null } : { status: 'local-only', email: null, error: null },
  )

  useEffect(() => {
    if (!supabase) return
    let active = true

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          setState({ status: 'error', email: null, error: describeAuthError(error) })
          return
        }
        const email = data.session?.user?.email ?? null
        setState({ status: email ? 'authenticated' : 'signed-out', email, error: null })
      })
      .catch((err: unknown) => {
        if (!active) return
        setState({ status: 'error', email: null, error: describeAuthError({ message: err instanceof Error ? err.message : '' }) })
      })

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'SIGNED_OUT' || !session) {
        setState({ status: 'signed-out', email: null, error: null })
      } else if (event === 'SIGNED_IN') {
        setState({ status: 'authenticated', email: session.user.email ?? null, error: null })
      }
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  return state
}
