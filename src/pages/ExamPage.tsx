import { useMemo, useState } from 'react'
import { Button, IconButton } from '../components/Button'
import { Card } from '../components/Card'
import { Field, TextInput } from '../components/Field'
import { EditIcon, PlusIcon, TrashIcon } from '../components/icons'
import { Modal, ConfirmDialog } from '../components/Modal'
import { useI18n } from '../i18n/useI18n'
import { useToast } from '../components/toastContext'
import { createExam, deleteExam, updateExam, useAppData, type NewExamDate } from '../services/store'
import { PageFrame, PageHeading } from './PageFrame'

const blank=():NewExamDate=>({title:'',subjectId:null,examAt:'',timezone:'Africa/Cairo',notes:''})
export function ExamPage(){
 const data=useAppData(),{language,formatDate,formatNumber}=useI18n(),{notify}=useToast(),en=language==='en'
 const [open,setOpen]=useState(false),[editId,setEditId]=useState<string|null>(null),[form,setForm]=useState<NewExamDate>(blank()),[removeId,setRemoveId]=useState<string|null>(null)
 const exams=useMemo(()=>[...data.exams].sort((a,b)=>a.examAt.localeCompare(b.examAt)),[data.exams])
 const save=async(event:React.FormEvent)=>{event.preventDefault();if(!form.title.trim()||!form.examAt)return;try{const value={...form,examAt:new Date(form.examAt).toISOString()};if(editId)await updateExam(editId,value);else await createExam(value);setOpen(false);notify(en?'Exam saved.':'تم حفظ الامتحان.','success')}catch(error){notify(error instanceof Error?error.message:(en?'Save failed.':'تعذر الحفظ.'),'danger')}}
 const edit=(exam?:typeof data.exams[number])=>{setEditId(exam?.id??null);setForm(exam?{title:exam.title,subjectId:exam.subjectId,examAt:exam.examAt.slice(0,16),timezone:exam.timezone,notes:exam.notes}:blank());setOpen(true)}
 const [today] = useState(() => Date.now())
 const daysLeft=(at:string)=>Math.max(0,Math.ceil((new Date(at).getTime()-today)/86400000))
 return <PageFrame className="page-stack"><PageHeading eyebrow={en?'Prepare at your pace':'استعدي على مهلك'} title={en?'Exam countdowns':'مواعيد الامتحانات'} subtitle={en?'Add your exam dates to see the time remaining. No dates or progress are prefilled.':'أضيفي مواعيد امتحاناتك لمتابعة الوقت المتبقي. لا توجد بيانات أو إنجازات مفترضة.'} action={<Button leadingIcon={<PlusIcon size={16}/>} onClick={()=>edit()}>{en?'Add exam':'إضافة امتحان'}</Button>}/>
 {exams.filter(exam=>new Date(exam.examAt).getTime()>=today).length ? exams.filter(exam=>new Date(exam.examAt).getTime()>=today).map(exam => <Card key={exam.id}><div className="row row--between"><div><h2>{exam.title}</h2><p className="t-sm t-muted">{formatDate(exam.examAt,{dateStyle:'medium',timeStyle:'short'})} · {formatNumber(daysLeft(exam.examAt))} {en?'days left':'يوم متبقي'}</p>{exam.notes && <p className="t-sm">{exam.notes}</p>}</div><div className="row"><IconButton label={en?'Edit exam':'تعديل الامتحان'} onClick={()=>edit(exam)}><EditIcon size={16}/></IconButton><IconButton label={en?'Delete exam':'حذف الامتحان'} variant="danger" onClick={()=>setRemoveId(exam.id)}><TrashIcon size={16}/></IconButton></div></div></Card>) : <Card><p className="t-sm t-muted">{en?'No exam dates yet. Add a date when you are ready.':'لا توجد مواعيد بعد. أضيفي الموعد عندما تكوني مستعدة.'}</p></Card>}
 <Modal open={open} onClose={()=>setOpen(false)} title={en?(editId?'Edit exam':'Add exam'):(editId?'تعديل الامتحان':'إضافة امتحان')} footer={<><Button variant="ghost" onClick={()=>setOpen(false)}>{en?'Cancel':'إلغاء'}</Button><Button onClick={save}>{en?'Save':'حفظ'}</Button></>}><form className="form-grid" onSubmit={save}><Field label={en?'Exam title':'اسم الامتحان'} required><TextInput value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></Field><Field label={en?'Date and time':'التاريخ والوقت'} required><TextInput type="datetime-local" value={form.examAt} onChange={e=>setForm({...form,examAt:e.target.value})}/></Field><Field label={en?'Notes':'ملاحظات'}><TextInput value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></Field></form></Modal>
 <ConfirmDialog open={!!removeId} title={en?'Delete exam?':'حذف الامتحان؟'} message={en?'This exam date will be removed.':'سيتم حذف موعد الامتحان.'} destructive onConfirm={async()=>{if(!removeId)return;try{await deleteExam(removeId);setRemoveId(null)}catch(error){notify(error instanceof Error?error.message:(en?'Delete failed.':'تعذر الحذف.'),'danger')}}} onCancel={()=>setRemoveId(null)}/></PageFrame>
}
