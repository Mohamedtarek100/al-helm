import { describe, expect, it } from 'vitest'
import { isSafeImageUrl, resolveProfilePhoto, upgradeGooglePhotoUrl, photoChanged } from './profilePhoto'

/**
 * Google profile photo resolution.
 *
 * Metadata shape is taken from this project's real auth.users row:
 *   avatar_url / picture = https://lh3.googleusercontent.com/a/...=s96-c
 *   name / full_name / display_name
 */

const GOOGLE_PHOTO = 'https://lh3.googleusercontent.com/a/ACg8ocIeXu75YmwO9ueIvUYbvtRFCAwzI3dEH1KXblBgTYBfTYy32=s96-c'

const googleUser = {
  email: 'owner@example.com',
  user_metadata: {
    avatar_url: GOOGLE_PHOTO,
    picture: GOOGLE_PHOTO,
    full_name: 'MOHAMED TAREK ELDAHSAN',
    name: 'MOHAMED TAREK',
    display_name: 'MOHAMED TAREK',
    provider_id: '111762635964679265274',
  },
}

describe('resolving the photo', () => {
  it('uses avatar_url and upgrades the Google thumbnail size', () => {
    const photo = resolveProfilePhoto(googleUser)
    expect(photo.url).toBe(GOOGLE_PHOTO.replace('=s96-c', '=s192-c'))
    expect(photo.url).not.toContain('=s96-c')
  })

  it('prefers full_name, then name, then display_name', () => {
    expect(resolveProfilePhoto(googleUser).displayName).toBe('MOHAMED TAREK ELDAHSAN')
    expect(resolveProfilePhoto({ user_metadata: { name: 'A' } }).displayName).toBe('A')
    expect(resolveProfilePhoto({ user_metadata: { display_name: 'B' } }).displayName).toBe('B')
  })

  it('falls back to the email local part when no name is present', () => {
    expect(resolveProfilePhoto({ email: 'someone@example.com', user_metadata: {} }).displayName).toBe('someone')
  })

  it('derives a single-character initial for the fallback avatar', () => {
    expect(resolveProfilePhoto(googleUser).initial).toBe('M')
    expect(resolveProfilePhoto({ email: 'zoe@x.com' }).initial).toBe('Z')
  })

  it('uses picture when avatar_url is absent (Google raw claim)', () => {
    const photo = resolveProfilePhoto({ user_metadata: { picture: GOOGLE_PHOTO } })
    expect(photo.url).toContain('googleusercontent.com')
  })

  it('returns a null url rather than a broken string when no photo exists', () => {
    expect(resolveProfilePhoto({ user_metadata: {} }).url).toBeNull()
    expect(resolveProfilePhoto(null).url).toBeNull()
    expect(resolveProfilePhoto(undefined).url).toBeNull()
  })
})

describe('unsafe or invalid photo values are rejected', () => {
  it.each([
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'http://insecure.example.com/a.png',
    'not a url',
    '',
    '   ',
  ])('rejects %s', (value) => {
    expect(isSafeImageUrl(value)).toBe(false)
    expect(resolveProfilePhoto({ user_metadata: { avatar_url: value } }).url).toBeNull()
  })

  it.each([null, undefined, 42, {}, []])('rejects the non-string value %s', (value) => {
    expect(isSafeImageUrl(value)).toBe(false)
  })

  it('accepts an ordinary https image', () => {
    expect(isSafeImageUrl('https://cdn.example.com/a.png')).toBe(true)
  })
})

describe('URL size upgrade', () => {
  it('does not touch non-Google hosts', () => {
    expect(upgradeGooglePhotoUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png')
  })

  it('returns an empty string for an unsafe URL', () => {
    expect(upgradeGooglePhotoUrl('javascript:alert(1)')).toBe('')
  })

  it('leaves an already-sized Google URL coherent', () => {
    const big = upgradeGooglePhotoUrl(GOOGLE_PHOTO, 512)
    expect(big).toContain('=s512-c')
  })
})

describe('change detection', () => {
  it('detects real changes but not repeats', () => {
    expect(photoChanged(null, 'https://a/b.png')).toBe(true)
    expect(photoChanged('https://a/b.png', 'https://a/b.png')).toBe(false)
    expect(photoChanged('https://a/b.png', null)).toBe(true)
  })
})

describe('no sensitive metadata is exposed', () => {
  it('the resolved object contains only url, displayName and initial', () => {
    const photo = resolveProfilePhoto(googleUser)
    expect(Object.keys(photo).sort()).toEqual(['displayName', 'initial', 'url'])
    expect(JSON.stringify(photo)).not.toContain('111762635964679265274')
  })
})
