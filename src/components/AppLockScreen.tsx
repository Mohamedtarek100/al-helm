import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { Button } from '../components/Button'
import {
  readLockRecord,
  verifyPin,
  isValidPin,
  beginLockRecovery,
  cancelLockRecovery,
  submitGuestRecoveryKey,
  issueRecoveryToken,
  resetLockAfterOwnershipProof,
  hasGuestRecoveryKey,
  markAccountRecoveryVerified,
  type RecoveryToken,
} from '../services/appLock'
import { verifyAccountOwnershipForRecovery } from '../services/lockRecovery'
import { authenticateWithBiometrics, checkBiometricSupport } from '../services/biometric'

/**
 * Full-screen lock. Rendered OVER the app (never instead of it), so unlocking
 * restores exactly where the user left off and no app state is remounted.
 *
 * SECURITY — this screen is the only thing between a locked device and the
 * customer's data.
 *
 *   - The PIN is verified locally against a PBKDF2 hash; a wrong entry only
 *     clears the field.
 *   - Biometric unlock is delegated to the OS/Keystore.
 *   - "Forgot PIN?" does NOT unlock the app. It opens a RECOVERY CEREMONY that
 *     must independently prove ownership of either the account (Supabase
 *     re-authentication with the account password) or, for a guest, the
 *     one-time recovery key shown when the lock was created.
 *   - The lock is removed only after that ceremony produces a single-use token,
 *     which is spent by `resetLockAfterOwnershipProof`.
 *
 * There is deliberately NO developer backdoor, master PIN, universal recovery
 * code, or "just remove the lock" button. The previous implementation had one:
 * a single confirmation press called clearLockRecord() and let anyone into a
 * guest's data. That is fixed here and pinned by appLockRecovery.test.ts.
 */

export interface AppLockScreenProps {
  onUnlocked: () => void
  /** Called after a VERIFIED recovery removed the lock. Must sign out and re-authenticate. */
  onRecovered: (owner: 'account' | 'guest') => void
  /** The email of the account signed in on this device, when there is one. */
  accountEmail?: string | null
}

type Step = 'pin' | 'recoverChoice' | 'recoverGuest' | 'recoverAccount' | 'newPin' | 'done'

