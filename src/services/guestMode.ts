/**
 * Guest session isolation.
 *
 * Guest data is durable on this device but is never synced without an account.
 *
 * This flag is the single switch the persistence layer consults:
 *
 *  - The store writes guest edits through the local adapter and never to Supabase.
 *  - A reload restores that local snapshot. Signing in still requires the
 *    explicit, verified migration flow before local data enters an account.
 *  - No Supabase session exists for a guest, so no cloud read or write can occur.
 *
 * The flag itself is deliberately NOT persisted: it is set once when the user
 * confirms Guest mode in this session, and resets on every page load. That also
 * guarantees guest state can never leak into a later Google session, because the
 * flag cannot itself authorize a cloud write after a reload.
 */

let guestSessionActive = false

export function isGuestSession(): boolean {
  return guestSessionActive
}

/**
 * Marks this page-load as a guest session.
 * Cleared automatically on reload (module state is not persisted).
 */
export function startGuestSession(): void {
  guestSessionActive = true
}

/** Leaves guest mode. Called when a real account session is established. */
export function endGuestSession(): void {
  guestSessionActive = false
}

/** Test-only reset. */
export function __resetGuestSessionForTests(): void {
  guestSessionActive = false
}
