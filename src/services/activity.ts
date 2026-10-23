import { heartbeat } from './edge/admin'
import { supabase } from './persistence/supabase'

/**
 * Throttled activity tracking for signed-in users.
 *
 * Calls the admin edge function's `heartbeat` action, which upserts a
 * `user_activity` row server-side. Never fires more than once per
 * HEARTBEAT_INTERVAL (15 min) per browser session, so a signed-in user
 * browsing the app does not create a request per render.
 */

const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000

let lastBeat = 0
let inFlight: Promise<void> | null = null

function shouldBeat(now: number): boolean {
  return now - lastBeat >= HEARTBEAT_INTERVAL_MS
}

export async function maybeHeartbeat(now: number = Date.now()): Promise<boolean> {
  if (!supabase) return false
  if (!shouldBeat(now)) return false
  if (inFlight) return false
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) return false
  lastBeat = now
  inFlight = heartbeat()
    .then(() => undefined)
    .catch(() => undefined) // heartbeat is best-effort; never blocks the UI
    .finally(() => {
      inFlight = null
    })
  return true
}

/** Test hook: reset throttle state between tests. */
export function resetHeartbeatForTests(): void {
  lastBeat = 0
  inFlight = null
}

/* ------------------------------------------------------------------ */
/* Pure helpers (exported for unit testing)                            */
/* ------------------------------------------------------------------ */

export const __internals = { shouldBeat, HEARTBEAT_INTERVAL_MS }
