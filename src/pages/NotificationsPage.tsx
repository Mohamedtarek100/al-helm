import { useEffect, useMemo, useState } from 'react'
import { Card } from '../components/Card'
import { EmptyState } from '../components/Display'
import { Button, IconButton } from '../components/Button'
import { BellIcon, CheckIcon, TrashIcon } from '../components/icons'
import {
  clearNotifications,
  deleteNotification,
  getPendingCloudError,
  markAllNotificationsRead,
  markAnnouncementReadEverywhere,
  markNotificationRead,
  syncServerAnnouncements,
  useCollection,
} from '../services/store'
import { PageFrame, PageHeading } from './PageFrame'
import { useToast } from '../components/toastContext'
import { useI18n } from '../i18n/useI18n'
import type { TranslationKey } from '../i18n/translations'

/**
 * Notification center.
 *
 * REPAIRED BEHAVIOUR (each was a reported defect):
 *
 *  - Deleting / marking read now AWAITS the store write and only then reports
 *    success. A failed write shows an error and the item stays (the store
 *    restores it), instead of disappearing locally and returning after reload.
 *  - The unread count is derived from state, so it updates on the same render
 *    as the item — no "badge catches up later".
 *  - Unread items are visually distinct BEFORE opening (weight, dot, tint),
 *    so the user can see what is new without clicking each row.
 *  - Duplicate taps are prevented with a per-item busy set, so a slow request
 *    cannot be issued twice and flip the state back.
 */

/** Kinds that exist in the app today; no invented sources. */
const KIND_LABEL: Record<string, TranslationKey> = {
  announcement: 'notifSource_announcement',
  task: 'notifSource_task',
  session: 'notifSource_exam',
  focus: 'notifSource_system',
  goal: 'notifSource_system',
  system: 'notifSource_system',
  dream: 'notifSource_system',
}

export function NotificationsPage() {
  const items = useCollection('notifications')
  const { notify } = useToast()
  const { t, locale } = useI18n()
  const [busy, setBusy] = useState<Set<string>>(() => new Set())
  const [clearing, setClearing] = useState(false)

  // Pull server announcements on open. Local notifications remain visible if
  // the network is unavailable, but a failed cloud refresh must not be silent:
  // otherwise users assume the admin message was never sent or delivered.
  useEffect(() => {
    let active = true
    void syncServerAnnouncements().catch((error) => {
      if (!active) return
      const detail = error instanceof Error ? error.message : t('retry')
      notify(`${t('retry')}: ${detail}`, 'warning')
    })
    return () => { active = false }
  }, [notify, t])

  const sorted = useMemo(() => [...items].sort((a, b) => b.at.localeCompare(a.at)), [items])
  const unread = sorted.filter((item) => !item.read).length

  const withBusy = async (id: string, action: () => Promise<void>) => {
    if (busy.has(id)) return
    setBusy((current) => new Set(current).add(id))
    try {
      await action()
    } catch (error) {
      notify(error instanceof Error ? error.message : t('retry'), 'danger')
    } finally {
      setBusy((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }
  }

  const reportCloudGate = () => {
    // A cloud failure is still a real failure to persist: say so once, plainly.
    if (getPendingCloudError()) notify(t('notifReadFailed'), 'warning')
  }

  const toggleRead = (id: string, read: boolean) => withBusy(id, async () => {
    if (id.startsWith('ann-')) {
      // Announcement read state lives on the server delivery row too.
      if (!read) await markAnnouncementReadEverywhere(id.slice(4))
      else await markNotificationRead(id, false)
    } else {
      await markNotificationRead(id, !read)
    }
    reportCloudGate()
  })

  const remove = (id: string) => withBusy(id, async () => {
    try {
      await deleteNotification(id)
      notify(t('notifDeleted'), 'info')
      reportCloudGate()
    } catch {
      // The store restores the item; reporting a deletion here would be a lie.
      notify(t('notifDeleteFailed'), 'danger')
      throw new Error(t('notifDeleteFailed'))
    }
  })

  const markAll = async () => {
    try {
      await markAllNotificationsRead()
      notify(t('notifMarkAllReadDone'), 'success')
      reportCloudGate()
    } catch (error) {
      notify(error instanceof Error ? error.message : t('retry'), 'danger')
    }
  }

  const clearAll = async () => {
    setClearing(true)
    try {
      await clearNotifications()
      notify(t('notificationsCleared'), 'info')
      reportCloudGate()
    } catch (error) {
      notify(error instanceof Error ? error.message : t('retry'), 'danger')
    } finally {
      setClearing(false)
    }
  }

  return (
    <PageFrame className="page-stack">
      <PageHeading
        eyebrow={t('notificationEyebrow')}
        title={t('notifications')}
        subtitle={t('notificationBackgroundNotice')}
        action={
          items.length > 0 ? (
            <div className="row">
              {unread > 0 && <span className="notif-unread-pill">{t('notifUnreadCount', { count: unread })}</span>}
              <Button size="sm" variant="secondary" onClick={() => { void markAll() }}>{t('markAllRead')}</Button>
              <Button size="sm" variant="ghost" loading={clearing} onClick={() => { void clearAll() }}>{t('clearAll')}</Button>
            </div>
          ) : null
        }
      />

      <Card>
        {sorted.length === 0 ? (
          <EmptyState icon={<BellIcon size={25} />} title={t('noNotifications')} message={t('noNotificationsBody')} />
        ) : (
          <ul className="notif-list">
            {sorted.map((item) => {
              const isBusy = busy.has(item.id)
              const kindLabel = KIND_LABEL[item.kind] ? t(KIND_LABEL[item.kind]) : t('notifSource_system')
              return (
                <li key={item.id} className={`notif-item ${item.read ? 'notif-item--read' : 'notif-item--unread'}`}>
                  <span className="notif-item__icon" aria-hidden="true"><BellIcon size={18} /></span>
                  <div className="notif-item__body">
                    <div className="notif-item__top">
                      {/* The unread dot is the "is this new?" signal that must
                          be visible BEFORE the row is opened. */}
                      {!item.read && <span className="notif-item__dot" aria-hidden="true" />}
                      <b className="notif-item__title">{item.title}</b>
                      <span className="notif-item__kind">{kindLabel}</span>
                    </div>
                    <p className="notif-item__text">{item.body}</p>
                    <time className="notif-item__time" dateTime={item.at}>
                      {new Date(item.at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
                    </time>
                  </div>
                  <div className="notif-item__actions">
                    <IconButton
                      label={item.read ? t('markUnread') : t('markRead')}
                      size="sm"
                      disabled={isBusy}
                      onClick={() => { void toggleRead(item.id, item.read) }}
                    >
                      <CheckIcon size={16} />
                    </IconButton>
                    <IconButton
                      label={t('delete')}
                      size="sm"
                      variant="danger"
                      disabled={isBusy}
                      onClick={() => { void remove(item.id) }}
                    >
                      <TrashIcon size={16} />
                    </IconButton>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </PageFrame>
  )
}
