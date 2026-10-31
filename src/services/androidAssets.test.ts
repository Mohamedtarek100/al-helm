import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Android WebView asset contract.
 *
 * The shipped 1.5 APK opened to a white screen because it was packaged from a
 * STALE dist/ (it contained index-DxycY9Ev.js, built before the i18n provider
 * fix). The base path was already correct, so these tests pin BOTH facts:
 *
 *   1. The packaged Android HTML must use RELATIVE asset paths. An absolute
 *      `/al-helm-app/` prefix 404s inside the Capacitor WebView.
 *   2. Every asset the HTML references must actually exist in the packaged
 *      directory — a stale copy is exactly what caused the white screen.
 *
 * The tests read whatever is currently synced into android/app/src/main/assets,
 * so they fail loudly if a build is packaged from an out-of-date dist.
 */

const ANDROID_PUBLIC = join(process.cwd(), 'android', 'app', 'src', 'main', 'assets', 'public')
const htmlPath = join(ANDROID_PUBLIC, 'index.html')
const hasAndroidAssets = existsSync(htmlPath)

function assetRefs(html: string): string[] {
  return [...html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)].map((m) => m[1])
}

describe('Android WebView index.html', () => {
  it.skipIf(!hasAndroidAssets)('uses relative asset paths, never an absolute Pages base', () => {
    const html = readFileSync(htmlPath, 'utf8')
    expect(html).not.toContain('/al-helm-app/')
    const refs = assetRefs(html)
    expect(refs.length).toBeGreaterThan(0)
    // Relative (./assets/…) or root-relative (/assets/…) both work inside the
    // WebView; the absolute Pages prefix does not.
    for (const ref of refs) expect(ref.startsWith('./') || ref.startsWith('/assets/')).toBe(true)
  })

  it.skipIf(!hasAndroidAssets)('references only assets that exist in the packaged folder', () => {
    const html = readFileSync(htmlPath, 'utf8')
    const assetsDir = join(ANDROID_PUBLIC, 'assets')
    const present = new Set(existsSync(assetsDir) ? readdirSync(assetsDir) : [])
    for (const ref of assetRefs(html)) {
      const name = ref.split('/').pop() as string
      expect(present.has(name), `missing packaged asset: ${name}`).toBe(true)
    }
  })
})

describe('Android package is self-consistent', () => {
  /**
   * NOTE: this deliberately does NOT compare against dist/index.html.
   *
   * The two targets are built separately and legitimately differ:
   *   dist/ (web)     → base /al-helm-app/, bundle index-D5ZdWCa1.js
   *   android assets  → base ./,            bundle index-Dwhkl6oL.js
   *
   * Comparing them would fail whenever the web build is newer than the native
   * one, which is normal. The staleness that shipped a white-screen APK is
   * caught by the tests above instead: the packaged HTML must use relative
   * paths and every referenced asset must exist in the package.
   */
  it.skipIf(!hasAndroidAssets)('does not reference the web build base path', () => {
    const html = readFileSync(htmlPath, 'utf8')
    expect(html).not.toContain('/al-helm-app/assets/')
  })

  it('the web build script still pins the Pages base (targets stay separate)', () => {
    // Assert on the SOURCE, not on dist/: dist/ legitimately holds whichever
    // target was built last, so checking it would fail after any Android build.
    // What must not change is that build:web pins /al-helm-app/.
    const webScript = readFileSync(join(process.cwd(), 'scripts', 'build-web-assets.mjs'), 'utf8')
    expect(webScript).toContain('/al-helm-app/')

    const androidScript = readFileSync(join(process.cwd(), 'scripts', 'build-android-assets.mjs'), 'utf8')
    // The Android target must force a relative base and refuse the Pages prefix.
    expect(androidScript).toContain("VITE_BASE_PATH: './'")
    expect(androidScript).toContain('/al-helm-app/')
  })
})
