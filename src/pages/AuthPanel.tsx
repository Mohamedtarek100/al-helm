import { useEffect, useState } from 'react'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Field, TextInput } from '../components/Field'
import { authConfigured, describeAuthError, requestPasswordReset, signIn, signInWithGoogle, signOut, signUp, type AuthUserView } from '../services/auth'
import { AccountAvatar } from '../components/AccountAvatar'
import { resolveProfilePhoto } from '../services/profilePhoto'
import { supabase } from '../services/persistence/supabase'
import { migrateLocalDataToCloud } from '../services/persistence/cloud-sync'
import { activePersistenceMode, authenticateCloudUser, getActivePersistenceCoordinator, logoutCloudUser, useAppData } from '../services/store'
import { useI18n } from '../i18n/useI18n'

/**
 * Cloud account panel.
 *
 * Migration is explicit and never automatic: when local data exists and the
 * account is empty, the user sees a button that describes exactly what will be
 * uploaded. A populated account is never overwritten by local data.
 */
export function AuthPanel() {
  const { language } = useI18n()
  const data = useAppData()
  const en = language === 'en'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [user, setUser] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [storageMode, setStorageMode] = useState<'local' | 'cloud'>(() => activePersistenceMode())
  /** Full user view (email + metadata) so the Google photo can be shown. */
  const [authUser, setAuthUser] = useState<AuthUserView | null>(null)
  const displayName = resolveProfilePhoto(authUser).displayName

  useEffect(() => {
    if (!supabase) return
    let active = true
    void supabase.auth.getUser().then(async ({ data: result }) => {
      if (!active) return
      setUser(result.user?.email ?? null)
      setUserId(result.user?.id ?? null)
      setAuthUser(result.user ? { email: result.user.email ?? null, user_metadata: result.user.user_metadata ?? null } : null)
      if (result.user) await authenticateCloudUser(result.user.id)
      if (active) setStorageMode(activePersistenceMode())
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      setUser(session?.user.email ?? null)
      setUserId(session?.user.id ?? null)
      setAuthUser(session?.user ? { email: session.user.email ?? null, user_metadata: session.user.user_metadata ?? null } : null)
      if (event === 'SIGNED_OUT' || !session) {
        void logoutCloudUser().then(() => setStorageMode(activePersistenceMode()))
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        void authenticateCloudUser(session.user.id).then(() => setStorageMode(activePersistenceMode()))
      }
    })
    return () => { active = false; sub.subscription.unsubscribe() }
  }, [])

  const run = async (action: () => Promise<unknown>, successText?: string) => {
    setBusy(true); setError(''); setMessage('')
    try {
      await action()
      if (supabase) {
        const { data: auth, error: authError } = await supabase.auth.getUser()
        if (authError) throw authError
        setUser(auth.user?.email ?? null)
        setUserId(auth.user?.id ?? null)
        setAuthUser(auth.user ? { email: auth.user.email ?? null, user_metadata: auth.user.user_metadata ?? null } : null)
        if (auth.user) await authenticateCloudUser(auth.user.id)
        setStorageMode(activePersistenceMode())
      }
      setMessage(successText ?? (en ? 'Done. Check your email if confirmation is enabled.' : 'تم. راجعي بريدك لو تأكيد البريد مفعّل.'))
    } catch (e) {
      // Provider/config failures return raw codes such as
      // "Unsupported provider: provider is not enabled"; translate them into a
      // message the user can act on instead of leaking backend internals.
      setError(
        describeAuthError(e instanceof Error ? { message: e.message } : null) ??
        (en ? 'Something went wrong.' : 'حصلت مشكلة.'),
      )
    } finally {
      setBusy(false)
    }
  }

  const hasLocalContent = data.tasks.length + data.subjects.length + data.sessions.length + data.artworks.length > 0
  const needsMigration = Boolean(userId) && storageMode === 'local'

  return (
    <Card className="settings-card">
      <h2 className="section-head__title">{en ? 'Cloud account' : 'الحساب السحابي'}</h2>
      {user ? (
        <div className="account-row">
          {/* Google profile photo, with an initial-based fallback. */}
          <AccountAvatar user={authUser} size={44} />
          <div className="account-row__text">
            <b className="account-row__name">{displayName || (en ? 'Signed in' : 'تم تسجيل الدخول')}</b>
            <p className="t-sm t-muted">{en ? `Signed in as ${user}` : `تم تسجيل الدخول: ${user}`}</p>
          </div>
        </div>
      ) : (
        <p className="t-sm t-muted">
          {!authConfigured
            ? (en ? 'Cloud account is not configured in this build — everything stays on this device.' : 'الحساب السحابي غير مهيأ في هذا الإصدار — كل حاجة محفوظة على الجهاز.')
            : (en ? 'Sign in to sync your tasks, subjects and artwork across devices.' : 'سجلي الدخول لمزامنة المهام والمواد والأعمال بين الأجهزة.')}
        </p>
      )}
      {user && (
        <p className={`alert ${storageMode === 'cloud' ? 'alert--success' : 'alert--warning'}`}>
          {storageMode === 'cloud'
            ? (en ? 'Cloud sync is active. Changes are saved to your account.' : 'المزامنة السحابية شغالة. كل التغييرات بتتحفظ في حسابك.')
            : (en ? 'This device is using local data only for now.' : 'الجهاز ده بيستخدم البيانات المحلية حاليًا.')}
        </p>
      )}

      {authConfigured && !user && (
        <>
          <div className="segmented segmented--block" role="tablist" aria-label={en ? 'Account action' : 'إجراء الحساب'} style={{ marginBottom: 12 }}>
            <button type="button" role="tab" aria-selected={mode === 'login'} className={`segmented__item ${mode === 'login' ? 'segmented__item--active' : ''}`} onClick={() => setMode('login')}>{en ? 'Sign in' : 'دخول'}</button>
            <button type="button" role="tab" aria-selected={mode === 'register'} className={`segmented__item ${mode === 'register' ? 'segmented__item--active' : ''}`} onClick={() => setMode('register')}>{en ? 'Create account' : 'حساب جديد'}</button>
          </div>
          <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void run(() => mode === 'login' ? signIn(email, password) : signUp(email, password, name)) }}>
            {mode === 'register' && (
              <Field label={en ? 'Display name' : 'الاسم'} className="form-grid__full">
                <TextInput value={name} onChange={(event) => setName(event.target.value)} required autoComplete="name" />
              </Field>
            )}
            <Field label="Email" className="form-grid__full">
              <TextInput type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
            </Field>
            <Field
              label={en ? 'Password' : 'كلمة المرور'}
              className="form-grid__full"
              hint={mode === 'register' ? (en ? 'At least 8 characters.' : '٨ حروف على الأقل.') : undefined}
            >
              <TextInput type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            </Field>
            <Button type="submit" variant="primary" loading={busy} className="form-grid__full">
              {mode === 'login' ? (en ? 'Sign in' : 'دخول') : (en ? 'Create account' : 'إنشاء الحساب')}
            </Button>
          </form>
          <div className="row row--wrap" style={{ marginTop: 10 }}>
            <Button size="sm" variant="ghost" onClick={() => void run(() => requestPasswordReset(email))}>{en ? 'Forgot password?' : 'نسيت كلمة المرور؟'}</Button>
            <Button size="sm" variant="secondary" onClick={() => void run(signInWithGoogle)}>{en ? 'Continue with Google' : 'المتابعة عبر Google'}</Button>
          </div>
        </>
      )}

      {authConfigured && user && (
        <div className="row row--wrap" style={{ marginTop: 10 }}>
          {needsMigration && hasLocalContent && (
            <Button
              variant="primary"
              loading={busy}
              onClick={() => void run(async () => {
                if (!userId) throw new Error('Sign in is required.')
                await migrateLocalDataToCloud(true, userId, getActivePersistenceCoordinator())
                setStorageMode(activePersistenceMode())
              }, en ? 'Local data uploaded to your account.' : 'تم رفع البيانات المحلية لحسابك.')}
            >
              {en ? `Upload ${data.subjects.length} subjects & ${data.tasks.length} tasks to this account` : `ارفعي ${data.subjects.length} مادة و${data.tasks.length} مهمة للحساب ده`}
            </Button>
          )}
          <Button variant="secondary" loading={busy} onClick={() => void run(signOut)}>{en ? 'Sign out' : 'تسجيل الخروج'}</Button>
        </div>
      )}

      {error && <p className="alert alert--danger" role="alert">{error}</p>}
      {message && <p className="alert alert--success">{message}</p>}
    </Card>
  )
}
