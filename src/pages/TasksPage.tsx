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
  { value: 'all', label: 'الكل' }, { value: 'open', label: 'مفتوحة' }, { value: 'today', label: 'النهارده' }, { value: 'overdue', label: 'محتاجة ترتيب' }, { value: 'done', label: 'مكتملة' },
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
    if (!form.title.trim()) next.title = 'اكتبي اسم المهمة.'
    if (form.estimatedMinutes < 5 || form.estimatedMinutes > 600) next.estimatedMinutes = 'اختاري مدة من ٥ إلى ٦٠ دقيقة.'
    if (Object.keys(next).length) { setErrors(next); return }
    if (editing) updateTask(editing.id, form)
    else createTask(form)
    setOpen(false)
    notify(editing ? 'اتحفظ التعديل.' : 'اتضافت المهمة.', 'success')
  }
  const remove = () => {
    if (!deleting) return
    deleteTask(deleting.id); setDeleting(null); notify('اتحذفت المهمة.', 'info')
  }
  const reschedule = (task: Task) => {
    const next = new Date(`${task.dueDate || todayKey()}T12:00:00`); next.setDate(next.getDate() + 1)
    const key = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
    updateTask(task.id, { dueDate: key }); notify('اتنقلت المهمة لبكرة.', 'success')
  }

  return <PageFrame className="page-stack">
    <PageHeading eyebrow="خطوة بخطوة" title="مهامي" subtitle="قائمة مرنة تساعدك ترتبي يومك من غير ضغط." action={<Button variant="primary" leadingIcon={<PlusIcon size={17} />} onClick={() => openForm()}>مهمة جديدة</Button>} />
    <Card className="task-toolbar"><div className="task-filters"><div className="filter-tabs">{statusOptions.map(item => <button key={item.value} className={`filter-tab ${filter.status === item.value ? 'filter-tab--active' : ''}`} onClick={() => setFilter({ ...filter, status: item.value })}>{item.label}{item.value === 'open' && <span>{data.tasks.filter(t => !t.completed).length}</span>}</button>)}</div><div className="filter-selects"><Select aria-label="تصفية حسب المادة" value={filter.subjectId} onChange={e => setFilter({ ...filter, subjectId: e.target.value })}><option value="all">كل المواد</option>{data.subjects.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</Select><Select aria-label="ترتيب المهام" value={sort} onChange={e => setSort(e.target.value as TaskSortKey)}><option value="due">الأقرب موعدًا</option><option value="priority">الأولوية</option><option value="created">الأحدث إضافة</option></Select><TextInput type="date" aria-label="تاريخ محدد" value={filter.date} onChange={e => setFilter({ ...filter, date: e.target.value })} /></div></div></Card>
    {visible.length ? <div className="task-list">{visible.map(task => {
      const subject = data.subjects.find(s => s.id === task.subjectId)
      const overdue = isTaskOverdue(task)
      return <Card key={task.id} className={`task-card ${task.completed ? 'task-card--done' : ''} ${overdue ? 'task-card--overdue' : ''}`} padded={false}>
        <div className="task-card__check"><button className={`task-check ${task.completed ? 'task-check--done' : ''}`} aria-label={task.completed ? 'إعادة فتح المهمة' : `إتمام ${task.title}`} onClick={() => { setTaskCompleted(task.id, !task.completed); notify(task.completed ? 'رجعت المهمة للقائمة.' : 'خطوة حلوة — المهمة خلصت.', 'success') }}><CheckIcon size={15} /></button></div>
        <div className="task-card__main"><h3 className="task-card__title">{task.title}</h3>{task.description && <p className="task-card__description">{task.description}</p>}<div className="task-card__meta"><span className={`chip chip--priority-${task.priority}`}>{TASK_PRIORITY_LABELS[task.priority]}</span><span className="chip">{TASK_CATEGORY_LABELS[task.category]}</span>{subject && <span className="chip">{subject.name}</span>}<span className={`task-due ${overdue ? 'task-due--overdue' : ''}`}>{describeDueDate(task.dueDate)}{task.dueTime ? ` · ${formatTime(task.dueTime)}` : ''}</span><span className="task-estimate">{formatMinutes(task.estimatedMinutes)}</span></div></div>
        <div className="task-card__actions">{!task.completed && overdue && <IconButton label="تأجيل لبكرة" onClick={() => reschedule(task)}><span className="reschedule-icon">↶</span></IconButton>}<IconButton label="تعديل المهمة" onClick={() => openForm(task)}><EditIcon size={17} /></IconButton><IconButton label="حذف المهمة" variant="danger" onClick={() => setDeleting(task)}><TrashIcon size={17} /></IconButton></div>
      </Card>
    })}</div> : <Card><EmptyState icon={<CheckSquareIcon size={28} />} title={data.tasks.length ? 'مفيش مهام بالشكل ده' : 'ابدئي بأول مهمة'} message={data.tasks.length ? 'جربي تغيري الفلتر أو أضيفي مهمة جديدة.' : 'اكتبي خطوة صغيرة عايزة تخلصيها، والباقي هييجي واحدة.'} action={<Button variant="primary" leadingIcon={<PlusIcon size={16} />} onClick={() => openForm()}>أضيفي مهمة</Button>} /></Card>}
    <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'تعديل المهمة' : 'مهمة جديدة'} subtitle="خليها واضحة وصغيرة على قد ما تقدري." variant="sheet" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>رجوع</Button><Button variant="primary" onClick={save}>{editing ? 'حفظ التعديل' : 'إضافة المهمة'}</Button></>}>
      <form className="form-grid" onSubmit={save}>
        <Field label="اسم المهمة" required error={errors.title} className="form-grid__full"><TextInput autoFocus value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="مثلاً: مراجعة الفصل الأول" /></Field>
        <Field label="وصف (اختياري)" className="form-grid__full"><TextArea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="تفاصيل تساعدك تفتكري…" rows={3} /></Field>
        <Field label="المادة"><Select value={form.subjectId ?? ''} onChange={e => setForm({ ...form, subjectId: e.target.value || null })}><option value="">من غير مادة</option>{data.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="التصنيف"><Select value={form.category} onChange={e => setForm({ ...form, category: e.target.value as TaskCategory })}>{Object.entries(TASK_CATEGORY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field>
        <Field label="تاريخ التسليم"><TextInput type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} /></Field>
        <Field label="الوقت (اختياري)"><TextInput type="time" value={form.dueTime} onChange={e => setForm({ ...form, dueTime: e.target.value })} /></Field>
        <Field label="الأولوية"><Select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value as TaskPriority })}>{Object.entries(TASK_PRIORITY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></Field>
        <Field label="المدة المتوقعة بالدقايق" error={errors.estimatedMinutes}><TextInput type="number" min={5} max={600} step={5} value={form.estimatedMinutes} onChange={e => setForm({ ...form, estimatedMinutes: Number(e.target.value) })} /></Field>
      </form>
    </Modal>
    <ConfirmDialog open={!!deleting} title="حذف المهمة؟" message={<>هتمسحي «{deleting?.title}» من قائمتك. تقدري تضيفيها تاني في أي وقت.</>} confirmLabel="حذف" destructive onConfirm={remove} onCancel={() => setDeleting(null)} />
  </PageFrame>
}

