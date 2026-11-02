import { useMemo, useRef, useState } from 'react'
import { Button, IconButton } from '../components/Button'
import { Card } from '../components/Card'
import { ConfirmDialog, Modal } from '../components/Modal'
import { Field, TextInput } from '../components/Field'
import { SubjectSelect } from '../components/SubjectSelect'
import { CheckIcon, PlusIcon, TrashIcon } from '../components/icons'
import { useToast } from '../components/toastContext'
import { deleteTask, createTask, getPendingCloudError, setTaskCompleted, useAppData } from '../services/store'
import { toDateKey, todayKey } from '../services/date'
import { PageFrame, PageHeading } from './PageFrame'
import { useI18n } from '../i18n/useI18n'

function daysInMonth(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1)
  const days: (Date | null)[] = Array.from({ length: first.getDay() }, () => null)
  const last = new Date(year, month + 1, 0).getDate()
  for (let day = 1; day <= last; day += 1) days.push(new Date(year, month, day))
  while (days.length % 7 !== 0) days.push(null)
  return days
}

export function CalendarPage() {
  const { t, language, formatDate } = useI18n()
  const { notify } = useToast()
  const data = useAppData()
  const [cursor, setCursor] = useState(() => { const now = new Date(); return { y: now.getFullYear(), m: now.getMonth() } })
  const [selected, setSelected] = useState(todayKey())
  const [newTitle, setNewTitle] = useState('')
  const [newSubjectId, setNewSubjectId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const addingRef = useRef(false)
  const [removeTask, setRemoveTask] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const cells = useMemo(() => daysInMonth(cursor.y, cursor.m), [cursor])
  const todayK = todayKey()

  const tasksByDay = useMemo(() => {
    const map = new Map<string, number>()
    for (const task of data.tasks) if (task.dueDate) map.set(task.dueDate, (map.get(task.dueDate) ?? 0) + 1)
    return map
  }, [data.tasks])

  const examsByDay = useMemo(() => {
    const map = new Map<string, number>()
    for (const exam of data.exams) { const day = toDateKey(new Date(exam.examAt)); map.set(day, (map.get(day) ?? 0) + 1) }
    return map
  }, [data.exams])

  const shift = (delta: number) => setCursor((prev) => { const d = new Date(prev.y, prev.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() } })
  const goToday = () => { const now = new Date(); setCursor({ y: now.getFullYear(), m: now.getMonth() }); setSelected(todayKey()) }

  const dayTasks = data.tasks.filter((task) => task.dueDate === selected)
  const dayExams = data.exams.filter((exam) => toDateKey(new Date(exam.examAt)) === selected)
  const weekdays = language === 'en' ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت']
  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleDateString(language === 'en' ? 'en-US' : 'ar-EG', { month: 'long', year: 'numeric' })

  const addTask = async () => {
    if (addingRef.current) return
    const title = newTitle.trim()
    if (!title) return
    addingRef.current = true
    setAdding(true)
    try {
      const task = await createTask({ title, description: '', subjectId: newSubjectId, dueDate: selected, dueTime: '', priority: 'medium', category: 'study', estimatedMinutes: 30 })
      setNewTitle('')
      setNewSubjectId(null)
      setAddOpen(false)
      notify(
        task.writeResult === 'local-only'
          ? getPendingCloudError() ? t('taskSavedCloudPending') : t('taskSavedDeviceOnly')
          : t('taskAdded'),
        task.writeResult === 'cloud' ? 'success' : 'warning',
      )
    } catch (error) {
      notify(error instanceof Error ? error.message : t('retry'), 'danger')
    } finally {
      addingRef.current = false
      setAdding(false)
    }
  }

  const closeAddForm = () => {
    if (!addingRef.current) setAddOpen(false)
  }

  return (
    <PageFrame className="page-stack">
      <PageHeading
        eyebrow={t('schedule')}
        title={t('calendarPage')}
        subtitle={t('scheduleSubtitle')}
        action={<Button variant="primary" leadingIcon={<PlusIcon size={16} />} onClick={() => setAddOpen(true)}>{t('calendarAddTask')}</Button>}
      />
      <div className="calendar-layout">
        <Card padded={false} className="calendar-card">
          <div className="calendar-head">
            <IconButton label={t('calendarPage')} size="sm" onClick={() => shift(-1)}>‹</IconButton>
            <strong className="calendar-month">{monthLabel}</strong>
            <IconButton label={t('calendarPage')} size="sm" onClick={() => shift(1)}>›</IconButton>
          </div>
          <div className="calendar-grid calendar-grid__weekdays" aria-hidden="true">{weekdays.map((day) => <span key={day}>{day}</span>)}</div>
          <div className="calendar-grid" role="grid" aria-label={monthLabel}>
            {cells.map((date, index) => {
              if (!date) return <span key={`pad-${index}`} className="calendar-cell calendar-cell--pad" />
              const key = toDateKey(date)
              const taskCount = tasksByDay.get(key) ?? 0
              const examCount = examsByDay.get(key) ?? 0
              return (
                <button
                  key={key}
                  type="button"
                  role="gridcell"
                  className={`calendar-cell ${key === selected ? 'calendar-cell--selected' : ''} ${key === todayK ? 'calendar-cell--today' : ''} ${examCount ? 'calendar-cell--exam' : ''}`}
                  aria-label={formatDate(key, { weekday: 'long', month: 'long', day: 'numeric' })}
                  aria-pressed={key === selected}
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
          <div className="calendar-foot"><Button size="sm" variant="secondary" onClick={goToday}>{t('calendarToday')}</Button></div>
        </Card>

        <Card className="calendar-day-panel">
          <h2 className="section-head__title">{formatDate(selected, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
          {dayExams.length > 0 && (
            <section className="calendar-section">
              <h3 className="t-sm t-muted">{t('calendarExamsOn')}</h3>
              {dayExams.map((exam) => <p key={exam.id} className="calendar-item calendar-item--exam">📌 {exam.title}</p>)}
            </section>
          )}
          <section className="calendar-section">
            <div className="row row--between">
              <h3 className="t-sm t-muted">{t('calendarTasksOn')}</h3>
              <Button size="sm" variant="ghost" leadingIcon={<PlusIcon size={15} />} onClick={() => setAddOpen(true)}>{t('calendarAddTask')}</Button>
            </div>
            {dayTasks.length === 0 && <p className="t-sm t-muted">{t('calendarEmpty')}</p>}
            {dayTasks.map((task) => (
              <div key={task.id} className="calendar-item">
                <button
                  type="button"
                  className={`task-check ${task.completed ? 'task-check--done' : ''}`}
                  aria-label={task.completed ? t('goalCompleted') : t('goalOpen')}
                  aria-pressed={task.completed}
                  onClick={async () => {
                    try {
                      const result = await setTaskCompleted(task.id, !task.completed)
                      notify(
                        result === 'local-only'
                          ? getPendingCloudError() ? t('taskSavedCloudPending') : t('taskSavedDeviceOnly')
                          : task.completed ? (language === 'en' ? 'Task reopened.' : 'رجعت المهمة للقائمة.') : t('taskCompleted'),
                        result === 'cloud' ? 'success' : 'warning',
                      )
                    }
                    catch (error) { notify(error instanceof Error ? error.message : t('retry'), 'danger') }
                  }}
                >
                  {task.completed ? <CheckIcon size={13} /> : ''}
                </button>
                <span className={task.completed ? 'strike' : ''}>{task.title}</span>
                <IconButton label={t('delete')} size="sm" variant="danger" onClick={() => setRemoveTask(task.id)}><TrashIcon size={14} /></IconButton>
              </div>
            ))}
          </section>
        </Card>
      </div>

      <Modal
        open={addOpen}
        onClose={closeAddForm}
        title={t('calendarAddTask')}
        subtitle={formatDate(selected, { weekday: 'long', day: 'numeric', month: 'long' })}
        variant="sheet"
        footer={<><Button variant="ghost" disabled={adding} onClick={closeAddForm}>{t('cancel')}</Button><Button variant="primary" type="submit" form="calendar-task-form" loading={adding}>{t('save')}</Button></>}
      >
        <form id="calendar-task-form" className="form-grid" onSubmit={(event) => { event.preventDefault(); void addTask() }}>
          <Field label={t('taskTitle')} required className="form-grid__full">
            <TextInput autoFocus value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder={t('calendarAddTask')} />
          </Field>
          <Field label={t('subjectLabel')} className="form-grid__full">
            <SubjectSelect value={newSubjectId} onChange={setNewSubjectId} onError={(message) => notify(message, 'danger')} />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!removeTask}
        title={t('delete')}
        message={language === 'en' ? 'Delete this task?' : 'تحذفي المهمة دي؟'}
        destructive
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        onConfirm={async () => {
          const id = removeTask
          if (!id) return
          try {
            const result = await deleteTask(id)
            setRemoveTask(null)
            notify(
              result === 'local-only'
                ? getPendingCloudError() ? t('taskSavedCloudPending') : t('taskSavedDeviceOnly')
                : t('taskDeleted'),
              result === 'cloud' ? 'info' : 'warning',
            )
          } catch (error) { notify(error instanceof Error ? error.message : t('retry'), 'danger') }
        }}
        onCancel={() => setRemoveTask(null)}
      />
    </PageFrame>
  )
}
