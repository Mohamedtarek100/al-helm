import { useEffect, useState } from 'react'
import { Button } from './Button'
import { Card } from './Card'
import { Field, Select, TextInput } from './Field'
import { useI18n } from '../i18n/useI18n'
import { useToast } from './toastContext'
import { disableLock, getLockSettings, isValidPin, setPin, MAX_PIN_LENGTH, MIN_PIN_LENGTH } from '../services/appLock'
import { checkBiometricSupport } from '../services/biometric'
import { resetLaunchMode, useLaunchMode } from '../services/onboarding'

/**
 * Device-lock settings.
 *
 * The lock protects THIS device only, so the copy says so. Enabling or changing
 * it requires the current PIN when one exists. Devices without biometrics get
 * a clean PIN-only path instead of a disabled feature.
 */
export function AppLockSettings() {
  const { language } = useI18n()
  const { notify } = useToast()
  const en = language === 'en'
  const [settings, setSettings] = useState(getLockSettings())
  const [biometricSupported, setBiometricSupported] = useState(false)
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [biometric, setBiometric] = useState(settings.biometricEnabled)
  const [idleMinutes, setIdleMinutes] = useState(settings.idleMinutes)
  const [busy, setBusy] = useState(false)
  const launchMode = useLaunchMode()
  const [error, setError] = useState('')
  const [welcomeReset, setWelcomeReset] = useState(false)

  useEffect(() => {
    void checkBiometricSupport().then((result) => setBiometricSupported(result.available))
  }, [])

  const save = async () => {
    setError('')
    if (!isValidPin(newPin)) {
      setError(en ? `Use ${MIN_PIN_LENGTH}–${MAX_PIN_LENGTH} digits.` : `استخدمي من ${MIN_PIN_LENGTH} إلى ${MAX_PIN_LENGTH} أرقام.`)
      return
    }
    if (newPin !== confirmPin) {
      setError(en ? 'The two PINs do not match.' : 'الرمزان مش متطابقين.')
      return
    }
    setBusy(true)
    try {
      await setPin(newPin, {
        currentPin: settings.enabled ? currentPin : undefined,
        biometricEnabled: biometricSupported ? biometric : false,
        idleMinutes,
      })
      setSettings(getLockSettings())
      setCurrentPin(''); setNewPin(''); setConfirmPin('')
      notify(en ? 'App lock enabled.' : 'قفل التطبيق اتفعّل.', 'success')
    } catch (e) {
      setError(e instanceof Error ? e.message : (en ? 'Could not save the PIN.' : 'تعذر حفظ الرمز.'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setError('')
    setBusy(true)
    try {
      await disableLock(currentPin)
      setSettings(getLockSettings())
      setCurrentPin(''); setNewPin(''); setConfirmPin('')
      notify(en ? 'App lock removed.' : 'قفل التطبيق اتشال.', 'info')
    } catch (e) {
      setError(e instanceof Error ? e.message : (en ? 'Could not remove the lock.' : 'تعذر إزالة القفل.'))
    } finally {
      setBusy(false)
    }
  }

  const lockAfterLabel = en ? 'Lock after' : 'القفل بعد'
  const biometricHint = biometricSupported
    ? undefined
    : (en ? 'Biometrics are not available on this device; PIN only.' : 'البصمة مش متاحة على الجهاز ده؛ الرمز بس.')

  return (
    <Card className="settings-card">
      <h2 className="section-head__title">{en ? 'App lock' : 'قفل التطبيق'}</h2>
      <p className="t-sm t-muted">
        {en
          ? 'A PIN locks 4uLife on this device only. It is never uploaded and does not follow your account to another device. Your PIN cannot be recovered — keep it somewhere safe.'
          : 'الرمز بيقفل 4uLife على الجهاز ده بس. مش بيترفع ولا بيتنقل مع حسابك لجهاز تاني. الرمز مش ممكن استرجاعه — احفظيه في مكان آمن.'}
      </p>

      <div className="form-grid">
        {settings.enabled && (
          <Field label={en ? 'Current PIN' : 'الرمز الحالي'} className="form-grid__full">
            <TextInput type="password" inputMode="numeric" maxLength={MAX_PIN_LENGTH} value={currentPin} onChange={(e) => setCurrentPin(e.target.value)} autoComplete="current-password" />
          </Field>
        )}
        <Field label={settings.enabled ? (en ? 'New PIN' : 'الرمز الجديد') : (en ? 'PIN' : 'الرمز')} className="form-grid__full">
          <TextInput type="password" inputMode="numeric" maxLength={MAX_PIN_LENGTH} value={newPin} onChange={(e) => setNewPin(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label={en ? 'Confirm PIN' : 'تأكيد الرمز'} className="form-grid__full">
          <TextInput type="password" inputMode="numeric" maxLength={MAX_PIN_LENGTH} value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label={lockAfterLabel} className="form-grid__full" hint={biometricHint}>
        <Select value={String(idleMinutes)} onChange={(e) => setIdleMinutes(Number(e.target.value))}>
          <option value="0">{en ? 'When I leave the app' : 'لما أخرج من التطبيق'}</option>
          <option value="1">{en ? '1 minute' : 'دقيقة'}</option>
          <option value="5">{en ? '5 minutes' : '٥ دقائق'}</option>
          <option value="15">{en ? '15 minutes' : '١٥ دقيقة'}</option>
        </Select>
      </Field>
      {biometricSupported && (
        <label className="row form-grid__full" style={{ gap: 8 }}>
          <input type="checkbox" checked={biometric} onChange={(e) => setBiometric(e.target.checked)} />
          <span>{en ? 'Also allow fingerprint / face unlock' : 'اسمحي كمان بفتح بالبصمة / الوجه'}</span>
        </label>
      )}
    </div>

      { error && <p className="alert alert--danger" role="alert">{error}</p> }

  <div className="row row--wrap" style={{ marginTop: 12 }}>
    <Button variant="primary" loading={busy} onClick={() => void save()}>
      {settings.enabled ? (en ? 'Change PIN' : 'تغيير الرمز') : (en ? 'Enable app lock' : 'تفعيل القفل')}
    </Button>
    {settings.enabled && (
      <Button variant="danger" loading={busy} onClick={() => void remove()}>
        {en ? 'Remove lock' : 'إزالة القفل'}
      </Button>
    )}
  </div>

      <hr className="divider" />
      <p className="t-sm t-muted">
        {launchMode === 'guest'
          ? (en ? 'You are using guest mode: data stays on this device.' : 'أنت في وضع الضيف: البيانات على الجهاز ده بس.')
          : launchMode === 'google'
            ? (en ? 'You chose the account option. Sign in from the account panel above.' : 'اخترتِ خيار الحساب. سجّلي الدخول من لوحة الحساب فوق.')
            : (en ? 'No start-up choice has been recorded yet.' : 'مفيش اختيار بداية مسجل لحد الآن.')}
      </p>
      <Button size="sm" variant="ghost" onClick={() => { resetLaunchMode(); setWelcomeReset(true) }}>
        {welcomeReset
          ? (en ? 'The welcome screen will appear on the next launch.' : 'شاشة الترحيب هتظهر في التشغيل الجاي.')
          : (en ? 'Show the welcome choice again' : 'إظهار شاشة الترحيب تاني')}
      </Button>
    </Card>
  )
}
