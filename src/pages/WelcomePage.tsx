import { useState } from 'react'
import { Button } from '../components/Button'
import { useI18n } from '../i18n/useI18n'
import { authConfigured, describeAuthError, signInWithGoogle } from '../services/auth'
import { setLaunchMode } from '../services/onboarding'

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
export function WelcomePage({ onDone }: { onDone: () => void }) {
  const { language } = useI18n()
  const en = language === 'en'
  const [busy, setBusy] = useState<'google' | 'guest' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const chooseGuest = () => {
    setBusy('guest')
    setError(null)
    const persisted = setLaunchMode('guest')
    if (!persisted) {
      setNotice(en ? 'You can continue, but this device cannot remember the choice.' : 'تقدري تكبّدي، بس الجهاز مش هيفتكر الاختيار.')
    }
    onDone()
    setBusy(null)
  }

  const continueWithGoogle = async () => {
    setBusy('google')
    setError(null)
    try {
      const { error: authError } = await signInWithGoogle()
      // A provider failure is shown here; a successful call redirects away.
      if (authError) {
        setError(describeAuthError(authError) ?? (en ? 'Google sign-in could not start.' : 'تعذر بدء الدخول عبر Google.'))
        setBusy(null)
        return
      }
      // The redirect leaves the page; record the intent for returning users.
      const persisted = setLaunchMode('google')
      if (!persisted) setBusy(null)
    } catch (e) {
      // Cancelling the popup/provider or losing the network lands here.
      setError(describeAuthError(e instanceof Error ? { message: e.message } : null) ?? (en ? 'Google sign-in was cancelled.' : 'تم إلغاء الدخول عبر Google.'))
      setBusy(null)
    }
  }

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
              ? 'Uninstalling the app, clearing its data, or losing the device can permanently remove guest data — there is no backup or password recovery for a guest account yet.'
              : 'مسح التطبيق أو مسح بياناته أو فقدان الجهاز ممكن يضيّع بيانات الضيف نهائيًا — مفيش نسخة احتياطية ولا استرجاع كلمة مرور لحساب الضيف لحد الآن.'}
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
