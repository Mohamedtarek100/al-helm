import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'

/**
 * Zero-cost over-the-air updates for the bundled Android app.
 *
 * Architecture: @capgo/capacitor-updater in MANUAL mode against a static
 * manifest hosted on GitHub Pages (HTTPS, no server required).
 *
 * - Manifest:   https://mohamedtarek100.github.io/al-helm-app/ota/manifest.json
 * - Bundles:    https://mohamedtarek100.github.io/al-helm-app/ota/<version>.zip
 *
 * The manifest is JSON: { "version": "x.y.z", "url": "<zip url>",
 * "checksum": "<sha256>" }. The plugin downloads the zip, verifies the
 * checksum, stages it, and activates it on the next reload/restart. If the
 * new bundle fails to call notifyAppReady(), the plugin rolls back to the
 * last known-good bundle automatically.
 */

const MANIFEST_URL =
  'https://mohamedtarek100.github.io/al-helm-app/ota/manifest.json'

export interface Manifest {
  version: string
  url: string
  checksum: string
}

interface CurrentBundle {
  id: string
  version: string
}

/** The current bundle version, or 'builtin' when running the shipped code. */
export async function currentBundle(): Promise<CurrentBundle | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const bundle = await CapacitorUpdater.current()
    return { id: bundle.bundle.id, version: bundle.bundle.version }
  } catch {
    return null
  }
}

/**
 * Check the manifest, and if a newer version exists, download + verify +
 * stage it. Returns the version that was downloaded, or null when already
 * up to date / not applicable.
 */
export async function checkAndDownload(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null
  let manifest: Manifest
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-store' })
    if (!res.ok) return null
    manifest = (await res.json()) as Manifest
  } catch {
    return null // offline or unreachable: stay on current bundle
  }
  if (!manifest?.version || !manifest?.url) return null

  const current = await currentBundle()
  const currentVersion = current?.version ?? 'builtin'
  if (compareVersions(manifest.version, currentVersion) <= 0) return null

  try {
    await CapacitorUpdater.download({
      url: manifest.url,
      version: manifest.version,
      checksum: manifest.checksum,
    })
    return manifest.version
  } catch {
    return null // download/checksum failure: keep last known-good bundle
  }
}

/** Activate a previously downloaded bundle. Call after download succeeds. */
export async function applyPendingUpdate(version: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    await CapacitorUpdater.set({ id: version })
    await CapacitorUpdater.reload()
    return true
  } catch {
    return false
  }
}

/**
 * Confirm the running bundle is healthy. The plugin auto-deletes and rolls
 * back the active bundle if this is NOT called within the timeout window.
 */
export async function confirmBundleHealthy(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await CapacitorUpdater.notifyAppReady()
  } catch {
    /* plugin not available on web */
  }
}

/** Semver-ish comparison: negative if a < b, 0 if equal, positive if a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i += 1) {
    const va = pa[i] ?? 0
    const vb = pb[i] ?? 0
    if (va !== vb) return va - vb
  }
  return 0
}
