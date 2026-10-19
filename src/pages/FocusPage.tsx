import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Field, Select, TextInput } from '../components/Field'
import { PauseIcon, PlayIcon, ResetIcon } from '../components/icons'
import { formatMinutes, todayKey } from '../services/date'
import { recordFocusSession, useAppData, useSettings, updateSettings } from '../services/store'
import { PageFrame, PageHeading } from './PageFrame'
import { useToast } from '../components/toastContext'

type Kind='focus'|'shortBreak'|'longBreak'
const labels:Record<Kind,string>={focus:'وقت التركيز',shortBreak:'استراحة قصيرة',longBreak:'استراحة طويلة'}

export function FocusPage(){
 const data=useAppData(),settings=useSettings(),{notify}=useToast()
 const [kind,setKind]=useState<Kind>('focus'),[running,setRunning]=useState(false),[remaining,setRemaining]=useState(settings.focusMinutes*60),[duration,setDuration]=useState(settings.focusMinutes*60),[subjectId,setSubjectId]=useState(''),[taskId,setTaskId]=useState('')
 const endAt=useRef<number|null>(null),targetSeconds=useRef(settings.focusMinutes*60),completedRef=useRef(false)
 const secondsFor = useCallback((k: Kind) => k === 'focus' ? settings.focusMinutes * 60 : k === 'shortBreak' ? settings.shortBreakMinutes * 60 : settings.longBreakMinutes * 60, [settings.focusMinutes, settings.shortBreakMinutes, settings.longBreakMinutes])
 const choose = (k: Kind) => { setRunning(false); setKind(k); const next = secondsFor(k); targetSeconds.current = next; setDuration(next); setRemaining(next); endAt.current = null; completedRef.current = false }
 useEffect(() => {
   if (!running) return
   const timer = window.setInterval(() => {
     const deadline = endAt.current
     if (deadline === null) return
     const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
     setRemaining(seconds)
     if (seconds > 0) return
     endAt.current = null
     setRunning(false)
     if (kind === 'focus' && !completedRef.current) {
       completedRef.current = true
       const completedAt = new Date().toISOString()
       recordFocusSession({ subjectId: subjectId || null, taskId: taskId || null, kind: 'focus', plannedMinutes: targetSeconds.current / 60, actualMinutes: Math.round(targetSeconds.current / 60), date: todayKey(), completedAt })
       notify('جلسة تركيز مكتملة — برافو عليكي!', 'success')
     } else notify(kind === 'focus' ? 'الجلسة خلصت. خدي نفس وارتاحي.' : 'الاستراحة خلصت، جاهزة ترجعي؟', 'info')
   }, 250)
   return () => window.clearInterval(timer)
 }, [running, kind, notify, subjectId, taskId])
 const total = duration
 const progress = total ? 1 - remaining / total : 0
 const r = 117
 const circ = 2 * Math.PI * r
 const mm=String(Math.floor(remaining/60)).padStart(2,'0'),ss=String(remaining%60).padStart(2,'0')
 const todayFocus=data.focusSessions.filter(s=>s.kind==='focus'&&s.date===todayKey())
 const totalToday=todayFocus.reduce((sum,s)=>sum+s.actualMinutes,0)
 const start=()=>{const duration = remaining > 0 ? remaining : targetSeconds.current; if(remaining <= 0) setRemaining(duration); completedRef.current=false; endAt.current=Date.now()+duration*1000; setRunning(true)}
 const pause=()=>{if(endAt.current !== null){setRemaining(Math.max(0,Math.ceil((endAt.current-Date.now())/1000)));endAt.current=null}setRunning(false)}
 const reset=()=>{setRunning(false);endAt.current=null;completedRef.current=false;const next=secondsFor(kind);targetSeconds.current=next;setDuration(next);setRemaining(next)}
 const changeDuration=(field:'focusMinutes'|'shortBreakMinutes',value:number)=>{const minutes=Math.max(1,Math.min(field==='focusMinutes'?120:60,value||1));updateSettings({[field]:minutes});if(!running&&((kind==='focus'&&field==='focusMinutes')||(kind==='shortBreak'&&field==='shortBreakMinutes'))){targetSeconds.current=minutes*60;setDuration(minutes*60);setRemaining(minutes*60)}}
 return <PageFrame className="page-stack"><PageHeading eyebrow="خدي نفس وابدئي" title="جلسة تركيز" subtitle="جلسة واحدة هادية أحسن من خطة كبيرة متعبة."/>
 <div className="focus-layout"><section className="focus-stage"><div className={`focus-ring ${kind!=='focus'?'focus-ring--break':''}`}><svg viewBox="0 0 250 250" aria-hidden="true"><circle className="focus-ring__track" cx="125" cy="125" r={r}/><circle className="focus-ring__value" cx="125" cy="125" r={r} strokeDasharray={circ} strokeDashoffset={circ*progress}/></svg><div className="focus-ring__text"><span className="focus-ring__time">{mm}:{ss}</span><span className="focus-ring__label">{labels[kind]}</span></div></div>
 <div className="segmented" role="tablist" aria-label="نوع المؤقت">{(['focus','shortBreak','longBreak'] as Kind[]).map(k=><button key={k} role="tab" aria-selected={kind===k} className={`segmented__item ${kind===k?'segmented__item--active':''}`} onClick={()=>choose(k)}>{k==='focus'?'تركيز':k==='shortBreak'?'راحة قصيرة':'راحة طويلة'}</button>)}</div>
 <div className="focus-controls">{running?<Button variant="primary" size="lg" leadingIcon={<PauseIcon/>} onClick={pause}>إيقاف مؤقت</Button>:<Button variant="primary" size="lg" leadingIcon={<PlayIcon/>} onClick={start}>{remaining<total?'استكملي الجلسة':'ابدئي التركيز'}</Button>}<Button variant="ghost" size="lg" aria-label="إعادة ضبط" onClick={reset}><ResetIcon/></Button></div>
 <p className="t-sm t-muted t-center">لما المؤقت يخلص، سجّلي جلسة مكتملة تلقائيًا.</p></section>
 <div className="dashboard-column"><Card><h2 className="section-head__title">رتّبي الجلسة</h2><div className="focus-settings"><Field label="المادة (اختياري)"><Select value={subjectId} onChange={e=>setSubjectId(e.target.value)}><option value="">بدون مادة</option>{data.subjects.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field><Field label="المهمة (اختياري)"><Select value={taskId} onChange={e=>setTaskId(e.target.value)}><option value="">بدون مهمة</option>{data.tasks.filter(t=>!t.completed).map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</Select></Field><div className="form-grid"><Field label="تركيز بالدقائق"><TextInput type="number" min={1} max={120} value={settings.focusMinutes} onChange={e=>changeDuration('focusMinutes',Number(e.target.value))}/></Field><Field label="راحة بالدقائق"><TextInput type="number" min={1} max={60} value={settings.shortBreakMinutes} onChange={e=>changeDuration('shortBreakMinutes',Number(e.target.value))}/></Field></div></div></Card>
 <Card><h2 className="section-head__title">تركيز النهارده</h2><p className="focus-summary__value">{formatMinutes(totalToday)}</p><p className="t-xs t-muted">{todayFocus.length} جلسات مكتملة مسجلة اليوم</p>{!todayFocus.length&&<p className="t-sm t-muted">أول جلسة تركيز مكتملة هتبدأ سجلّك.</p>}<Link to="/progress" className="text-link">شوفي إنجازاتك ←</Link></Card>
 <div className="notice-card">المؤقت يحتاج الصفحة مفتوحة في المتصفح. التنبيهات في الخلفية غير مضمونة في المرحلة دي.</div></div></div></PageFrame>
}

