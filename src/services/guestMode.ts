/**
 * Guest session isolation.
 *
 * REQUIREMENT: a Guest chooses not to have an account, so their data must be
 * genuinely temporary — no cloud access, and nothing written to durable storage.
 *
 * This flag is the single switch the persistence layer consults:
 *
 *  - `store.commitAndPersist` / `persistCloudSnapshot` skip ALL writes
 *    (localStorage and Supabase) while it is set, so guest edits live only in
 *    the in-memory snapshot for the life of the page.
 *  - A reload constructs a fresh store, so guest data is gone by design. That is
 *    the documented behaviour, not a bug.
 *  - No Supabase session exists for a guest, so no cloud read or write can occur.
 *
 * The flag itself is deliberately NOT persisted: it is set once when the user
 * confirms Guest mode in this session, and resets on every page load. That also
 * guarantees guest state can never leak into a later Google session, because the
 * flag cannot survive the reload that precedes signing in.
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
