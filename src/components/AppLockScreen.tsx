import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { Button } from './Button'
import { readLockRecord, verifyPin, clearLockRecord, isValidPin } from '../services/appLock'
import { authenticateWithBiometrics, checkBiometricSupport } from '../services/biometric'

/**
 * Full-screen lock. Rendered over the app (never instead of it), so unlocking
 * restores exactly where the user left off and no app state is remounted or
 * lost.
 *
 * Biometric unlock is attempted once on mount when enabled; if the device or
 * plugin declines, the PIN keypad remains the path. Neither route can delete
 * data — "forgot PIN" only removes the device lock after explicit confirmation.
 */

export interface AppLockScreenProps {
  onUnlocked: () => void
  /** Notifies the shell so it can hand control to the account panel. */
  onForgotPin: () => void
}

export function AppLockScreen({ onUnlocked, onForgotPin }: AppLockScreenProps) {
  const { language } = useI18n()
  const en = language === 'en'
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmForgot, setConfirmForgot] = useState(false)
  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const attempts = useRef(0)

  const record = readLockRecord()

  useEffect(() => {
    let active = true
    void checkBiometricSupport().then((result) => { if (active) setBiometricAvailable(result.available) })
    return () => { active = false }
  }, [])

  // Try biometrics once, and only when the user enabled them.
  useEffect(() => {
    if (!record?.biometricEnabled || !biometricAvailable) return
    void tryBiometric()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biometricAvailable])

  async function tryBiometric() {
    // Cancelled or unavailable falls back to the PIN quietly.
    if (await authenticateWithBiometrics(en ? 'Unlock 4uLife' : 'فتح 4uLife', en ? 'Use PIN' : 'استخدم الرمز')) onUnlocked()
  }

  async function submit(candidate: string) {
    const current = readLockRecord()
    if (!current) { onUnlocked(); return }
    setBusy(true)
    try {
      if (await verifyPin(candidate, current)) {
        attempts.current = 0
        onUnlocked()
      } else {
        attempts.current += 1
        setError(en ? 'Wrong PIN. Try again.' : 'الرمز غلط. حاولي تاني.')
        setPin('')
      }
    } finally {
      setBusy(false)
    }
  }

  const press = (digit: string) => {
    if (busy) return
    setError('')
    const next = pin + digit
    setPin(next)
    if (next.length >= 4 && isValidPin(next) && next.length === 4) void submit(next)
  }

  const forgetPin = () => {
    // Only the DEVICE LOCK is removed. Tasks, subjects and cloud data are
    // untouched; a signed-in user signs in again through their provider.
    clearLockRecord()
    onForgotPin()
  }

  return (
    <div className="app-lock" role="dialog" aria-modal="true" aria-label={en ? 'App locked' : 'التطبيق مقفول'}>
      <div className="app-lock__panel">
        <h2 style={{ margin: 0 }}>{en ? 'Enter your PIN' : 'ادخلي الرمز'}</h2>
        <p className="t-sm t-muted">{en ? '4uLife is locked on this device.' : '4uLife مقفول على الجهاز ده.'}</p>

        <div className="app-lock__dots" aria-hidden="true">
          {Array.from({ length: Math.max(4, pin.length) }).map((_, index) => (
            <span key={index} className={`app-lock__dot ${index < pin.length ? 'app-lock__dot--on' : ''}`} />
          ))}
        </div>

        <p className="app-lock__error" role="alert">{error}</p>

        <div className="app-lock__keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button key={digit} type="button" className="btn btn--secondary app-lock__key" onClick={() => press(digit)}>{digit}</button>
          ))}
          <button type="button" className="btn btn--ghost app-lock__key" onClick={() => setPin(pin.slice(0, -1))} aria-label={en ? 'Delete' : 'حذف'}>⌫</button>
          <button type="button" className="btn btn--secondary app-lock__key" onClick={() => press('0')}>0</button>
          <button type="button" className="btn btn--ghost app-lock__key" onClick={() => void submit(pin)} aria-label={en ? 'Unlock' : 'فتح'}>✓</button>
        </div>

        {record?.biometricEnabled && biometricAvailable && (
          <Button variant="ghost" onClick={() => void tryBiometric()}>{en ? 'Use fingerprint / face' : 'استخدمي البصمة / الوجه'}</Button>
        )}

        {!confirmForgot ? (
          <button type="button" className="link-button" onClick={() => setConfirmForgot(true)}>
            {en ? 'Forgot your PIN?' : 'نسيتِ الرمز؟'}
          </button>
        ) : (
          <div role="alertdialog" aria-label={en ? 'Reset lock' : 'إعادة تعيين القفل'}>
            <p className="t-sm">
              {en
                ? 'The PIN cannot be recovered. Removing the lock signs you out of this device and deletes the lock only — your tasks, subjects and account data are kept. A guest cannot restore a lost account; sign in with Google to get cloud data back.'
                : 'الرمز مش ممكن استرجاعه. إزالة القفل بتسجل خروج على الجهاز وتمسح القفل بس — مهامك وموادك وبيانات حسابك بتفضل. حساب الضيف مش ممكن استرجاعه، سجّلي الدخول بـ Google لرجوع بيانات السحابة.'}
            </p>
            <div className="row">
              <Button variant="danger" onClick={forgetPin}>{en ? 'Remove lock and sign out' : 'إزالة القفل وتسجيل الخروج'}</Button>
              <Button variant="ghost" onClick={() => setConfirmForgot(false)}>{en ? 'Cancel' : 'إلغاء'}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
