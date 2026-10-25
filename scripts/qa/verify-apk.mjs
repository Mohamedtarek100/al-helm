import fs from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

// 1. Build outcome
const log = fs.readFileSync('build-apk.log', 'utf8')
const outcome = log.split('\n').filter((l) => /BUILD SUCCESSFUL|BUILD FAILED/.test(l)).join(' ').trim()
console.log('GRADLE:', outcome || '(no outcome line found)')

// 2. APK presence + integrity
const apkPath = path.join('android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
const buf = fs.readFileSync(apkPath)
const sha = createHash('sha256').update(buf).digest('hex')
console.log('APK     :', apkPath)
console.log('SIZE    :', buf.length, 'bytes =', (buf.length / 1024 / 1024).toFixed(2), 'MB')
console.log('SHA-256 :', sha)

// 3. The bundled web assets must contain this session's code
const assetsDir = path.join('android', 'app', 'src', 'main', 'assets', 'public', 'assets')
const jsFiles = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'))
let focusFound = false
let stackFound = false
for (const f of jsFiles) {
  const text = fs.readFileSync(path.join(assetsDir, f), 'utf8')
  if (text.includes('exitFullScreen') || text.includes('sketch-studio--focus')) focusFound = true
  if (text.includes('destination-over') || text.includes('destination-out')) stackFound = true
}
console.log('focus-mode code in APK assets :', focusFound ? 'YES' : 'NO')
console.log('eraser compositing in APK     :', stackFound ? 'YES' : 'NO')

// 4. Version metadata
const gradle = fs.readFileSync(path.join('android', 'app', 'build.gradle'), 'utf8')
const vc = /versionCode\s+(\d+)/.exec(gradle)?.[1]
const vn = /versionName\s+"([^"]+)"/.exec(gradle)?.[1]
const appId = /applicationId\s+"([^"]+)"/.exec(gradle)?.[1]
console.log('applicationId :', appId)
console.log('version       :', vn, '(code', vc + ')')
