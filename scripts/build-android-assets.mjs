#!/usr/bin/env node
/**
 * Builds the web assets intended for the Capacitor Android WebView.
 *
 * WHY THIS EXISTS
 *   The GitHub Pages build needs an absolute base (`/al-helm-app/`). The Android
 *   WebView loads files from `https://localhost/` inside the APK, so an absolute
 *   Pages base would make every script 404 and the app would open white.
 *
 *   `android:sync` used to run a plain `npm run build`, which silently inherited
 *   whatever `VITE_BASE_PATH` happened to be exported in the shell. This script
 *   forces the Android base to `./` regardless of the ambient environment, so the
 *   two targets can never bleed into each other.
 *
 *   It also fails loudly if the resulting index.html references an absolute
 *   `/al-helm-app/` path, or if any referenced local asset is missing.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const dist = join(root, 'dist')

// Hard-pin the base for this build target; ignore an inherited value.
const env = { ...process.env, VITE_BASE_PATH: './' }

console.log('Building Android assets with VITE_BASE_PATH=./')
const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', env, shell: true, cwd: root })
if (build.status !== 0) {
  console.error('Build failed; not touching the Android project.')
  process.exit(build.status ?? 1)
}

const indexPath = join(dist, 'index.html')
if (!existsSync(indexPath)) {
  console.error('dist/index.html missing after build.')
  process.exit(1)
}
const html = readFileSync(indexPath, 'utf8')

// 1. No absolute Pages prefix may survive into a native build.
if (html.includes('/al-helm-app/')) {
  console.error('FAIL: dist/index.html still references /al-helm-app/ — this build is not Android-safe.')
  process.exit(1)
}

// 2. Every referenced local script/style must exist on disk.
const refs = [...html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)].map((m) => m[1])
if (refs.length === 0) {
  console.error('FAIL: no asset references found in dist/index.html.')
  process.exit(1)
}
const assetsDir = join(dist, 'assets')
const present = new Set(existsSync(assetsDir) ? readdirSync(assetsDir) : [])
const missing = refs
  .map((r) => r.split('/').pop())
  .filter((name) => name && !present.has(name))

if (missing.length) {
  console.error('FAIL: referenced assets missing from dist/assets:', missing.join(', '))
  process.exit(1)
}

console.log(`OK: ${refs.length} local asset reference(s) verified, relative base in use.`)
console.log(refs.join('\n'))
