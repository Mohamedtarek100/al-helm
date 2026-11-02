import { useEffect, useState } from 'react'
import { useI18n } from '../../../i18n/useI18n'
import { runHealthChecks, useAdminHealth } from '../../../services/edge/adminHealth'
import { getAuditLog, type AuditEntry } from '../../../services/edge/admin'
import { useAdminResource } from '../../../services/edge/adminData'
import {
  AdminButton,
  AdminCard,
  AdminDataTable,
  AdminEmptyState,
  AdminErrorState,
  AdminLoadingState,
  AdminPageHeader,
  AdminStatCard,
  AdminStatusBadge,
  type AdminColumn,
  type AdminTone,
} from '../AdminUI'
import { AdminSearchInput } from '../AdminFilters'

/**
 * Security center, audit log and system health.
 *
 * WHY THE SECURITY PANEL IS A LIST OF FACTS, NOT A SCORE
 *   A “security score” would be invented. Instead each row states one control
 *   that actually exists in this codebase, where it is enforced, and — where
 *   the server can confirm it — the live status. Rows the server cannot verify
 *   say so.
 */

const AUDIT_LABEL_KEYS: Record<string, 'acAuditAction_app_open' | 'acAuditAction_user_export' | 'acAuditAction_announcement_send' | 'acAuditAction_settings_update' | 'acAuditAction_recipients_preview'> = {
  app_open: 'acAuditAction_app_open',
  user_export: 'acAuditAction_user_export',
  announcement_send: 'acAuditAction_announcement_send',
  settings_update: 'acAuditAction_settings_update',
  recipients_preview: 'acAuditAction_recipients_preview',
}

const LIVE_CHECK_MAP: Record<string, string[]> = {
  // security row id → health check ids that back it
  serverAuth: ['auth'],
  serviceRole: ['database', 'delivery', 'activity'],
  rls: ['delivery', 'activity'],
  audit: ['audit'],
}

