import { useSyncExternalStore } from 'react'
import { supabase } from '../persistence/supabase'
import { getAdminGate, type AdminGate } from './admin'

/**
 * Normalises an email for comparison.
 *
 * The server already does `(user.email ?? '').toLowerCase()` on both sides, but
 * Google can return mixed case, and a trailing space in a pasted allow-list
 * entry is invisible. Trimming here keeps the client's *displayed* identity
 * consistent with what the server compares, and is never used to grant access.
 */
export function normalizeAdminEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

/**
 * Client-side mirror of the server's admin decision.
 *
 * This is a NAVIGATION hint only. It never grants access: every privileged
 * read and write still goes through the `admin` Edge Function, which re-checks
 * the caller's JWT against the server-side ADMIN_EMAILS allowlist. Hiding or
 * showing a menu entry changes nothing about what the backend will allow.
 *
 * The state is re-resolved whenever authentication changes (sign in, sign out,
 * token refresh, account switch) so a stale "is admin" answer cannot survive a
 * switch to a different account.
 */

export type AdminGateState =
  | 'unknown' // not resolved yet (no session, or a request is in flight)
  | 'loading'
  | 'authorized'
  | 'denied'
  | 'signed-out'
  | 'unconfigured' // ADMIN_EMAILS is not set on the server
  | 'error' // network/function failure — cannot decide

export interface AdminGateSnapshot {
  state: AdminGateState
  gate: AdminGate | null
  error: string | null
  /** The email the current answer refers to, so a switch can be detected. */
  email: string | null
}

const IDLE: AdminGateSnapshot = { state: 'unknown', gate: null, error: null, email: null }

let snapshot: AdminGateSnapshot = IDLE
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribeAdminGate(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getAdminGateState(): AdminGateSnapshot {
  return snapshot
}

export function useAdminGate(): AdminGateSnapshot {
  return useSyncExternalStore(subscribeAdminGate, getAdminGateState, getAdminGateState)
}

/** Monotonic token so a slow response for an older session cannot win. */
let requestToken = 0

/** Forces a fresh server decision (used by the dashboard's Refresh button). */
export async function refreshAdminGate(): Promise<AdminGateSnapshot> {
  const token = ++requestToken
  if (!supabase) {
    snapshot = { state: 'unconfigured', gate: null, error: null, email: null }
    emit()
    return snapshot
  }
  snapshot = { ...snapshot, state: 'loading', error: null }
  emit()
  try {
    const { data, error } = await supabase.auth.getSession()
    if (token !== requestToken) return snapshot
    if (error) throw error
    if (!data.session) {
      snapshot = { state: 'signed-out', gate: null, error: null, email: null }
      emit()
      return snapshot
    }
    const gate = await getAdminGate()
    if (token !== requestToken) return snapshot
    const next: AdminGateSnapshot = gate.error === 'not_configured'
      ? { state: 'unconfigured', gate, error: null, email: gate.email }
      : { state: gate.isAdmin ? 'authorized' : 'denied', gate, error: null, email: gate.email }
    snapshot = next
    emit()
    return snapshot
  } catch (error) {
    if (token !== requestToken) return snapshot
    const message = error instanceof Error ? error.message : String(error)
    snapshot = {
      // A rejected token means the session is gone, not that the backend broke.
      state: /unauthenticated|sign in is required|bearer/i.test(message) ? 'signed-out' : 'error',
      gate: null,
      error: message,
      email: snapshot.email,
    }
    emit()
    return snapshot
  }
}

/**
 * Installs the auth listener once and resolves the gate immediately.
 * Returns a teardown for tests/HMR.
 */
export function initAdminGate(): () => void {
  if (!supabase) {
    snapshot = { state: 'unconfigured', gate: null, error: null, email: null }
    emit()
    return () => undefined
  }
  const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
    // Any of these can change who is signed in, so the previous answer is void.
    if (event === 'SIGNED_OUT' || !session) {
      requestToken += 1
      snapshot = { state: 'signed-out', gate: null, error: null, email: null }
      emit()
      return
    }
    void refreshAdminGate()
  })
  void refreshAdminGate()
  return () => sub.subscription.unsubscribe()
}

/** Test-only: resets module state between cases. */
export function __resetAdminGate(): void {
  requestToken += 1
  snapshot = IDLE
  emit()
}
