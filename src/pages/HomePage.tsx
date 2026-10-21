import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card, CardHeader } from '../components/Card'
import { EmptyState, ProgressBar } from '../components/Display'
import { CheckIcon, CheckSquareIcon, ClockIcon, MonitorIcon, MoonIcon, PaletteIcon, PlusIcon, SparkIcon, SunIcon, TargetIcon, TimerIcon } from '../components/icons'
import { WEEKDAY_SHORT, SUBJECT_COLOR_HEX, SESSION_TYPE_LABELS } from '../services/domain'
import { formatMinutes, formatTime, todayKey } from '../services/date'
import { useI18n } from '../i18n/useI18n'
import { sessionsForDate } from '../services/selectors'
import { useAppData, setTaskCompleted, useSettings, updateSettings } from '../services/store'
import { PageFrame } from './PageFrame'

function SketchHero() {
  return (
    <div className="hero-art" aria-hidden="true">
      <div className="hero-art__wash" />
      <svg viewBox="0 0 240 240" fill="none" role="presentation">
        <circle cx="120" cy="106" r="43" stroke="var(--clay)" strokeWidth="1.5" strokeDasharray="3 7" opacity=".65" />
        <circle cx="120" cy="106" r="29" fill="var(--clay)" opacity=".82" />
        <path d="M52 177c19-31 42-46 68-46s49 15 68 46" stroke="var(--ink-2)" strokeWidth="3" strokeLinecap="round" />
        <path d="M65 179v17m55-61v61m55-17v17" stroke="var(--ink-2)" strokeWidth="2" strokeLinecap="round" opacity=".65" />
        <path d="M40 198c29-8 48 2 77-4 30-6 53-12 83-2" stroke="var(--sage)" strokeWidth="2" strokeLinecap="round" opacity=".8" />
        <path d="M187 72c-11 19-10 39 2 58m-2-37c7-2 11-8 13-15m-12 32c-7-1-12-6-15-13m17 27c8-3 13-8 16-15" stroke="var(--sage)" strokeWidth="2" strokeLinecap="round" />
        <path d="m66 83 4 10 10 4-10 3-4 10-3-10-10-3 10-4 3-10Z" fill="var(--beige)" />
      </svg>
    </div>
  )
}

