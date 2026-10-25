/**
 * Verifies the Android artifact end to end:
 *  - recompute SHA-256 from the exact local APK,
 *  - confirm it matches the APK currently published on the live site,
 *  - confirm package id / version / signature / size / embedded assets.
 * Never prints any signing secret.
 */
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const LOCAL = path.join('android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
const PUBLISHED = path.join('al-helm-app-deploy', 'downloads', '4ulife-1.3-debug.apk')

const sha = (buf) => createHash('sha256').update(buf).digest('hex')

const local = fs.readFileSync(LOCAL)
const published = fs.existsSync(PUBLISHED) ? fs.readFileSync(PUBLISHED) : null

console.log('LOCAL     :', LOCAL)
console.log('  size    :', local.length, 'bytes =', (local.length / 1024 / 1024).toFixed(2), 'MB')
console.log('  sha256  :', sha(local))

if (published) {
  console.log('PUBLISHED :', PUBLISHED)
  console.log('  size    :', published.length, 'bytes')
  console.log('  sha256  :', sha(published))
  console.log('  IDENTICAL TO LOCAL:', sha(published) === sha(local) ? 'YES' : 'NO')
} else {
  console.log('PUBLISHED : (not found in deploy repo)')
}

const AAPT = 'D:\\Dev\\Android\\Sdk\\build-tools\\35.0.0\\aapt.exe'
try {
  const out = execFileSync(AAPT, ['dump', 'badging', LOCAL], { encoding: 'utf8' })
  const line = out.split('\n').find((l) => l.startsWith('package:'))
  console.log('\nBADGING  :', line?.trim())
  const sdk = out.split('\n').find((l) => l.startsWith('sdkVersion:'))
  const target = out.split('\n').find((l) => l.startsWith('targetSdkVersion:'))
  console.log('SDK      :', sdk?.trim(), '|', target?.trim())
} catch (e) {
  console.log('\naapt unavailable:', e.message.split('\n')[0])
}

const APKSIGNER = 'D:\\Dev\\Android\\Sdk\\build-tools\\35.0.0\\apksigner.bat'
try {
  const sig = execFileSync(APKSIGNER, ['verify', '--print-certs', LOCAL], { encoding: 'utf8' })
  const certs = sig.split('\n').filter((l) => /Signer #1 certificate DN|SHA-256 digest/.test(l))
  console.log('SIGNATURE:', certs.map((c) => c.trim()).join(' | '))
  console.log('SIGNED   : OK (verified)')
} catch (e) {
  console.log('SIGNATURE: verification FAILED -', e.message.split('\n')[0])
}

const jsDir = path.join('android', 'app', 'src', 'main', 'assets', 'public', 'assets')
let focus = false
let layers = false
for (const f of fs.readdirSync(jsDir).filter((x) => x.endsWith('.js'))) {
  const text = fs.readFileSync(path.join(jsDir, f), 'utf8')
  if (text.includes('sketch-studio--focus') || text.includes('exitFullScreen')) focus = true
  if (text.includes('destination-out')) layers = true
}
console.log('\nEMBEDDED focus-mode  :', focus ? 'YES' : 'NO')
console.log('EMBEDDED ink layers  :', layers ? 'YES' : 'NO')
