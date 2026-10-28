import { useEffect, type ReactNode } from 'react'
import { useLaunchMode } from './onboarding'
import { activePersistenceMode, getActivePersistenceCoordinator, getState, useSettings } from './store'

/**
 * Guest-mode guard.
 *
 * A guest's data lives in the same local snapshot the app always used, so
 * nothing is migrated, copied or rewritten here. The single job of this
 * provider is to make sure that signing in NEVER silently discards guest work:
 *
 *  - `PersistenceCoordinator.authenticate()` already keeps the local snapshot
 *    alive and reports `migrationRequired` instead of entering cloud mode when
 *    the account is empty but local data exists. That path is the deliberate,
 *    user-confirmed upload (AuthPanel).
 *  - This provider only *reports* the situation (see the returned context), so
 *    the UI can explain it. It performs no writes.
 *
 * It intentionally does not auto-merge guest records into an account. Merging
 * two address spaces without user intent is exactly how duplicate or
 * cross-account data appears.
 */

export interface GuestContextValue {
  /** The recorded first-launch choice. */
  mode: 'google' | 'guest' | null
  /** True while the active persistence mode is local. */
  isLocalOnly: boolean
  /** True when local data exists that the signed-in account does not have. */
  hasUnlinkedLocalData: boolean
}

export function useGuestContext(): GuestContextValue {
  const mode = useLaunchMode()
  const settings = useSettings()
  const state = getActivePersistenceCoordinator().snapshot()
  return {
    mode,
    isLocalOnly: activePersistenceMode() === 'local',
    hasUnlinkedLocalData: Boolean(state.userId) && Boolean(state.migrationRequired) && settings.storage !== 'cloud',
  }
}

/**
 * Keeps guest data addressable across sessions and warns (once) if a sign-in
 * would have replaced it. The warning is a console-only diagnostic for support;
 * the user-facing explanation lives in the account panel.
 */
export function AnonymousGuestProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (typeof window === 'undefined') return
    // A guard against silent loss: if local data exists and we are about to be
    // in cloud mode with an empty account, the coordinator must have flagged a
    // required migration. If it ever does not, surface it loudly in dev.
    if (!import.meta.env.DEV) return
    const state = getActivePersistenceCoordinator().snapshot()
    const localCount = getState().tasks.length + getState().subjects.length
    if (state.mode === 'cloud' && state.migrationRequired === false && localCount > 0 && state.error) {
      console.warn('Guest data present while entering cloud mode; confirm the upload flow before continuing.', state.error)
    }
  }, [])
  return <>{children}</>
}
