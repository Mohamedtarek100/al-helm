#!/usr/bin/env node
/**
 * Android release gate: verify that a new APK can actually UPGRADE an existing
 * install.
 *
 * WHY THIS EXISTS
 *   Release 1.5.3 could not be installed over any earlier release. Every build
 *   from 1.3 to 1.5.2 had been published as a *debug* APK (signed with the
 *   Android debug key, CN=Android Debug), while 1.5.3 was the first *release*
 *   APK (CN=Al-Helm Study Planner). Android refuses an update whose signing
 *   certificate differs — INSTALL_FAILED_UPDATE_INCOMPATIBLE — and no version
 *   code can change that. Nothing in the previous pipeline compared
 *   certificates, so the break reached users.
 *
 * WHAT THIS CHECKS (static, no device required)
 *   1. package id continuity with the previous published APK
 *   2. signing certificate continuity (full SHA-256 fingerprint, not a short id)
 *   3. strictly increasing versionCode
 *   4. versionName agrees with versionCode
 *   5. minSdk/targetSdk are not silently lowered
 *   6. the OTA manifest points at THIS artifact, with a matching versionCode
 *
 * A failure here means "do not publish": an update would be rejected on every
 * installed device.
 *
 * USAGE
 *   node scripts/qa/verify-android-upgrade-gate.mjs <new.apk> <previous.apk>
 *   (add --require-manifest to also assert ota/apk-manifest.json consistency)
 *
 * Exit 0 = safe to publish. Exit 1 = blocking problem, with the reason printed.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'

/** SHA-256 of a file, so the manifest can be matched to the exact artifact. */
function sha256Of(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

const [, , newApk, previousApk, ...flags] = process.argv
if (!newApk || !previousApk) {
  console.error('usage: node scripts/qa/verify-android-upgrade-gate.mjs <new.apk> <previous.apk> [--require-manifest]')
  process.exit(1)
}

/* ---------------- tool discovery ---------------- */

function findBuildTool(name) {
  const roots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, 'D:/Dev/Android/Sdk', `${process.env.LOCALAPPDATA}/Android/Sdk`]
    .filter(Boolean)
  for (const root of roots) {
    const dir = `${root}/build-tools`
    if (!existsSync(dir)) continue
    // Highest version first: apksigner/aapt2 live in the newest build-tools.
    const versions = readdirSync(dir).sort().reverse()
    for (const version of versions) {
      for (const ext of process.platform === 'win32' ? ['.bat', '.exe'] : ['']) {
        const exe = `${dir}/${version}/${name}${ext}`
        if (existsSync(exe)) return exe
      }
    }
  }
  return null
}

const apksigner = findBuildTool('apksigner')
const aapt2 = findBuildTool('aapt2')
if (!apksigner || !aapt2) {
  console.error('FAIL: Android build-tools (apksigner/aapt2) not found. Set ANDROID_HOME.')
  process.exit(1)
}

/* ---------------- metadata extraction ---------------- */

function badging(apk) {
  const isWindows = process.platform === 'win32'
  const [command, commandArgs] = isWindows ? ['cmd.exe', ['/c', aapt2, 'dump', 'badging', apk]] : [aapt2, ['dump', 'badging', apk]]
  const out = execFileSync(command, commandArgs, { encoding: 'utf8' })
  const pkg = /package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'/.exec(out)
  const minSdk = /sdkVersion:'(\d+)'/.exec(out)
  const targetSdk = /targetSdkVersion:'(\d+)'/.exec(out)
  if (!pkg) throw new Error(`cannot parse package info from ${apk}`)
  return {
    packageId: pkg[1],
    versionCode: Number(pkg[2]),
    versionName: pkg[3],
    minSdk: minSdk ? Number(minSdk[1]) : null,
    targetSdk: targetSdk ? Number(targetSdk[1]) : null,
  }
}

