import { useCallback, useState } from 'react'

/**
 * Owner console preferences — presentational ONLY.
 *
 * These are the owner's own view settings (language of the console chrome,
 * reduced motion, rows per page, whether to confirm before sending). They are:
 *
 *   - never persisted to Supabase,
 *   - never read by any authorization decision,
 *   - never used to decide what the server will allow.
 *
 * Authorization is decided ONLY by the `admin` Edge Function (JWT +
 * server-side ADMIN_EMAILS). Storing any "isOwner" style flag here would be a
 * privilege-escalation vector, so the type deliberately cannot express one.
 *
 * Persistence is `localStorage` under a single namespaced key, wrapped so a
 * disabled/blocked storage backend degrades to in-memory defaults instead of
 * throwing.
 */

export interface AdminPreferences {
  /** Console chrome language; independent of the app's language setting. */
  language: 'en' | 'ar'
  /** Force the reduced-motion presentation regardless of the OS setting. */
  reducedMotion: boolean
  /** Rows rendered per page in directory and history tables. */
  pageSize: 10 | 20 | 50
  /** Ask for confirmation before an announcement is sent. */
  confirmBeforeSend: boolean
  /** Show ISO timestamps instead of the localized format. */
  utcTimestamps: boolean
}

export const DEFAULT_ADMIN_PREFERENCES: AdminPreferences = {
  language: 'en',
  reducedMotion: false,
  pageSize: 20,
  confirmBeforeSend: true,
  utcTimestamps: false,
}

export const ADMIN_PREFERENCE_KEY = 'alhelm:admin-preferences'

const PAGE_SIZES: readonly number[] = [10, 20, 50]

/**
 * Coerces arbitrary stored JSON into a valid preference object.
 *
 * Unknown or invalid values fall back to the default for THAT field only, so a
 * partially corrupted entry cannot reset everything or crash the console.
 */
export function parseAdminPreferences(raw: unknown): AdminPreferences {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pageSize = Number(source.pageSize)
  return {
    language: source.language === 'ar' ? 'ar' : 'en',
    reducedMotion: source.reducedMotion === true,
    pageSize: PAGE_SIZES.includes(pageSize) ? (pageSize as AdminPreferences['pageSize']) : DEFAULT_ADMIN_PREFERENCES.pageSize,
    confirmBeforeSend: source.confirmBeforeSend !== false,
    utcTimestamps: source.utcTimestamps === true,
  }
}

function readStored(): AdminPreferences {
  if (typeof localStorage === 'undefined') return DEFAULT_ADMIN_PREFERENCES
  try {
    const stored = localStorage.getItem(ADMIN_PREFERENCE_KEY)
    if (!stored) return DEFAULT_ADMIN_PREFERENCES
    return parseAdminPreferences(JSON.parse(stored))
  } catch {
    return DEFAULT_ADMIN_PREFERENCES
  }
}

/** Writes the value; returns false when storage refused (private mode, quota). */
export function writeAdminPreferences(value: AdminPreferences): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    localStorage.setItem(ADMIN_PREFERENCE_KEY, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

/**
 * Owner preferences for the mounted console.
 *
 * A single parse happens on mount (never during render), and every update is
 * applied in memory first so the UI stays responsive if storage is unavailable.
 */
export function useAdminPreferences(): {
  preferences: AdminPreferences
  update: (patch: Partial<AdminPreferences>) => void
  reset: () => void
} {
  // Storage is read in the INITIALISER, which React runs once per mount. That
  // avoids a setState-in-effect (which would render defaults first, then the
  // saved values) and keeps the value available on the very first paint.
  // `readStored` is total: no storage, a blocked storage, or corrupted JSON all
  // resolve to defaults without throwing.
  const [preferences, setPreferences] = useState<AdminPreferences>(readStored)

  const update = useCallback((patch: Partial<AdminPreferences>) => {
    setPreferences((current) => {
      const next = parseAdminPreferences({ ...current, ...patch })
      writeAdminPreferences(next)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    writeAdminPreferences(DEFAULT_ADMIN_PREFERENCES)
    setPreferences(DEFAULT_ADMIN_PREFERENCES)
  }, [])

  return { preferences, update, reset }
}
