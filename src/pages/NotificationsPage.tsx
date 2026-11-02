import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card } from '../components/Card'
import { EmptyState } from '../components/Display'
import { Button, IconButton } from '../components/Button'
import { BellIcon, CheckIcon, TrashIcon } from '../components/icons'
import {
  clearNotifications,
  deleteNotification,
  getPendingAnnouncementDismissalError,
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
import { disableWebPush, enableWebPush, getWebPushStatus, WebPushError, type WebPushStatus } from '../services/webPush'
import { AndroidPushError, disableAndroidPush, enableAndroidPush, getAndroidPushStatus, type AndroidPushStatus } from '../services/androidPush'

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
  const [searchParams, setSearchParams] = useSearchParams()
  const announcementId = searchParams.get('announcementId')
  const [busy, setBusy] = useState<Set<string>>(() => new Set())
  const [clearing, setClearing] = useState(false)
  const [pushStatus, setPushStatus] = useState<WebPushStatus | null>(null)
  const [pushStatusError, setPushStatusError] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [androidPushStatus, setAndroidPushStatus] = useState<AndroidPushStatus | null>(null)
  const [androidPushStatusError, setAndroidPushStatusError] = useState(false)
  const [androidPushBusy, setAndroidPushBusy] = useState(false)

  useEffect(() => {
    let active = true
    void getWebPushStatus()
      .then((status) => {
        if (!active) return
        setPushStatus(status)
        setPushStatusError(false)
      })
      .catch((error: unknown) => {
        if (!active) return
        setPushStatusError(true)
        notify(error instanceof Error ? error.message : t('webPushFailed'), 'warning')
      })
    return () => { active = false }
  }, [notify, t])

  useEffect(() => {
    let active = true
    void getAndroidPushStatus()
      .then((status) => {
        if (!active) return
        setAndroidPushStatus(status)
        setAndroidPushStatusError(false)
      })
      .catch((error: unknown) => {
        if (!active) return
        setAndroidPushStatusError(true)
        notify(error instanceof Error ? error.message : t('androidPushFailed'), 'warning')
      })
    return () => { active = false }
  }, [notify, t])

  useEffect(() => {
    const handleRefreshError = () => notify(t('androidPushRotationFailed'), 'warning')
    window.addEventListener('alhelm:android-push-error', handleRefreshError)
    return () => window.removeEventListener('alhelm:android-push-error', handleRefreshError)
  }, [notify, t])

  const toggleWebPush = async () => {
    if (!pushStatus || pushBusy) return
    setPushBusy(true)
    try {
      try {
        if (pushStatus.subscribed) {
          await disableWebPush()
          notify(t('webPushDisabled'), 'success')
          setPushStatus((current) => current ? { ...current, subscribed: false } : current)
        } else {
          await enableWebPush()
          notify(t('webPushEnabled'), 'success')
          setPushStatus((current) => current ? { ...current, subscribed: true } : current)
        }
      } catch (error) {
        const message = error instanceof WebPushError
          ? t(`webPushError_${error.code}` as TranslationKey)
          : error instanceof Error ? error.message : t('webPushFailed')
        notify(message, 'danger')
        return
      }
      setPushStatus(await getWebPushStatus())
      setPushStatusError(false)
    } catch (error) {
      setPushStatusError(true)
      notify(error instanceof Error ? error.message : t('webPushFailed'), 'warning')
    } finally {
      setPushBusy(false)
    }
  }

  const toggleAndroidPush = async () => {
    if (!androidPushStatus || androidPushBusy) return
    setAndroidPushBusy(true)
    try {
      if (androidPushStatus.registered) {
        await disableAndroidPush()
        notify(t('androidPushDisabled'), 'success')
      } else {
        if (!androidPushStatus.configured) {
          notify(t('androidPushNotConfigured'), 'warning')
          return
        }
        const result = await enableAndroidPush()
        notify(result.configured ? t('androidPushEnabled') : t('androidPushNotConfigured'), result.configured ? 'success' : 'warning')
      }
      setAndroidPushStatus(await getAndroidPushStatus())
      setAndroidPushStatusError(false)
    } catch (error) {
      try {
        setAndroidPushStatus(await getAndroidPushStatus())
        setAndroidPushStatusError(false)
      } catch (statusError) {
        setAndroidPushStatusError(true)
        notify(statusError instanceof Error ? statusError.message : t('androidPushFailed'), 'warning')
      }
      const message = error instanceof AndroidPushError
        ? t(`androidPushError_${error.code}` as TranslationKey)
        : error instanceof Error ? error.message : t('androidPushFailed')
      notify(message, 'danger')
    } finally {
      setAndroidPushBusy(false)
    }
  }

  // Keep the local inbox available offline, but do not hide a failed refresh:
  // otherwise users may mistake a sync problem for an undelivered announcement.
  useEffect(() => {
    let active = true
    void syncServerAnnouncements()
      .then(async () => {
        if (!active || !announcementId) return
        await markAnnouncementReadEverywhere(announcementId)
        if (active) {
          const next = new URLSearchParams(searchParams)
          next.delete('announcementId')
          setSearchParams(next, { replace: true })
        }
      })
      .catch((error) => {
        if (!active) return
        const detail = error instanceof Error ? error.message : t('retry')
        notify(`${announcementId ? t('notifReadFailed') : t('notifSyncFailed')}: ${detail}`, 'warning')
      })
    return () => { active = false }
  }, [announcementId, notify, searchParams, setSearchParams, t])

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
    const result = await deleteNotification(id)
    if (result === 'local-pending') {
      const error = getPendingAnnouncementDismissalError()
      notify(`${t('notifDeletePending')}${error ? `: ${error}` : ''}`, 'warning')
    } else {
      notify(t('notifDeleted'), 'info')
    }
    reportCloudGate()
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
      const result = await clearNotifications()
      if (result === 'local-pending') {
        const error = getPendingAnnouncementDismissalError()
        notify(`${t('notifDeletePending')}${error ? `: ${error}` : ''}`, 'warning')
      } else {
        notify(t('notificationsCleared'), 'info')
      }
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
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <b>{t('webPushTitle')}</b>
            <p className="muted" role="status" style={{ margin: '6px 0 0' }}>
              {!pushStatus
                ? pushStatusError ? t('webPushFailed') : t('webPushChecking')
                : !pushStatus.supported
                  ? t('webPushError_unsupported')
                  : !pushStatus.configured
                    ? t('webPushError_not_configured')
                    : !pushStatus.authenticated
                      ? t('webPushError_sign_in_required')
                      : pushStatus.permission === 'denied'
                        ? t('webPushError_permission_denied')
                        : pushStatus.subscribed ? t('webPushEnabled') : t('webPushDisabled')}
            </p>
          </div>
          <Button
            size="sm"
            variant={pushStatus?.subscribed ? 'secondary' : 'primary'}
            loading={pushBusy}
            disabled={
              !pushStatus?.supported
              || !pushStatus.authenticated
              || (!pushStatus.configured && !pushStatus.subscribed)
              || pushBusy
            }
            onClick={() => { void toggleWebPush() }}
          >
            {pushStatus?.subscribed ? t('webPushDisable') : t('webPushEnable')}
          </Button>
        </div>
      </Card>

      {androidPushStatus?.supported && (
        <Card>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <b>{t('androidPushTitle')}</b>
              <p className="muted" role="status" style={{ margin: '6px 0 0' }}>
                {androidPushStatusError
                  ? t('androidPushFailed')
                  : !androidPushStatus.authenticated
                    ? t('androidPushSignInRequired')
                    : !androidPushStatus.configured
                      ? t('androidPushNotConfigured')
                      : androidPushStatus.permission === 'denied'
                        ? t('androidPushPermissionDenied')
                        : androidPushStatus.registered ? t('androidPushEnabled') : t('androidPushDisabled')}
              </p>
            </div>
            <Button
              size="sm"
              variant={androidPushStatus.registered ? 'secondary' : 'primary'}
              loading={androidPushBusy}
              disabled={
                !androidPushStatus.authenticated
                || (!androidPushStatus.configured && !androidPushStatus.registered)
                || androidPushBusy
              }
              onClick={() => { void toggleAndroidPush() }}
            >
              {androidPushStatus.registered ? t('androidPushDisable') : t('androidPushEnable')}
            </Button>
          </div>
        </Card>
      )}

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
