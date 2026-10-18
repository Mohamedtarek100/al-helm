import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card, CardHeader } from '../components/Card'
import { EmptyState, ProgressBar } from '../components/Display'
import { CheckIcon, CheckSquareIcon, ClockIcon, PaletteIcon, PlusIcon, SparkIcon, TargetIcon, TimerIcon } from '../components/icons'
import { WEEKDAY_SHORT, SUBJECT_COLOR_HEX, SESSION_TYPE_LABELS } from '../services/domain'
import { formatLongDate, formatMinutes, formatTime, greetingForHour, todayKey } from '../services/date'
import { sessionsForDate } from '../services/selectors'
import { useAppData, setTaskCompleted } from '../services/store'
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
  const data = useAppData()
  const [{ date, formattedDate, hour }] = useState(() => {
    const now = new Date()
    return { date: todayKey(), formattedDate: formatLongDate(now), hour: now.getHours() }
  })
  const todaysTasks = useMemo(() => data.tasks.filter((task) => !task.completed && task.dueDate === date).sort((a,b) => (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99')), [data.tasks, date])
  const todaysSessions = useMemo(() => sessionsForDate(data.sessions, date), [data.sessions, date])
  const done = data.tasks.filter((task) => task.completed && task.completedAt?.slice(0,10) === date).length
  const dailyGoal = data.profile.motto.trim() || 'خطوة صغيرة كل يوم، تقرّبك من مرسمك.'
  const total = todaysTasks.length + done
  const weeklyMinutes = Array(7).fill(0) as number[]
  for (const session of data.focusSessions) {
    const weekday = new Date(`${session.date}T12:00:00`).getDay()
    if (session.kind === 'focus') weeklyMinutes[weekday] += session.actualMinutes
  }
  const max = Math.max(60, ...weeklyMinutes)
  const greeting = greetingForHour(hour)

  return (
    <PageFrame className="page-stack">
      <section className="hero-card">
        <div className="hero-card__content">
          <p className="hero-card__greeting">{greeting}، {data.profile.displayName || 'يا فنانة'} ✨</p>
          <h1 className="hero-card__title">الحُلم</h1>
          <p className="hero-card__tagline">كل صفحة بتذاكريها، بتقرّبك من الحلم.</p>
          <p className="hero-card__date">{formattedDate}</p>
          <div className="hero-card__actions">
            <Link to="/tasks"><Button variant="primary" leadingIcon={<PlusIcon size={17} />}>مهمة جديدة</Button></Link>
            <Link to="/focus"><Button variant="secondary" leadingIcon={<TimerIcon size={17} />}>ابدئي جلسة تركيز</Button></Link>
          </div>
        </div>
        <SketchHero />
      </section>

      <div className="dashboard-grid">
        <div className="dashboard-column">
          <Card>
            <CardHeader title="هدف النهارده" subtitle="نية بسيطة تكفي كبداية" icon={<TargetIcon size={19} />} />
            <p className="daily-goal">{dailyGoal}</p>
            <div className="today-progress">
              <div className="row row--between t-sm"><span>مهام اليوم</span><span className="t-muted">{done} من {total} خلصت</span></div>
              <ProgressBar value={total ? done / total : 0} label="إنجاز مهام اليوم" height={9} />
              {total === 0 && <p className="t-xs t-muted">لما تضيفي مهامك، هتظهر هنا بهدوء.</p>}
            </div>
          </Card>

          <Card>
            <CardHeader title="مهام النهارده" subtitle={todaysTasks.length ? `${todaysTasks.length} مهام لسه مستنياكي` : 'كل خطوة صغيرة محسوبة'} icon={<CheckSquareIcon size={19} />} action={<Link className="text-link" to="/tasks">كل المهام ←</Link>} />
            {todaysTasks.length ? <div>{todaysTasks.slice(0,5).map((task) => <div key={task.id} className="task-row">
              <button className="task-check" aria-label={`إتمام ${task.title}`} onClick={() => setTaskCompleted(task.id,true)}><CheckIcon size={15} /></button>
              <div className="task-row__body"><p className="task-row__title">{task.title}</p><p className="task-row__meta">{task.dueTime ? formatTime(task.dueTime) : 'خلال اليوم'} · {formatMinutes(task.estimatedMinutes)}</p></div>
              <span className={`priority-dot priority-dot--${task.priority}`} title={task.priority === 'high' ? 'مهمة' : task.priority === 'medium' ? 'متوسطة' : 'هادية'} />
            </div>)}</div> : <EmptyState compact icon={<SparkIcon size={24} />} title="يومك لسه ورقة فاضية" message="ضيفي مهمة أو استمتعي ببداية هادية." action={<Link className="text-link" to="/tasks">أضيفي أول مهمة</Link>} />}
          </Card>

          <Card>
            <CardHeader title="جلسات قريبة" subtitle="مواعيدك الدراسية لليوم" icon={<ClockIcon size={19} />} action={<Link className="text-link" to="/schedule">الجدول ←</Link>} />
            {todaysSessions.length ? <div>{todaysSessions.slice(0,4).map((session) => {
              const subject = data.subjects.find((item) => item.id === session.subjectId)
              return <div key={session.id} className="session-row"><span className="session-row__time">{formatTime(session.startTime)}</span><span className="session-row__color" style={{'--subject-color': subject ? SUBJECT_COLOR_HEX[subject.color] : 'var(--clay)'} as React.CSSProperties} /><div><p className="session-row__title">{session.title}</p><p className="session-row__meta">{subject?.name ?? 'بدون مادة'} · {SESSION_TYPE_LABELS[session.type]}</p></div></div>
            })}</div> : <EmptyState compact icon={<ClockIcon size={24} />} title="مفيش جلسات مجدولة" message="رتّبي وقتك براحتك، يوم بيوم." action={<Link className="text-link" to="/schedule">افتحي الجدول</Link>} />}
          </Card>
        </div>

        <div className="dashboard-column">
          <Card>
            <CardHeader title="أسبوعك في التركيز" subtitle="وقت مسجل من جلسات تركيز مكتملة" icon={<TimerIcon size={19} />} />
            {data.focusSessions.length ? <><div className="week-strip">{WEEKDAY_SHORT.map((day,index) => <div className="week-day" key={day}><span className="week-day__label">{day}</span><span className="week-day__bar"><span className="week-day__fill" style={{height:`${Math.max(4,weeklyMinutes[index]/max*100)}%`}} /></span></div>)}</div><p className="t-xs t-muted" style={{marginTop:12}}>كل جلسة مكتملة بتظهر هنا — دي بيانات رحلتك الفعلية.</p></> : <EmptyState compact icon={<BookIconSafe />} title="رحلتك لسه بتبدأ" message="أول جلسة تركيز هتبدأ ترسم أسبوعك هنا." />}
          </Card>
          <div className="encouragement">«الطريق للفن يبدأ بخط واحد، والطريق للحلم يبدأ بصفحة واحدة.»</div>
          <Card className="dream-card"><div className="dream-card__mark"><PaletteIcon size={21}/></div><p className="dream-card__eyebrow">مرسم الحلم</p><h3>مساحة صغيرة لفنكِ</h3><p className="t-sm t-muted">أهدافك، أفكارك، وأعمالك الفنية — كلها في مكان واحد.</p><Link to="/studio" className="text-link">ادخلي المرسم ←</Link></Card>
        </div>
      </div>
    </PageFrame>
  )
}

function BookIconSafe(){return <PaletteIcon size={23}/>}
