import { useState } from 'react'
import { useSyncStatus, probeCloudReachable, type SyncStatus } from '../services/syncStatus'
import { retryPersistence } from '../services/store'
import { Button } from './Button'
import { useI18n } from '../i18n/useI18n'

/**
 * Compact, honest connectivity/sync indicator for the app shell.
 *
 * It never says "Synced" for local-only data, and it distinguishes
 * "device offline" from "device online but the service is unreachable".
 */
export function SyncIndicator() {
  const status = useSyncStatus()
  const { t, language } = useI18n()
  const [open, setOpen] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const en = language === 'en'

  const view = describe(status, en)

  return (
    <div className="sync-indicator">
      <button
        type="button"
        className={`sync-pill sync-pill--${view.tone}`}
        aria-label={`${view.label}. ${en ? 'Show sync details' : 'عرض تفاصيل المزامنة'}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <i className="sync-pill__dot" aria-hidden="true" />
        <span className="sync-pill__text">{view.label}</span>
      </button>

      {open && (
        <div className="sync-popover" role="dialog" aria-label={en ? 'Sync status' : 'حالة المزامنة'}>
          <p className="sync-popover__title">{view.label}</p>
          <p className="sync-popover__detail">{view.detail}</p>
          {status.error && <p className="sync-popover__error">{status.error}</p>}
          {status.lastSyncedAt && (
            <p className="t-xs t-muted">
              {en ? 'Last synced' : 'آخر مزامنة'}: {new Date(status.lastSyncedAt).toLocaleString(en ? 'en-US' : 'ar-EG')}
            </p>
          )}
          <div className="row row--wrap" style={{ marginTop: 8 }}>
            <Button
              size="sm"
              variant="secondary"
              loading={retrying}
              onClick={async () => {
                setRetrying(true)
                try {
                  await probeCloudReachable(true)
                  await retryPersistence().catch(() => undefined)
                } finally {
                  setRetrying(false)
                }
              }}
            >
              {en ? 'Retry now' : 'أعيدي المحاولة'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{t('close')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function describe(status: SyncStatus, en: boolean): { label: string; detail: string; tone: string } {
  if (status.localOnly) {
    return {
      tone: 'local',
      label: en ? 'Saved on this device' : 'محفوظ على الجهاز',
      detail: en
        ? 'Cloud sync is not configured, so your work is kept in this browser only. Everything you change is still saved locally.'
        : 'المزامنة السحابية غير مهيأة، فشغلك محفوظ في المتصفح ده بس. أي تعديل بيتحفظ محليًا.',
    }
  }
  if (status.connection === 'offline') {
    return {
      tone: 'offline',
      label: en ? 'Offline — saved locally' : 'بدون إنترنت — محفوظ محليًا',
      detail: en
        ? 'Your changes are saved on this device. They will sync when the connection returns.'
        : 'تغييراتك محفوظة على الجهاز، وهتزامن أول ما الإنترنت يرجع.',
    }
  }
  if (status.connection === 'unreachable') {
    return {
      tone: 'warning',
      label: en ? 'Service unreachable' : 'السيرفر مش متاح',
      detail: en
        ? 'Your device is online but the sync service cannot be reached. Nothing has been lost — changes stay on this device.'
        : 'الجهاز متصل بالإنترنت لكن خدمة المزامنة مش متاحة. مفيش حاجة ضاعت — التغييرات محفوظة على الجهاز.',
    }
  }
  switch (status.sync) {
    case 'syncing':
      return { tone: 'syncing', label: en ? 'Syncing…' : 'بيتزامن…', detail: en ? 'Uploading your latest changes.' : 'بيتم رفع آخر تغييراتك.' }
    case 'synced':
      return { tone: 'synced', label: en ? 'Synced' : 'متزامن', detail: en ? 'Your latest changes are backed up to your account.' : 'آخر تغييراتك محفوظة في حسابك.' }
    case 'failed':
      return {
        tone: 'warning',
        label: en ? 'Sync failed — saved locally' : 'فشلت المزامنة — محفوظ محليًا',
        detail: en
          ? 'Your changes are still available on this device. Use Retry to send them again.'
          : 'تغييراتك لسه موجودة على الجهاز. استخدمي «أعيدي المحاولة».',
      }
    case 'sign-in-required':
      return {
        tone: 'local',
        label: en ? 'Local only — sign in to sync' : 'محلي فقط — سجّلي الدخول للمزامنة',
        detail: en ? 'You are signed in but this device has not been linked to the cloud yet.' : 'أنت مسجّلة، لكن الجهاز ده لسه مش مرتبط بالسحابة.',
      }
    default:
      return { tone: 'synced', label: en ? 'Online' : 'متصل', detail: en ? 'Connected and up to date.' : 'متصل ومحدث.' }
  }
}