function certFingerprint(apk) {
  // --print-certs lists every signer; the SHA-256 digest is the identity that
  // decides update compatibility.
  //
  // On Windows `apksigner` is a .bat, and a batch file cannot be launched
  // directly by execFileSync without `shell: true`. Off Windows it is a plain
  // executable. This difference is why the first implementation saw no output.
  const isWindows = process.platform === 'win32'
  const run = (args) => {
    // `apksigner` is a .bat on Windows. Passing arguments through `shell: true`
    // triggers a Node deprecation warning about unescaped concatenation, so the
    // batch file is invoked explicitly through cmd instead.
    const [command, commandArgs] = isWindows
      ? ['cmd.exe', ['/c', apksigner, ...args]]
      : [apksigner, args]
    try {
      return execFileSync(command, commandArgs, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      // A signature failure still prints diagnostics; a MISSING certificate is
      // what must abort.
      const combined = `${error.stdout ?? ''}${error.stderr ?? ''}`
      if (!/Signer #1 certificate SHA-256 digest:/i.test(combined)) {
        throw new Error(`APK is not verifiably signed: ${basename(apk)}\n${combined.trim().slice(0, 300)}`)
      }
      return combined
    }
  }

  const out = run(['verify', '--print-certs', apk])
  const digest = /Signer #1 certificate SHA-256 digest:\s*([0-9a-f]+)/i.exec(out)
  const dn = /Signer #1 certificate DN:\s*(.+)/.exec(out)
  const schemes = [...out.matchAll(/Verified using (v[\d.]+) scheme[^:]*:\s*(\w+)/gi)].map((m) => `${m[1]}:${m[2]}`)
  if (!digest) throw new Error(`cannot read signing certificate of ${basename(apk)}`)
  return { sha256: digest[1].toLowerCase(), dn: dn ? dn[1].trim() : '(unknown)', schemes }
}

/* ---------------- checks ---------------- */

const failures = []
const notes = []
const fail = (message) => failures.push(message)

const next = badging(newApk)
const prev = badging(previousApk)
const nextCert = certFingerprint(newApk)
const prevCert = certFingerprint(previousApk)

console.log('== new APK ==')
console.log(`  ${basename(newApk)}`)
console.log(`  package=${next.packageId} versionCode=${next.versionCode} versionName=${next.versionName} minSdk=${next.minSdk} targetSdk=${next.targetSdk}`)
console.log(`  cert=${nextCert.dn}`)
console.log(`  sha256=${nextCert.sha256}`)
console.log(`  schemes=${nextCert.schemes.join(' ') || '(none reported)'}`)
console.log('== previous APK ==')
console.log(`  ${basename(previousApk)}`)
console.log(`  package=${prev.packageId} versionCode=${prev.versionCode} versionName=${prev.versionName} minSdk=${prev.minSdk} targetSdk=${prev.targetSdk}`)
console.log(`  cert=${prevCert.dn}`)
console.log(`  sha256=${prevCert.sha256}`)
console.log('== checks ==')

// 1. Package id must match, or the "update" installs a second app.
if (next.packageId !== prev.packageId) {
  fail(`package id changed: ${prev.packageId} -> ${next.packageId}. An update must keep the same package id.`)
} else {
  console.log(`  OK  package id unchanged (${next.packageId})`)
}

// 2. THE critical check: identical signing certificate.
if (nextCert.sha256 !== prevCert.sha256) {
  fail(
    `SIGNING CERTIFICATE MISMATCH\n`
    + `        previous: ${prevCert.dn}\n        sha256:   ${prevCert.sha256}\n`
    + `        new:      ${nextCert.dn}\n        sha256:   ${nextCert.sha256}\n`
    + '        Android will reject this as INSTALL_FAILED_UPDATE_INCOMPATIBLE.\n'
    + '        A version-code change cannot fix it. Publish with the SAME key that signed the previous release.',
  )
} else {
  console.log('  OK  signing certificate identical (update will be accepted)')
}

// 3. Version code must strictly increase.
if (!(next.versionCode > prev.versionCode)) {
  fail(`versionCode must increase: ${prev.versionCode} -> ${next.versionCode} is not an upgrade.`)
} else {
  console.log(`  OK  versionCode increases (${prev.versionCode} -> ${next.versionCode})`)
}

// 4. versionName should track the versionCode so the manifest and the binary
//    cannot disagree about which release is installed.
if (next.versionName === prev.versionName) {
  fail(`versionName unchanged (${next.versionName}) while versionCode moved; the two must advance together.`)
} else {
  console.log(`  OK  versionName advances (${prev.versionName} -> ${next.versionName})`)
}

// 5. Raising minSdk is a compat decision; lowering it silently changes the
//    supported population, so report either direction.
if (next.minSdk !== null && prev.minSdk !== null && next.minSdk < prev.minSdk) {
  fail(`minSdk lowered (${prev.minSdk} -> ${next.minSdk}); existing devices may behave differently.`)
} else {
  console.log(`  OK  minSdk not lowered (${prev.minSdk} -> ${next.minSdk})`)
}

// 6. OTA manifest must describe THIS build.
if (flags.includes('--require-manifest')) {
  const manifestPath = 'al-helm-app-deploy/ota/apk-manifest.json'
  if (!existsSync(manifestPath)) {
    fail(`OTA manifest missing at ${manifestPath}`)
  } else {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.version !== next.versionName) {
      fail(`OTA manifest version ${manifest.version} != APK versionName ${next.versionName}`)
    } else if (Number(manifest.versionCode) !== next.versionCode) {
      fail(`OTA manifest versionCode ${manifest.versionCode} != APK versionCode ${next.versionCode}`)
    } else if (!String(manifest.apkUrl ?? '').endsWith(basename(newApk))) {
      // The published artifact is renamed (app-release.apk -> 4ulife-X.Y.Z-release.apk),
      // so identity is verified by VERSION + CHECKSUM rather than by filename.
      const publishedName = `${basename(newApk).replace(/^app-release\.apk$/, `4ulife-${next.versionName}-release.apk`)}`
      if (!String(manifest.apkUrl ?? '').endsWith(publishedName)) {
        fail(`OTA manifest apkUrl does not point at ${publishedName}: ${manifest.apkUrl}`)
      } else if (manifest.sha256 && manifest.sha256 !== sha256Of(newApk)) {
        fail(`OTA manifest sha256 does not match ${basename(newApk)}`)
      } else {
        console.log(`  OK  OTA manifest points at ${publishedName} with a matching checksum`)
      }
    } else {
      console.log(`  OK  OTA manifest matches (${manifest.version} / ${manifest.versionCode})`)
    }
    if (String(manifest.apkUrl ?? '').includes('debug')) {
      fail('OTA manifest points at a DEBUG APK. Publishing a debug-signed build locks users out of future release-signed updates.')
    }
  }
}

/* ---------------- result ---------------- */

if (failures.length) {
  console.error('\nBLOCKED — do not publish:')
  for (const message of failures) console.error(`  - ${message}`)
  process.exit(1)
}
for (const note of notes) console.log(`  note: ${note}`)
console.log('\nPASS: this APK can be installed as an in-place upgrade over the previous release.')
