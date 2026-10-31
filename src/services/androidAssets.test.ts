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
const DIST = join(process.cwd(), 'dist')

const htmlPath = join(ANDROID_PUBLIC, 'index.html')
const hasAndroidAssets = existsSync(htmlPath)
const hasDist = existsSync(join(DIST, 'index.html'))

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

describe('Android package is not stale relative to dist', () => {
  it.skipIf(!hasAndroidAssets || !hasDist)('packages the same entry bundle the current dist built', () => {
    const androidHtml = readFileSync(htmlPath, 'utf8')
    const distHtml = readFileSync(join(DIST, 'index.html'), 'utf8')
    const entry = (html: string) => (html.match(/assets\/(index-[\w-]+\.js)/) ?? [])[1]
    // A mismatch means `cap sync` was run against an older dist — the exact
    // defect that shipped a white-screen APK.
    expect(entry(androidHtml)).toBe(entry(distHtml))
  })
})
