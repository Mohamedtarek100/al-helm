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
