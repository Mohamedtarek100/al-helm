import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Button, IconButton } from '../components/Button'
import { Card } from '../components/Card'
import { Field, TextInput } from '../components/Field'
import { EditIcon, PlusIcon, TrashIcon } from '../components/icons'
import { Modal, ConfirmDialog } from '../components/Modal'
import { useI18n } from '../i18n/useI18n'
import { useToast } from '../components/toastContext'
import { createExam, deleteExam, updateExam, useAppData, type NewExamDate } from '../services/store'
import { toValidDate } from '../services/date'
import { cairoLocalInputToIso, isoToCairoLocalInput } from '../services/timezone'
import { PageFrame, PageHeading } from './PageFrame'

/**
 * Exam countdowns.
 *
 * Form values are kept as the *typed* wall-clock string (`yyyy-MM-ddTHH:mm`,
 * Africa/Cairo) and are only converted to an ISO instant at save time. Two
 * failure modes are deliberately prevented here:
 *
 *  1. `new Date('2026-12-06T10:00').toISOString()` used to be called before any
 *     validation. On an empty field that throws RangeError, and the *rendered*
 *     exam countdown later fed an invalid Date to Intl.format — either way the
 *     whole route unmounted to a blank page. Every value is now validated
 *     first, and rendering tolerates bad stored data.
 *  2. Conversion used the device timezone, so an exam entered as 10:00 showed a
 *     different hour on a device set to UTC. It is now always Cairo wall time.
 */

type Draft = { title: string; examAt: string; notes: string }
type Errors = Partial<Record<keyof Draft, string>>

const blank = (): Draft => ({ title: '', examAt: '', notes: '' })

/** Default a new exam to tomorrow at 09:00 Cairo — a valid starting point. */
function suggestedSlot(): string {
  const tomorrow = new Date(Date.now() + 86_400_000)
  const iso = isoToCairoLocalInput(tomorrow.toISOString())
  return iso ? iso.slice(0, 11) + '09:00' : ''
}

