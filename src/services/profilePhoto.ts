/**
 * Google profile photo resolution.
 *
 * What Supabase actually returns for a Google sign-in (verified against this
 * project's auth.users.raw_user_meta_data):
 *
 *   avatar_url, picture   https://lh3.googleusercontent.com/a/ACg8...=s96-c
 *   name, full_name, display_name
 *
 * Rules:
 *  - `avatar_url` is the canonical Supabase field; `picture` is Google's raw
 *    OIDC claim and is used as a fallback.
 *  - Only https URLs are accepted. A `javascript:` or `data:` value from
 *    spoofed metadata must never reach an <img src>.
 *  - Nothing is stored in the app database: the URL lives in the auth session,
 *    so it is always current after a refresh or a new sign-in, and a user's own
 *    upload is never overwritten by an empty Google value.
 */

export interface ProfilePhoto {
  /** Usable https URL, or null when the account has no valid photo. */
  url: string | null
  /** Display name from metadata, trimmed; falls back to the email local part. */
  displayName: string
  /** First character used by the fallback avatar. */
  initial: string
}

type Meta = Record<string, unknown>

/** True for an absolute https URL that is safe to place in an <img src>. */
export function isSafeImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && Boolean(url.hostname)
  } catch {
    return false
  }
}

/**
 * Google serves a 96px thumbnail by default (`=s96-c`). Requesting a larger size
 * keeps the avatar crisp on high-density screens; the suffix is ignored (and
 * harmless) for non-Google hosts.
 */
export function upgradeGooglePhotoUrl(url: string, size = 192): string {
  if (!isSafeImageUrl(url)) return ''
  if (!/googleusercontent\.com/.test(url)) return url
  return url.replace(/=s\d+-c$/, `=s${size}-c`)
}

function firstString(meta: Meta, keys: string[]): string {
  for (const key of keys) {
    const value = meta[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/**
 * Resolves the photo and display name for a signed-in user.
 *
 * `user` is the Supabase `User` (or anything with `email` and `user_metadata`),
 * so this is pure and trivially testable with mocked metadata.
 */
export function resolveProfilePhoto(
  user: { email?: string | null; user_metadata?: Meta | null } | null | undefined,
  size = 192,
): ProfilePhoto {
  const meta: Meta = (user?.user_metadata ?? {}) as Meta
  const candidates = [meta.avatar_url, meta.picture].filter(isSafeImageUrl) as string[]

  const displayName =
    firstString(meta, ['full_name', 'name', 'display_name']) ||
    (user?.email ? String(user.email).split('@')[0] : '') ||
    ''

  const url = candidates.length ? upgradeGooglePhotoUrl(candidates[0], size) : null
  const initial = displayName ? Array.from(displayName.trim())[0]?.toUpperCase() ?? '' : ''

  return { url, displayName, initial }
}

/**
 * True when the account's Google photo has changed since `previous`, so the UI
 * only updates state when it actually differs (avoids a reload loop).
 */
export function photoChanged(previous: string | null, next: string | null): boolean {
  return (previous ?? '') !== (next ?? '')
}
