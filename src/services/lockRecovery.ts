/**
 * Account ownership verification for app-lock recovery.
 *
 * SECURITY MODEL
 *   The device lock is a LOCAL secret, so it cannot be "reset" by proving
 *   something the device already knows. Recovery therefore requires proof that
 *   the person is the owner of the account signed in on this device.
 *
 *   The proof is a fresh PASSWORD SIGN-IN through Supabase:
 *
 *     1. The current signed-in user's email and id are read from the session.
 *     2. `signInWithPassword()` is called with that email and the password the
 *        user typed. The password never leaves the device for verification —
 *        Supabase's auth server checks it.
 *     3. The session returned must belong to the SAME user id as the account
 *        that owns this device's data. A different account's valid password does
 *        not unlock this device.
 *
 *   What this function deliberately does NOT do:
 *     - It never accepts an email address typed into a box as proof.
 *     - It never accepts a client-side boolean (the old `passwordReset = true`).
 *     - It never sends a recovery email and treats its mere sending — or the
 *       user's return from it — as success.
 *     - It never exposes the stored password or session token to the caller.
 *
 *   A password reset performed through email (Supabase's recovery link) changes
 *   the ACCOUNT password. That is a different ceremony, and it only counts here
 *   once the user has come back with a verified session; see
 *   `verifyRecoveredSession()`.
 */

import { supabase } from './persistence/supabase'

export interface RecoveryVerification {
  ok: boolean
  userId: string
  expectedUserId: string | null
  /** Safe, user-facing reason when `ok` is false. */
  message: string
}

const GENERIC_FAILURE = 'That password is not correct for this account.'

function failure(message: string, expectedUserId: string | null = null): RecoveryVerification {
  return { ok: false, userId: '', expectedUserId, message }
}

/**
 * Verifies the account password for the account signed in on this device.
 *
 * Returns `ok: true` only when Supabase issued a session whose user id matches
 * the device's account.
 */
export async function verifyAccountOwnershipForRecovery(password: string): Promise<RecoveryVerification> {
  if (!supabase) return failure('Account recovery is not available in this build.')

  // The email comes from the SESSION, never from an input field: the recovery
  // screen must not be usable to probe whether an arbitrary address exists.
  const { data: current, error: sessionError } = await supabase.auth.getUser()
  if (sessionError) return failure('Your session has expired. Sign in again first.')
  const email = current.user?.email ?? null
  if (!current.user || !email) {
    return failure('This device is not signed in to an account. Use your recovery key instead.')
  }

  if (typeof password !== 'string' || password.length === 0) return failure(GENERIC_FAILURE, current.user.id)

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    // Do not distinguish "wrong password" from "no such user": the email is
    // fixed by the session, so a generic message leaks nothing extra.
    return failure(GENERIC_FAILURE, current.user.id)
  }

  const verifiedId = data.user?.id ?? data.session?.user.id ?? ''
  if (!verifiedId) return failure(GENERIC_FAILURE, current.user.id)

  if (verifiedId !== current.user.id) {
    // A valid password for a DIFFERENT account must not unlock this device.
    return failure('This device belongs to a different account.', current.user.id)
  }

  return { ok: true, userId: verifiedId, expectedUserId: current.user.id, message: '' }
}

/**
 * Verifies a session the user obtained through Supabase's email recovery link.
 *
 * This is the second supported account path: the user completes the provider's
 * password-reset ceremony in the browser, returns to the app, and the app only
 * accepts it once a real session exists for the account that owns the device.
 * A deep link on its own never satisfies this — the session is what is checked.
 */
export async function verifyRecoveredSession(): Promise<RecoveryVerification> {
  if (!supabase) return failure('Account recovery is not available in this build.')
  const { data, error } = await supabase.auth.getSession()
  if (error) return failure('Your session could not be read.')
  const recoveredId = data.session?.user.id ?? ''
  if (!recoveredId) return failure('No verified account session was found. Complete the recovery link first.')
  const { data: current } = await supabase.auth.getUser()
  const expected = current.user?.id ?? null
  if (expected && expected !== recoveredId) {
    return failure('This device belongs to a different account.', expected)
  }
  return { ok: true, userId: recoveredId, expectedUserId: expected, message: '' }
}

/** The email of the account signed in on this device, for the recovery UI. */
export async function currentAccountEmail(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getUser()
  return data.user?.email ?? null
}