export function ExamPage() {
  const data = useAppData()
  const { language, formatDate, formatNumber } = useI18n()
  const { notify } = useToast()
  const en = language === 'en'

  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Draft>(blank())
  const [errors, setErrors] = useState<Errors>({})
  const [saving, setSaving] = useState(false)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [today] = useState(() => Date.now())

  const exams = useMemo(() => {
    // Sort only by parseable timestamps: a legacy/bad row must not break sort.
    return [...data.exams].sort((a, b) => (toValidDate(a.examAt)?.getTime() ?? 0) - (toValidDate(b.examAt)?.getTime() ?? 0))
  }, [data.exams])

  const upcoming = useMemo(
    () => exams.filter((exam) => (toValidDate(exam.examAt)?.getTime() ?? 0) >= today),
    [exams, today],
  )

  const daysLeft = (at: string): number | null => {
    const when = toValidDate(at)
    if (!when) return null
    return Math.max(0, Math.ceil((when.getTime() - today) / 86_400_000))
  }

  const validate = (draft: Draft): Errors => {
    const next: Errors = {}
    if (!draft.title.trim()) next.title = en ? 'Give the exam a name.' : 'اكتبي اسم الامتحان.'
    if (!draft.examAt.trim()) next.examAt = en ? 'Choose the exam date and time.' : 'اختاري تاريخ ووقت الامتحان.'
    else if (!cairoLocalInputToIso(draft.examAt)) next.examAt = en ? 'That date and time is not valid. Check the day and time again.' : 'التاريخ أو الوقت غير صحيح. راجعي اليوم والساعة.'
    return next
  }

  const openForm = (exam?: typeof data.exams[number]) => {
    setEditId(exam?.id ?? null)
    setErrors({})
    setForm(
      exam
        ? { title: exam.title, examAt: isoToCairoLocalInput(exam.examAt), notes: exam.notes }
        : { ...blank(), examAt: suggestedSlot() },
    )
    setOpen(true)
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    const next = validate(form)
    setErrors(next)
    if (Object.keys(next).length) return

    const examAt = cairoLocalInputToIso(form.examAt)
    // Guard again: conversion must never hand an invalid value to the store.
    if (!examAt) { setErrors({ examAt: en ? 'That date and time is not valid.' : 'التاريخ أو الوقت غير صحيح.' }); return }

    const payload: NewExamDate = { title: form.title.trim(), subjectId: null, examAt, timezone: 'Africa/Cairo', notes: form.notes.trim() }
    setSaving(true)
    try {
      if (editId) await updateExam(editId, payload)
      else await createExam(payload)
      setOpen(false)
      setForm(blank())
      notify(en ? 'Exam saved.' : 'تم حفظ الامتحان.', 'success')
    } catch (error) {
      // Keep the dialog open and the draft intact so nothing typed is lost.
      const message = error instanceof Error ? error.message : ''
      notify(message || (en ? 'Could not save the exam. Your entry is still here — try again.' : 'تعذر حفظ الامتحان. الكتابة لسه موجودة — جرّبي تاني.'), 'danger')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!removeId) return
    try {
      await deleteExam(removeId)
      setRemoveId(null)
      notify(en ? 'Exam removed.' : 'تم حذف الامتحان.', 'info')
    } catch (error) {
      notify(error instanceof Error ? error.message : (en ? 'Could not delete the exam.' : 'تعذر حذف الامتحان.'), 'danger')
    }
  }

  return (
    <PageFrame className="page-stack">
      <PageHeading
        eyebrow={en ? 'Prepare at your pace' : 'استعدي على مهلك'}
        title={en ? 'Exam countdowns' : 'مواعيد الامتحانات'}
        subtitle={en ? 'Add your exam dates to see the time remaining. No dates or progress are prefilled.' : 'أضيفي مواعيد امتحاناتك لمتابعة الوقت المتبقي. لا توجد بيانات أو إنجازات مفترضة.'}
        action={<Button leadingIcon={<PlusIcon size={16} />} onClick={() => openForm()}>{en ? 'Add exam' : 'إضافة امتحان'}</Button>}
      />

      {upcoming.length ? (
        upcoming.map((exam) => {
          const left = daysLeft(exam.examAt)
          return (
            <Card key={exam.id}>
              <div className="row row--between">
                <div>
                  <h2>{exam.title}</h2>
                  <p className="t-sm t-muted">
                    {formatDate(exam.examAt, { dateStyle: 'medium', timeStyle: 'short' })}
                    {left === null ? '' : ` · ${formatNumber(left)} ${en ? 'days left' : 'يوم متبقي'}`}
                  </p>
                  {exam.notes && <p className="t-sm">{exam.notes}</p>}
                </div>
                <div className="row">
                  <IconButton label={en ? 'Edit exam' : 'تعديل الامتحان'} onClick={() => openForm(exam)}><EditIcon size={16} /></IconButton>
                  <IconButton label={en ? 'Delete exam' : 'حذف الامتحان'} variant="danger" onClick={() => setRemoveId(exam.id)}><TrashIcon size={16} /></IconButton>
                </div>
              </div>
            </Card>
          )
        })
      ) : (
        <Card>
          <p className="t-sm t-muted">{en ? 'No exam dates yet. Add a date when you are ready.' : 'لا توجد مواعيد بعد. أضيفي الموعد عندما تكوني مستعدة.'}</p>
        </Card>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={en ? (editId ? 'Edit exam' : 'Add exam') : (editId ? 'تعديل الامتحان' : 'إضافة امتحان')}
        subtitle={en ? 'Times are in Cairo time (Africa/Cairo).' : 'الأوقات بتوقيت القاهرة (Africa/Cairo).'}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>{en ? 'Cancel' : 'إلغاء'}</Button><Button loading={saving} onClick={save}>{en ? 'Save' : 'حفظ'}</Button></>}
      >
        <form className="form-grid" onSubmit={save}>
          <Field label={en ? 'Exam title' : 'اسم الامتحان'} required error={errors.title}>
            <TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={en ? 'e.g. Maths — final' : 'مثلاً: رياضيات — آخر العام'} />
          </Field>
          <Field label={en ? 'Date and time' : 'التاريخ والوقت'} required error={errors.examAt} hint={en ? 'Cairo time' : 'بتوقيت القاهرة'}>
            <TextInput type="datetime-local" value={form.examAt} onChange={(e) => setForm({ ...form, examAt: e.target.value })} />
          </Field>
          <Field label={en ? 'Notes' : 'ملاحظات'}>
            <TextInput value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!removeId}
        title={en ? 'Delete exam?' : 'حذف الامتحان؟'}
        message={en ? 'This exam date will be removed.' : 'سيتم حذف موعد الامتحان.'}
        confirmLabel={en ? 'Delete' : 'حذف'}
        cancelLabel={en ? 'Cancel' : 'إلغاء'}
        destructive
        onConfirm={remove}
        onCancel={() => setRemoveId(null)}
      />
    </PageFrame>
  )
}
