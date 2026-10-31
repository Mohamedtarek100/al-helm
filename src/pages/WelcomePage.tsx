import { useEffect, useState } from 'react'
import { Button } from '../components/Button'
import { useI18n } from '../i18n/useI18n'
import { authConfigured, describeAuthError, signInWithGoogle } from '../services/auth'
import { setLaunchMode } from '../services/onboarding'
import { startGuestSession } from '../services/guestMode'
import { markAuthenticating, markAuthFailed, useAuthSignal } from '../services/authState'
import { supabase } from '../services/persistence/supabase'

/**
 * First-launch choice: Continue with Google, or Continue as guest.
 *
 * Copy rules that matter for trust:
 *  - It says cloud sync enables account-based storage — it never claims that
 *    anything HAS synced, because nothing has until a write is confirmed.
 *  - Guest mode states plainly that data stays on this device and can be lost
 *    with the app/device, and that no backup exists yet.
 *  - "Continue as guest" only records the choice. It never touches, deletes or
 *    replaces existing data.
 */
export function WelcomePage({ onDone, onGuest }: { onDone: () => void; onGuest?: () => void }) {
  const { language } = useI18n()
  const en = language === 'en'
  const [busy, setBusy] = useState<'google' | 'guest' | null>(null)
  const auth = useAuthSignal()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const chooseGuest = () => {
    setBusy('guest')
    setError(null)
    // Flag this page-load as a guest session BEFORE anything can persist, so no
    // edit, autosave, retry or background sync writes to storage or the cloud.
    startGuestSession()
    const persisted = setLaunchMode('guest')
    if (!persisted) {
      setNotice(en ? 'You can continue, but this device cannot remember the choice.' : 'تقدري تكبّدي، بس الجهاز مش هيفتكر الاختيار.')
    }
    // `onGuest` lets LaunchGate remember the guest choice itself; `onDone` is the
    // legacy path (kept so the welcome screen still works when rendered alone).
    if (onGuest) onGuest()
    else onDone()
    setBusy(null)
  }

  /**
   * Starts the Google flow.
   *
   * The spinner is DELIBERATELY left on while the external flow runs — on
   * Android the user is in Chrome and returns to this same live WebView, so the
   * attempt is genuinely still in progress. It is cleared, never stranded, by:
   *   - success: LaunchGate unmounts this screen once the session is confirmed;
   *   - failure: the auth signal carries a safe message (see the effect below);
   *   - resume without a session: the app-resume / visibility check below.
   */
  const continueWithGoogle = async () => {
    setBusy('google')
    setError(null)
    markAuthenticating()
    try {
      const { error: authError } = await signInWithGoogle()
      if (authError) {
        const message = describeAuthError(authError) ?? (en ? 'Google sign-in could not start.' : 'تعذر بدء الدخول عبر Google.')
        setError(message)
        markAuthFailed(message)
        setBusy(null)
      }
      // On success the redirect/return leaves this screen; no `setBusy(null)`.
    } catch (e) {
      const message = describeAuthError(e instanceof Error ? { message: e.message } : null) ?? (en ? 'Google sign-in was cancelled.' : 'تم إلغاء الدخول عبر Google.')
      setError(message)
      markAuthFailed(message)
      setBusy(null)
    }
  }

  // 1. A failure reported by the native callback (never includes codes/tokens).
  useEffect(() => {
    if (auth.error) {
      setError(auth.error)
      setBusy(null)
    }
  }, [auth.error])

  // 2. Returning from Chrome WITHOUT a session (cancelled, denied, closed tab).
  //    The WebView resumes, the flow is no longer running, so release the
  //    spinner and let the user retry.
  useEffect(() => {
    if (busy !== 'google') return
    const release = () => {
      if (document.visibilityState !== 'visible') return
      void supabase?.auth.getSession().then(({ data }) => {
        if (!data.session) {
          setBusy(null)
          setError((prev) => prev ?? (en ? 'Sign-in was not completed. You can try again.' : 'الدخول مكتملش. تقدري تجربي تاني.'))
          markAuthFailed('Sign-in was not completed.')
        }
      }).catch(() => setBusy(null))
    }
    document.addEventListener('visibilitychange', release)
    window.addEventListener('focus', release)
    return () => {
      document.removeEventListener('visibilitychange', release)
      window.removeEventListener('focus', release)
    }
  }, [busy, en])

  return (
    <div className="onboarding">
      <div className="onboarding__card">
        <div className="onboarding__brand">
          <img className="brand-mark" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={40} height={40} />
          <div>
            <div className="brand-wordmark">4uLife</div>
            <div className="brand-caption">{en ? 'Study & Art Companion' : 'رفيق المذاكرة والفن'}</div>
          </div>
        </div>

        <h1 className="onboarding__title">{en ? 'Welcome' : 'أهلاً بيك'}</h1>
        <p className="onboarding__lead">
          {en
            ? 'Choose how you want to use 4uLife. You can change this later from Settings.'
            : 'اختاري إزاي تحبي تستخدمي 4uLife. تقدري تغيّري الاختيار بعدين من الإعدادات.'}
        </p>

        <div className="onboarding__option onboarding__option--primary">
          <span className="onboarding__option-title">{en ? 'Continue with Google' : 'المتابعة عبر Google'}</span>
          <p>
            {en
              ? 'Signing in links your tasks, subjects and artwork to your account, so they can follow you to another device.'
              : 'الدخول بيربط مهامك وموادك وأعمالك بحسابك، عشان تقدري توصلهم من جهاز تاني.'}
          </p>
          <p className="onboarding__note">
            {en
              ? 'Cloud storage is enabled by signing in. Your data is only marked as synced after the server confirms a save.'
              : 'التخزين السحابي بيتفعّل بالدخول. البيانات بتتعلّم إنها متزامنة بعد ما السيرفر يأكّد الحفظ فقط.'}
          </p>
          <div className="onboarding__actions">
            <Button
              variant="primary"
              loading={busy === 'google'}
              disabled={!authConfigured}
              onClick={() => void continueWithGoogle()}
            >
              {en ? 'Continue with Google' : 'المتابعة عبر Google'}
            </Button>
            {!authConfigured && (
              <span className="t-xs t-muted">{en ? 'Google sign-in is not configured in this build.' : 'الدخول عبر Google غير مهيأ في هذا الإصدار.'}</span>
            )}
          </div>
        </div>

        <div className="onboarding__option">
          <span className="onboarding__option-title">{en ? 'Continue as guest' : 'المتابعة كضيف'}</span>
          <p>
            {en
              ? 'Use the app without an account. Everything you add stays on this device only and is not synced anywhere.'
              : 'استخدمي التطبيق من غير حساب. كل حاجة تضيفيها بتفضل على الجهاز ده لوحده ومش بتتزامن.'}
          </p>
          <p className="onboarding__note">
            {en
              ? 'Guest data is temporary: it is never saved to this device or to any account. Reloading the page, closing the app, or losing the device ends the session and everything in it.'
              : 'بيانات الضيف مؤقتة: مش بتتحفظ على الجهاز ولا في أي حساب. عمل تحديث للصفحة أو قفل التطبيق أو فقدان الجهاز بينهي الجلسة وكل حاجة فيها.'}
          </p>
          <div className="onboarding__actions">
            <Button variant="secondary" loading={busy === 'guest'} onClick={chooseGuest}>
              {en ? 'Continue as guest' : 'المتابعة كضيف'}
            </Button>
          </div>
        </div>

        {error && <p className="alert alert--danger" role="alert">{error}</p>}
        {notice && <p className="alert alert--warning">{notice}</p>}
      </div>
    </div>
  )
}
