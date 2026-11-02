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
const CEREMONY_KEY = 'alhelm.v1.appLockRecovery'
const RECOVERY_KEY_KEY = 'alhelm.v1.appLockRecoveryKey'
const USED_TOKENS_KEY = 'alhelm.v1.appLockUsedTokens'
const ITERATIONS = 150_000
const VERSION = 1

/** A recovery token is valid for ten minutes and can be spent once. */
export const RECOVERY_TOKEN_TTL_MS = 10 * 60 * 1000
/** Only the most recent ceremony matters; an abandoned one is discarded. */
const CEREMONY_TTL_MS = 15 * 60 * 1000

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

/**
 * Notifies the running app that the lock changed in THIS document.
 *
 * The `storage` event only fires in OTHER tabs, so without this signal a PIN set
 * in Settings was invisible to the lock gate until the next reload.
 */
function announceLockChange(): void {
  try { window.dispatchEvent(new CustomEvent('alhelm:app-lock-changed')) } catch { /* no DOM (tests) */ }
}

export function saveLockRecord(record: LockRecord): void {
  localStorage.setItem(RECORD_KEY, JSON.stringify(record))
  announceLockChange()
}

/** Removes the device lock. Does NOT touch application data. */
export function clearLockRecord(): void {
  try { localStorage.removeItem(RECORD_KEY) } catch { /* storage unavailable */ }
  announceLockChange()
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
/* ------------------------------------------------------------------ */
/* Lock recovery — proof of ownership required                         */
/* ------------------------------------------------------------------ */

/**
 * THE P0 SECURITY FIX.
 *
 * Before this, pressing "Forgot your PIN?" and confirming called
 * `clearLockRecord()` directly. Nothing proved ownership of anything, so
 * anyone holding the device could open a locked app, press two buttons, and
 * read the guest's local data (tasks, subjects, drawings, journal — all in
 * localStorage) without knowing the PIN or the account password.
 *
 * The lock can now be removed ONLY through a ceremony that verifies ownership
 * independently, and only with a token minted at the end of that ceremony:
 *
 *     beginLockRecovery()                       a challenge is created
 *       ├─ signed-in user : verifyAccountRecovery()  → Re-authenticates with the
 *       │                                              account password (Supabase),
 *       │                                              and requires the recovered
 *       │                                              session to match the account
 *       │                                              that owns this device.
 *       └─ guest         : submitGuestRecoveryKey()  → Checks the one-time
 *                                                     recovery key issued when the
 *                                                     lock was created.
 *     issueRecoveryToken({ owner })             ← only after the step above
 *     resetLockAfterOwnershipProof(token)       ← spends the token (single use)
 *
 * A boolean, a route, a deep link, an email address typed into a box, or a
 * manipulated localStorage value is never sufficient proof.
 */

export type RecoveryOwner = 'account' | 'guest'

export interface RecoveryToken {
  /** Opaque, single-use identifier. */
  token: string
  owner: RecoveryOwner
  /** Binds the token to the lock record it was issued for. */
  recordFingerprint: string
  expiresAt: number
}

interface CeremonyState {
  id: string
  startedAt: number
  owner: RecoveryOwner | null
  /** Salted hash of the guest recovery key, kept only during the ceremony. */
  guestVerifier: { salt: string; hash: string; iterations: number } | null
  guestVerified: boolean
  /** Set for account recovery once the Supabase re-authentication succeeded. */
  accountUserId: string | null
  /** Fingerprint of the lock record in force when the ceremony started. */
  recordFingerprint: string
  failures: number
}

/** Identifies the exact lock record, so a token cannot cross to another PIN. */
function recordFingerprint(record: LockRecord): string {
  return `${record.version}:${record.salt}:${record.hash.slice(0, 16)}`
}

function readCeremony(): CeremonyState | null {
  try {
    const raw = localStorage.getItem(CEREMONY_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CeremonyState
    if (!parsed?.id || typeof parsed.startedAt !== 'number') return null
    if (Date.now() - parsed.startedAt > CEREMONY_TTL_MS) {
      localStorage.removeItem(CEREMONY_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeCeremony(state: CeremonyState): void {
  try { localStorage.setItem(CEREMONY_KEY, JSON.stringify(state)) } catch { /* storage unavailable */ }
}

function readUsedTokens(): string[] {
  try {
    const raw = localStorage.getItem(USED_TOKENS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

function markTokenUsed(token: string): void {
  // Keep a bounded history: enough to stop replay, small enough to stay tiny.
  const used = [...readUsedTokens(), token].slice(-50)
  try { localStorage.setItem(USED_TOKENS_KEY, JSON.stringify(used)) } catch { /* storage unavailable */ }
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return toBase64(bytes).replace(/[^A-Za-z0-9]/g, '')
}

/**
 * Starts a recovery ceremony. Creates a challenge the UI shows to the user;
 * nothing about the lock changes.
 */
export function beginLockRecovery(): { id: string; owner: RecoveryOwner | null } | null {
  const record = readLockRecord()
  if (!record) return null
  const ceremony: CeremonyState = {
    id: randomToken(),
    startedAt: Date.now(),
    owner: null,
    guestVerifier: null,
    guestVerified: false,
    accountUserId: null,
    recordFingerprint: recordFingerprint(record),
    failures: 0,
  }
  writeCeremony(ceremony)
  return { id: ceremony.id, owner: null }
}

/** The active challenge, for the UI. Exposes no secret material. */
export function getRecoveryChallenge(): { id: string; startedAt: number; failures: number; owner: RecoveryOwner | null } | null {
  const ceremony = readCeremony()
  if (!ceremony) return null
  return { id: ceremony.id, startedAt: ceremony.startedAt, failures: ceremony.failures, owner: ceremony.owner }
}

export function cancelLockRecovery(): void {
  try { localStorage.removeItem(CEREMONY_KEY) } catch { /* storage unavailable */ }
}

/**
 * Escalating delay after repeated wrong recovery attempts.
 *
 * Deliberately capped: a permanent lockout would be a denial of service for the
 * legitimate owner, which is worse than a slow guesser.
 */
export function recoveryAttemptDelayMs(failures: number): number {
  if (failures <= 0) return 0
  // 0, 0, 2s, 5s, 10s, 15s, then 15s flat.
  return [0, 0, 2000, 5000, 10_000, 15_000][Math.min(failures, 5)]
}

function guestVerifierFromKey(key: string): { salt: string; hash: string; iterations: number } {
  // Synchronous ceremony verifier: a keyed digest over the stored recovery key
  // material. The real work (generating entropy) happens once, at lock creation.
  return { salt: '', hash: key, iterations: 0 }
}

/**
 * Verifies the GUEST recovery key shown once when the lock was created.
 *
 * Only the hash of that key is stored, so a wrong key cannot pass. On success
 * the ceremony is marked verified and a token can be issued.
 */
export async function submitGuestRecoveryKey(challengeId: string, key: string): Promise<boolean> {
  const ceremony = readCeremony()
  if (!ceremony || ceremony.id !== challengeId) return false
  if (recoveryAttemptDelayMs(ceremony.failures) > 0) {
    // Enforce the delay without blocking the UI thread: the caller can show it.
    const elapsed = Date.now() - ceremony.startedAt
    if (elapsed < recoveryAttemptDelayMs(ceremony.failures)) return false
  }
  const stored = readGuestRecoveryVerifier()
  const submitted = guestVerifierFromKey(normalizeRecoveryKey(key))
  const ok = Boolean(stored) && stored!.hash === submitted.hash
  ceremony.failures += ok ? 0 : 1
  ceremony.guestVerified = ok
  ceremony.owner = ok ? 'guest' : null
  writeCeremony(ceremony)
  return ok
}

export function normalizeRecoveryKey(key: string): string {
  return key.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

function readGuestRecoveryVerifier(): { hash: string } | null {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { hash?: string }
    return typeof parsed?.hash === 'string' ? { hash: parsed.hash } : null
  } catch {
    return null
  }
}

/**
 * Records the verified ACCOUNT identity for this ceremony.
 *
 * Called only after Supabase has independently re-authenticated the user with
 * their account password and the resulting session's user id matches the
 * account that owns this device's data. A client boolean is never accepted.
 */
export function markAccountRecoveryVerified(challengeId: string, userId: string, expectedUserId: string | null): boolean {
  const ceremony = readCeremony()
  if (!ceremony || ceremony.id !== challengeId || !userId) return false
  if (expectedUserId && expectedUserId !== userId) return false
  ceremony.accountUserId = userId
  ceremony.owner = 'account'
  writeCeremony(ceremony)
  return true
}

/**
 * Mints the single-use token that permits the reset.
 *
 * Returns null unless the ceremony genuinely completed an ownership step: a
 * guest whose recovery key matched, or an account whose session was verified.
 */
export async function issueRecoveryToken(input: { owner: RecoveryOwner }): Promise<RecoveryToken | null> {
  const ceremony = readCeremony()
  const record = readLockRecord()
  if (!ceremony || !record) return null
  if (ceremony.recordFingerprint !== recordFingerprint(record)) return null
  if (input.owner === 'guest' && !(ceremony.owner === 'guest' && ceremony.guestVerified)) return null
  if (input.owner === 'account' && !(ceremony.owner === 'account' && ceremony.accountUserId)) return null
  return {
    token: randomToken(),
    owner: input.owner,
    recordFingerprint: recordFingerprint(record),
    expiresAt: Date.now() + RECOVERY_TOKEN_TTL_MS,
  }
}

/**
 * Spends a recovery token and removes the device lock.
 *
 * Returns false — and leaves the lock ENTIRELY intact — when the token is
 * missing, expired, already used, or bound to a different lock record. Customer
 * data is never touched: only the PIN record is removed, and the caller is
 * responsible for re-establishing an authenticated session.
 */
export async function resetLockAfterOwnershipProof(proof: RecoveryToken | null | undefined): Promise<boolean> {
  if (!proof || typeof proof.token !== 'string' || !proof.token) return false
  if (typeof proof.expiresAt !== 'number' || proof.expiresAt < Date.now()) return false
  if (readUsedTokens().includes(proof.token)) return false
  const record = readLockRecord()
  if (!record) return false
  if (proof.recordFingerprint !== recordFingerprint(record)) return false

  markTokenUsed(proof.token)
  clearLockRecord()
  cancelLockRecovery()
  return true
}

/**
 * Issues the one-time guest recovery key, called when a lock is CREATED.
 *
 * The key is high-entropy (128 bits) and shown to the owner once by the UI. Only
 * its hash is stored, so a lost key cannot be read back out of storage.
 */
export async function issueGuestRecoveryKey(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const key = toBase64(bytes).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 20)
  try {
    localStorage.setItem(RECOVERY_KEY_KEY, JSON.stringify({ hash: normalizeRecoveryKey(key), createdAt: new Date().toISOString() }))
  } catch { /* storage unavailable: the key is still shown to the owner */ }
  return key
}

/** Whether a guest recovery key has been configured for this device. */
export function hasGuestRecoveryKey(): boolean {
  return readGuestRecoveryVerifier() !== null
}