import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APK_MANIFEST_URL,
  compareVersions,
  isTrustedApkUrl,
  parseApkManifest,
  checkApkUpdate,
  dismissVersion,
  getDismissedVersion,
} from './apkUpdate'

/**
 * APK update notice.
 *
 * The app must never nag, never auto-install, and never trust an arbitrary
 * manifest. Every failure mode degrades to "no update".
 */

const validManifest = {
  version: '1.4.0',
  versionCode: 14,
  apkUrl: 'https://github.com/Mohamedtarek100/al-helm-app/releases/download/v1.4.0/app-release.apk',
  notes: 'Fixes Google sign-in return on Android.',
}

const okResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response

beforeEach(() => {
  localStorage.clear()
})

describe('version comparison', () => {
  it.each([
    ['1.4.0', '1.3.9', 1],
    ['1.10.0', '1.9.0', 1],
    ['1.3.9', '1.4.0', -1],
    ['1.4.0', '1.4.0', 0],
    ['1.4', '1.4.0', 0],
    ['2', '1.9.9', 1],
  ])('compare(%s, %s) = %i', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected)
  })
})

describe('manifest validation', () => {
  it('accepts a valid manifest', () => {
    expect(parseApkManifest(validManifest)).toMatchObject({ version: '1.4.0', versionCode: 14 })
  })

  it.each([
    [{ ...validManifest, version: 'latest' }],
    [{ ...validManifest, version: '' }],
    [{ ...validManifest, versionCode: 'x' }],
    [{ ...validManifest, apkUrl: 'http://insecure.example.com/app.apk' }],
    [{ ...validManifest, apkUrl: 'https://example.com/app.zip' }],
    [{ ...validManifest, apkUrl: 'javascript:alert(1)' }],
    [null],
    ['string'],
  ])('rejects an untrusted payload (%j)', (payload) => {
    expect(parseApkManifest(payload)).toBeNull()
  })

  it('only trusts https .apk URLs', () => {
    expect(isTrustedApkUrl('https://example.com/app.apk')).toBe(true)
    expect(isTrustedApkUrl('https://example.com/app.apk.exe')).toBe(false)
    expect(isTrustedApkUrl('http://example.com/app.apk')).toBe(false)
  })
})

describe('checking for an update', () => {
  it('is not applicable on web', async () => {
    const result = await checkApkUpdate({ currentVersion: '1.3.0', platform: 'web' })
    expect(result.available).toBe(false)
    expect(result.reason).toBe('not-native')
  })

  it('reports an available update on Android', async () => {
    const fetchImpl = vi.fn(async () => okResponse(validManifest))
    const result = await checkApkUpdate({ currentVersion: '1.3.0', platform: 'android', fetchImpl })
    expect(result.available).toBe(true)
    expect(result.latest).toBe('1.4.0')
    expect(result.reason).toBe('available')
    expect(fetchImpl).toHaveBeenCalledWith(APK_MANIFEST_URL, expect.anything())
  })

  it('reports up-to-date when versions match', async () => {
    const result = await checkApkUpdate({ currentVersion: '1.4.0', platform: 'android', fetchImpl: async () => okResponse(validManifest) })
    expect(result.available).toBe(false)
    expect(result.reason).toBe('up-to-date')
  })

  it('degrades to no-update when the manifest is unreachable', async () => {
    const result = await checkApkUpdate({
      currentVersion: '1.3.0',
      platform: 'android',
      fetchImpl: async () => { throw new Error('network down') },
    })
    expect(result.available).toBe(false)
    expect(result.reason).toBe('no-manifest')
  })

  it('degrades to no-update on a non-200 response', async () => {
    const result = await checkApkUpdate({
      currentVersion: '1.3.0',
      platform: 'android',
      fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response,
    })
    expect(result.reason).toBe('no-manifest')
  })

  it('degrades to no-update on an invalid manifest', async () => {
    const result = await checkApkUpdate({
      currentVersion: '1.3.0',
      platform: 'android',
      fetchImpl: async () => okResponse({ version: 'oops' }),
    })
    expect(result.reason).toBe('invalid-manifest')
  })
})

describe('dismissal does not nag', () => {
  it('remembers a dismissed version', () => {
    dismissVersion('1.4.0')
    expect(getDismissedVersion()).toBe('1.4.0')
  })

  it('suppresses the same dismissed version', async () => {
    dismissVersion('1.4.0')
    const result = await checkApkUpdate({ currentVersion: '1.3.0', platform: 'android', fetchImpl: async () => okResponse(validManifest) })
    expect(result.available).toBe(true)
    expect(result.dismissed).toBe(true)
    expect(result.reason).toBe('dismissed')
  })

  it('shows a NEWER version even if an older one was dismissed', async () => {
    dismissVersion('1.4.0')
    const result = await checkApkUpdate({
      currentVersion: '1.3.0',
      platform: 'android',
      fetchImpl: async () => okResponse({ ...validManifest, version: '1.5.0', versionCode: 15 }),
    })
    expect(result.dismissed).toBe(false)
    expect(result.reason).toBe('available')
  })
})
