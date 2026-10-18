import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { Task, TaskCategory, TaskPriority } from '../types'
import { Button, IconButton } from '../components/Button'
import { Card } from '../components/Card'
import { ConfirmDialog, Modal } from '../components/Modal'
import { EmptyState } from '../components/Display'
import { Field, Select, TextArea, TextInput } from '../components/Field'
import { CheckIcon, CheckSquareIcon, EditIcon, PlusIcon, TrashIcon } from '../components/icons'
import { TASK_CATEGORY_LABELS, TASK_PRIORITY_LABELS } from '../services/domain'
import { describeDueDate, formatMinutes, formatTime, todayKey } from '../services/date'
import { emptyTaskFilter, filterTasks, sortTasks, type TaskFilter, type TaskSortKey, type TaskStatusFilter, isTaskOverdue } from '../services/taskSelectors'
import { createTask, deleteTask, setTaskCompleted, updateTask, useAppData, type NewTask } from '../services/store'
import { PageFrame, PageHeading } from './PageFrame'
import { useToast } from '../components/toastContext'

const blank = (): NewTask => ({ title: '', description: '', subjectId: null, dueDate: todayKey(), dueTime: '', priority: 'medium', category: 'study', estimatedMinutes: 30 })
const statusOptions: { value: TaskStatusFilter; label: string }[] = [
  { value: 'all', label: 'Ø§Ù„ÙƒÙ„' }, { value: 'open', label: 'Ù…ÙØªÙˆØ­Ø©' }, { value: 'today', label: 'Ø§Ù„Ù†Ù‡Ø§Ø±Ø¯Ù‡' }, { value: 'overdue', label: 'Ù…Ø­ØªØ§Ø¬Ø© ØªØ±ØªÙŠØ¨' }, { value: 'done', label: 'Ù…ÙƒØªÙ…Ù„Ø©' },
]

