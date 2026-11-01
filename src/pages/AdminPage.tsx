import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageFrame, PageHeading } from './PageFrame'
import { useI18n } from '../i18n/useI18n'
import { refreshAdminGate, useAdminGate } from '../services/edge/adminGate'
import { logAdminAction } from '../services/edge/admin'
import { useAdminHealth } from '../services/edge/adminHealth'
import { useAdminPreferences } from '../services/edge/adminSettings'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { EmptyState } from '../components/Display'
import { UserIcon } from '../components/icons'
import { AdminLayout, type AdminNavItem } from '../components/admin/AdminLayout'
import { OverviewSection } from '../components/admin/sections/OverviewSection'
import { UsersSection } from '../components/admin/sections/UsersSection'
import { AnalyticsSection } from '../components/admin/sections/AnalyticsSection'
import { AnnouncementsSection } from '../components/admin/sections/AnnouncementsSection'
import { SecuritySection } from '../components/admin/sections/SecuritySection'
import { SettingsSection } from '../components/admin/sections/SettingsSection'
import type { TranslationKey } from '../i18n/translations'

/**
 * Owner Control Center.
 *
 * SECURITY MODEL (fail-closed at every level):
 *
 *   1. The page is a VIEW. Every privileged read/write goes through the `admin`
 *      Edge Function, which re-verifies the JWT and the server-side
 *      ADMIN_EMAILS allowlist before acting.
 *   2. Nothing privileged mounts until `useAdminGate()` reports `authorized` —
 *      that value comes from the SERVER, never from localStorage, user
 *      metadata, a query parameter, or a hardcoded email.
 *   3. Loading, unknown, signed-out and error states all fail CLOSED: they
 *      render a neutral screen with no data components mounted.
 *   4. The gate re-resolves on sign-out and account change (see adminGate.ts),
 *      so a previous account's authorization cannot survive a switch.
 *   5. If the gate becomes unauthorized AFTER the console is mounted (token
 *      expiry, account switch, explicit denial), the console unmounts on the
 *      same render — the same check governs both entry and continued access.
 */

type Tab = 'overview' | 'users' | 'analytics' | 'announcements' | 'security' | 'settings'

const TABS: { id: Tab; key: TranslationKey; icon: string }[] = [
  { id: 'overview', key: 'adminTab_metrics', icon: '◈' },
  { id: 'users', key: 'adminTab_users', icon: '◉' },
  { id: 'analytics', key: 'acAnalyticsTitle', icon: '▤' },
  { id: 'announcements', key: 'adminAnnouncements', icon: '✦' },
  { id: 'security', key: 'acSecurityTitle', icon: '⛨' },
  { id: 'settings', key: 'acSettingsTitle', icon: '⚙' },
]

