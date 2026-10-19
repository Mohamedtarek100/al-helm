import { Card } from '../components/Card'
import { EmptyState } from '../components/Display'
import { Button, IconButton } from '../components/Button'
import { BellIcon, CheckIcon, TrashIcon } from '../components/icons'
import { clearNotifications, deleteNotification, markAllNotificationsRead, markNotificationRead, useCollection } from '../services/store'
import { PageFrame, PageHeading } from './PageFrame'
import { useToast } from '../components/toastContext'

export function NotificationsPage() { const items = useCollection('notifications'); const { notify } = useToast(); const sorted = [...items].sort((a, b) => b.at.localeCompare(a.at)); return <PageFrame className="page-stack"><PageHeading eyebrow="تذكيراتك وملاحظاتك" title="الإشعارات" subtitle="تنبيهات داخل التطبيق فقط؛ الإشعارات الحقيقية بالخلفية مؤجلة للمرحلة الثانية." action={items.length > 0 ? <div className="row"><Button size="sm" variant="secondary" onClick={markAllNotificationsRead}>تعليم الكل كمقروء</Button><Button size="sm" variant="ghost" onClick={() => { clearNotifications(); notify('اتمسحت الإشعارات.', 'info') }}>مسح الكل</Button></div> : null} /><Card>{sorted.length ? sorted.map(n => <article className={`notification-row ${n.read ? 'notification-row--read' : ''}`} key={n.id}><span className="notification-row__icon"><BellIcon size={18} /></span><div className="notification-row__body"><b>{n.title}</b><p>{n.body}</p><time>{new Date(n.at).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' })}</time></div><div className="row"><IconButton label={n.read ? 'تعليم كغير مقروء' : 'تعليم كمقروء'} size="sm" onClick={() => markNotificationRead(n.id, !n.read)}><CheckIcon size={16} /></IconButton><IconButton label="حذف" size="sm" variant="danger" onClick={() => deleteNotification(n.id)}><TrashIcon size={16} /></IconButton></div></article>) : <EmptyState icon={<BellIcon size={25} />} title="مفيش إشعارات لسه" message="أي تذكيرات داخلية أو تحديثات هتظهر هنا." />}</Card></PageFrame> }