export function TasksPage() {
  const data = useAppData()
  const { notify } = useToast()
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
  const save = (event: FormEvent) => {
    event.preventDefault()
    const next: Record<string, string> = {}
    if (!form.title.trim()) next.title = 'Ø§ÙƒØªØ¨ÙŠ Ø§Ø³Ù… Ø§Ù„Ù…Ù‡Ù…Ø©.'
    if (form.estimatedMinutes < 5 || form.estimatedMinutes > 600) next.estimatedMinutes = 'Ø§Ø®ØªØ§Ø±ÙŠ Ù…Ø¯Ø© Ù…Ù† Ù¥ Ø¥Ù„Ù‰ Ù¦Ù  Ø¯Ù‚ÙŠÙ‚Ø©.'
    if (Object.keys(next).length) { setErrors(next); return }
    if (editing) updateTask(editing.id, form)
    else createTask(form)
    setOpen(false)
    notify(editing ? 'Ø§ØªØ­ÙØ¸ Ø§Ù„ØªØ¹Ø¯ÙŠÙ„.' : 'Ø§ØªØ¶Ø§ÙØª Ø§Ù„Ù…Ù‡Ù…Ø©.', 'success')
  }
  const remove = () => {
    if (!deleting) return
    deleteTask(deleting.id); setDeleting(null); notify('Ø§ØªØ­Ø°ÙØª Ø§Ù„Ù…Ù‡Ù…Ø©.', 'info')
  }
  const reschedule = (task: Task) => {
    const next = new Date(`${task.dueDate || todayKey()}T12:00:00`); next.setDate(next.getDate() + 1)
    const key = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
    updateTask(task.id, { dueDate: key }); notify('Ø§ØªÙ†Ù‚Ù„Øª Ø§Ù„Ù…Ù‡Ù…Ø© Ù„Ø¨ÙƒØ±Ø©.', 'success')
  }

  return <PageFrame className="page-stack">
    <PageHeading eyebrow="Ø®Ø·ÙˆØ© Ø¨Ø®Ø·ÙˆØ©" title="Ù…Ù‡Ø§Ù…ÙŠ" subtitle="Ù‚Ø§Ø¦Ù…Ø© Ù…Ø±Ù†Ø© ØªØ³Ø§Ø¹Ø¯Ùƒ ØªØ±ØªØ¨ÙŠ ÙŠÙˆÙ…Ùƒ Ù…Ù† ØºÙŠØ± Ø¶ØºØ·." action={<Button variant="primary" leadingIcon={<PlusIcon size={17} />} onClick={() => openForm()}>Ù…Ù‡Ù…Ø© Ø¬Ø¯ÙŠØ¯Ø©</Button>} />
    <Card className="task-toolbar"><div className="task-filters"><div className="filter-tabs">{statusOptions.map(item => <button key={item.value} className={`filter-tab ${filter.status === item.value ? 'filter-tab--active' : ''}`} onClick={() => setFilter({ ...filter, status: item.value })}>{item.label}{item.value === 'open' && <span>{data.tasks.filter(t => !t.completed).length}</span>}</button>)}</div><div className="filter-selects"><Select aria-label="ØªØµÙÙŠØ© Ø­Ø³Ø¨ Ø§Ù„Ù…Ø§Ø¯Ø©" value={filter.subjectId} onChange={e => setFilter({ ...filter, subjectId: e.target.value })}><option value="all">ÙƒÙ„ Ø§Ù„Ù…ÙˆØ§Ø¯</option>{data.subjects.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</Select><Select aria-label="ØªØ±ØªÙŠØ¨ Ø§Ù„Ù…Ù‡Ø§Ù…" value={sort} onChange={e => setSort(e.target.value as TaskSortKey)}><option value="due">Ø§Ù„Ø£Ù‚Ø±Ø¨ Ù…ÙˆØ¹Ø¯Ù‹Ø§</option><option value="priority">Ø§Ù„Ø£ÙˆÙ„ÙˆÙŠØ©</option><option value="created">Ø§Ù„Ø£Ø­Ø¯Ø« Ø¥Ø¶Ø§ÙØ©</option></Select><TextInput type="date" aria-label="ØªØ§Ø±ÙŠØ® Ù…Ø­Ø¯Ø¯" value={filter.date} onChange={e => setFilter({ ...filter, date: e.target.value })} /></div></div></Card>
    {visible.length ? <div className="task-list">{visible.map(task => {
      const subject = data.subjects.find(s => s.id === task.subjectId)
      const overdue = isTaskOverdue(task)
      return <Card key={task.id} className={`task-card ${task.completed ? 'task-card--done' : ''} ${overdue ? 'task-card--overdue' : ''}`} padded={false}>
        <div className="task-card__check"><button className={`task-check ${task.completed ? 'task-check--done' : ''}`} aria-label={task.completed ? 'Ø¥Ø¹Ø§Ø¯Ø© ÙØªØ­ Ø§Ù„Ù…Ù‡Ù…Ø©' : `Ø¥ØªÙ…Ø§Ù… ${task.title}`} onClick={() => { setTaskCompleted(task.id, !task.completed); notify(task.completed ? 'Ø±Ø¬Ø¹Øª Ø§Ù„Ù…Ù‡Ù…Ø© Ù„Ù„Ù‚Ø§Ø¦Ù…Ø©.' : 'Ø®Ø·ÙˆØ© Ø­Ù„ÙˆØ© â€” Ø§Ù„Ù…Ù‡Ù…Ø© Ø®Ù„ØµØª.', 'success') }}><CheckIcon size={15} /></button></div>
        <div className="task-card__main"><h3 className="task-card__title">{task.title}</h3>{task.description && <p className="task-card__description">{task.description}</p>}<div className="task-card__meta"><span className={`chip chip--priority-${task.priority}`}>{TASK_PRIORITY_LABELS[task.priority]}</span><span className="chip">{TASK_CATEGORY_LABELS[task.category]}</span>{subject && <span className="chip">{subject.name}</span>}<span className={`task-due ${overdue ? 'task-due--overdue' : ''}`}>{describeDueDate(task.dueDate)}{task.dueTime ? ` Â· ${formatTime(task.dueTime)}` : ''}</span><span className="task-estimate">{formatMinutes(task.estimatedMinutes)}</span></div></div>
        <div className="task-card__actions">{!task.completed && overdue && <IconButton label="ØªØ£Ø¬ÙŠÙ„ Ù„Ø¨ÙƒØ±Ø©" onClick={() => reschedule(task)}><span className="reschedule-icon">â†¶</span></IconButton>}<IconButton label="ØªØ¹Ø¯ÙŠÙ„ Ø§Ù„Ù…Ù‡Ù…Ø©" onClick={() => openForm(task)}><EditIcon size={17} /></IconButton><IconButton label="Ø­Ø°Ù Ø§Ù„Ù…Ù‡Ù…Ø©" variant="danger" onClick={() => setDeleting(task)}><TrashIcon size={17} /></IconButton></div>
      </Card>
    })}</div> : <Card><EmptyState icon={<CheckSquareIcon size={28} />} title={data.tasks.length ? 'Ù…ÙÙŠØ´ Ù…Ù‡Ø§Ù… Ø¨Ø§Ù„Ø´ÙƒÙ„ Ø¯Ù‡' : 'Ø§Ø¨Ø¯Ø¦ÙŠ Ø¨Ø£ÙˆÙ„ Ù…Ù‡Ù…Ø©'} message={data.tasks.length ? 'Ø¬Ø±Ø¨ÙŠ ØªØºÙŠØ±ÙŠ Ø§Ù„ÙÙ„ØªØ± Ø£Ùˆ Ø£Ø¶ÙŠÙÙŠ Ù…Ù‡Ù…Ø© Ø¬Ø¯ÙŠØ¯Ø©.' : 'Ø§ÙƒØªØ¨ÙŠ Ø®Ø·ÙˆØ© ØµØºÙŠØ±Ø© Ø¹Ø§ÙŠØ²Ø© ØªØ®Ù„ØµÙŠÙ‡Ø§ØŒ ÙˆØ§Ù„Ø¨Ø§Ù‚ÙŠ Ù‡ÙŠÙŠØ¬ÙŠ ÙˆØ§Ø­Ø¯Ø©.'} action={<Button variant="primary" leadingIcon={<PlusIcon size={16} />} onClick={() => openForm()}>Ø£Ø¶ÙŠÙÙŠ Ù…Ù‡Ù…Ø©</Button>} /></Card>}
    <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'ØªØ¹Ø¯ÙŠÙ„ Ø§Ù„Ù…Ù‡Ù…Ø©' : 'Ù…Ù‡Ù…Ø© Ø¬Ø¯ÙŠØ¯Ø©'} subtitle="Ø®Ù„ÙŠÙ‡Ø§ ÙˆØ§Ø¶Ø­Ø© ÙˆØµØºÙŠØ±Ø© Ø¹Ù„Ù‰ Ù‚Ø¯ Ù…Ø§ ØªÙ‚Ø¯Ø±ÙŠ." variant="sheet" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Ø±Ø¬ÙˆØ¹</Button><Button variant="primary" onClick={save}>{editing ? 'Ø­ÙØ¸ Ø§Ù„ØªØ¹Ø¯ÙŠÙ„' : 'Ø¥Ø¶Ø§ÙØ© Ø§Ù„Ù…Ù‡Ù…Ø©'}</Button></>}>
      <form className="form-grid" onSubmit={save}>
        <Field label="Ø§Ø³Ù… Ø§Ù„Ù…Ù‡Ù…Ø©" required error={errors.title} className="form-grid__full"><TextInput autoFocus value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Ù…Ø«Ù„Ø§Ù‹: Ù…Ø±Ø§Ø¬Ø¹Ø© Ø§Ù„ÙØµÙ„ Ø§Ù„Ø£ÙˆÙ„" /></Field>
        <Field label="ÙˆØµÙ (Ø§Ø®ØªÙŠØ§Ø±ÙŠ)" className="form-grid__full"><TextArea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="ØªÙØ§ØµÙŠÙ„ ØªØ³Ø§Ø¹Ø¯Ùƒ ØªÙØªÙƒØ±ÙŠâ€¦" rows={3} /></Field>
        <Field label="Ø§Ù„Ù…Ø§Ø¯Ø©"><Select value={form.subjectId ?? ''} onChange={e => setForm({ ...form, subjectId: e.target.value || null })}><option value="">Ù…Ù† ØºÙŠØ± Ù…Ø§Ø¯Ø©</option>{data.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Ø§Ù„ØªØµÙ†ÙŠÙ"><Select value={form.category} onChange={e => setForm({ ...form, category: e.target.value as TaskCategory })}>{Object.entries(TASK_CATEGORY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field>
        <Field label="ØªØ§Ø±ÙŠØ® Ø§Ù„ØªØ³Ù„ÙŠÙ…"><TextInput type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} /></Field>
        <Field label="Ø§Ù„ÙˆÙ‚Øª (Ø§Ø®ØªÙŠØ§Ø±ÙŠ)"><TextInput type="time" value={form.dueTime} onChange={e => setForm({ ...form, dueTime: e.target.value })} /></Field>
        <Field label="Ø§Ù„Ø£ÙˆÙ„ÙˆÙŠØ©"><Select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value as TaskPriority })}>{Object.entries(TASK_PRIORITY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field>
        <Field label="Ø§Ù„Ù…Ø¯Ø© Ø§Ù„Ù…ØªÙˆÙ‚Ø¹Ø© Ø¨Ø§Ù„Ø¯Ù‚Ø§ÙŠÙ‚" error={errors.estimatedMinutes}><TextInput type="number" min={5} max={600} step={5} value={form.estimatedMinutes} onChange={e => setForm({ ...form, estimatedMinutes: Number(e.target.value) })} /></Field>
      </form>
    </Modal>
    <ConfirmDialog open={!!deleting} title="Ø­Ø°Ù Ø§Ù„Ù…Ù‡Ù…Ø©ØŸ" message={<>Ù‡ØªÙ…Ø³Ø­ÙŠ Â«{deleting?.title}Â» Ù…Ù† Ù‚Ø§Ø¦Ù…ØªÙƒ. ØªÙ‚Ø¯Ø±ÙŠ ØªØ¶ÙŠÙÙŠÙ‡Ø§ ØªØ§Ù†ÙŠ ÙÙŠ Ø£ÙŠ ÙˆÙ‚Øª.</>} confirmLabel="Ø­Ø°Ù" destructive onConfirm={remove} onCancel={() => setDeleting(null)} />
  </PageFrame>
}