export function HomePage() {
  const settings = useSettings()
  const themeIcon = settings.theme === 'dark' ? <MoonIcon size={18} /> : settings.theme === 'system' ? <MonitorIcon size={18} /> : <SunIcon size={18} />
  const data = useAppData()
  const { t, language, formatDate, formatNumber } = useI18n()
  const [{ date, hour, todayDate }] = useState(() => {
    const now = new Date()
    return { date: todayKey(), hour: now.getHours(), todayDate: now }
  })
  const formattedDate = formatDate(todayDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const greetingKey = hour < 12 ? 'greetingMorning' : hour < 17 ? 'greetingDay' : 'greetingEvening'
  const greeting = t(greetingKey)
  const todaysTasks = useMemo(() => data.tasks.filter((task) => !task.completed && task.dueDate === date).sort((a,b) => (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99')), [data.tasks, date])
  const todaysSessions = useMemo(() => sessionsForDate(data.sessions, date), [data.sessions, date])
  const done = data.tasks.filter((task) => task.completed && task.completedAt?.slice(0,10) === date).length
  const dailyGoal = data.profile.motto.trim() || t('dailyGoalDefault')
  const total = todaysTasks.length + done
  const weeklyMinutes = Array(7).fill(0) as number[]
  for (const session of data.focusSessions) {
    const weekday = new Date(`${session.date}T12:00:00`).getDay()
    if (session.kind === 'focus') weeklyMinutes[weekday] += session.actualMinutes
  }
  const max = Math.max(60, ...weeklyMinutes)

  return (
    <PageFrame className="page-stack">
      <section className="hero-card">
        <div className="hero-card__content">
          <p className="hero-card__greeting">{greeting}, {data.profile.displayName || (language === 'en' ? 'artist' : 'يا فنانة')} ✨</p>
          <h1 className="hero-card__title">{t('dreamGreeting')}</h1>
          <p className="hero-card__tagline">{t('tagline')}</p>
          <p className="hero-card__date">{formattedDate}</p>
          <button
            className="theme-quick-toggle"
            type="button"
            aria-label={settings.theme === 'dark' ? (language === 'en' ? 'Switch to light mode' : 'التحويل للوضع الفاتح') : (language === 'en' ? 'Switch to dark mode' : 'التحويل للوضع الليلي')}
            onClick={() => { void updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' }).catch(() => {}) }}
          >
            {themeIcon}
            <span>{settings.theme === 'dark' ? (language === 'en' ? 'Light mode' : 'الوضع الفاتح') : (language === 'en' ? 'Dark mode' : 'الوضع الليلي')}</span>
          </button>
          <div className="hero-card__actions">
            <Link to="/tasks"><Button variant="primary" leadingIcon={<PlusIcon size={17} />}>{t('taskNew')}</Button></Link>
            <Link to="/focus"><Button variant="secondary" leadingIcon={<TimerIcon size={17} />}>{t('focusTitle')}</Button></Link>
          </div>
        </div>
        <SketchHero />
      </section>

      <div className="dashboard-grid">
        <div className="dashboard-column">
          <Card>
            <CardHeader title={t('dailyIntention')} subtitle={t('intentionHint')} icon={<TargetIcon size={19} />} />
            <p className="daily-goal">{dailyGoal}</p>
            <div className="today-progress">
              <div className="row row--between t-sm"><span>{t('tasksToday')}</span><span className="t-muted">{formatNumber(done)} / {formatNumber(total)} {t('completedOf')}</span></div>
              <ProgressBar value={total ? done / total : 0} label={t('todayProgress')} height={9} />
              {total === 0 && <p className="t-xs t-muted">{t('emptyTasksBody')}</p>}
            </div>
          </Card>

          <Card>
            <CardHeader title={t('tasksToday')} subtitle={todaysTasks.length ? `${formatNumber(todaysTasks.length)} ${language === 'en' ? 'tasks are waiting' : 'مهام لسه مستنياكي'}` : t('completedOf')} icon={<CheckSquareIcon size={19} />} action={<Link className="text-link" to="/tasks">{t('tasks')} →</Link>} />
            {todaysTasks.length ? <div>{todaysTasks.slice(0,5).map((task) => <div key={task.id} className="task-row">
              <button className="task-check" aria-label={`${language === 'en' ? 'Complete' : 'إتمام'} ${task.title}`} onClick={() => setTaskCompleted(task.id,true)}><CheckIcon size={15} /></button>
              <div className="task-row__body"><p className="task-row__title">{task.title}</p><p className="task-row__meta">{task.dueTime ? formatTime(task.dueTime, language==='en'?'en-US':'ar-EG') : t('today')} · {formatMinutes(task.estimatedMinutes, language==='en'?'en-US':'ar-EG')}</p></div>
              <span className={`priority-dot priority-dot--${task.priority}`} title={task.priority === 'high' ? (language === 'en' ? 'High priority' : 'مهمة') : task.priority === 'medium' ? (language === 'en' ? 'Medium priority' : 'متوسطة') : (language === 'en' ? 'Low priority' : 'هادية')} />
            </div>)}</div> : <EmptyState compact icon={<SparkIcon size={24} />} title={t('noTasks')} message={t('noTasksBody')} action={<Link className="text-link" to="/tasks">{t('addFirstTask')}</Link>} />}
          </Card>

          <Card>
            <CardHeader title={t('upcomingSessions')} subtitle={t('todaysStudySessions')} icon={<ClockIcon size={19} />} action={<Link className="text-link" to="/schedule">{t('schedule')} →</Link>} />
            {todaysSessions.length ? <div>{todaysSessions.slice(0,4).map((session) => {
              const subject = data.subjects.find((item) => item.id === session.subjectId)
              return <div key={session.id} className="session-row"><span className="session-row__time">{formatTime(session.startTime, language==='en'?'en-US':'ar-EG')}</span><span className="session-row__color" style={{'--subject-color': subject ? SUBJECT_COLOR_HEX[subject.color] : 'var(--clay)'} as React.CSSProperties} /><div><p className="session-row__title">{session.title}</p><p className="session-row__meta">{subject?.name ?? (language === 'en' ? 'No subject' : 'بدون مادة')} · {language === 'en' ? session.type : SESSION_TYPE_LABELS[session.type]}</p></div></div>
            })}</div> : <EmptyState compact icon={<ClockIcon size={24} />} title={t('noSessions')} message={t('noSessionsBody')} action={<Link className="text-link" to="/schedule">{t('openSchedule')}</Link>} />}
          </Card>
        </div>

        <div className="dashboard-column">
          <Card>
            <CardHeader title={t('focusWeek')} subtitle={t('completedFocusOnly')} icon={<TimerIcon size={19} />} />
            {data.focusSessions.length ? <><div className="week-strip">{WEEKDAY_SHORT.map((day,index) => <div className="week-day" key={day}><span className="week-day__label">{language === 'en' ? ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][index] : day}</span><span className="week-day__bar"><span className="week-day__fill" style={{height:`${Math.max(4,weeklyMinutes[index]/max*100)}%`}} /></span></div>)}</div><p className="t-xs t-muted" style={{marginTop:12}}>كل جلسة مكتملة بتظهر هنا — دي بيانات رحلتك الفعلية.</p></> : <EmptyState compact icon={<BookIconSafe />} title={t('startJourney')} message={t('firstFocus')} />}
          </Card>
          <div className="encouragement">{t('encouragement')}</div>
          <Card className="dream-card"><div className="dream-card__mark"><PaletteIcon size={21}/></div><p className="dream-card__eyebrow">{t('studio')}</p><h3>{t('dreamStudioIntro')}</h3><p className="t-sm t-muted">{t('dreamStudioBody')}</p><Link to="/studio" className="text-link">{t('enterStudio')} →</Link></Card>
        </div>
      </div>
    </PageFrame>
  )
}

function BookIconSafe(){return <PaletteIcon size={23}/>}
