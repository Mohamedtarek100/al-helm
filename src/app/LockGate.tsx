import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLockScreen } from '../components/AppLockScreen'
import { getLockSettings, shouldRelock } from '../services/appLock'
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
  // `sessionLocked` only tracks "this session is locked"; the gate itself is
  // derived below, so removing the record opens the app immediately.
  const [sessionLocked, setSessionLocked] = useState(lockEnabled)
  const locked = lockEnabled && sessionLocked
  // Activity timestamp. Initialised inside the effect below; reading the clock
  // during render would make the component impure.
  const lastActive = useRef<number | null>(null)
  const navigate = useNavigate()

  // Track activity so the idle policy has a real timestamp. A fresh session
  // starts its idle clock when this effect mounts, not during render.
  useEffect(() => {
    if (!lockEnabled) return
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

  const forgotPin = useCallback(() => {
    // Sign out of this device, then send the user to the account panel to
    // re-authenticate. Data is preserved; only the lock record was removed.
    void logoutCloudUser().catch(() => undefined)
    // The record is already gone (AppLockScreen removes it before calling
    // back), but re-reading makes the gate state match storage explicitly
    // rather than relying on a later visibility event.
    setLockEnabled(getLockSettings().enabled)
    setSessionLocked(false)
    navigate('/settings')
  }, [navigate])

  return (
    <>
      {children}
      {locked && <AppLockScreen onUnlocked={unlock} onForgotPin={forgotPin} />}
    </>
  )
}
