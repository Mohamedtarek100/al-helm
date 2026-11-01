// Build an APK signing lineage (Proof-of-Rotation) from the ORIGINAL debug key
// to the permanent Al-Helm release key, then sign a migration APK with it.
//
// Passwords are read from the existing keystore.properties files and passed to
// the child process environment / args without ever being echoed. Never prints
// a password.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = process.cwd()
const buildToolsRoot = 'D:/Dev/Android/Sdk/build-tools'
const versions = execFileSync('node', ['-e', `console.log(require('fs').readdirSync(${JSON.stringify(buildToolsRoot)}).sort().reverse().join('\\n'))`], { encoding: 'utf8' }).split('\n').filter(Boolean)
const apksigner = join(buildToolsRoot, versions[0], 'apksigner.bat')

const props = Object.fromEntries(
  readFileSync('C:/Users/user/.al-helm-keystore/keystore.properties', 'utf8')
    .split(/\r?\n/).filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => { const i = line.indexOf('='); return [line.slice(0, i).trim(), line.slice(i + 1).trim()] }),
)

const DEBUG_KS = 'C:/Users/user/.android/debug.keystore'
const DEBUG_ALIAS = 'androiddebugkey'
const DEBUG_PASS = 'android'

const work = join(tmpdir(), 'rotation')
mkdirSync(work, { recursive: true })
const lineageOut = join(work, 'lineage.bin')

if (!existsSync(DEBUG_KS)) {
  console.error('BLOCKED: original debug keystore not found at', DEBUG_KS)
  process.exit(1)
}

const run = (args, label) => {
  console.log(`\n>> ${label}`)
  try {
    const out = execFileSync('cmd.exe', ['/c', apksigner, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    if (out.trim()) console.log(out.trim())
    return out
  } catch (error) {
    console.error(`${label} FAILED`)
    const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim()
    if (detail) console.error(detail)
    process.exit(1)
  }
}

// 1. Create the lineage: debug (old) -> Al-Helm (new).
run([
  'rotate',
  '--out', lineageOut,
  '--old-signer', '--ks', DEBUG_KS, '--ks-key-alias', DEBUG_ALIAS, '--ks-pass', `pass:${DEBUG_PASS}`,
  '--new-signer', '--ks', props.storeFile, '--ks-key-alias', props.keyAlias, '--ks-pass', `pass:${props.storePassword}`,
], 'create signing lineage (debug -> Al-Helm)')

console.log('\nlineage written:', lineageOut)

// 2. Sign the migration APK with the lineage. `apksigner sign` stamps v2 + v3
//    and embeds the proof-of-rotation, which is what lets a device that holds
//    the OLD certificate accept this build.
const unsigned = join(work, 'app-release-unsigned.apk')
const migration = join(work, '4ulife-migration-sign.apk')

run([
  'sign',
  '--ks', props.storeFile, '--ks-key-alias', props.keyAlias, '--ks-pass', `pass:${props.storePassword}`,
  '--key-pass', `pass:${props.keyPassword}`,
  // v1 (JAR) signing must ALSO be stamped with the OLDEST signer in the
  // lineage, otherwise apksigner refuses: a v1 signature is a single JAR
  // signature and can only come from one key. Providing the debug key lets the
  // build carry v1 for very old devices, while v3 carries the rotation proof.
  '--next-signer', '--ks', DEBUG_KS, '--ks-key-alias', DEBUG_ALIAS, '--ks-pass', `pass:${DEBUG_PASS}`,
  '--lineage', lineageOut,
  '--v1-signing-enabled', 'true',
  '--v2-signing-enabled', 'true',
  '--v3-signing-enabled', 'true',
  '--out', migration,
  join(root, 'android/app/build/outputs/apk/release/app-release.apk'),
], 'sign APK with lineage')

copyFileSync(migration, join(work, 'signed-lineage.apk'))
console.log('\nsigned migration APK:', migration)
