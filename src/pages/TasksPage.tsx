import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { Task, TaskCategory, TaskPriority } from '../types'
import { Button, IconButton } from '../components/Button'
import { Card } from '../components/Card'
import { ConfirmDialog, Modal } from '../components/Modal'
import { EmptyState } from '../components/Display'
import { Field, Select, TextArea, TextInput } from '../components/Field'
import { CheckIcon, CheckSquareIcon, EditIcon, PlusIcon, TrashIcon } from '../components/icons'
import { describeDueDate, formatMinutes, formatTime, todayKey } from '../services/date'
import { emptyTaskFilter, filterTasks, sortTasks, type TaskFilter, type TaskSortKey, type TaskStatusFilter, isTaskOverdue } from '../services/taskSelectors'
import { createTask, deleteTask, setTaskCompleted, updateTask, useAppData, type NewTask } from '../services/store'
import { PageFrame, PageHeading } from './PageFrame'
import { useToast } from '../components/toastContext'
import { useI18n } from '../i18n/useI18n'

const blank = (): NewTask => ({ title: '', description: '', subjectId: null, dueDate: todayKey(), dueTime: '', priority: 'medium', category: 'study', estimatedMinutes: 30 })
export function TasksPage() {
  const data = useAppData()
  const { notify } = useToast()
  const { t, language, formatNumber } = useI18n()
  const statusOptions: { value: TaskStatusFilter; label: string }[] = [
    { value: 'all', label: t('filterAll') }, { value: 'open', label: t('filterOpen') },
    { value: 'today', label: t('tasksToday') }, { value: 'overdue', label: t('filterOverdue') }, { value: 'done', label: t('filterDone') },
  ]
  const categoryLabels: Record<TaskCategory, string> = { study: t('categoryStudy'), homework: t('categoryHomework'), revision: t('categoryRevision'), practice: t('categoryPractice'), art: t('categoryArt'), other: t('categoryOther') }
  const priorityLabels: Record<TaskPriority, string> = { low: t('priorityLabelLow'), medium: t('priorityLabelMedium'), high: t('priorityLabelHigh') }
  const [filter, setFilter] = useState<TaskFilter>(emptyTaskFilter)
  const [sort, setSort] = useState<TaskSortKey>('due')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [deleting, setDeleting] = useState<Task | null>(null)
  const [form, setForm] = useState<NewTask>(blank())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const visible = useMemo(() => sortTasks(filterTasks(data.tasks, filter), sort), [data.tasks, filter, sort])

  const openForm = (task?: Task) => {
    setEditing(task ?? null)
    setForm(task ? { title: task.title, description: task.description, subjectId: task.subjectId, dueDate: task.dueDate, dueTime: task.dueTime, priority: task.priority, category: task.category, estimatedMinutes: task.estimatedMinutes } : blank())
    setErrors({})
    setOpen(true)
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    const next: Record<string, string> = {}
    if (!form.title.trim()) next.title = t('required')
    if (form.estimatedMinutes < 5 || form.estimatedMinutes > 600) next.estimatedMinutes = language === 'en' ? 'Choose a duration from 5 to 600 minutes.' : 'اختاري مدة من ٥ إلى ٦٠ دقيقة.'
    if (Object.keys(next).length) { setErrors(next); return }
    try {
      if (editing) await updateTask(editing.id, form)
      else await createTask(form)
      setOpen(false)
      notify(editing ? t('taskSaved') : t('taskAdded'), 'success')
    } catch (error) {
      notify(error instanceof Error ? error.message : t('retry'), 'danger')
    }
  }
  const remove = async () => {
    if (!deleting) return
    try { await deleteTask(deleting.id); setDeleting(null); notify(t('taskDeleted'), 'info') }
    catch (error) { notify(error instanceof Error ? error.message : t('retry'), 'danger') }
  }
  const reschedule = async (task: Task) => {
    const next = new Date(`${task.dueDate || todayKey()}T12:00:00`); next.setDate(next.getDate() + 1)
    const key = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
    try { await updateTask(task.id, { dueDate: key }); notify(language === 'en' ? 'Task moved to tomorrow.' : 'اتنقلت المهمة لبكرة.', 'success') }
    catch (error) { notify(error instanceof Error ? error.message : t('retry'), 'danger') }
  }

  return <PageFrame className="page-stack">
    <PageHeading eyebrow={language === 'en' ? 'One step at a time' : 'خطوة بخطوة'} title={t('tasks')} subtitle={language === 'en' ? 'A flexible list to help shape your day without pressure.' : 'قائمة مرنة تساعدك ترتبي يومك من غير ضغط.'} action={<Button variant="primary" leadingIcon={<PlusIcon size={17} />} onClick={() => openForm()}>{t('taskNew')}</Button>} />
    <Card className="task-toolbar"><div className="task-filters"><div className="filter-tabs">{statusOptions.map(item => <button key={item.value} className={`filter-tab ${filter.status === item.value ? 'filter-tab--active' : ''}`} onClick={() => setFilter({ ...filter, status: item.value })}>{item.label}{item.value === 'open' && <span>{data.tasks.filter(t => !t.completed).length}</span>}</button>)}</div><div className="filter-selects"><Select aria-label={language === 'en' ? 'Filter by subject' : 'تصفية حسب المادة'} value={filter.subjectId} onChange={e => setFilter({ ...filter, subjectId: e.target.value })}><option value="all">{language === 'en' ? 'All subjects' : 'كل المواد'}</option>{data.subjects.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</Select><Select aria-label={language === 'en' ? 'Sort tasks' : 'ترتيب المهام'} value={sort} onChange={e => setSort(e.target.value as TaskSortKey)}><option value="due">{language === 'en' ? 'Due date' : 'الأقرب موعدًا'}</option><option value="priority">{t('taskPriority')}</option><option value="created">{language === 'en' ? 'Recently added' : 'الأحدث إضافة'}</option></Select><TextInput type="date" aria-label={language === 'en' ? 'Specific date' : 'تاريخ محدد'} value={filter.date} onChange={e => setFilter({ ...filter, date: e.target.value })} /></div></div></Card>
    {visible.length ? <div className="task-list">{visible.map(task => {
      const subject = data.subjects.find(s => s.id === task.subjectId)
      const overdue = isTaskOverdue(task)
      return <Card key={task.id} className={`task-card ${task.completed ? 'task-card--done' : ''} ${overdue ? 'task-card--overdue' : ''}`} padded={false}>
        <div className="task-card__check"><button className={`task-check ${task.completed ? 'task-check--done' : ''}`} aria-label={task.completed ? (language === 'en' ? 'Reopen task' : 'إعادة فتح المهمة') : `${t('taskComplete')} ${task.title}`} onClick={async () => { try { await setTaskCompleted(task.id, !task.completed); notify(task.completed ? (language === 'en' ? 'Task reopened.' : 'رجعت المهمة للقائمة.') : t('taskCompleted'), 'success') } catch (error) { notify(error instanceof Error ? error.message : t('retry'), 'danger') } }}><CheckIcon size={15} /></button></div>
        <div className="task-card__main"><h3 className="task-card__title">{task.title}</h3>{task.description && <p className="task-card__description">{task.description}</p>}<div className="task-card__meta"><span className={`chip chip--priority-${task.priority}`}>{priorityLabels[task.priority]}</span><span className="chip">{categoryLabels[task.category]}</span>{subject && <span className="chip">{subject.name}</span>}<span className={`task-due ${overdue ? 'task-due--overdue' : ''}`}>{describeDueDate(task.dueDate, language === 'en' ? 'en-US' : 'ar-EG')}{task.dueTime ? ` · ${formatTime(task.dueTime,language==='en'?'en-US':'ar-EG')}` : ''}</span><span className="task-estimate">{language === 'en' ? `${formatNumber(task.estimatedMinutes)} min` : formatMinutes(task.estimatedMinutes)}</span></div></div>
        <div className="task-card__actions">{!task.completed && overdue && <IconButton label={language === 'en' ? 'Reschedule to tomorrow' : 'تأجيل لبكرة'} onClick={() => reschedule(task)}><span className="reschedule-icon">↶</span></IconButton>}<IconButton label={language === 'en' ? 'Edit task' : 'تعديل المهمة'} onClick={() => openForm(task)}><EditIcon size={17} /></IconButton><IconButton label={language === 'en' ? 'Delete task' : 'حذف المهمة'} variant="danger" onClick={() => setDeleting(task)}><TrashIcon size={17} /></IconButton></div>
      </Card>
    })}</div> : <Card><EmptyState icon={<CheckSquareIcon size={28} />} title={data.tasks.length ? t('noTasksMatch') : t('getStartedTask')} message={data.tasks.length ? (language === 'en' ? 'Try changing a filter or add a task.' : 'جربي تغيري الفلتر أو أضيفي مهمة جديدة.') : t('noTasksBody')} action={<Button variant="primary" leadingIcon={<PlusIcon size={16} />} onClick={() => openForm()}>{t('addFirstTask')}</Button>} /></Card>}
    <Modal open={open} onClose={() => setOpen(false)} title={editing ? t('taskFormEdit') : t('taskFormTitle')} subtitle={t('taskFormHint')} variant="sheet" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>{t('back')}</Button><Button variant="primary" onClick={save}>{editing ? t('save') : t('taskNew')}</Button></>}>
      <form className="form-grid" onSubmit={save}>
        <Field label={t('taskTitle')} required error={errors.title} className="form-grid__full"><TextInput autoFocus value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder={language === 'en' ? 'e.g. Review chapter one' : 'مثلاً: مراجعة الفصل الأول'} /></Field>
        <Field label={t('descriptionOptional')} className="form-grid__full"><TextArea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder={language === 'en' ? 'Details to help you remember…' : 'تفاصيل تساعدك تفتكري…'} rows={3} /></Field>
        <Field label={t('subjectLabel')}><Select value={form.subjectId ?? ''} onChange={e => setForm({ ...form, subjectId: e.target.value || null })}><option value="">{t('subjectNone')}</option>{data.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label={t('categoryLabel')}><Select value={form.category} onChange={e => setForm({ ...form, category: e.target.value as TaskCategory })}>{Object.entries(categoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field>
        <Field label={t('dueDateLabel')}><TextInput type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} /></Field>
        <Field label={t('dueTimeOptional')}><TextInput type="time" value={form.dueTime} onChange={e => setForm({ ...form, dueTime: e.target.value })} /></Field>
        <Field label={t('taskPriority')}><Select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value as TaskPriority })}>{Object.entries(priorityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field>
        <Field label={t('estimatedMinutes')} error={errors.estimatedMinutes}><TextInput type="number" min={5} max={600} step={5} value={form.estimatedMinutes} onChange={e => setForm({ ...form, estimatedMinutes: Number(e.target.value) })} /></Field>
      </form>
    </Modal>
    <ConfirmDialog open={!!deleting} title={language === 'en' ? 'Delete task?' : 'حذف المهمة؟'} message={language === 'en' ? <>“{deleting?.title}” will be removed. You can add it again later.</> : <>هتمسحي «{deleting?.title}» من قائمتك. تقدري تضيفيها تاني في أي وقت.</>} confirmLabel={t('delete')} destructive onConfirm={remove} onCancel={() => setDeleting(null)} />
  </PageFrame>
}