export function AppLockScreen({ onUnlocked, onRecovered, accountEmail = null }: AppLockScreenProps) {
  const { language } = useI18n()
  const en = language === 'en'
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [step, setStep] = useState<Step>('pin')
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [recoveryKey, setRecoveryKey] = useState('')
  const [accountPassword, setAccountPassword] = useState('')
  const [newPin, setNewPin] = useState('')
  const [newPinConfirm, setNewPinConfirm] = useState('')
  const token = useRef<RecoveryToken | null>(null)
  const attempts = useRef(0)

  const record = readLockRecord()

  useEffect(() => {
    let active = true
    void checkBiometricSupport().then((result) => { if (active) setBiometricAvailable(result.available) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!record?.biometricEnabled || !biometricAvailable) return
    void tryBiometric()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biometricAvailable])

  async function tryBiometric() {
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

  /* ---------------- recovery ---------------- */

  const startRecovery = () => {
    const started = beginLockRecovery()
    if (!started) { setError(en ? 'No lock is configured.' : 'مفيش قفل متسجل.'); return }
    setChallengeId(started.id)
    setError('')
    setStep('recoverChoice')
  }

  const cancelRecovery = () => {
    cancelLockRecovery()
    token.current = null
    setChallengeId(null)
    setRecoveryKey('')
    setAccountPassword('')
    setNewPin('')
    setNewPinConfirm('')
    setError('')
    setStep('pin')
  }

  /** Guest: the one-time recovery key issued when the lock was created. */
  const submitGuestKey = async () => {
    if (!challengeId) return
    setBusy(true)
    try {
      const ok = await submitGuestRecoveryKey(challengeId, recoveryKey)
      if (!ok) {
        setError(en ? 'That recovery key is not valid for this device.' : 'مفتاح الاسترجاع ده مش صحيح للجهاز ده.')
        return
      }
      token.current = await issueRecoveryToken({ owner: 'guest' })
      if (!token.current) { setError(en ? 'Recovery could not be completed.' : 'مقدرناش نكمّل الاسترجاع.'); return }
      setError('')
      setStep('newPin')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Account: re-authenticate with the ACCOUNT PASSWORD through Supabase.
   * Only a session whose user id matches the account that owns this device is
   * accepted. Typing an email address proves nothing and is not offered.
   */
  const submitAccountRecovery = async () => {
    if (!challengeId) return
    setBusy(true)
    try {
      const result = await verifyAccountOwnershipForRecovery(accountPassword)
      if (!result.ok) {
        setError(result.message)
        return
      }
      if (!markAccountRecoveryVerified(challengeId, result.userId, result.expectedUserId)) {
        setError(en
          ? 'This device belongs to a different account. Sign in as that account to recover.'
          : 'الجهاز ده تابع لحساب تاني. سجّلي الدخول بالحساب الصح للاسترجاع.')
        return
      }
      // Account recovery also signs out, so the recovered session is re-established
      // knowingly rather than carried over implicitly.
      token.current = await issueRecoveryToken({ owner: 'account' })
      if (!token.current) { setError(en ? 'Recovery could not be completed.' : 'مقدرناش نكمّل الاسترجاع.'); return }
      setError('')
      setStep('newPin')
    } finally {
      setBusy(false)
    }
  }

  /** Spends the verified token and unlocks; the caller re-authenticates. */
  const finishRecovery = async () => {
    if (!token.current) return
    if (!isValidPin(newPin)) {
      setError(en ? 'Choose a PIN of 4 to 8 digits.' : 'اختاري رمز من ٤ لـ ٨ أرقام.')
      return
    }
    if (newPin !== newPinConfirm) {
      setError(en ? 'The two PINs do not match.' : 'الرمزين مش متطابقين.')
      return
    }
    setBusy(true)
    try {
      const owner = token.current.owner
      const removed = await resetLockAfterOwnershipProof(token.current)
      if (!removed) {
        setError(en ? 'Recovery has expired. Start again.' : 'الاسترجاع انتهت صلاحيته. ابدأي من جديد.')
        setStep('pin')
        return
      }
      token.current = null
      setStep('done')
      onRecovered(owner)
    } finally {
      setBusy(false)
    }
  }

  const title = step === 'pin'
    ? (en ? 'Enter your PIN' : 'ادخلي الرمز')
    : step === 'recoverChoice'
      ? (en ? 'Recover access' : 'استرجاع الدخول')
      : step === 'recoverGuest'
        ? (en ? 'Recovery key' : 'مفتاح الاسترجاع')
        : step === 'recoverAccount'
          ? (en ? 'Confirm your account' : 'تأكيد الحساب')
          : (en ? 'Choose a new PIN' : 'اختاري رمز جديد')

  return (
    <div className="app-lock" role="dialog" aria-modal="true" aria-label={en ? 'App locked' : 'التطبيق مقفول'}>
      <div className="app-lock__panel">
        <h2 style={{ margin: 0 }}>{title}</h2>
        <p className="t-sm t-muted">
          {step === 'pin'
            ? (en ? '4uLife is locked on this device.' : '4uLife مقفول على الجهاز ده.')
            : (en ? 'Your data has not been unlocked yet.' : 'بياناتك لسه مقفولة.')}
        </p>

        {step === 'pin' && (
          <>
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

            <button type="button" className="link-button" onClick={startRecovery}>
              {en ? 'Forgot your PIN?' : 'نسيتِ الرمز؟'}
            </button>
          </>
        )}

        {step === 'recoverChoice' && (
          <>
            <p className="t-sm" role="note">
              {en
                ? 'Recovering access requires proving that this device is yours. The PIN itself cannot be recovered.'
                : 'الاسترجاع محتاج إثبات إن الجهاز ده بتاعك. الرمز نفسه مش ممكن استرجاعه.'}
            </p>
            {accountEmail ? (
              <Button variant="primary" onClick={() => { setError(''); setStep('recoverAccount') }}>
                {en ? 'Verify my account' : 'تأكيد حسابي'}
              </Button>
            ) : null}
            {hasGuestRecoveryKey() ? (
              <Button variant={accountEmail ? 'secondary' : 'primary'} onClick={() => { setError(''); setStep('recoverGuest') }}>
                {en ? 'Use my recovery key' : 'استخدم مفتاح الاسترجاع'}
              </Button>
            ) : (
              <p className="t-xs t-muted">
                {en
                  ? 'No recovery key is stored on this device. Without one, the lock cannot be removed and your local data cannot be opened.'
                  : 'مفيش مفتاح استرجاع محفوظ على الجهاز. من غيره القفل مش هيتشال والبيانات المحلية مش هتتفتح.'}
              </p>
            )}
            <p className="app-lock__error" role="alert">{error}</p>
            <Button variant="ghost" onClick={cancelRecovery}>{en ? 'Back to PIN' : 'رجوع للرمز'}</Button>
          </>
        )}

        {step === 'recoverGuest' && (
          <form onSubmit={(event) => { event.preventDefault(); void submitGuestKey() }}>
            <label className="field">
              <span className="field__label">{en ? 'Recovery key' : 'مفتاح الاسترجاع'}</span>
              <input
                className="input"
                autoFocus
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                value={recoveryKey}
                onChange={(event) => { setRecoveryKey(event.target.value); setError('') }}
                placeholder="XXXX-XXXX-XXXX"
              />
            </label>
            <p className="t-xs t-muted">
              {en
                ? 'This is the one-time key shown when you set up the lock. It is single use and never leaves this device.'
                : 'ده المفتاح اللي ظهر مرة واحدة وقت تفعيل القفل. بيتستخدم مرة واحدة ومش بيطلع من الجهاز.'}
            </p>
            <p className="app-lock__error" role="alert">{error}</p>
            <div className="row">
              <Button variant="primary" type="submit" loading={busy}>{en ? 'Verify key' : 'تأكيد المفتاح'}</Button>
              <Button variant="ghost" onClick={cancelRecovery}>{en ? 'Cancel' : 'إلغاء'}</Button>
            </div>
          </form>
        )}

        {step === 'recoverAccount' && (
          <form onSubmit={(event) => { event.preventDefault(); void submitAccountRecovery() }}>
            <p className="t-sm">
              {en ? 'Enter the password for ' : 'اكتبي كلمة سر حساب '}
              <strong>{accountEmail}</strong>
            </p>
            <label className="field">
              <span className="field__label">{en ? 'Account password' : 'كلمة سر الحساب'}</span>
              <input
                className="input"
                type="password"
                autoFocus
                autoComplete="current-password"
                value={accountPassword}
                onChange={(event) => { setAccountPassword(event.target.value); setError('') }}
              />
            </label>
            <p className="t-xs t-muted">
              {en
                ? 'Your account password is checked by the account provider, not by this device.'
                : 'كلمة السر بتتأكد من مزود الحساب مش من الجهاز.'}
            </p>
            <p className="app-lock__error" role="alert">{error}</p>
            <div className="row">
              <Button variant="primary" type="submit" loading={busy}>{en ? 'Verify account' : 'تأكيد الحساب'}</Button>
              <Button variant="ghost" onClick={cancelRecovery}>{en ? 'Cancel' : 'إلغاء'}</Button>
            </div>
          </form>
        )}

        {step === 'newPin' && (
          <form onSubmit={(event) => { event.preventDefault(); void finishRecovery() }}>
            <p className="t-sm t-muted">
              {en ? 'Ownership verified. Set a new PIN to remove the lock.' : 'تم التأكد من الملكية. اختاري رمز جديد لإزالة القفل.'}
            </p>
            <label className="field">
              <span className="field__label">{en ? 'New PIN' : 'رمز جديد'}</span>
              <input
                className="input"
                type="password"
                inputMode="numeric"
                autoFocus
                maxLength={8}
                value={newPin}
                onChange={(event) => { setNewPin(event.target.value.replace(/\D/g, '')); setError('') }}
              />
            </label>
            <label className="field">
              <span className="field__label">{en ? 'Confirm new PIN' : 'تأكيد الرمز'}</span>
              <input
                className="input"
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={newPinConfirm}
                onChange={(event) => { setNewPinConfirm(event.target.value.replace(/\D/g, '')); setError('') }}
              />
            </label>
            <p className="app-lock__error" role="alert">{error}</p>
            <div className="row">
              <Button variant="primary" type="submit" loading={busy}>{en ? 'Unlock and continue' : 'فتح ومتابعة'}</Button>
              <Button variant="ghost" onClick={cancelRecovery}>{en ? 'Cancel' : 'إلغاء'}</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
