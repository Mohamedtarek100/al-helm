import { useCallback, useEffect, useState } from 'react'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Toggle } from '../components/Field'
import { BellIcon } from '../components/icons'
import { updateSettings, useSettings, createAlarm, updateAlarm, deleteAlarm } from '../services/store'
import { canScheduleReminders, requestReminderPermission, sendTestNotification, syncReminders, type ReminderSyncResult } from '../services/reminders'
import { REMINDER_TONES, previewTone } from '../services/alarmTones'
import type { ReminderPreference, ReminderTone } from '../types'
import { useToast } from '../components/toastContext'
import { ConfirmDialog, Modal } from '../components/Modal'
import { Field, TextInput, Select } from '../components/Field'
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

/**
 * The translated default name for a built-in reminder.
 *
 * Used only as the STARTING value: the stored `label` wins whenever the user has
 * renamed the alarm, so an edited title is never replaced by a translated
 * constant on the next render (the previous defect).
 */
function defaultLabel(id: string, t: (key: TranslationKey) => string, fallback: string): string {
  const key = LABEL_KEY[id]
  return key ? t(key) : fallback
}

export function ReminderSettings() {
  const settings = useSettings()
  const { t, language, formatDate } = useI18n()
  const en = language === 'en'
  const supported = canScheduleReminders()
  const { notify } = useToast()
  const [pendingId, setPendingId] = useState<string | null>(null)
  /** In-progress name edits, so a half-typed title is never persisted. */
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState<{ label: string; time: string; date: string; tone: ReminderTone }>({ label: '', time: '07:00', date: '', tone: 'default' })
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

  /**
   * Renaming is a two-step edit: typing updates the field only, and the commit
   * happens on blur/Enter. Persisting per keystroke would also re-run the
   * native schedule on every character.
   */
  const renameLocally = (id: string, label: string) => {
    setDrafts((current) => ({ ...current, [id]: label }))
  }

  const commitRename = async (id: string, raw: string) => {
    const current = reminders.find((reminder) => reminder.id === id)
    if (!current) return
    const label = raw.trim().slice(0, 40)
    // An empty name would make the alarm unrecognisable in the notification
    // shade, so it is discarded rather than saved blank.
    if (!label || label === current.label) {
      setDrafts((state) => { const next = { ...state }; delete next[id]; return next })
      return
    }
    const next = reminders.map((reminder) => (reminder.id === id ? { ...reminder, label } : reminder))
    setPendingId(id)
    try {
      await updateSettings({ reminders: next })
      // A scheduled notification carries the title captured when it was
      // scheduled, so an enabled reminder must be rescheduled with the new name.
      if (current.enabled && supported) await resync(next)
      notify(t('alarmSaved'), 'success')
    } catch (error) {
      notify(error instanceof Error ? error.message : t('retry'), 'danger')
    } finally {
      setDrafts((state) => { const next = { ...state }; delete next[id]; return next })
      setPendingId(null)
    }
  }

  /** Changes the alarm tone, rescheduling so the new channel takes effect. */
  const changeTone = async (id: string, tone: ReminderTone) => {
    const next = reminders.map((reminder) => (reminder.id === id ? { ...reminder, tone } : reminder))
    setPendingId(id)
    try {
      await updateSettings({ reminders: next })
      if (next.find((reminder) => reminder.id === id)?.enabled && supported) await resync(next)
      notify(t('alarmSaved'), 'success')
    } catch (error) {
      notify(error instanceof Error ? error.message : t('retry'), 'danger')
    } finally {
      setPendingId(null)
    }
  }

  /**
   * Plays the selected tone.
   *
   * On Android the real sound can only be heard through an actual notification,
   * so this raises a test notification on that tone. On the web a synthesised
   * preview plays and the limitation is stated rather than faked.
   */
  const audition = async (tone: ReminderTone) => {
    setTesting(true)
    try {
      if (supported) {
        const result = await sendTestNotification(tone)
        setTestResult(result.ok
          ? t('alarmPreviewSent')
          : result.error === 'permission_denied' ? t('testNotificationPermission') : t('alarmPreviewFailed'))
        return
      }
      const preview = await previewTone(tone)
      setTestResult(preview.ok ? t('alarmPreviewWeb') : t('alarmNoSounds'))
    } finally {
      setTesting(false)
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

  /* ---------------- create / edit / delete ---------------- */

  const openCreate = () => {
    setEditingId(null)
    setForm({ label: '', time: '07:00', date: '', tone: 'default' })
    setFormError(null)
    setDialogOpen(true)
  }

  const openEdit = (reminder: ReminderPreference) => {
    setEditingId(reminder.id)
    setForm({ label: reminder.label, time: reminder.time, date: reminder.date ?? '', tone: reminder.tone ?? 'default' })
    setFormError(null)
    setDialogOpen(true)
  }

  const submitAlarm = async () => {
    if (!form.label.trim()) { setFormError(t('alarmTitleRequired')); return }
    if (!/^\d{2}:\d{2}$/.test(form.time)) { setFormError(t('alarmTimeRequired')); return }
    // Enabling an alarm without notification permission would silently never
    // ring, so permission is requested FIRST and the alarm is left off if denied.
    let enabled = true
    if (supported) {
      const granted = await requestReminderPermission()
      if (!granted) {
        enabled = false
        setLastResult({ scheduled: 0, permissionGranted: false, webUnsupported: false, error: 'permission_denied' })
      }
    }
    try {
      if (editingId) {
        await updateAlarm(editingId, { label: form.label, time: form.time, date: form.date || null, tone: form.tone, enabled })
      } else {
        await createAlarm({ label: form.label, time: form.time, date: form.date || null, tone: form.tone, enabled })
      }
      const result = await resync()
      if (supported && result?.error) {
        setLastResult(result)
        setFormError(result.error === 'permission_denied' ? t('testNotificationPermission') : result.error)
        notify(result.error === 'permission_denied' ? t('testNotificationPermission') : result.error, 'danger')
        return
      }
      if (!supported) {
        setLastResult({ scheduled: 0, permissionGranted: false, webUnsupported: true, error: null })
      }
      setDialogOpen(false)
      notify(!supported
        ? (en ? 'Saved in the app. System alarms require the Android app.' : 'تم الحفظ داخل التطبيق. المنبهات الفعلية تحتاج تطبيق Android.')
        : t('alarmSaved'), supported ? 'success' : 'warning')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('retry'))
    }
  }

  const confirmDelete = async () => {
    if (!deletingId) return
    try {
      await deleteAlarm(deletingId)
      setDeletingId(null)
      notify(t('alarmDeleted'), 'info')
      await resync()
    } catch (error) {
      // The alarm is still stored (the store throws before removing it), so the
      // message must not claim it was deleted.
      notify(error instanceof Error ? error.message : t('retry'), 'danger')
    }
  }

  const alarms = reminders

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

      <div className="reminder-panel__actions">
        <Button variant="primary" size="sm" onClick={openCreate}>{t('alarmNew')}</Button>
      </div>

      {!supported && <p className="alert alert--info">{t('noCloudPush')}</p>}
      {/* Platform limits stated plainly: a browser cannot fire an alarm while
          the tab is closed, and Android can defer alarms under battery saver.
          Claiming otherwise would be untrue. */}
      <p className="alert alert--info">{supported ? t('alarmAndroidLimit') : t('alarmWebLimit')}</p>

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
                      <p className="reminder-row__label">
                        {/* The stored name wins; a blank/legacy record falls
                            back to the translated default. */}
                        {reminder.label || defaultLabel(reminder.id, t, t('reminders'))}
                      </p>
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
                        aria-label={`${reminder.label} — ${en ? 'time' : 'الوقت'}`}
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
                    <div className="reminder-row__tools">
                      {/* Editable title: the alarm must be recognisable in the
                          notification shade, so the name is user-owned. */}
                      <input
                        className="input reminder-row__name"
                        value={drafts[reminder.id] ?? reminder.label}
                        maxLength={40}
                        aria-label={t('alarmTitle')}
                        title={t('alarmRenameHint')}
                        onChange={(event) => renameLocally(reminder.id, event.target.value)}
                        onBlur={(event) => { void commitRename(reminder.id, event.target.value) }}
                        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
                      />
                      <select
                        className="input reminder-row__tone"
                        value={reminder.tone ?? 'default'}
                        aria-label={t('alarmSound')}
                        onChange={(event) => { void changeTone(reminder.id, event.target.value as ReminderTone) }}
                      >
                        {REMINDER_TONES.map((tone) => (
                          <option key={tone.id} value={tone.id}>{t(tone.labelKey)}</option>
                        ))}
                      </select>
                      <Button size="sm" variant="ghost" loading={testing} onClick={() => { void audition(reminder.tone ?? 'default') }}>
                        {t('alarmPreview')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(reminder)}>{t('alarmEdit')}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeletingId(reminder.id)} aria-label={`${t('delete')} ${reminder.label}`}>
                        {t('delete')}
                      </Button>
                    </div>
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

      {/* Create / edit alarm. Title, time and an optional one-off date. */}
      <Modal
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editingId ? t('alarmEdit') : t('alarmNew')}
        footer={<>
          <Button variant="ghost" onClick={() => setDialogOpen(false)}>{t('adminCancel')}</Button>
          <Button variant="primary" onClick={() => { void submitAlarm() }}>{t('save')}</Button>
        </>}
      >
        <div className="form-grid">
          <Field label={t('alarmTitle')} required error={formError ?? undefined} className="form-grid__full">
            <TextInput
              value={form.label}
              maxLength={40}
              placeholder={t('alarmTitlePlaceholder')}
              onChange={(event) => setForm({ ...form, label: event.target.value })}
            />
          </Field>
          <Field label={t('alarmTime')} required>
            <TextInput type="time" value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} />
          </Field>
          <Field label={t('alarmDate')} hint={t('alarmDateHint')}>
            <TextInput type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
          </Field>
          <Field label={t('alarmSound')} className="form-grid__full" hint={t('alarmToneHint')}>
            <Select
              value={form.tone}
              onChange={(event) => setForm({ ...form, tone: event.target.value as ReminderTone })}
            >
              {REMINDER_TONES.map((tone) => (
                <option key={tone.id} value={tone.id}>{t(tone.labelKey)}</option>
              ))}
            </Select>
          </Field>
          <div className="form-grid__full row">
            <Button variant="secondary" loading={testing} onClick={() => { void audition(form.tone) }}>
              {t('alarmPreview')}
            </Button>
            {testResult && <span className="t-xs t-muted">{testResult}</span>}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deletingId !== null}
        title={t('delete')}
        message={t('alarmDeleteConfirm', {
          name: alarms.find((alarm) => alarm.id === deletingId)?.label ?? '',
        })}
        confirmLabel={t('delete')}
        cancelLabel={t('adminCancel')}
        destructive
        onConfirm={() => { void confirmDelete() }}
        onCancel={() => setDeletingId(null)}
      />
    </Card>
  )
}
