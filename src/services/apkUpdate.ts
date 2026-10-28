import { Capacitor } from '@capacitor/core'

/**
 * APK update availability.
 *
 * Separate from the OTA service in `ota.ts`: that updates the web bundle inside
 * the installed APK, while this reports that a whole new APK exists — needed
 * when native code, plugins or the manifest changed (as they just did for the
 * OAuth intent filter).
 *
 * Safety rules:
 *  - The manifest URL is fixed and HTTPS. The user is only ever LINKED to a
 *    download; the app never downloads or installs an APK itself.
 *  - Unreachable, malformed or untrusted manifests resolve to "no update"
 *    rather than an error the user must dismiss.
 *  - A dismissed optional update stays dismissed for that exact version, so the
 *    banner cannot nag on every launch.
 */

export const APK_MANIFEST_URL = 'https://mohamedtarek100.github.io/al-helm-app/ota/apk-manifest.json'
const DISMISS_KEY = 'alhelm.v1.dismissedApkVersion'

export interface ApkManifest {
  version: string
  versionCode: number
  apkUrl: string
  minSupportedVersion?: string
  notes?: string
}

export interface UpdateCheckResult {
  /** A newer version is available. */
  available: boolean
  current: string | null
  latest: string | null
  manifest: ApkManifest | null
  /** The user dismissed this exact version. */
  dismissed: boolean
  reason?: 'not-native' | 'no-manifest' | 'invalid-manifest' | 'up-to-date' | 'available' | 'dismissed'
}

/** Compares dotted numeric versions. Returns 1, 0 or -1. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => String(value).split('.').map((part) => Number.parseInt(part, 10)).map((n) => (Number.isFinite(n) ? n : 0))
  const left = parse(a)
  const right = parse(b)
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i += 1) {
    const l = left[i] ?? 0
    const r = right[i] ?? 0
    if (l > r) return 1
    if (l < r) return -1
  }
  return 0
}

/** True for an https URL that points at a `.apk`. */
export function isTrustedApkUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && /\.apk$/i.test(url.pathname)
  } catch {
    return false
  }
}

/** Validates an untrusted manifest payload; returns null when unusable. */
export function parseApkManifest(raw: unknown): ApkManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const version = typeof value.version === 'string' ? value.version.trim() : ''
  const versionCode = Number(value.versionCode)
  if (!/^\d+(\.\d+)*$/.test(version)) return null
  if (!Number.isInteger(versionCode) || versionCode < 1) return null
  if (!isTrustedApkUrl(value.apkUrl)) return null
  const notes = typeof value.notes === 'string' ? value.notes.slice(0, 400) : undefined
  const minSupportedVersion = typeof value.minSupportedVersion === 'string' ? value.minSupportedVersion : undefined
  return { version, versionCode, apkUrl: value.apkUrl as string, notes, minSupportedVersion }
}

export function getDismissedVersion(): string | null {
  try { return localStorage.getItem(DISMISS_KEY) } catch { return null }
}

export function dismissVersion(version: string): void {
  try { localStorage.setItem(DISMISS_KEY, version) } catch { /* storage unavailable */ }
}

/**
 * Checks for a newer APK.
 *
 * `currentVersion` is the installed app version (from Capacitor). On web this
 * is always "not applicable" — a browser install is a PWA, not an APK.
 */
export async function checkApkUpdate(options: {
  currentVersion: string | null
  platform?: string
  fetchImpl?: typeof fetch
  dismissed?: string | null
}): Promise<UpdateCheckResult> {
  const platform = options.platform ?? Capacitor.getPlatform()
  const current = options.currentVersion
  if (platform !== 'android' || !current) {
    return { available: false, current, latest: null, manifest: null, dismissed: false, reason: 'not-native' }
  }
  const fetchImpl = options.fetchImpl ?? fetch
  let manifest: ApkManifest | null = null
  try {
    const response = await fetchImpl(APK_MANIFEST_URL, { cache: 'no-store' })
    if (!response.ok) throw new Error(String(response.status))
    manifest = parseApkManifest(await response.json())
  } catch {
    return { available: false, current, latest: null, manifest: null, dismissed: false, reason: 'no-manifest' }
  }
  if (!manifest) return { available: false, current, latest: null, manifest: null, dismissed: false, reason: 'invalid-manifest' }

  const newer = compareVersions(manifest.version, current) > 0
  const dismissedVersion = options.dismissed ?? getDismissedVersion()
  const dismissed = newer && dismissedVersion === manifest.version
  return {
    available: newer,
    current,
    latest: manifest.version,
    manifest,
    dismissed,
    reason: !newer ? 'up-to-date' : dismissed ? 'dismissed' : 'available',
  }
}
