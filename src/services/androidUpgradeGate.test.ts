import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

/**
 * Android upgrade gate — regression guard.
 *
 * THE BUG THIS PREVENTS
 *   Releases 1.3 through 1.5.2 were all published as DEBUG-signed APKs
 *   (certificate CN=Android Debug). 1.5.3 was the first RELEASE-signed build
 *   (CN=Al-Helm Study Planner). Android refuses an update whose signing
 *   certificate differs, so no installed user could move to 1.5.3 — and no
 *   version-code change can make that work.
 *
 *   Nothing in the release pipeline compared certificates, so the break shipped.
 *   `scripts/qa/verify-android-upgrade-gate.mjs` now refuses to publish in that
 *   situation. These tests keep the gate itself working and keep the release
 *   configuration on the permanent release key.
 */

const GATE = 'scripts/qa/verify-android-upgrade-gate.mjs'
const gate = existsSync(GATE) ? readFileSync(GATE, 'utf8') : ''
const buildGradle = readFileSync('android/app/build.gradle', 'utf8')

describe('upgrade gate script', () => {
  it('exists', () => {
    expect(existsSync(GATE)).toBe(true)
  })

  it('compares the FULL SHA-256 signing certificate, not a short id', () => {
    // A short fingerprint (or the DN alone) can coincide between two different
    // keys; only the 64-hex SHA-256 digest identifies the signing identity.
    expect(gate).toMatch(/Signer #1 certificate SHA-256 digest/)
    expect(gate).toMatch(/nextCert\.sha256 !== prevCert\.sha256/)
  })

  it('blocks the publish when the certificate differs', () => {
    expect(gate).toContain('INSTALL_FAILED_UPDATE_INCOMPATIBLE')
    expect(gate).toMatch(/BLOCKED — do not publish/)
    // A mismatch must exit non-zero so a release script stops.
    expect(gate).toMatch(/process\.exit\(1\)/)
  })

  it('checks package id continuity', () => {
    expect(gate).toMatch(/next\.packageId !== prev\.packageId/)
  })

  it('checks that versionCode strictly increases', () => {
    expect(gate).toMatch(/next\.versionCode > prev\.versionCode/)
  })

  it('checks that versionName advances with versionCode', () => {
    expect(gate).toMatch(/next\.versionName === prev\.versionName/)
  })

  it('rejects an OTA manifest pointing at a debug APK', () => {
    // Publishing a debug-signed build would lock users out of release-signed
    // updates forever after.
    expect(gate).toMatch(/manifest\.apkUrl \?\? ''\)\.includes\('debug'\)/)
  })

  it('verifies the manifest checksum, not just the file name', () => {
    expect(gate).toMatch(/manifest\.sha256 !== sha256Of\(newApk\)/)
  })
})

describe('release signing configuration', () => {
  it('signs release builds with the release config, never debug', () => {
    // There are TWO `release {` blocks: the signingConfigs one (which defines the
    // key) and the buildTypes one (which applies it). Only the buildTypes block
    // decides which key signs the published artifact, so it is located by its
    // distinguishing `minifyEnabled` line.
    const buildTypeIndex = buildGradle.indexOf('buildTypes')
    expect(buildTypeIndex).toBeGreaterThan(-1)
    const buildTypes = buildGradle.slice(buildTypeIndex)
    const releaseStart = buildTypes.indexOf('release {')
    const debugStart = buildTypes.indexOf('debug {')
    expect(releaseStart).toBeGreaterThan(-1)
    const releaseBuildType = debugStart > releaseStart
      ? buildTypes.slice(releaseStart, debugStart)
      : buildTypes.slice(releaseStart)
    expect(releaseBuildType).toMatch(/signingConfig signingConfigs\.release/)
    // The regression was publishing an `assembleDebug` artifact as the release.
    expect(releaseBuildType).not.toMatch(/signingConfig signingConfigs\.debug/)
  })

  it('loads signing material from outside the repository', () => {
    // The keystore must never be committed; it lives in the user profile.
    expect(buildGradle).toMatch(/keystore\.properties/)
  })

  it('keeps the existing package id', () => {
    expect(buildGradle).toMatch(/applicationId\s+"com\.alhelm\.studyplanner"/)
  })

  it('declares a versionCode that can only move forward', () => {
    const match = /versionCode\s+(\d+)/.exec(buildGradle)
    expect(match).not.toBeNull()
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(10)
  })
})

describe('published release artifacts', () => {
  it('keeps the OTA manifest consistent with the newest release', () => {
    const manifestPath = 'al-helm-app-deploy/ota/apk-manifest.json'
    expect(existsSync(manifestPath)).toBe(true)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      version: string
      versionCode: number
      apkUrl: string
    }
    const versionName = /versionName\s+"([^"]+)"/.exec(buildGradle)?.[1]
    const versionCode = Number(/versionCode\s+(\d+)/.exec(buildGradle)?.[1])
    expect(manifest.version).toBe(versionName)
    expect(manifest.versionCode).toBe(versionCode)
    // The download must be a release build, never a debug one.
    expect(manifest.apkUrl).not.toMatch(/debug/)
    expect(manifest.apkUrl).toMatch(/-release\.apk$/)
  })
})
