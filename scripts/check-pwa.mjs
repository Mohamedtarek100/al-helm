import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
const dist = resolve('dist')
const manifestPath = resolve(dist, 'manifest.webmanifest')
const htmlPath = resolve(dist, 'index.html')
const workerPath = resolve(dist, 'sw.js')
const failures = []
for (const path of [manifestPath, htmlPath, workerPath]) if (!existsSync(path)) failures.push(`Missing build output: ${path}`)
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.display !== 'standalone') failures.push('Manifest display must be standalone.')
  for (const icon of manifest.icons ?? []) if (!existsSync(resolve(dist, icon.src.replace(/^\.\//, '')))) failures.push(`Missing manifest icon: ${icon.src}`)
}
if (existsSync(htmlPath)) {
  const html = readFileSync(htmlPath, 'utf8')
  if (!html.includes('manifest.webmanifest')) failures.push('Built HTML does not link the manifest.')
  if (html.includes('src="/src/main.tsx"')) failures.push('Built HTML retains development entrypoint.')
}
if (existsSync(workerPath)) {
  const worker = readFileSync(workerPath, 'utf8')
  if (!worker.includes("addEventListener('activate'")) failures.push('Service worker has no activate lifecycle.')
  if (!worker.includes("addEventListener('push'")) console.warn('No push handler present (background delivery is not configured).')
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1) }
console.log('PWA build artifacts and manifest references verified locally; deployment is not verified.')
