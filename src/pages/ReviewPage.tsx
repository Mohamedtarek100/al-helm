import { useState } from 'react'
import { Card } from '../components/Card'
import { useI18n } from '../i18n/useI18n'
import { todayKey, formatMinutes } from '../services/date'
import { useAppData } from '../services/store'
import { PageFrame, PageHeading } from './PageFrame'

export function ReviewPage() {
  const data=useAppData(),{language,formatNumber}=useI18n()
  const [{from,to,weekday}]=useState(()=>{
    const nowDate=new Date(),start=new Date(nowDate)
    start.setDate(nowDate.getDate()-((nowDate.getDay()+6)%7));start.setHours(0,0,0,0)
    return {from:start.toISOString().slice(0,10),to:todayKey(),weekday:nowDate.getDay()}
  })
  const focus=data.focusSessions.filter(s=>s.kind==='focus'&&s.date>=from&&s.date<=to)
  const completed=data.tasks.filter(task=>task.completed&&task.completedAt&&task.completedAt.slice(0,10)>=from&&task.completedAt.slice(0,10)<=to)
  const planned=data.sessions.filter(s=>s.recurrence==='weekly'||(s.date>=from&&s.date<=to)).filter(s=>s.recurrence==='weekly'?s.weekday>=0&&s.weekday<=weekday:true)
  const totalFocus=focus.reduce((sum,s)=>sum+s.actualMinutes,0)
  const locale=language==='en'?'en-US':'ar-EG'
  const rows=[
    {label:language==='en'?'Completed focus sessions':'جلسات التركيز المكتملة',value:formatNumber(focus.length)},
    {label:language==='en'?'Recorded focus time':'وقت التركيز المسجّل',value:formatMinutes(totalFocus,locale)},
    {label:language==='en'?'Tasks completed':'المهام المكتملة',value:formatNumber(completed.length)},
    {label:language==='en'?'Planned sessions':'الجلسات المخططة',value:formatNumber(planned.length)},
  ]
  return <PageFrame className="page-stack"><PageHeading eyebrow={language==='en'?'A gentle weekly reflection':'مراجعة أسبوعية هادئة'} title={language==='en'?'Weekly review':'مراجعة الأسبوع'} subtitle={language==='en'?`Real activity from ${from} through ${to}.`:`نشاطك الحقيقي من ${from} إلى ${to}.`} /><div className="grid grid--2">{rows.map(row=><Card key={row.label}><p className="t-sm t-muted">{row.label}</p><strong className="studio-count">{row.value}</strong></Card>)}</div><Card><h2 className="section-head__title">{language==='en'?'A note for next week':'ملاحظة للأسبوع القادم'}</h2><p className="t-sm t-muted">{language==='en'?'Use these saved records to decide what felt manageable. Nothing is rescheduled automatically.':'استخدمي السجل لتختاري ما يناسبك الأسبوع القادم. لا يتم تعديل الجدول تلقائيًا.'}</p></Card></PageFrame>
}