export function AdminPage() {
  const { t, language } = useI18n()
  const en = language === 'en'
  // The gate lives in one shared module so the dashboard and the navigation
  // always agree, and so account switches re-resolve it exactly once.
  const gateState = useAdminGate()
  const { preferences } = useAdminPreferences()
  const [tab, setTab] = useState<Tab>('overview')
  const [nonce, setNonce] = useState(0)

  const status = gateState.state === 'authorized' ? 'ready'
    : gateState.state === 'denied' ? 'denied'
      : gateState.state === 'unconfigured' ? 'unconfigured'
        : gateState.state === 'signed-out' ? 'signed-out'
          : gateState.state === 'error' ? 'error'
            : 'loading'
  const error = gateState.error

  const refresh = useCallback(async () => {
    setNonce((value) => value + 1)
    await refreshAdminGate()
  }, [])

  // One audit entry per console visit (not per tab switch): the log answers
  // "who opened the console and when", and per-tab noise would bury it.
  const authorizedEmail = gateState.state === 'authorized' ? gateState.email : null
  // Declared here, ABOVE the early returns, because hooks must run in the same
  // order on every render. Reading a store hook after a conditional return
  // would break the Rules of Hooks.
  const health = useAdminHealth()
  useEffect(() => {
    if (!authorizedEmail) return
    void logAdminAction('app_open', null, { viewport: typeof window === 'undefined' ? 0 : window.innerWidth }).catch(() => undefined)
  }, [authorizedEmail])

  const navItems: AdminNavItem[] = useMemo(
    () => TABS.map((item) => ({ id: item.id, label: t(item.key), icon: <span aria-hidden="true">{item.icon}</span> })),
    [t],
  )

  if (status === 'loading') {
    return (
      <PageFrame className="page-stack admin-page">
        <PageHeading eyebrow={en ? 'Owner tools' : 'أدوات المالك'} title={t('adminTitle')} subtitle={t('adminLoading')} />
        <div className="skeleton-stack" aria-hidden="true"><span className="skeleton skeleton--card" /><span className="skeleton skeleton--card" /></div>
      </PageFrame>
    )
  }

  if (status !== 'ready') {
    const copy = status === 'unconfigured' ? t('adminUnconfigured')
      : status === 'signed-out' ? (en ? 'Sign in with the owner account to open this dashboard.' : 'سجّلي الدخول بحساب المالك لفتح اللوحة.')
        : status === 'denied' ? t('adminDenied')
          : t('adminUnavailable')
    return (
      <PageFrame className="page-stack admin-page">
        <PageHeading eyebrow={en ? 'Owner tools' : 'أدوات المالك'} title={t('adminTitle')} subtitle={copy} />
        <Card>
          <EmptyState
            icon={<UserIcon size={26} />}
            title={status === 'denied' ? t('adminDenied') : t('adminTitle')}
            message={error && status === 'error' ? error : copy}
            action={
              <div className="row">
                <Button size="sm" variant="secondary" onClick={() => { void refresh() }}>{t('adminRefresh')}</Button>
                {status === 'signed-out' && <Link to="/settings" className="link-button">{t('settings')}</Link>}
              </div>
            }
          />
        </Card>
      </PageFrame>
    )
  }

  // Only reached when the SERVER confirmed ownership, and only kept while it
  // continues to do so.
  const activeTab = TABS.find((item) => item.id === tab) ?? TABS[0]

  /**
   * The topbar badge reports AUTHENTICATION and, once checks have run, the real
   * health result. It never says "Verified" for checks that have not run.
   *
   * Previously it was a hardcoded `tone: 'ok', label: 'VERIFIED'`, which read as
   * "everything is fine" while the Security panel listed checks as "Not checked".
   */
  const healthBadge = ((): { tone: 'ok' | 'warn' | 'error' | 'info' | 'muted'; label: string } => {
    if (health.summary === 'checking') return { tone: 'info', label: t('acRunningChecks') }
    if (health.summary === 'healthy') return { tone: 'ok', label: en ? 'All checks passed' : 'كل الفحوص نجحت' }
    if (health.summary === 'degraded') return { tone: 'warn', label: en ? 'Degraded' : 'متدهور' }
    if (health.summary === 'failed') return { tone: 'error', label: en ? 'Checks failed' : 'فشل الفحص' }
    if (health.error) return { tone: 'warn', label: en ? 'Health unavailable' : 'الصحة غير متاحة' }
    // Authorized but not yet checked: this is the honest state, and it must not
    // borrow the word "verified".
    return { tone: 'muted', label: en ? 'Not checked' : 'لم يُفحص' }
  })()

  return (
    <AdminLayout
      nav={navItems}
      active={tab}
      onNavigate={(id) => setTab(id as Tab)}
      eyebrow={t('adminConsoleSection')}
      title={t(activeTab.key)}
      ownerEmail={gateState.email}
      authorization="authorized"
      status={healthBadge}
      onRefresh={() => { void refresh() }}
      labels={{
        openNav: t('acOpenNav'),
        closeNav: t('acCloseNav'),
        refresh: t('acRefreshData'),
        refreshing: t('acRefreshing'),
        workspace: t('adminConsoleSection'),
        sections: t('adminConsoleSection'),
        soon: t('acComingSoon'),
        authorized: t('acVerified'),
        verifying: t('acVerifying'),
        denied: t('acNotAuthorized'),
        unknown: t('acUnknownState'),
      }}
      brand={{ title: t('adminConsoleTitle'), subtitle: t('acBrandSubtitle') }}
    >
      <div className={preferences.reducedMotion ? 'ac-reduce-motion' : undefined}>
        {tab === 'overview' && (
          <OverviewSection userId={gateState.email} refreshKey={nonce} onOpenUsers={() => setTab('users')} />
        )}
        {tab === 'users' && <UsersSection userId={gateState.email} pageSize={preferences.pageSize} />}
        {tab === 'analytics' && <AnalyticsSection userId={gateState.email} refreshKey={nonce} />}
        {tab === 'announcements' && (
          <AnnouncementsSection userId={gateState.email} refreshKey={nonce} onSent={() => setNonce((value) => value + 1)} />
        )}
        {tab === 'security' && <SecuritySection userId={gateState.email} refreshKey={nonce} />}
        {tab === 'settings' && <SettingsSection userId={gateState.email} ownerEmail={gateState.email} />}
      </div>
    </AdminLayout>
  )
}
