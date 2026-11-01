import { useI18n } from '../../../i18n/useI18n'
import { useToast } from '../../../components/toastContext'
import { useAdminPreferences, type AdminPreferences } from '../../../services/edge/adminSettings'
import { logAdminAction } from '../../../services/edge/admin'
import {
  AdminButton,
  AdminCard,
  AdminPageHeader,
  AdminStatusBadge,
} from '../AdminUI'
import { AdminDefinitionList } from '../AdminDrawer'
import { AdminFilterField, AdminSelect } from '../AdminFilters'

/**
 * Owner settings.
 *
 * Scope is deliberately narrow: these are CONSOLE PREFERENCES stored on this
 * device. Nothing here can change who is an owner, what the server allows, or
 * any other account's data — an owner-settings screen that could do either
 * would be a privilege-escalation surface disguised as a preferences page.
 *
 * Destructive account operations are explicitly NOT implemented: they need a
 * separate, reviewed migration and are listed as such rather than exposed as
 * a button that would silently do nothing (or, worse, do something).
 */
export function SettingsSection({ userId, ownerEmail }: { userId: string | null; ownerEmail: string | null }) {
  const { t, language } = useI18n()
  const { notify } = useToast()
  const en = language === 'en'
  // Preferences are read synchronously on mount (see useAdminPreferences), so
  // the first paint already shows the saved values — no flash of defaults and
  // no "loading" placeholder that would mimic a network request.
  const { preferences, update, reset } = useAdminPreferences()

  const change = <K extends keyof AdminPreferences>(key: K, value: AdminPreferences[K]) => {
    update({ [key]: value } as Partial<AdminPreferences>)
    notify(t('acSettingsSaved'), 'success')
    // Owner preference changes are part of the audit trail. Best-effort: a log
    // failure must not make the preference look unsaved.
    void logAdminAction('settings_update', key, {
      key,
      // Only primitives are meaningful for an audit entry; a composite value
      // is recorded as its type rather than being persisted wholesale.
      value: typeof value === 'boolean' || typeof value === 'number' ? value : String(value),
    }).catch(() => undefined)
  }

  const online = typeof navigator === 'undefined' ? null : navigator.onLine

  return (
    <>
      <AdminPageHeader
        eyebrow={t('adminConsoleSection')}
        title={t('acSettingsTitle')}
        description={t('acSettingsSubtitle')}
        actions={
          <AdminButton onClick={() => { reset(); notify(t('acSettingsResetDone'), 'info') }}>
            {t('acSettingsReset')}
          </AdminButton>
        }
      />

      <div className="ac-grid ac-grid--panels">
          <AdminCard title={t('acSettingsTitle')} hint={t('acSettingsLocalOnly')}>
            <div className="ac-form">
              <AdminFilterField label={t('acSettingsLanguage')}>
                <AdminSelect<'en' | 'ar'>
                  value={preferences.language}
                  onChange={(value) => change('language', value)}
                  ariaLabel={t('acSettingsLanguage')}
                  options={[
                    { value: 'en', label: 'English' },
                    { value: 'ar', label: 'العربية' },
                  ]}
                />
              </AdminFilterField>

              <AdminFilterField label={t('acSettingsPageSize')}>
                <AdminSelect<'10' | '20' | '50'>
                  value={String(preferences.pageSize) as '10' | '20' | '50'}
                  onChange={(value) => change('pageSize', Number(value) as AdminPreferences['pageSize'])}
                  ariaLabel={t('acSettingsPageSize')}
                  options={[
                    { value: '10', label: '10' },
                    { value: '20', label: '20' },
                    { value: '50', label: '50' },
                  ]}
                />
              </AdminFilterField>

              <ToggleRow
                label={t('acSettingsConfirmSend')}
                hint={t('acSettingsConfirmSendHint')}
                checked={preferences.confirmBeforeSend}
                onChange={(value) => change('confirmBeforeSend', value)}
              />
              <ToggleRow
                label={t('acSettingsReducedMotion')}
                hint={t('acSettingsReducedMotionHint')}
                checked={preferences.reducedMotion}
                onChange={(value) => change('reducedMotion', value)}
              />
              <ToggleRow
                label={t('acSettingsUtc')}
                hint={t('acSettingsUtcHint')}
                checked={preferences.utcTimestamps}
                onChange={(value) => change('utcTimestamps', value)}
              />
            </div>
          </AdminCard>

          <div className="ac-grid">
            <AdminCard title={t('acRuntimeTitle')}>
              <AdminDefinitionList
                items={[
                  { label: t('acSecurityTitle'), value: <AdminStatusBadge tone="ok">{t('acVerified')}</AdminStatusBadge> },
                  { label: t('acOwnerEmailTitle'), value: <span className="ac-mono">{ownerEmail ?? '—'}</span> },
                  { label: t('acUserId'), value: <span className="ac-mono ac-mono--wrap">{userId ?? '—'}</span> },
                  { label: t('acRuntimePlatform'), value: typeof navigator === 'undefined' ? '—' : navigator.platform || '—' },
                  { label: t('acRuntimeLanguage'), value: preferences.language === 'ar' ? 'العربية' : 'English' },
                  { label: t('acRuntimeZone'), value: Intl.DateTimeFormat().resolvedOptions().timeZone ?? '—' },
                  {
                    label: t('acRuntimeOnline'),
                    value: (
                      <AdminStatusBadge tone={online === null ? 'muted' : online ? 'ok' : 'error'}>
                        {online === null ? '—' : online ? t('acRuntimeOnlineYes') : t('acRuntimeOnlineNo')}
                      </AdminStatusBadge>
                    ),
                  },
                ]}
              />
            </AdminCard>

            <AdminCard title={t('acDangerTitle')} hint={t('acDangerBody')}>
              <AdminButton disabled>{en ? 'Delete account (not available)' : 'حذف حساب (غير متاح)'}</AdminButton>
            </AdminCard>
          </div>
        </div>
    </>
  )
}

/** Accessible switch row (role="switch"), independent of the app-wide Toggle. */
function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="ac-toggle-row">
      <div>
        <p className="ac-toggle-row__label">{label}</p>
        <p className="ac-toggle-row__hint">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={checked ? 'ac-switch ac-switch--on' : 'ac-switch'}
        onClick={() => onChange(!checked)}
      >
        <span className="ac-switch__knob" />
      </button>
    </div>
  )
}
