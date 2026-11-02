import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AppLockScreen } from '../components/AppLockScreen'
import { getLockSettings, shouldRelock } from '../services/appLock'
import { currentAccountEmail } from '../services/lockRecovery'
import { logoutCloudUser } from '../services/store'

/**
 * Applies the device lock lifecycle around the application.
 *
 * Policy:
 *  - Locked immediately at launch when a PIN is configured.
 *  - Re-locked when the app goes to the background (visibilitychange hidden),
 *    and after `idleMinutes` of inactivity if configured.
 *
 * The lock is an overlay: children stay mounted underneath, so unlocking
 * restores the exact previous screen and no state (an active form, a running
 * focus timer) is lost.
 *
 * "Forgot PIN" removes the device lock and signs the user out so the account
 * can be re-authenticated; it never clears application data.
 */
export function LockGate({ children }: { children: ReactNode }) {
  // The lock record is read INSIDE an effect, never during render: reading
  // storage while rendering is an impure side read, and a profile edit or a
  // theme change would re-read it incidentally. Re-reading on mount and on
  // visibility/focus transitions covers every way the record can change (set
  // or removed in Settings, then the user returns to the app).
  const [lockEnabled, setLockEnabled] = useState(() => getLockSettings().enabled)
  const location = useLocation()
  const navigate = useNavigate()
  const lastActive = useRef<number | null>(null)

  /**
   * THE LOCK IS OBSERVED CONTINUOUSLY, NOT SNAPSHOTTED AT MOUNT.
   *
   * `useState(() => getLockSettings().enabled)` was read ONCE. Verified in the
   * running app: with a PIN already stored, a hash navigation (`#/tasks`) left
   * the app fully open, while a full reload locked correctly — same record, two
   * different outcomes. Enabling the lock in Settings and returning within the
   * same document had the same problem.
   *
   * `lockLive` is re-read on mount, on every route change, on focus, on
   * visibility and on a storage event, so the gate and storage always agree.
   */
  const [lockLive, setLockLive] = useState(() => getLockSettings().enabled)
  const refreshLockConfig = useCallback(() => {
    const enabled = getLockSettings().enabled
    setLockLive((previous) => (previous === enabled ? previous : enabled))
  }, [])
  const effectiveLockEnabled = lockEnabled || lockLive

  // `sessionLocked` only tracks "this session is locked"; the gate itself is
  // derived below, so removing the record opens the app immediately.
  const [sessionLocked, setSessionLocked] = useState(lockEnabled)
  const locked = effectiveLockEnabled && sessionLocked
  // Used only to offer the account path on the recovery screen; the email is
  // never taken from a free-text field.
  const [accountEmail, setAccountEmail] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void currentAccountEmail().then((email) => { if (active) setAccountEmail(email) })
    return () => { active = false }
  }, [locked])
  // Re-read the lock whenever it can have changed: on mount, on visibility, on
  // focus, on a storage event (another tab), and on every route change, which is
  // exactly where the old gate lost track of a configured lock.
  useEffect(() => {
    refreshLockConfig()
    const onStorage = (event: StorageEvent) => { if (event.key?.startsWith('alhelm.v1.appLock')) refreshLockConfig() }
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', refreshLockConfig)
    document.addEventListener('visibilitychange', refreshLockConfig)
    // Enabling the lock happens IN this document (Settings), so no `storage`
    // event fires — that event only fires in OTHER tabs. Without this listener
    // a newly-enabled PIN was invisible to the gate: the app stayed open with the
    // lock configured, and only a reload locked it (verified in the running app).
    const onLockChanged = () => refreshLockConfig()
    window.addEventListener('alhelm:app-lock-changed', onLockChanged)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', refreshLockConfig)
      document.removeEventListener('visibilitychange', refreshLockConfig)
      window.removeEventListener('alhelm:app-lock-changed', onLockChanged)
    }
  }, [refreshLockConfig, location.pathname])

  /**
   * When a lock is enabled during this session, the app must immediately become
   * locked — the user has just set a PIN and expects it to protect the app now,
   * not after the next restart.
   */
  useEffect(() => {
    if (!lockLive) return
    setSessionLocked(true)
  }, [lockLive])

  // Track activity so the idle policy has a real timestamp. A fresh session
  // starts its idle clock when this effect mounts, not during render.
  useEffect(() => {
    if (!effectiveLockEnabled) return
    lastActive.current = Date.now()
    const touch = () => { lastActive.current = Date.now() }
    const events: Array<keyof DocumentEventMap> = ['pointerdown', 'keydown', 'touchstart']
    events.forEach((event) => document.addEventListener(event, touch, { passive: true }))
    // Removal must match how the listener was added. `removeEventListener` only
    // accepts a capture flag (EventListenerOptions, not AddEventListenerOptions),
    // and these were added with the default capture of `false`, so the third
    // argument here is `false` — passing an options object would be both a type
    // error and a mismatch that could leak handlers.
    return () => events.forEach((event) => document.removeEventListener(event, touch, false))
  }, [lockEnabled])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // The user may have enabled or removed the lock in another tab or in
        // Settings while the app was backgrounded, so the record is re-read on
        // return rather than trusted from mount time.
        const current = getLockSettings()
        setLockEnabled(current.enabled)
        if (!current.enabled) return
        if (shouldRelock(lastActive.current ?? Date.now(), current.idleMinutes)) setSessionLocked(true)
        return
      }
      if (!lockEnabled) return
      setSessionLocked(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [lockEnabled])



  const unlock = useCallback(() => {
    lastActive.current = Date.now()
    setSessionLocked(false)
  }, [])

  /**
   * Called ONLY after a verified recovery ceremony removed the lock.
   *
   * There is no other path: `AppLockScreen` cannot reach this without a
   * single-use token minted after proving ownership of the account password or
   * the guest recovery key. See `appLockRecovery.test.ts`.
   *
   * The account is signed out so data is re-fetched under a fresh, verified
   * session. Customer data is never deleted.
   */
  const recovered = useCallback(() => {
    void logoutCloudUser().catch(() => undefined)
    setLockEnabled(getLockSettings().enabled)
    setSessionLocked(false)
    navigate('/settings')
  }, [navigate])

  // WHEN LOCKED, THE APP IS NOT RENDERED AT ALL.
  //
  // It used to stay mounted underneath the overlay, so a locked device still had
  // every screen in the DOM: readable by a screenshot, accessible to assistive
  // technology, and one CSS/z-index mistake away from being interactive. Nothing
  // behind the lock needs to stay mounted — the store holds the data and the
  // route is restored on unlock by the router.
  if (locked) {
    return <AppLockScreen onUnlocked={unlock} onRecovered={recovered} accountEmail={accountEmail} />
  }
  return <>{children}</>
}
