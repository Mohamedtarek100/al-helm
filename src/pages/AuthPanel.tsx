import { useEffect, useState } from 'react'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Field, TextInput } from '../components/Field'
import { authConfigured, requestPasswordReset, signIn, signInWithGoogle, signOut, signUp } from '../services/auth'
import { supabase } from '../services/persistence/supabase'
import { migrateLocalDataToCloud } from '../services/persistence/cloud-sync'
import { authenticateCloudUser, getActivePersistenceCoordinator, logoutCloudUser } from '../services/store'
import { useI18n } from '../i18n/useI18n'

export function AuthPanel() {
  const { language } = useI18n()
  const en = language === 'en'
  const [email,setEmail]=useState(''), [password,setPassword]=useState(''), [name,setName]=useState(''), [error,setError]=useState(''), [message,setMessage]=useState(''), [busy,setBusy]=useState(false), [mode,setMode]=useState<'login'|'register'>('login'), [user,setUser]=useState<string|null>(null)
  useEffect(() => {
    if (!supabase) return
    let active = true
    void supabase.auth.getUser().then(async ({data}) => {
      if(!active)return
      setUser(data.user?.email??null)
      if(data.user) await authenticateCloudUser(data.user.id)
    })
    const {data}=supabase.auth.onAuthStateChange((event,session)=>{
      if(!active)return
      setUser(session?.user.email??null)
      if(event==='SIGNED_OUT'||!session) logoutCloudUser()
      else if(event==='SIGNED_IN'||event==='TOKEN_REFRESHED') void authenticateCloudUser(session.user.id)
    })
    return ()=>{active=false;data.subscription.unsubscribe()}
  },[])
  const run = async (action:()=>Promise<unknown>) => { setBusy(true); setError('');setMessage('');try{await action();if(supabase){const {data,error:authError}=await supabase.auth.getUser();if(authError)throw authError;setUser(data.user?.email??null);if(data.user)await authenticateCloudUser(data.user.id)}setMessage(en?'Done. Check your email if confirmation is enabled.':'تم. راجعي بريدك لو تأكيد البريد مفعّل.')}catch(e){setError(e instanceof Error?e.message:(en?'Something went wrong.':'حصلت مشكلة.'))}finally{setBusy(false)} }
  return <Card><h2 className="section-head__title">{en?'Cloud account':'الحساب السحابي'}</h2><p className="t-sm t-muted">{!authConfigured?(en?'Cloud account is not configured yet.':'الحساب السحابي غير مهيأ بعد.'):user?(en?`Signed in as ${user}`:`تم تسجيل الدخول: ${user}`):(en?'Sign in to enable cloud data sync.':'سجلي الدخول لتفعيل مزامنة البيانات.')}</p>{authConfigured&&!user&&<><div className="row row--wrap"><Button variant={mode==='login'?'primary':'secondary'} onClick={()=>setMode('login')}>{en?'Sign in':'دخول'}</Button><Button variant={mode==='register'?'primary':'secondary'} onClick={()=>setMode('register')}>{en?'Create account':'حساب جديد'}</Button></div><form className="form-grid" onSubmit={e=>{e.preventDefault();void run(()=>mode==='login'?signIn(email,password):signUp(email,password,name))}}>{mode==='register'&&<Field label={en?'Display name':'الاسم'}><TextInput value={name} onChange={e=>setName(e.target.value)} required /></Field>}<Field label="Email"><TextInput type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email" /></Field><Field label={en?'Password':'كلمة المرور'}><TextInput type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={8} autoComplete={mode==='login'?'current-password':'new-password'} /></Field><Button type="submit" loading={busy}>{mode==='login'?(en?'Sign in':'دخول'):(en?'Create account':'إنشاء الحساب')}</Button></form><div className="row row--wrap"><Button variant="ghost" onClick={()=>void run(()=>requestPasswordReset(email))}>{en?'Forgot password?':'نسيت كلمة المرور؟'}</Button><Button variant="secondary" onClick={()=>void run(signInWithGoogle)}>{en?'Continue with Google':'المتابعة عبر Google'}</Button></div></>}{authConfigured&&user&&<div className="row row--wrap"><Button variant="primary" onClick={()=>void run(async()=>{const {data:{user},error}=await supabase!.auth.getUser();if(error)throw error;if(!user)throw new Error('Sign in is required.');const coordinator=getActivePersistenceCoordinator();await migrateLocalDataToCloud(window.confirm(en?'Upload device data only when cloud is empty?':'ارفعي بيانات الجهاز إذا كانت السحابة فارغة؟'),user.id,coordinator);await authenticateCloudUser(user.id)})}>{en?'Migrate local data to cloud':'نقل البيانات للسحابة'}</Button><Button variant="secondary" onClick={()=>void run(async()=>{await signOut();logoutCloudUser()})}>{en?'Sign out':'تسجيل الخروج'}</Button></div>}{error&&<p role="alert" className="t-sm">{error}</p>}{message&&<p role="status" className="t-sm">{message}</p>}</Card>
}
