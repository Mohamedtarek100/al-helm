import { useEffect, useState } from 'react'
import { resolveProfilePhoto } from '../services/profilePhoto'

/**
 * Account avatar.
 *
 * Renders the Google profile photo when the signed-in user has one, and a
 * neutral initial-based fallback otherwise. Images are never loaded from a
 * non-https value, and a failed load falls back instead of showing a broken
 * image icon. No token or metadata beyond the photo URL and display name is
 * read.
 */

export interface AccountAvatarProps {
  user: { email?: string | null; user_metadata?: Record<string, unknown> | null } | null
  size?: number
  className?: string
}

export function AccountAvatar({ user, size = 40, className }: AccountAvatarProps) {
  const { url, displayName, initial } = resolveProfilePhoto(user, Math.max(192, size * 3))
  const [failed, setFailed] = useState(false)

  // A new account (or a changed photo) must clear a previous failure.
  useEffect(() => { setFailed(false) }, [url])

  const showImage = Boolean(url) && !failed
  const label = displayName || 'Account'

  return (
    <span
      className={`account-avatar${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden={showImage ? undefined : 'true'}
    >
      {showImage ? (
        <img
          src={url as string}
          alt={label}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="account-avatar__initial" role="img" aria-label={label}>
          {initial || '·'}
        </span>
      )}
    </span>
  )
}
