/**
 * Local app lock: PIN + optional biometric unlock.
 *
 * SECURITY MODEL
 *  - The PIN is NEVER stored. Only a salted PBKDF2-SHA-256 hash is persisted,
 *    with a per-device random salt and a version tag so it can be upgraded.
 *  - Hashing uses WebCrypto (available in the WebView and in Node tests), not a
 *    hand-rolled algorithm.
 *  - The lock is deliberately device-local: it protects this installation, so
 *    it is not part of the cloud snapshot and never travels between accounts or
 *    devices.
 *  - The hash lives in localStorage because no secure-storage plugin is
 *    installed. That is an accepted limitation for a *local convenience lock*
 *    (it is not protecting data at rest from a device-owner attacker) and is
 *    documented rather than papered over. Biometric verification, when
 *    available, is delegated to the OS and protected by the Keystore.
 *
 * RECOVERY
 *  - A forgotten PIN cannot be recovered — there is no server and no plaintext.
 *  - Instead of an unrecoverable dead end, "forgot PIN" requires an explicit
 *    confirmation and then signs out and clears the DEVICE LOCK ONLY. It never
 *    deletes tasks, subjects, or cloud data. If the user is signed in, the
 *    account re-authenticates through the provider and data is re-downloaded;
 *    a guest is told plainly that the local lock is being removed.
 */

const RECORD_KEY = 'alhelm.v1.appLock'
const ITERATIONS = 150_000
const VERSION = 1

export interface LockRecord {
  version: number
  salt: string
  hash: string
  iterations: number
  /** Whether biometric unlock is enabled for this device. */
  biometricEnabled: boolean
  /** Lock after this many minutes of inactivity (0 = on app background only). */
  idleMinutes: number
}

export interface LockSettings {
  enabled: boolean
  biometricEnabled: boolean
  idleMinutes: number
}

export const MIN_PIN_LENGTH = 4
export const MAX_PIN_LENGTH = 8

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** True when the PIN has the required shape: digits only, 4–8 long. */
export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${MIN_PIN_LENGTH},${MAX_PIN_LENGTH}}$`).test(pin)
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    key,
    256,
  )
  return toBase64(new Uint8Array(bits))
}

/** Creates a lock record. The PIN itself is not retained anywhere. */
export async function createLockRecord(
  pin: string,
  options: { biometricEnabled?: boolean; idleMinutes?: number } = {},
): Promise<LockRecord> {
  if (!isValidPin(pin)) throw new Error(`PIN must be ${MIN_PIN_LENGTH}–${MAX_PIN_LENGTH} digits.`)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return {
    version: VERSION,
    salt: toBase64(salt),
    hash: await derive(pin, salt, ITERATIONS),
    iterations: ITERATIONS,
    biometricEnabled: options.biometricEnabled === true,
    idleMinutes: Math.max(0, Math.min(60, options.idleMinutes ?? 5)),
  }
}

/** Constant-time-ish comparison of the derived hash. */
export async function verifyPin(pin: string, record: LockRecord): Promise<boolean> {
  if (!isValidPin(pin) || !record?.salt || !record?.hash) return false
  try {
    const candidate = await derive(pin, fromBase64(record.salt), record.iterations || ITERATIONS)
    if (candidate.length !== record.hash.length) return false
    let diff = 0
    for (let i = 0; i < candidate.length; i += 1) diff |= candidate.charCodeAt(i) ^ record.hash.charCodeAt(i)
    return diff === 0
  } catch {
    return false
  }
}

export function readLockRecord(): LockRecord | null {
  try {
    const raw = localStorage.getItem(RECORD_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LockRecord
    if (!parsed || typeof parsed.hash !== 'string' || typeof parsed.salt !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export function saveLockRecord(record: LockRecord): void {
  localStorage.setItem(RECORD_KEY, JSON.stringify(record))
}

/** Removes the device lock. Does NOT touch application data. */
export function clearLockRecord(): void {
  try { localStorage.removeItem(RECORD_KEY) } catch { /* storage unavailable */ }
}

export function getLockSettings(): LockSettings {
  const record = readLockRecord()
  return {
    enabled: Boolean(record),
    biometricEnabled: record?.biometricEnabled === true,
    idleMinutes: record?.idleMinutes ?? 5,
  }
}

/** Enables the lock, or replaces the PIN after the current one is verified. */
export async function setPin(
  pin: string,
  options: { currentPin?: string; biometricEnabled?: boolean; idleMinutes?: number } = {},
): Promise<void> {
  const existing = readLockRecord()
  if (existing) {
    // Changing an existing PIN requires proof of the old one.
    if (!options.currentPin || !(await verifyPin(options.currentPin, existing))) {
      throw new Error('The current PIN is incorrect.')
    }
  }
  saveLockRecord(await createLockRecord(pin, {
    biometricEnabled: options.biometricEnabled ?? existing?.biometricEnabled ?? false,
    idleMinutes: options.idleMinutes ?? existing?.idleMinutes ?? 5,
  }))
}

/** Disables the lock. Requires the current PIN when one is set. */
export async function disableLock(currentPin: string): Promise<void> {
  const existing = readLockRecord()
  if (!existing) return
  if (!(await verifyPin(currentPin, existing))) throw new Error('The current PIN is incorrect.')
  clearLockRecord()
}

/**
 * Inactivity policy.
 * Returns true when the app should re-lock given the last-unlock timestamp.
 */
export function shouldRelock(lastUnlockedAt: number, idleMinutes: number, now = Date.now()): boolean {
  if (idleMinutes <= 0) return false
  return now - lastUnlockedAt >= idleMinutes * 60_000
}