export function SecuritySection({ userId, refreshKey }: { userId: string | null; refreshKey: number }) {
  const { t, language } = useI18n()
  const en = language === 'en'
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  // Health runs on demand via "Run checks"; mounting the panel does not fire a
  // check, so the header badge says "Not checked" until one is actually run.
  const healthStore = useAdminHealth()
  useEffect(() => {
    if (healthStore.summary === 'unknown' && !healthStore.error) {
      void runHealthChecks()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const health = {
    state: healthStore.report
      ? ({ status: 'ready', data: healthStore.report, error: null } as const)
      : healthStore.summary === 'checking'
        ? ({ status: 'loading', data: null, error: null } as const)
        : healthStore.error
          ? ({ status: 'error', data: null, error: healthStore.error } as const)
          : ({ status: 'loading', data: null, error: null } as const),
    retry: () => { void runHealthChecks() },
  }
  const audit = useAdminResource(() => getAuditLog({ limit: 100, search: query }), [userId, refreshKey, query])

  const checkById = new Map((health.state.status === 'ready' ? health.state.data.checks : []).map((check) => [check.id, check]))

  const rowStatus = (id: string): { tone: AdminTone; label: string } => {
    if (health.state.status !== 'ready') return { tone: 'muted', label: t('acCheckUnknown') }
    const ids = LIVE_CHECK_MAP[id] ?? []
    if (ids.length === 0) return { tone: 'info', label: t('acSecurityEnforced') }
    const checks = ids.map((checkId) => checkById.get(checkId)).filter(Boolean)
    if (checks.length === 0) return { tone: 'muted', label: t('acCheckUnknown') }
    return checks.every((check) => check?.ok)
      ? { tone: 'ok', label: t('acSecurityVerified') }
      : { tone: 'error', label: t('acCheckFailed') }
  }

  const controls = [
    { id: 'serverAuth', title: t('acSecurityAuth'), body: t('acSecurityAuthBody'), source: 'supabase/functions/admin/index.ts · ADMIN_EMAILS' },
    { id: 'client', title: t('acSecurityClient'), body: t('acSecurityClientBody'), source: 'src/pages/AdminPage.tsx · useAdminGate()' },
    { id: 'serviceRole', title: t('acSecurityServiceRole'), body: t('acSecurityServiceRoleBody'), source: 'supabase/functions/admin/index.ts · adminClient()' },
    { id: 'cors', title: t('acSecurityCors'), body: t('acSecurityCorsBody'), source: 'OPTIONS handler before auth' },
    { id: 'rls', title: t('acSecurityRls'), body: t('acSecurityRlsBody'), source: 'migrations 003 + 010' },
    { id: 'audit', title: t('acAuditTitle'), body: t('acAuditAppendOnly'), source: 'migration 010 · audit triggers' },
  ]

  const auditColumns: AdminColumn<AuditEntry>[] = [
    { key: 'when', header: t('acAuditWhen'), render: (row) => new Date(row.createdAt).toLocaleString(en ? 'en-US' : 'ar-EG') },
    // Known actions get a translated label; an action added server-side later
    // still renders its human-readable server label instead of a raw key.
    { key: 'action', header: t('acAuditAction'), render: (row) => <b>{AUDIT_LABEL_KEYS[row.action] ? t(AUDIT_LABEL_KEYS[row.action]) : row.actionLabel}</b> },
    { key: 'actor', header: t('acAuditActor'), render: (row) => <span className="ac-mono">{row.actorEmail ?? '—'}</span>, hideOnMobile: true },
    { key: 'target', header: t('acAuditTarget'), render: (row) => <span className="ac-mono">{row.target ?? '—'}</span>, hideOnMobile: true },
    {
      key: 'detail',
      header: t('acAuditDetail'),
      render: (row) => <span className="ac-mono ac-mono--wrap">{row.detail ? JSON.stringify(row.detail) : '—'}</span>,
      hideOnMobile: true,
    },
  ]

  return (
    <>
      <AdminPageHeader
        eyebrow={t('adminConsoleSection')}
        title={t('acSecurityTitle')}
        description={t('acSecuritySubtitle')}
        actions={
          <AdminButton onClick={health.retry} loading={health.state.status === 'loading'}>
            {health.state.status === 'loading' ? t('acRunningChecks') : t('acRunChecks')}
          </AdminButton>
        }
      />

      <AdminCard title={t('acSecurityCheck')} padded={false}>
        <div className="ac-control-list">
          {controls.map((control) => {
            const status = rowStatus(control.id)
            return (
              <div key={control.id} className="ac-control">
                <div className="ac-control__text">
                  <h3 className="ac-control__title">{control.title}</h3>
                  <p className="ac-control__body">{control.body}</p>
                  <p className="ac-control__source">{control.source}</p>
                </div>
                <AdminStatusBadge tone={status.tone}>{status.label}</AdminStatusBadge>
              </div>
            )
          })}
        </div>
      </AdminCard>

      <div className="ac-grid ac-grid--panels" style={{ marginTop: 'var(--ac-space-3)' }}>
        <AdminCard
          title={t('acDiagnosticsTitle')}
          hint={t('acDiagnosticsSubtitle')}
          action={
            health.state.status === 'ready'
              ? <AdminStatusBadge tone={health.state.data.checks.every((check) => check.ok) ? 'ok' : 'error'}>
                {health.state.data.checks.every((check) => check.ok) ? t('acHealthAllGood') : t('acHealthSomeFailed')}
              </AdminStatusBadge>
              : undefined
          }
        >
          {health.state.status === 'loading' && <AdminLoadingState label={t('acRunningChecks')} />}
          {health.state.status === 'error' && (
            <AdminErrorState title={t('acCheckFailed')} message={health.state.error} onRetry={health.retry} retryLabel={t('acRetry')} />
          )}
          {health.state.status === 'ready' && (
            <>
              <ul className="ac-health">
                {health.state.data.checks.map((check) => (
                  <li key={check.id} className="ac-health__row">
                    <span className="ac-health__label">{check.label}</span>
                    <AdminStatusBadge tone={check.ok ? 'ok' : 'error'}>
                      {check.ok ? t('acCheckPassed') : t('acCheckFailed')}
                    </AdminStatusBadge>
                    {check.detail && <span className="ac-health__detail">{check.detail}</span>}
                  </li>
                ))}
              </ul>
              <p className="ac-footnote">
                {t('acHealthLastChecked')}: {new Date(health.state.data.checkedAt).toLocaleString(en ? 'en-US' : 'ar-EG')}
                {' · '}
                {t('acHealthLatency')}: {health.state.data.elapsedMs} ms
              </p>
              <ul className="ac-health ac-health--runtime">
                <li className="ac-health__row">
                  <span className="ac-health__label">{en ? 'ADMIN_EMAILS configured' : 'ADMIN_EMAILS مهيأة'}</span>
                  <AdminStatusBadge tone={health.state.data.runtime.adminAllowlistConfigured ? 'ok' : 'error'}>
                    {health.state.data.runtime.adminAllowlistConfigured ? t('acCheckPassed') : t('acCheckFailed')}
                  </AdminStatusBadge>
                </li>
                <li className="ac-health__row">
                  <span className="ac-health__label">{en ? 'Service role key present' : 'مفتاح service role موجود'}</span>
                  <AdminStatusBadge tone={health.state.data.runtime.serviceRoleConfigured ? 'ok' : 'error'}>
                    {health.state.data.runtime.serviceRoleConfigured ? t('acCheckPassed') : t('acCheckFailed')}
                  </AdminStatusBadge>
                </li>
                <li className="ac-health__row">
                  <span className="ac-health__label">{en ? 'Web Push configuration present' : 'إعدادات Web Push موجودة'}</span>
                  <AdminStatusBadge tone={health.state.data.runtime.webPushConfigured ? 'ok' : 'muted'}>
                    {health.state.data.runtime.webPushConfigured ? t('acCheckPassed') : t('acCheckFailed')}
                  </AdminStatusBadge>
                </li>
                <li className="ac-health__row">
                  <span className="ac-health__label">{en ? 'FCM service-account configuration present' : 'إعدادات حساب خدمة FCM موجودة'}</span>
                  <AdminStatusBadge tone={health.state.data.runtime.fcmConfigured ? 'ok' : 'muted'}>
                    {health.state.data.runtime.fcmConfigured ? t('acCheckPassed') : t('acCheckFailed')}
                  </AdminStatusBadge>
                </li>
                <li className="ac-health__row">
                  <span className="ac-health__label">{en ? 'Verified owner' : 'المالك الموثّق'}</span>
                  <span className="ac-mono">{health.state.data.runtime.ownerEmail ?? '—'}</span>
                </li>
              </ul>
            </>
          )}
        </AdminCard>

        <div className="ac-grid">
          <AdminStatCard
            label={t('acAuditTitle')}
            value={audit.state.status === 'ready' ? audit.state.data.entries.length : null}
            period={t('acAllTime')}
            index={0}
            tone="info"
            footnote={audit.state.status === 'ready' && audit.state.data.appendOnly ? t('acAuditAppendOnly') : undefined}
          />
        </div>
      </div>

      <div style={{ marginTop: 'var(--ac-space-3)' }}>
        <AdminCard
          title={t('acAuditTitle')}
          hint={t('acAuditSubtitle')}
          action={
            <div style={{ minWidth: 220 }}>
              <AdminSearchInput value={search} onChange={setSearch} placeholder={t('acSearchHistory')} ariaLabel={t('acAuditTitle')} />
            </div>
          }
          padded={false}
        >
          {audit.state.status === 'loading' && <AdminLoadingState label={t('adminLoading')} />}
          {audit.state.status === 'error' && (
            <AdminErrorState title={t('adminUnavailable')} message={audit.state.error} onRetry={audit.retry} retryLabel={t('acRetry')} />
          )}
          {audit.state.status === 'ready' && (
            <AdminDataTable
              caption={t('acAuditTitle')}
              columns={auditColumns}
              rows={audit.state.data.entries}
              rowKey={(row) => row.id}
              empty={<AdminEmptyState title={t('acAuditEmpty')} />}
            />
          )}
        </AdminCard>
      </div>

      <p className="ac-footnote">{t('acDiagnosticsNoSecrets')}</p>
    </>
  )
}
