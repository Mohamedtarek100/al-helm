import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AnonymousGuestProvider } from '../services/guest'
import { hasStoredUserContent } from '../services/domain'
import { getState } from '../services/store'
import { shouldShowOnboarding } from '../services/onboarding'
import { supabase } from '../services/persistence/supabase'
import { WelcomePage } from '../pages/WelcomePage'

/**
 * Decides whether to show the first-launch choice before the app itself.
 *
 * The decision is made once, after the store has hydrated:
 *  - a recorded choice means the app renders immediately (no flash);
 *  - an existing local snapshot means a returning user — never interrupt them;
 *  - an active session means they are already signed in — nothing to ask;
 *  - otherwise it is a genuine first launch and the choice is shown.
 *
 * While the check runs (a few milliseconds, just reading the session) a neutral
 * splash is rendered rather than the app, so the choice never appears on top of
 * a half-rendered interface.
 */
export function LaunchGate({ children }: { children: ReactNode }) {
  const [decision, setDecision] = useState<'pending' | 'welcome' | 'app'>('pending')

  useEffect(() => {
    let active = true
    const decide = async () => {
      let email: string | null = null
      if (supabase) {
        const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }))
        email = data.session?.user.email ?? null
      }
      if (!active) return
      const show = shouldShowOnboarding({
        hasExistingData: hasStoredUserContent(getState()),
        sessionEmail: email,
      })
      setDecision(show ? 'welcome' : 'app')
    }
    void decide()
    return () => { active = false }
  }, [])

  if (decision === 'pending') {
    return <div className="onboarding" aria-busy="true"><span className="skeleton skeleton--card" style={{ width: 'min(520px, 100%)', height: 240 }} /></div>
  }
  if (decision === 'welcome') return <WelcomePage onDone={() => setDecision('app')} />
  return <AnonymousGuestProvider>{children}</AnonymousGuestProvider>
}
