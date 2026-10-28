import { beforeEach, describe, expect, it } from 'vitest'
import {
  createLockRecord,
  verifyPin,
  isValidPin,
  setPin,
  disableLock,
  readLockRecord,
  getLockSettings,
  shouldRelock,
  MIN_PIN_LENGTH,
  MAX_PIN_LENGTH,
} from './appLock'

/**
 * Local PIN lock.
 *
 * The guarantees under test: the PIN is never stored in plaintext, changing or
 * disabling requires the current PIN, and a forgotten PIN has a recovery path
 * that does not destroy application data.
 */

beforeEach(() => {
  localStorage.clear()
})

describe('PIN shape', () => {
  it('accepts 4–8 digits', () => {
    expect(isValidPin('1234')).toBe(true)
    expect(isValidPin('12345678')).toBe(true)
  })

  it.each(['123', '123456789', 'abcd', '12a4', '', ' 1234', '12 34'])('rejects %j', (pin) => {
    expect(isValidPin(pin)).toBe(false)
  })

  it('states the constraint in the error', async () => {
    await expect(createLockRecord('12')).rejects.toThrow(new RegExp(`${MIN_PIN_LENGTH}.*${MAX_PIN_LENGTH}`))
  })
})

describe('storage never contains the plaintext PIN', () => {
  it('stores only a salt, a hash and metadata', async () => {
    await setPin('246810')
    const raw = localStorage.getItem('alhelm.v1.appLock') || ''
    expect(raw).not.toContain('246810')
    const parsed = JSON.parse(raw)
    expect(Object.keys(parsed).sort()).toEqual(['biometricEnabled', 'hash', 'idleMinutes', 'iterations', 'salt', 'version'])
  })

  it('produces a different hash for the same PIN on another device (unique salt)', async () => {
    const a = await createLockRecord('1234')
    const b = await createLockRecord('1234')
    expect(a.salt).not.toBe(b.salt)
    expect(a.hash).not.toBe(b.hash)
    // …but both verify.
    expect(await verifyPin('1234', a)).toBe(true)
    expect(await verifyPin('1234', b)).toBe(true)
  })
})

describe('verification', () => {
  it('accepts the correct PIN and rejects a wrong one', async () => {
    await setPin('1357')
    const record = readLockRecord()!
    expect(await verifyPin('1357', record)).toBe(true)
    expect(await verifyPin('1358', record)).toBe(false)
    expect(await verifyPin('9999', record)).toBe(false)
  })

  it('rejects malformed input without throwing', async () => {
    await setPin('1357')
    const record = readLockRecord()!
    expect(await verifyPin('', record)).toBe(false)
    expect(await verifyPin('abcd', record)).toBe(false)
  })

  it('rejects a corrupted record instead of unlocking', async () => {
    localStorage.setItem('alhelm.v1.appLock', 'not json')
    expect(readLockRecord()).toBeNull()
    expect(getLockSettings().enabled).toBe(false)
    expect(await verifyPin('1234', { version: 1, salt: 'x', hash: 'y', iterations: 1, biometricEnabled: false, idleMinutes: 5 })).toBe(false)
  })
})

describe('changing and disabling require the current PIN', () => {
  it('refuses a PIN change without the current PIN', async () => {
    await setPin('1111')
    await expect(setPin('2222')).rejects.toThrow(/current PIN is incorrect/)
    // The old PIN still works and the new one was not stored.
    const record = readLockRecord()!
    expect(await verifyPin('1111', record)).toBe(true)
    expect(await verifyPin('2222', record)).toBe(false)
  })

  it('refuses a PIN change with the wrong current PIN', async () => {
    await setPin('1111')
    await expect(setPin('2222', { currentPin: '9999' })).rejects.toThrow(/current PIN is incorrect/)
  })

  it('changes the PIN when the current one is correct', async () => {
    await setPin('1111')
    await setPin('2222', { currentPin: '1111' })
    const record = readLockRecord()!
    expect(await verifyPin('2222', record)).toBe(true)
    expect(await verifyPin('1111', record)).toBe(false)
  })

  it('refuses to disable with the wrong PIN', async () => {
    await setPin('1111')
    await expect(disableLock('0000')).rejects.toThrow(/current PIN is incorrect/)
    expect(getLockSettings().enabled).toBe(true)
  })

  it('disables with the correct PIN', async () => {
    await setPin('1111')
    await disableLock('1111')
    expect(getLockSettings().enabled).toBe(false)
    expect(readLockRecord()).toBeNull()
  })

  it('removing the lock never deletes application data', async () => {
    localStorage.setItem('alhelm.v1.tasks', JSON.stringify([{ id: 't1', title: 'Kept' }]))
    await setPin('1111')
    await disableLock('1111')
    expect(JSON.parse(localStorage.getItem('alhelm.v1.tasks') || '[]')).toHaveLength(1)
  })
})

describe('idle relock policy', () => {
  it('locks after the configured idle window', () => {
    const now = 10_000_000
    expect(shouldRelock(now - 6 * 60_000, 5, now)).toBe(true)
    expect(shouldRelock(now - 4 * 60_000, 5, now)).toBe(false)
  })

  it('never idles when idleMinutes is 0 (lock on background only)', () => {
    expect(shouldRelock(0, 0, 10_000_000)).toBe(false)
  })
})
