import { useCallback, useEffect, useState } from 'react'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Toggle } from '../components/Field'
import { BellIcon } from '../components/icons'
import { updateSettings, useSettings } from '../services/store'
import { canScheduleReminders, requestReminderPermission, sendTestNotification, syncReminders, type ReminderSyncResult } from '../services/reminders'
import { useI18n } from '../i18n/useI18n'
import type { TranslationKey } from '../i18n/translations'

/**
 * Reminder management.
 *
 * Layout: three grouped sections of comfortable rows instead of one long
 * settings table. Honesty rules:
 *  - on Android the status text reflects the *actual* plugin result;
 *  - in the browser we say plainly that OS reminders are not available in this
 *    build instead of showing a switch that silently does nothing;
 *  - a failed schedule keeps the switch off and shows the real error.
 */

type Section = 'study' | 'review' | 'studio'

const SECTIONS: { id: Section; key: TranslationKey }[] = [
  { id: 'study', key: 'reminderSection_study' },
  { id: 'review', key: 'reminderSection_review' },
  { id: 'studio', key: 'reminderSection_studio' },
]

const SECTION_OF: Record<string, Section> = {
  rem_morning: 'study',
  rem_afternoon: 'study',
  rem_evening: 'review',
  rem_studio: 'studio',
  rem_break: 'studio',
}

const LABEL_KEY: Record<string, TranslationKey> = {
  rem_morning: 'reminderMorning',
  rem_afternoon: 'reminderAfternoon',
  rem_evening: 'reminderEvening',
  rem_studio: 'reminderStudio',
  rem_break: 'reminderBreak',
}

export function ReminderSettings() {
  const settings = useSettings()
  const { t, language, formatDate } = useI18n()
  const en = language === 'en'
  const supported = canScheduleReminders()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<ReminderSyncResult | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  const reminders = settings.reminders

  /** Re-run the native sync and record the real outcome. */
  const resync = useCallback(async (list = reminders) => {
    if (!supported) return null
    const result = await syncReminders(list)
    setLastResult(result)
    return result
  }, [reminders, supported])

  // Restore schedules after an app restart: Android drops nothing, but if the
  // user granted permission later or the OS cleared alarms, this re-asserts
  // them. Runs once per mount, never prompts when nothing is enabled.
  useEffect(() => {
    if (!supported) return
    if (!reminders.some((reminder) => reminder.enabled)) return
    void resync(reminders)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported])

  const toggle = async (id: string, enabled: boolean) => {
    const next = reminders.map((reminder) => (reminder.id === id ? { ...reminder, enabled } : reminder))
    setPendingId(id)
    setLastResult(null)
    try {
      if (enabled && supported) {
        const granted = await requestReminderPermission()
        if (!granted) {
          setLastResult({ scheduled: 0, permissionGranted: false, webUnsupported: false, error: 'permission_denied' })
          return // keep the previous (off) state — never show a false "on"
        }
      }
      await updateSettings({ reminders: next, notificationsOptIn: next.some((reminder) => reminder.enabled) })
      await resync(next)
    } finally {
      setPendingId(null)
    }
  }

  const changeTime = async (id: string, time: string) => {
    if (!/^\d{2}:\d{2}$/.test(time)) return
    const next = reminders.map((reminder) => (reminder.id === id ? { ...reminder, time } : reminder))
    setPendingId(id)
    try {
      await updateSettings({ reminders: next })
      if (next.find((reminder) => reminder.id === id)?.enabled) await resync(next)
    } finally {
      setPendingId(null)
    }
  }

  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await sendTestNotification()
      if (result.ok) setTestResult(en ? 'Test notification accepted by the system. Check your notification shade.' : 'النظام قبل الإشعار التجريبي. شوفيه في شريط الإشعارات.')
      else if (result.error === 'web_unsupported') setTestResult(t('testNotificationWebUnsupported'))
      else if (result.error === 'permission_denied') setTestResult(t('testNotificationPermission'))
      else setTestResult(`${t('testNotificationFailed')}: ${result.error}`)
    } finally {
      setTesting(false)
    }
  }

  const statusFor = (enabled: boolean) => {
    if (!enabled) return { tone: 'off', text: t('reminderDisabled') }
    if (!supported) return { tone: 'off', text: t('reminderDeliveryWeb') }
    if (lastResult?.error === 'permission_denied') return { tone: 'error', text: t('reminderDeliveryDenied') }
    if (lastResult?.error) return { tone: 'error', text: lastResult.error }
    return { tone: 'on', text: t('reminderDeliveryNative') }
  }

  return (
    <Card className="settings-card reminder-panel">
      <div className="reminder-panel__head">
        <div>
          <h2 className="section-head__title">{t('reminders')}</h2>
          <p className="t-sm t-muted">
            {supported ? t('reminderSavedNative') : t('reminderSavedWeb')}
          </p>
        </div>
        <span className={`platform-pill ${supported ? 'platform-pill--native' : 'platform-pill--web'}`}>
          <BellIcon size={14} />
          {supported ? t('reminderPlatformAndroid') : t('reminderPlatformWeb')}
        </span>
      </div>

      {!supported && <p className="alert alert--info">{t('noCloudPush')}</p>}

      {SECTIONS.map((section) => {
        const rows = reminders.filter((reminder) => SECTION_OF[reminder.id] === section.id)
        if (rows.length === 0) return null
        return (
          <section className="reminder-group" key={section.id}>
            <h3 className="reminder-group__title">{t(section.key)}</h3>
            <div className="reminder-list">
              {rows.map((reminder) => {
                const status = statusFor(reminder.enabled)
                const busy = pendingId === reminder.id
                return (
                  <div key={reminder.id} className={`reminder-row ${reminder.enabled ? 'reminder-row--on' : ''}`}>
                    <div className="reminder-row__text">
                      <p className="reminder-row__label">{t(LABEL_KEY[reminder.id] ?? 'reminders')}</p>
                      <p className={`reminder-row__status reminder-row__status--${status.tone}`}>
                        <i aria-hidden="true" />
                        {busy ? t('reminderScheduling') : status.text}
                      </p>
                    </div>
                    <div className="reminder-row__time">
                      <input
                        type="time"
                        className="input input--time"
                        value={reminder.time}
                        aria-label={`${t(LABEL_KEY[reminder.id] ?? 'reminders')} — ${en ? 'time' : 'الوقت'}`}
                        onChange={(event) => { void changeTime(reminder.id, event.target.value) }}
                      />
                    </div>
                    <Toggle
                      label={reminder.enabled ? t('reminderEnabled') : t('reminderDisabled')}
                      checked={reminder.enabled}
                      disabled={busy || !supported}
                      onChange={(checked) => { void toggle(reminder.id, checked) }}
                      className="reminder-row__toggle"
                    />
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}

      {supported && (
        <div className="reminder-panel__footer">
          <Button variant="secondary" loading={testing} onClick={() => { void runTest() }}>{t('testNotification')}</Button>
          <p className="t-xs t-muted">{t('reminderCardHint')}</p>
          {testResult && <p className="alert alert--info">{testResult}</p>}
          {lastResult?.error && lastResult.error !== 'permission_denied' && (
            <p className="alert alert--danger">{t('reminderScheduleFailed', { error: lastResult.error })}</p>
          )}
        </div>
      )}

      {!supported && lastResult?.webUnsupported && (
        <p className="t-xs t-muted">
          {formatDate(new Date(), { month: 'short', day: 'numeric' })} · {t('reminderCardHint')}
        </p>
      )}
    </Card>
  )
}
