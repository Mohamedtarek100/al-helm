import { Card } from '../components/Card'
import { EmptyState, ProgressBar, StatTile } from '../components/Display'
import { AwardIcon, CheckSquareIcon, ClockIcon, PaletteIcon, SparkIcon, TimerIcon } from '../components/icons'
import { WEEKDAY_SHORT } from '../services/domain'
import { formatMinutes } from '../services/date'
import { useAppData } from '../services/store'
import { useState } from 'react'
import { PageFrame, PageHeading } from './PageFrame'
import { useI18n } from '../i18n/useI18n'

const englishDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function ProgressPage() {
  const d = useAppData()
  const { t, language, formatNumber } = useI18n()
  const completed = d.tasks.filter(x => x.completed).length
  const sessions = d.focusSessions.filter(x => x.kind === 'focus')
  const minutes = sessions.reduce((sum, x) => sum + x.actualMinutes, 0)
  const goals = d.goals.filter(x => x.completed).length
  const challenges = d.challenges.filter(x => x.completed).length
  const [start] = useState(() => { const date = new Date(); date.setDate(date.getDate() - 6); return date })
  const activity = Array.from({ length: 7 }, (_, i) => { const date = new Date(start); date.setDate(start.getDate() + i); const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; return { key, day: language === 'en' ? englishDays[date.getDay()] : WEEKDAY_SHORT[date.getDay()], minutes: sessions.filter(x => x.date === key).reduce((sum, x) => sum + x.actualMinutes, 0) } })
  const max = Math.max(30, ...activity.map(x => x.minutes))
  const hasActivity = completed + sessions.length + goals + challenges > 0
  return <PageFrame className="page-stack">
    <PageHeading eyebrow={t('progressEyebrow')} title={t('progress')} subtitle={t('progressSubtitle')} />
    {!hasActivity && <Card><EmptyState icon={<SparkIcon size={25} />} title={t('emptyProgressTitle')} message={t('emptyProgressBody')} /></Card>}
    <div className="grid grid--4"><StatTile label={t('completedTasks')} value={formatNumber(completed)} icon={<CheckSquareIcon />} accent="var(--sage)" /><StatTile label={t('focusSessionsCount')} value={formatNumber(sessions.length)} icon={<TimerIcon />} accent="var(--clay)" /><StatTile label={t('recordedFocusTime')} value={formatMinutes(minutes,language==='en'?'en-US':'ar-EG')} icon={<ClockIcon />} accent="var(--dusty-blue)" /><StatTile label={t('artGoalsCount')} value={formatNumber(goals)} hint={`${formatNumber(challenges)} ${t('drawingExercises')}`} icon={<PaletteIcon />} accent="var(--plum)" /></div>
    <Card><h2 className="section-head__title">{t('focusLast7')}</h2><p className="t-xs t-muted" style={{ marginTop: 4 }}>{t('completedOnly')}</p><div className="chart-bars">{activity.map(a => <div className="chart-bar" key={a.key} title={`${formatMinutes(a.minutes,language==='en'?'en-US':'ar-EG')} · ${a.key}`}><div className="chart-bar__track"><span className="chart-bar__fill" style={{ height: `${Math.max(3, a.minutes / max * 100)}%` }} /></div><span className="chart-bar__label">{a.day}</span></div>)}</div>{!sessions.length && <p className="t-sm t-muted" style={{ marginTop: 13 }}>{t('noSessionsYet')}</p>}</Card>
    <Card><h2 className="section-head__title">{t('subjectGoals')}</h2>{d.subjects.filter(s => s.weeklyTargetMinutes > 0).length ? d.subjects.filter(s => s.weeklyTargetMinutes > 0).map(s => { const subjectMinutes = d.focusSessions.filter(f => f.subjectId === s.id && f.kind === 'focus').reduce((sum, f) => sum + f.actualMinutes, 0); return <div className="subject-progress" key={s.id}><div className="row row--between"><b>{s.name}</b><span className="t-xs t-muted">{formatMinutes(subjectMinutes,language==='en'?'en-US':'ar-EG')} / {formatMinutes(s.weeklyTargetMinutes,language==='en'?'en-US':'ar-EG')}</span></div><ProgressBar value={subjectMinutes / s.weeklyTargetMinutes} height={8} /></div> }) : <p className="t-sm t-muted">{t('configureSubjectGoal')}</p>}</Card>
    <Card><div className="row"><AwardIcon /><div><h2 className="section-head__title">{t('achievementsArt')}</h2><p className="t-sm t-muted">{formatNumber(goals)} {t('goalsCompletedCount')} · {formatNumber(challenges)} {t('challengesCompletedCount')}</p></div></div></Card>
  </PageFrame> }
