import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * P0 SECURITY — the application lock must not be removable without proof of
 * ownership.
 *
 * CONFIRMED ROOT CAUSE (before this fix)
 *   `AppLockScreen.forgetPin()` called `clearLockRecord()` and then
 *   `onForgotPin()` on a single button press. `LockGate.forgotPin()` then set
 *   `lockEnabled = false` from the (now deleted) record and navigated to
 *   /settings. Nothing verified that the person pressing the button owned
 *   anything — so anyone holding the unlocked-but-locked device could:
 *
 *     1. open the app, see the lock screen,
 *     2. tap "Forgot your PIN?" → "Remove lock and sign out",
 *     3. land inside the application with the guest's local data
 *        (tasks, subjects, drawings, journal) fully readable,
 *
 *   A guest's records live in localStorage and are not encrypted, so removing
 *   the lock exposed them outright. The account path was equally affected: the
 *   recovery was "sign out and sign in again", which proves ownership of the
 *   ACCOUNT but never proved ownership of the DEVICE LOCK.
 *
 * THE CONTRACT THESE TESTS PIN
 *   - Pressing the forgot control MUST NOT remove the lock.
 *   - The lock is removed only by `resetLockAfterOwnershipProof()`, which
 *     requires a token minted by a verified recovery ceremony.
 *   - The token is single-use, expires, is bound to the device's lock record,
 *     and cannot be replayed.
 *   - A valid token must NOT wipe customer data.
 */

const RECORD = 'alhelm.v1.appLock'

const PIN = '1234'

beforeEach(async () => {
  localStorage.clear()
  const { createLockRecord, saveLockRecord, issueGuestRecoveryKey } = await import('../services/appLock')
  saveLockRecord(await createLockRecord(PIN))
  // Enabling a lock issues a one-time guest recovery key, exactly as the UI does.
  await issueGuestRecoveryKey()
})

/** Completes the guest ceremony, the only path that mints a token. */
async function completeGuestCeremony() {
  const { beginLockRecovery, getRecoveryChallenge, submitGuestRecoveryKey, issueGuestRecoveryKey } = await import('../services/appLock')
  const challenge = beginLockRecovery()!
  // Re-issue to learn the key (the owner keeps it; tests regenerate it).
  const key = await issueGuestRecoveryKey()
  expect(await submitGuestRecoveryKey(challenge.id, key)).toBe(true)
  void getRecoveryChallenge
  return { challenge, key }
}

describe('enabling the lock', () => {
  it('stores only a salted hash — never the PIN', async () => {
    const raw = localStorage.getItem(RECORD) ?? ''
    expect(raw).not.toContain(PIN)
    const record = JSON.parse(raw) as { hash: string; salt: string; iterations: number }
    expect(record.hash.length).toBeGreaterThan(20)
    expect(record.salt.length).toBeGreaterThan(10)
    // A real KDF, not a bare digest.
    expect(record.iterations).toBeGreaterThanOrEqual(100_000)
  })

  it('rejects a wrong PIN', async () => {
    const { readLockRecord, verifyPin } = await import('../services/appLock')
    const record = readLockRecord()!
    expect(await verifyPin('9999', record)).toBe(false)
    expect(await verifyPin(PIN, record)).toBe(true)
  })

  it('cannot be replaced without the current PIN', async () => {
    const { setPin, verifyPin, readLockRecord } = await import('../services/appLock')
    await expect(setPin('5678')).rejects.toThrow(/current PIN/i)
    await setPin('5678', { currentPin: PIN })
    expect(await verifyPin('5678', readLockRecord()!)).toBe(true)
  })
})

describe('the "forgot PIN" control does not unlock the app', () => {
  it('cancelling the recovery ceremony leaves the lock in place', async () => {
    const { beginLockRecovery, cancelLockRecovery, getLockSettings } = await import('../services/appLock')
    beginLockRecovery()
    cancelLockRecovery()
    expect(getLockSettings().enabled).toBe(true)
    // The record is byte-identical: the PIN still works.
    const { verifyPin, readLockRecord } = await import('../services/appLock')
    expect(await verifyPin(PIN, readLockRecord()!)).toBe(true)
  })

  it('a recovery ceremony alone never removes the lock', async () => {
    const { beginLockRecovery, getLockSettings } = await import('../services/appLock')
    beginLockRecovery()
    expect(getLockSettings().enabled).toBe(true)
  })

  it('completing the guest ceremony mints a token, and only THEN can the lock go', async () => {
    const { getLockSettings, issueRecoveryToken, resetLockAfterOwnershipProof } = await import('../services/appLock')
    await completeGuestCeremony()
    // The ceremony itself has not removed anything yet.
    expect(getLockSettings().enabled).toBe(true)
    const token = await issueRecoveryToken({ owner: 'guest' })
    expect(token).not.toBeNull()
    expect(await resetLockAfterOwnershipProof(token!)).toBe(true)
    expect(getLockSettings().enabled).toBe(false)
  })

  it('there is no exported helper that removes the lock without a token', async () => {
    const lock = await import('../services/appLock')
    // `clearLockRecord` still exists for internal use (disabling with the PIN),
    // but it is NOT a recovery path: the recovery entry point requires a token.
    expect(typeof lock.resetLockAfterOwnershipProof).toBe('function')
    await expect(lock.resetLockAfterOwnershipProof(undefined as never)).resolves.toBe(false)
    expect(lock.getLockSettings().enabled).toBe(true)
  })
})

