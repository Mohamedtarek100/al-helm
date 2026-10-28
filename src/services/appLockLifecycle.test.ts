import { beforeEach, describe, expect, it } from 'vitest'
import { createLockRecord, getLockSettings, saveLockRecord, clearLockRecord, shouldRelock } from './appLock'

/**
 * Lock lifecycle: the guarantees that prevent both lockout and accidental bypass.
 */

beforeEach(() => {
  localStorage.clear()
})

describe('lifecycle policy', () => {
  it('locks when a record exists and never when none does', async () => {
    clearLockRecord()
    expect(getLockSettings().enabled).toBe(false)
    saveLockRecord(await createLockRecord('1234'))
    expect(getLockSettings().enabled).toBe(true)
    clearLockRecord()
    expect(getLockSettings().enabled).toBe(false)
  })

  it('removing the record opens the app without a restart', async () => {
    saveLockRecord(await createLockRecord('1234'))
    expect(getLockSettings().enabled).toBe(true)
    clearLockRecord()
    // LockGate re-reads getLockSettings() on every render, so removal takes
    // effect immediately rather than at the next launch.
    expect(getLockSettings().enabled).toBe(false)
  })

  it('enabling while the app is open locks it immediately', async () => {
    expect(getLockSettings().enabled).toBe(false)
    saveLockRecord(await createLockRecord('5678'))
    expect(getLockSettings().enabled).toBe(true)
    clearLockRecord()
  })

  it('idle policy: zero minutes never idles, positive minutes do', () => {
    const now = 10_000_000
    expect(shouldRelock(now - 1, 0, now)).toBe(false)
    expect(shouldRelock(now - 6 * 60_000, 5, now)).toBe(true)
    expect(shouldRelock(now - 4 * 60_000, 5, now)).toBe(false)
  })
})
