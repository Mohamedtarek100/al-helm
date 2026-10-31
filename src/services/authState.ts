import { useSyncExternalStore } from 'react'

/**
 * Single source of truth for "is the user authenticated right now?".
 *
 * WHY THIS EXISTS
 *   On Android the OAuth flow leaves Chrome, returns through the custom scheme,
 *   and finishes INSIDE the already-running WebView. Nothing remounts, so:
 *
 *     - LaunchGate made its welcome/app decision once at mount and never
 *       re-evaluated, leaving the welcome screen up forever;
 *     - WelcomePage set `busy = 'google'` expecting a redirect that never came,
 *       so the button spun indefinitely.
 *
 *   Both now subscribe here. The native callback publishes a *confirmed* session
 *   (after the PKCE exchange and cloud hydration), and the UI reacts.
 *
 * RULES
 *   - Only a CONFIRMED Supabase session may flip this to 'authenticated'. Opening
 *     the callback URL is not success.
 *   - The payload carries a user id, never a token.
 */

export type AuthPhase = 'unknown' | 'signed-out' | 'authenticating' | 'authenticated'

export interface AuthSignal {
  phase: AuthPhase
  /** Present only when phase === 'authenticated'. A user id, never a token. */
  userId: string | null
  /** Safe, user-facing failure text. No codes, tokens or URLs. */
  error: string | null
}

const INITIAL: AuthSignal = { phase: 'unknown', userId: null, error: null }

let signal: AuthSignal = INITIAL
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function set(next: AuthSignal): void {
  // Avoid needless re-renders when nothing meaningful changed.
  if (
    next.phase === signal.phase &&
    next.userId === signal.userId &&
    next.error === signal.error
  ) return
  signal = next
  emit()
}

export function getAuthSignal(): AuthSignal {
  return signal
}

export function subscribeAuthSignal(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useAuthSignal(): AuthSignal {
  return useSyncExternalStore(subscribeAuthSignal, getAuthSignal, getAuthSignal)
}

/** The user left for the external Google flow (Chrome / popup). */
export function markAuthenticating(): void {
  set({ phase: 'authenticating', userId: null, error: null })
}

/**
 * A session was verified AND the cloud layer finished hydrating.
 * This is the ONLY way the app is allowed to enter the authenticated state.
 */
export function markAuthenticated(userId: string): void {
  set({ phase: 'authenticated', userId, error: null })
}

/** Sign-out, or a boot check that found no session. */
export function markSignedOut(): void {
  set({ phase: 'signed-out', userId: null, error: null })
}

/**
 * The attempt failed (provider error, cancelled, expired state, exchange error).
 * The message must already be safe for display.
 */
export function markAuthFailed(message: string): void {
  set({ phase: 'signed-out', userId: null, error: message })
}

/** Test-only reset. */
export function __resetAuthSignalForTests(): void {
  signal = INITIAL
  emit()
}