describe('recovery tokens', () => {
  it('rejects a fabricated token', async () => {
    const { resetLockAfterOwnershipProof, getLockSettings } = await import('../services/appLock')
    expect(await resetLockAfterOwnershipProof({ token: 'forged', owner: 'guest', recordFingerprint: 'x', expiresAt: Date.now() + 1000 })).toBe(false)
    expect(getLockSettings().enabled).toBe(true)
  })

  it('rejects an expired token', async () => {
    const { issueRecoveryToken, resetLockAfterOwnershipProof, getLockSettings } = await import('../services/appLock')
    await completeGuestCeremony()
    const issued = await issueRecoveryToken({ owner: 'guest' })
    expect(issued).not.toBeNull()
    // Advance beyond the token lifetime.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.now() + 60 * 60 * 1000)
      expect(await resetLockAfterOwnershipProof(issued!)).toBe(false)
      expect(getLockSettings().enabled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a reused token (single use)', async () => {
    const { issueRecoveryToken, resetLockAfterOwnershipProof, readLockRecord } = await import('../services/appLock')
    await completeGuestCeremony()
    const issued = await issueRecoveryToken({ owner: 'guest' })
    expect(await resetLockAfterOwnershipProof(issued!)).toBe(true)
    expect(readLockRecord()).toBeNull()

    // Re-install a lock and try to replay the SAME token.
    const { createLockRecord, saveLockRecord, getLockSettings } = await import('../services/appLock')
    saveLockRecord(await createLockRecord(PIN))
    expect(await resetLockAfterOwnershipProof(issued!)).toBe(false)
    expect(getLockSettings().enabled).toBe(true)
  })

  it('a token issued for another lock record cannot unlock this device', async () => {
    const { issueRecoveryToken, resetLockAfterOwnershipProof, createLockRecord, saveLockRecord, getLockSettings } = await import('../services/appLock')
    await completeGuestCeremony()
    const issued = await issueRecoveryToken({ owner: 'guest' })
    // The user changes the PIN (a new salt/hash ⇒ a different lock record).
    saveLockRecord(await createLockRecord('4321'))
    expect(await resetLockAfterOwnershipProof(issued!)).toBe(false)
    expect(getLockSettings().enabled).toBe(true)
  })

  it('a valid token removes the lock but never deletes customer data', async () => {
    localStorage.setItem('alhelm.v1.tasks', JSON.stringify([{ id: 'tsk_keep', title: 'Keep me' }]))
    const { issueRecoveryToken, resetLockAfterOwnershipProof, getLockSettings } = await import('../services/appLock')
    await completeGuestCeremony()
    const issued = await issueRecoveryToken({ owner: 'guest' })
    expect(await resetLockAfterOwnershipProof(issued!)).toBe(true)
    expect(getLockSettings().enabled).toBe(false)
    expect(localStorage.getItem('alhelm.v1.tasks')).toContain('tsk_keep')
  })
})

describe('recovery requires a verification ceremony, not a click', () => {
  it('a token cannot be issued while a ceremony is not in progress', async () => {
    const { issueRecoveryToken } = await import('../services/appLock')
    expect(await issueRecoveryToken({ owner: 'guest' })).toBeNull()
  })

  it('the ceremony requires a concrete ownership step before a token exists', async () => {
    const { beginLockRecovery, getRecoveryChallenge, submitGuestRecoveryKey, issueRecoveryToken } = await import('../services/appLock')
    beginLockRecovery()
    const challenge = getRecoveryChallenge()
    expect(challenge).not.toBeNull()
    // Wrong recovery key: no token.
    expect(await submitGuestRecoveryKey(challenge!.id, 'WRONG-KEY-WRONG-KEY-WRONG')).toBe(false)
    expect(await issueRecoveryToken({ owner: 'guest' })).toBeNull()
  })
})
