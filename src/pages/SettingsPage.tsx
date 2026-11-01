import { useRef, useState } from 'react'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Field, TextInput, Toggle } from '../components/Field'
import { DownloadIcon, UploadIcon } from '../components/icons'
import { importBackup, downloadBackup } from '../services/export/backupService'
import { resetAllData, updateProfile, updateSettings, useProfile, useSettings } from '../services/store'
import { PageFrame, PageHeading } from './PageFrame'
import { useToast } from '../components/toastContext'
import { ConfirmDialog } from '../components/Modal'
import { useI18n } from '../i18n/useI18n'
import { AuthPanel } from './AuthPanel'
import { AppLockSettings } from '../components/AppLockSettings'
import { ReminderSettings } from './ReminderSettings'

export function SettingsPage() {
  const profile = useProfile()
  const settings = useSettings()
  const { notify } = useToast()
  const { t, language, setLanguage } = useI18n()
  const en = language === 'en'
  const input = useRef<HTMLInputElement>(null)
  const [confirm, setConfirm] = useState(false)
  const [importing, setImporting] = useState(false)
  /**
   * Edits are tracked as an OVERRIDE, not as a copy of the profile.
   *
   * `null` means "no local edit yet — show the stored profile". This replaces a
   * state-resetting effect: the previous version copied the profile into state
   * and then re-synced it in an effect, which rendered the stale value first and
   * would discard an in-progress edit as soon as a background cloud sync
   * rewrote `profile`.
   */
  const [draft, setDraft] = useState<{ name: string; motto: string } | null>(null)
  const [savingProfile, setSavingProfile] = useState(false)
  const name = draft?.name ?? profile.displayName
  const motto = draft?.motto ?? profile.motto
  const setName = (value: string) => setDraft((current) => ({ name: value, motto: current?.motto ?? profile.motto }))
  const setMotto = (value: string) => setDraft((current) => ({ name: current?.name ?? profile.displayName, motto: value }))

  const backup = () => {
    try {
      const fileName = downloadBackup()
      notify(`${t('backupDownloaded')}: ${fileName}`, 'success')
    } catch (error) {
      notify(error instanceof Error ? error.message : t('retry'), 'danger')
    }
  }

  const load = async (file?: File) => {
    if (!file) return
    setImporting(true)
    try {
      await importBackup(file)
      notify(t('backupRestored'), 'success')
    } catch (error) {
      notify(error instanceof Error ? error.message : t('importInvalid'), 'danger')
    } finally {
      setImporting(false)
      if (input.current) input.current.value = ''
    }
  }

  const saveProfile = async () => {
    setSavingProfile(true)
    try {
      await updateProfile({ displayName: name.trim() || (en ? 'Artist' : 'فنانة'), motto })
      // Hand the fields back to the stored profile: the write is confirmed, so
      // the override is no longer needed and later syncs can show through.
      setDraft(null)
      notify(t('save'), 'success')
    } catch (error) {
      notify(error instanceof Error ? error.message : t('retry'), 'danger')
    } finally {
      setSavingProfile(false)
    }
  }

  return (
    <PageFrame className="page-stack">
      <PageHeading eyebrow={t('settings')} title={t('settings')} subtitle={t('localStorageNotice')} />

      <div className="settings-grid">
        <div className="settings-column">
          <Card className="settings-card">
            <h2 className="section-head__title">{en ? 'Your profile' : 'ملفك'}</h2>
            <div className="form-grid">
              <Field label={t('profileName')} className="form-grid__full">
                <TextInput value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
              </Field>
              <Field label={t('intentionHint')} className="form-grid__full">
                <TextInput value={motto} onChange={(event) => setMotto(event.target.value)} maxLength={140} />
              </Field>
            </div>
            <div className="row row--end" style={{ marginTop: 12 }}>
              <Button variant="primary" loading={savingProfile} onClick={() => { void saveProfile() }}>{t('save')}</Button>
            </div>
          </Card>

          <Card className="settings-card">
            <h2 className="section-head__title">{t('language')}</h2>
            <div className="row row--wrap" style={{ marginBottom: 14 }}>
              <Button variant={language === 'en' ? 'primary' : 'secondary'} onClick={() => setLanguage('en')}>{t('english')}</Button>
              <Button variant={language === 'ar' ? 'primary' : 'secondary'} onClick={() => setLanguage('ar')}>{t('arabic')}</Button>
            </div>
            <Toggle
              label={t('soundEnabled')}
              description={t('timerSound')}
              checked={settings.soundEnabled}
              onChange={(checked) => { void updateSettings({ soundEnabled: checked }).catch((error) => notify(error instanceof Error ? error.message : t('retry'), 'danger')) }}
            />
          </Card>

          <AuthPanel />

          <AppLockSettings />
        </div>

        <div className="settings-column">
          <ReminderSettings />

          <Card className="settings-card">
            <h2 className="section-head__title">{t('backupData')}</h2>
            <p className="t-sm t-muted">{t('backupHint')}</p>
            <div className="row row--wrap" style={{ marginTop: 12 }}>
              <Button variant="secondary" leadingIcon={<DownloadIcon size={16} />} onClick={backup}>{t('downloadBackup')}</Button>
              <Button variant="secondary" leadingIcon={<UploadIcon size={16} />} loading={importing} onClick={() => input.current?.click()}>{t('restoreBackup')}</Button>
              <input ref={input} type="file" accept="application/json,.json" hidden onChange={(event) => { void load(event.target.files?.[0]) }} />
            </div>
          </Card>

          <Card className="settings-card settings-card--danger">
            <h2 className="section-head__title">{t('clearLocalData')}</h2>
            <p className="t-sm t-muted">{t('clearDataConfirmBody')}</p>
            <Button variant="danger" onClick={() => setConfirm(true)} style={{ marginTop: 12 }}>{t('clearLocalData')}</Button>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirm}
        title={t('clearDataConfirmTitle')}
        message={t('clearDataConfirmBody')}
        confirmLabel={t('clearDataConfirm')}
        cancelLabel={t('cancel')}
        destructive
        onConfirm={async () => {
          setConfirm(false)
          try { await resetAllData(); notify(t('notificationsCleared'), 'info') }
          catch (error) { notify(error instanceof Error ? error.message : t('retry'), 'danger') }
        }}
        onCancel={() => setConfirm(false)}
      />
    </PageFrame>
  )
}
