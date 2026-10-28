import { useSyncExternalStore } from 'react'

/**
 * First-launch mode choice: "Continue with Google" or "Continue as guest".
 *
 * The choice is stored in localStorage and read synchronously, so the decision
 * is known before the first paint and the screen never flashes for a returning
 * user. It is deliberately NOT part of the cloud snapshot: the choice belongs
 * to this device, and syncing it would let one device force the choice on
 * another.
 *
 * Invariants:
 *  - An existing user with data who never saw the screen must not be forced
 *    through it.
 *  - Choosing guest never deletes, overwrites, or hides existing local data.
 *  - Signing in later is a separate, explicit action; guest data is never
 *    merged into an account automatically.
 */

export type LaunchMode = 'google' | 'guest' | null

const KEY = 'alhelm.v1.launchMode'

function readStored(): LaunchMode {
  try {
    const raw = localStorage.getItem(KEY)
    return raw === 'google' || raw === 'guest' ? raw : null
  } catch {
    return null
  }
}

let mode: LaunchMode = readStored()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function getLaunchMode(): LaunchMode {
  return mode
}

export function subscribeLaunchMode(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLaunchMode(): LaunchMode {
  return useSyncExternalStore(subscribeLaunchMode, getLaunchMode, getLaunchMode)
}

/** Records the choice. Returns false when storage is unavailable (private mode). */
export function setLaunchMode(next: Exclude<LaunchMode, null>): boolean {
  mode = next
  let stored = true
  try { localStorage.setItem(KEY, next) } catch { stored = false }
  emit()
  return stored
}

/** Clears the recorded choice so the screen can be shown again (Settings). */
export function resetLaunchMode(): void {
  mode = null
  try { localStorage.removeItem(KEY) } catch { /* storage unavailable */ }
  emit()
}

/**
 * Whether the launch screen should be shown.
 *
 * `hasExistingData` protects users who already have a local snapshot from an
 * upgrade: they never saw this screen, and forcing it would look like data
 * loss. With no recorded choice and no data, it is a genuine first launch.
 */
export function shouldShowOnboarding(options: { hasExistingData: boolean; sessionEmail: string | null }): boolean {
  if (mode) return false
  if (options.sessionEmail) return false // already signed in: nothing to decide
  return !options.hasExistingData
}

/** Test-only: drops the in-memory copy without touching storage. */
export function __resetLaunchModeForTests(): void {
  mode = null
  emit()
}
