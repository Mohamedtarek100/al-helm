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
  // Re-read on every render: enabling or removing the lock in Settings must
  // take effect immediately, not only at the next launch.
  const settings = getLockSettings()
  const [locked, setLocked] = useState(settings.enabled)
  const lastActive = useRef(Date.now())
  const navigate = useNavigate()

  // Enabling the lock while the app is open locks it immediately. Removing the
  // record (forgot-PIN path) opens the app without needing a restart.
  useEffect(() => {
    if (!settings.enabled) setLocked(false)
  }, [settings.enabled])

  // Track activity so the idle policy has a real timestamp.
  useEffect(() => {
    if (!settings.enabled) return
    const touch = () => { lastActive.current = Date.now() }
    const events: Array<keyof DocumentEventMap> = ['pointerdown', 'keydown', 'touchstart']
    events.forEach((event) => document.addEventListener(event, touch, { passive: true }))
    return () => events.forEach((event) => document.removeEventListener(event, touch))
  }, [settings.enabled])

  useEffect(() => {
    if (!settings.enabled) return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        setLocked(true)
        return
      }
      if (shouldRelock(lastActive.current, settings.idleMinutes)) setLocked(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [settings.enabled, settings.idleMinutes])

  const unlock = useCallback(() => {
    lastActive.current = Date.now()
    setLocked(false)
  }, [])

  const forgotPin = useCallback(() => {
    // Sign out of this device, then send the user to the account panel to
    // re-authenticate. Data is preserved; only the lock record was removed.
    void logoutCloudUser().catch(() => undefined)
    setLocked(false)
    navigate('/settings')
  }, [navigate])

  return (
    <>
      {children}
      {locked && <AppLockScreen onUnlocked={unlock} onForgotPin={forgotPin} />}
    </>
  )
}
