import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PageFrame, PageHeading } from './PageFrame'
import { useI18n } from '../i18n/useI18n'
import { refreshAdminGate, useAdminGate } from '../services/edge/adminGate'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { EmptyState } from '../components/Display'
import { UserIcon } from '../components/icons'
import { AdminLayout, type AdminNavItem } from '../components/admin/AdminLayout'
import { AdminOverview, AdminUsers, AdminSend, AdminHistory } from '../components/admin/sections/LegacySections'

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
 */

type Tab = 'overview' | 'users' | 'send' | 'history'
const TABS: { id: Tab; key: 'adminTab_metrics' | 'adminTab_users' | 'adminTab_send' | 'adminTab_history' }[] = [
  { id: 'overview', key: 'adminTab_metrics' },
  { id: 'users', key: 'adminTab_users' },
  { id: 'send', key: 'adminTab_send' },
  { id: 'history', key: 'adminTab_history' },
]

export function AdminPage() {
  const { t, language } = useI18n()
  const en = language === 'en'
  // The gate lives in one shared module so the dashboard and the navigation
  // always agree, and so account switches re-resolve it exactly once.
  const gateState = useAdminGate()
  const [tab, setTab] = useState<Tab>('overview')
  const [nonce, setNonce] = useState(0)

  const status = gateState.state === 'authorized' ? 'ready'
    : gateState.state === 'denied' ? 'denied'
      : gateState.state === 'unconfigured' ? 'unconfigured'
        : gateState.state === 'signed-out' ? 'signed-out'
          : gateState.state === 'error' ? 'error'
            : 'loading'
  const gate = gateState.gate
  const error = gateState.error
  const refresh = async () => {
    setNonce((value) => value + 1)
    await refreshAdminGate()
  }

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
                <Button size="sm" variant="secondary" onClick={refresh}>{t('adminRefresh')}</Button>
                {status === 'signed-out' && <Link to="/settings" className="link-button">{t('settings')}</Link>}
              </div>
            }
          />
        </Card>
      </PageFrame>
    )
  }

  // Only reached when the SERVER confirmed ownership.
  const navItems: AdminNavItem[] = TABS.map((item) => ({
    id: item.id,
    label: t(item.key),
    icon: <span aria-hidden="true">•</span>,
  }))

  return (
    <AdminLayout
      nav={navItems}
      active={tab}
      onNavigate={(id) => setTab(id as Tab)}
      eyebrow={t('adminConsoleSection')}
      title={t(TABS.find((item) => item.id === tab)?.key ?? 'adminTitle')}
      ownerEmail={gate?.email ?? null}
      status={{ tone: 'ok', label: en ? 'Authorized' : 'مصرّح' }}
      onRefresh={() => { void refresh() }}
    >
      {tab === 'overview' && <AdminOverview userId={gateState.email} />}
      {tab === 'users' && <AdminUsers userId={gateState.email} />}
      {tab === 'send' && <AdminSend onSent={() => setTab('history')} />}
      {tab === 'history' && <AdminHistory userId={gateState.email} refreshKey={nonce} />}
    </AdminLayout>
  )
}
