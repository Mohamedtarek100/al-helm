import { supabase } from './persistence/supabase'

export const authConfigured = Boolean(supabase)
export async function signUp(email: string, password: string, displayName: string) {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase.auth.signUp({ email, password, options: { data: { display_name: displayName }, emailRedirectTo: window.location.origin + window.location.pathname + window.location.hash } })
}
export async function signIn(email: string, password: string) {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase.auth.signInWithPassword({ email, password })
}
export async function signInWithGoogle() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + window.location.pathname + window.location.hash } })
}
export async function requestPasswordReset(email: string) {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname + window.location.hash })
}
export async function signOut() {
  if (!supabase) return
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

import { useEffect, useState } from 'react'

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
          setState({ status: 'error', email: null, error: error.message })
          return
        }
        const email = data.session?.user?.email ?? null
        setState({ status: email ? 'authenticated' : 'signed-out', email, error: null })
      })
      .catch((err: unknown) => {
        if (!active) return
        setState({ status: 'error', email: null, error: err instanceof Error ? err.message : 'Auth error' })
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
