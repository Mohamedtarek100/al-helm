import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AnonymousGuestProvider } from '../services/guest'
import { hasStoredUserContent } from '../services/domain'
import { getState } from '../services/store'
import { getLaunchMode, shouldShowOnboarding } from '../services/onboarding'
import { supabase } from '../services/persistence/supabase'
import { useAuthSignal } from '../services/authState'
import { endGuestSession, startGuestSession } from '../services/guestMode'
import { WelcomePage } from '../pages/WelcomePage'

/**
 * Decides whether to show the first-launch choice before the app itself.
 *
 * The initial decision is computed once, after the store has hydrated:
 *  - a recorded choice means the app renders immediately (no flash);
 *  - an existing local snapshot means a returning user — never interrupt them;
 *  - an active session means they are already signed in — nothing to ask;
 *  - otherwise it is a genuine first launch and the choice is shown.
 *
 * CRITICAL (Android): the gate ALSO reacts to `useAuthSignal()`. On Android the
 * Google flow returns through the custom scheme into the already-running
 * WebView, so nothing remounts. Without this subscription the gate stayed on
 * the welcome screen forever after a successful sign-in.
 *
 * The app is only revealed on `authenticated`, which is published AFTER the
 * PKCE exchange AND cloud hydration complete — never on mere navigation back.
 */
export function LaunchGate({ children }: { children: ReactNode }) {
  const [decision, setDecision] = useState<'pending' | 'welcome' | 'app'>('pending')
  const auth = useAuthSignal()
  /** Set when the user explicitly chose Guest and confirmed the warning. */
  const [guestChosen, setGuestChosen] = useState(false)

  useEffect(() => {
    let active = true
    const decide = async () => {
      let email: string | null = null
      let hasSession = false
      if (supabase) {
        const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }))
        email = data.session?.user.email ?? null
        hasSession = Boolean(data.session)
      }
      if (!active) return
      if (getLaunchMode() === 'guest' && !hasSession) startGuestSession()
      else endGuestSession()
      const show = shouldShowOnboarding({
        hasExistingData: hasStoredUserContent(getState()),
        sessionEmail: email,
      })
      setDecision(show ? 'welcome' : 'app')
    }
    void decide()
    return () => { active = false }
  }, [])

  // A confirmed sign-in (web or native) always enters the app, even if the
  // initial decision was 'welcome' and WelcomePage is currently mounted.
  const authenticated = auth.phase === 'authenticated'

  if (decision === 'pending') {
    return <div className="onboarding" aria-busy="true"><span className="skeleton skeleton--card" style={{ width: 'min(520px, 100%)', height: 240 }} /></div>
  }
  if (authenticated || guestChosen || decision === 'app') {
    return <AnonymousGuestProvider>{children}</AnonymousGuestProvider>
  }
  return (
    <WelcomePage
      onDone={() => setDecision('app')}
      onGuest={() => setGuestChosen(true)}
    />
  )
}
