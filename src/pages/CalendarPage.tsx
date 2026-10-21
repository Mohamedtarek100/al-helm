import { useMemo, useState } from 'react'
import { Button, IconButton } from '../components/Button'
import { Card } from '../components/Card'
import { TextInput } from '../components/Field'
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, TrashIcon } from '../components/icons'
import { todayKey, toDateKey } from '../services/date'
import { createTask, setTaskCompleted, deleteTask, useAppData } from '../services/store'
import { PageFrame, PageHeading } from './PageFrame'
import { useToast } from '../components/toastContext'
import { useI18n } from '../i18n/useI18n'
import type { NewTask } from '../services/store'

const WEEKDAYS_AR = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت']
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function monthDays(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1)
  const startOffset = first.getDay() // 0=Sunday grid
  const days: (Date | null)[] = Array.from({ length: startOffset }, () => null)
  const last = new Date(year, month + 1, 0).getDate()
  for (let d = 1; d <= last; d++) days.push(new Date(year, month, d))
  while (days.length % 7 !== 0) days.push(null)
  return days
}

export function CalendarPage() {
  const { t, language, formatDate } = useI18n()
  const { notify } = useToast()
  const data = useAppData()
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return { y: now.getFullYear(), m: now.getMonth() }
  })
  const [selected, setSelected] = useState(todayKey())
  const [newTitle, setNewTitle] = useState('')

  const cells = useMemo(() => monthDays(cursor.y, cursor.m), [cursor])
  const todayK = todayKey()

  const tasksByDay = useMemo(() => {
    const map = new Map<string, number>()
    for (const task of data.tasks) {
      if (!task.dueDate) continue
      map.set(task.dueDate, (map.get(task.dueDate) ?? 0) + 1)
    }
    return map
  }, [data.tasks])

  const examsByDay = useMemo(() => {
    const map = new Map<string, number>()
    for (const exam of data.exams) {
      const day = toDateKey(new Date(exam.examAt))
      map.set(day, (map.get(day) ?? 0) + 1)
    }
    return map
  }, [data.exams])

  const shift = (delta: number) => {
    setCursor((prev) => {
      const d = new Date(prev.y, prev.m + delta, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })
  }

  const goToday = () => {
    const now = new Date()
    setCursor({ y: now.getFullYear(), m: now.getMonth() })
    setSelected(todayKey())
  }

  const dayTasks = data.tasks.filter((task) => task.dueDate === selected)
  const dayExams = data.exams.filter((exam) => toDateKey(new Date(exam.examAt)) === selected)

  const addTask = async () => {
    const title = newTitle.trim()
    if (!title) return
    const input: NewTask = {
      title,
      description: '',
      subjectId: null,
      dueDate: selected,
      dueTime: '',
      priority: 'medium',
      category: 'study',
      estimatedMinutes: 30,
    }
    try {
      await createTask(input)
      setNewTitle('')
      notify(t('save'), 'success')
    } catch (error) {
      notify(error instanceof Error ? error.message : t('retry'), 'danger')
    }
  }

  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleDateString(language === 'en' ? 'en-US' : 'ar-EG', { month: 'long', year: 'numeric' })
  const weekdays = language === 'en' ? WEEKDAYS_EN : WEEKDAYS_AR

  return (
    <PageFrame className="page-stack">
      <PageHeading eyebrow={t('schedule')} title={t('calendarPage')} subtitle={t('scheduleSubtitle')} />
      <div className="calendar-layout">
        <Card padded={false} className="calendar-card">
          <div className="calendar-head">
            <IconButton label={t('calendarPage')} size="sm" onClick={() => shift(-1)}><ChevronLeftIcon size={17} /></IconButton>
            <strong className="calendar-month">{monthLabel}</strong>
            <IconButton label={t('calendarPage')} size="sm" onClick={() => shift(1)}><ChevronRightIcon size={17} /></IconButton>
          </div>
          <div className="calendar-grid calendar-grid__weekdays" aria-hidden="true">
            {weekdays.map((d) => <span key={d}>{d}</span>)}
          </div>
          <div className="calendar-grid" role="grid" aria-label={monthLabel}>
            {cells.map((date, i) => {
              if (!date) return <span key={`pad-${i}`} className="calendar-cell calendar-cell--pad" />
              const key = toDateKey(date)
              const isToday = key === todayK
              const isSel = key === selected
              const taskCount = tasksByDay.get(key) ?? 0
              const examCount = examsByDay.get(key) ?? 0
              return (
                <button
                  key={key}
                  type="button"
                  role="gridcell"
                  className={`calendar-cell ${isSel ? 'calendar-cell--selected' : ''} ${isToday ? 'calendar-cell--today' : ''} ${examCount ? 'calendar-cell--exam' : ''}`}
                  aria-label={formatDate(key, { weekday: 'long', month: 'long', day: 'numeric' })}
                  aria-pressed={isSel}
                  onClick={() => setSelected(key)}
                >
                  <span className="calendar-cell__num">{date.getDate()}</span>
                  {(taskCount > 0 || examCount > 0) && (
                    <span className="calendar-cell__dots">
                      {examCount > 0 && <i className="calendar-dot calendar-dot--exam" />}
                      {taskCount > 0 && <i className="calendar-dot" />}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <div className="calendar-foot">
            <Button size="sm" variant="secondary" onClick={goToday}>{t('calendarToday')}</Button>
          </div>
        </Card>

        <Card className="calendar-day-panel">
          <h2 className="section-head__title">{formatDate(selected, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
          <div className="row row--wrap" style={{ marginTop: 10 }}>
            <TextInput
              value={newTitle}
              placeholder={t('calendarAddTask')}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { void addTask() } }}
              aria-label={t('calendarAddTask')}
            />
            <Button variant="primary" leadingIcon={<PlusIcon size={16} />} onClick={() => { void addTask() }}>{t('calendarAddTask')}</Button>
          </div>
          {dayExams.length > 0 && (
            <section style={{ marginTop: 14 }}>
              <h3 className="t-sm t-muted">{t('calendarExamsOn')}</h3>
              {dayExams.map((exam) => <p key={exam.id} className="calendar-item calendar-item--exam">📌 {exam.title}</p>)}
            </section>
          )}
          <section style={{ marginTop: 14 }}>
            <h3 className="t-sm t-muted">{t('calendarTasksOn')}</h3>
            {dayTasks.length === 0 && <p className="t-sm t-muted">{t('calendarEmpty')}</p>}
            {dayTasks.map((task) => (
              <div key={task.id} className="calendar-item">
                <button
                  type="button"
                  className={`goal-check ${task.completed ? 'goal-check--done' : ''}`}
                  aria-label={task.completed ? t('goalCompleted') : t('goalOpen')}
                  onClick={() => { void setTaskCompleted(task.id, !task.completed).catch((e: unknown) => notify(e instanceof Error ? e.message : t('retry'), 'danger')) }}
                >
                  {task.completed ? <CheckIcon size={12} /> : ''}
                </button>
                <span className={task.completed ? 'strike' : ''}>{task.title}</span>
                <IconButton
                  label={t('delete')}
                  size="sm"
                  variant="danger"
                  onClick={() => { void deleteTask(task.id).catch((e: unknown) => notify(e instanceof Error ? e.message : t('retry'), 'danger')) }}
                >
                  <TrashIcon size={14} />
                </IconButton>
              </div>
            ))}
          </section>
        </Card>
      </div>
    </PageFrame>
  )
}
