#!/usr/bin/env node
/**
 * Builds the web assets published to GitHub Pages.
 *
 * Pins `VITE_BASE_PATH=/al-helm-app/` explicitly (Node sets env vars
 * portably, unlike inline `VAR=value cmd` which fails under PowerShell).
 * Mirrors build-android-assets.mjs: the two targets must never share a base.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const BASE = '/al-helm-app/'

console.log(`Building web assets with VITE_BASE_PATH=${BASE}`)
const build = spawnSync('npm', ['run', 'build'], {
  stdio: 'inherit',
  shell: true,
  cwd: root,
  env: { ...process.env, VITE_BASE_PATH: BASE },
})
if (build.status !== 0) process.exit(build.status ?? 1)

const indexPath = join(root, 'dist', 'index.html')
if (!existsSync(indexPath)) {
  console.error('dist/index.html missing after build.')
  process.exit(1)
}
const html = readFileSync(indexPath, 'utf8')

// The Pages build MUST carry the absolute base, or asset URLs break on GitHub.
if (!html.includes(BASE)) {
  console.error(`FAIL: web build does not reference ${BASE}.`)
  process.exit(1)
}
console.log('OK: web build uses the /al-helm-app/ base.')
