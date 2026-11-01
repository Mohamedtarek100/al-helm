import { useState } from 'react'
import { useI18n } from '../../../i18n/useI18n'
import { getAdminHealth, getAdminOverview, type AdminOverview, type HealthReport } from '../../../services/edge/admin'
import { useAdminResource } from '../../../services/edge/adminData'
import { dayLabel, formatRate, rate } from '../../../services/edge/adminFormat'
import {
  AdminBarChart,
  AdminButton,
  AdminCard,
  AdminDataTable,
  AdminEmptyState,
  AdminErrorState,
  AdminLoadingState,
  AdminPageHeader,
  AdminProgressList,
  AdminStatCard,
  AdminStatusBadge,
  type AdminColumn,
} from '../AdminUI'
import type { AdminUserRow } from '../../../services/edge/admin'

/**
 * Overview
 *
 * Every figure is read from the server in ONE request (`overview`), which also
 * returns the denominators. That matters: a KPI card that shows "42 new users"
 * without saying "of 300 registered" invites a wrong conclusion, and a chart
 * whose bars come from different snapshots can contradict itself.
 *
 * Nothing is estimated. When a denominator is zero the rate is `null` and the
 * card says so instead of printing 0%.
 */
export function OverviewSection({
  userId,
  refreshKey,
  onOpenUsers,
}: {
  userId: string | null
  refreshKey: number
  onOpenUsers: () => void
}) {
  const { t, language } = useI18n()
  const en = language === 'en'
  const [windowDays, setWindowDays] = useState<30 | 90>(30)
  const { state, retry } = useAdminResource<AdminOverview>(
    () => getAdminOverview(windowDays),
    [userId, refreshKey, windowDays],
  )
  // Service availability is checked separately: if the health endpoint is
  // unreachable the overview figures must still render, with the check shown
  // as unknown rather than blocking the page.
  const health = useAdminResource<HealthReport>(() => getAdminHealth(), [userId, refreshKey])

  const header = (
    <AdminPageHeader
      eyebrow={t('adminConsoleSection')}
      title={t('acOverviewTitle')}
      description={t('acOverviewSubtitle')}
      actions={
        <div className="ac-segmented" role="group" aria-label={t('acWindow')}>
          {[30, 90].map((days) => (
            <button
              key={days}
              type="button"
              className={days === windowDays ? 'ac-segmented__item ac-segmented__item--active' : 'ac-segmented__item'}
              aria-pressed={days === windowDays}
              onClick={() => setWindowDays(days as 30 | 90)}
            >
              {days === 30 ? t('acLast30') : en ? '90 days' : '٩٠ يوم'}
            </button>
          ))}
        </div>
      }
    />
  )

  if (state.status === 'loading') {
    return <>{header}<AdminLoadingState label={t('adminLoading')} /></>
  }
  if (state.status === 'error') {
    return (
      <>
        {header}
        <AdminCard>
          <AdminErrorState title={t('adminUnavailable')} message={state.error} onRetry={retry} retryLabel={t('adminRefresh')} />
        </AdminCard>
      </>
    )
  }

  const data = state.data
  const optInRate = rate(data.pushOptIns, data.totalRegistered)
  const readRate = rate(data.deliveriesOpened, data.deliveries)
  const activeShare = rate(data.active30, data.trackedAccounts)
  const neverSeenShare = rate(data.neverSeen, data.totalRegistered)

  const registrationSeries = data.registrations.map((point) => ({
    label: dayLabel(point.date, language),
    value: point.count,
  }))

  const recentColumns: AdminColumn<AdminUserRow>[] = [
    { key: 'email', header: t('adminEmail'), render: (row) => <span className="ac-mono">{row.email ?? '—'}</span> },
    { key: 'name', header: t('adminDisplayName'), render: (row) => row.displayName || '—', hideOnMobile: true },
    {
      key: 'created',
      header: t('adminRegisteredCol'),
      render: (row) => new Date(row.createdAt).toLocaleDateString(en ? 'en-US' : 'ar-EG'),
      hideOnMobile: true,
    },
    {
      key: 'push',
      header: t('acFilterPush'),
      render: (row) => <AdminStatusBadge tone={row.pushOptIn ? 'ok' : 'muted'}>{row.pushOptIn ? t('acFilterOptedIn') : t('acFilterNotOptedIn')}</AdminStatusBadge>,
      align: 'end',
    },
  ]

  return (
    <>
      {header}

      <div className="ac-grid ac-grid--stats">
        <AdminStatCard label={t('acKpiRegistered')} value={data.totalRegistered} period={t('acAllTime')} index={0} tone="info" />
        <AdminStatCard label={t('acKpiNew7')} value={data.newUsers7d} period={t('acLast7')} index={1} tone="ok" />
        <AdminStatCard
          label={t('acKpiNew30')}
          value={data.newUsers30d}
          period={t('acLast30')}
          index={2}
          tone="info"
          footnote={data.trackedAccounts > 0 ? `${formatRate(rate(data.newUsers30d, data.totalRegistered))} ${en ? 'of all accounts' : 'من كل الحسابات'}` : undefined}
        />
        <AdminStatCard label={t('acKpiActive7')} value={data.active7} period={t('acLast7')} index={3} tone="ok" />
        <AdminStatCard
          label={t('acKpiActive30')}
          value={data.active30}
          period={t('acLast30')}
          index={4}
          tone="info"
          footnote={`${formatRate(activeShare)} ${en ? 'of reporting accounts' : 'من الحسابات اللي بتبلّغ'}`}
        />
        <AdminStatCard
          label={t('acKpiPush')}
          value={data.pushOptIns}
          period={t('acAllTime')}
          index={5}
          tone="warn"
          footnote={`${formatRate(optInRate)} ${en ? 'opt-in rate' : 'نسبة التفعيل'}`}
        />
      </div>

      <div className="ac-grid ac-grid--panels" style={{ marginTop: 'var(--ac-space-3)' }}>
        <AdminCard
          title={t('acSignupsTitle')}
          hint={t('acSignupsHint')}
          action={<AdminStatusBadge tone="info">{windowDays === 30 ? t('acLast30') : en ? '90 days' : '٩٠ يوم'}</AdminStatusBadge>}
        >
          <AdminBarChart
            data={registrationSeries}
            ariaLabel={t('acSignupsTitle')}
            emptyLabel={t('acNoSignups')}
            formatValue={(value) => new Intl.NumberFormat(en ? 'en-US' : 'ar-EG').format(value)}
          />
        </AdminCard>

        <AdminCard title={t('acAudienceTitle')} hint={t('acAudienceHint')}>
          <AdminProgressList
            rows={[
              { label: t('acKpiAnnouncements'), value: data.announcementsSent, tone: 'info' },
              { label: t('acDelivered'), value: data.deliveries, tone: 'info' },
              { label: t('acOpened'), value: data.deliveriesOpened, tone: 'ok' },
            ]}
            formatValue={(value) => new Intl.NumberFormat(en ? 'en-US' : 'ar-EG').format(value)}
          />
          <p className="ac-footnote" style={{ marginTop: 12 }}>
            {t('acOpenRate')}: <strong style={{ color: 'var(--ac-text)' }}>{formatRate(readRate)}</strong>
            {' · '}
            {t('acKpiNeverSeen')}: <strong style={{ color: 'var(--ac-text)' }}>{data.neverSeen}</strong>
            {neverSeenShare !== null && ` (${formatRate(neverSeenShare)})`}
          </p>
        </AdminCard>
      </div>

      <div style={{ marginTop: 'var(--ac-space-3)' }}>
        <AdminCard
          title={t('acRecentTitle')}
          hint={t('acRecentHint')}
          action={<AdminButton size="sm" onClick={onOpenUsers}>{t('acViewAll')}</AdminButton>}
          padded={false}
        >
          <div style={{ padding: 0 }}>
            <AdminDataTable
              caption={t('acRecentTitle')}
              columns={recentColumns}
              rows={data.recentUsers}
              rowKey={(row) => row.id}
              empty={<AdminEmptyState title={t('adminNoUsers')} />}
            />
          </div>
        </AdminCard>
      </div>

      <div style={{ marginTop: 'var(--ac-space-3)' }}>
        <AdminCard title={en ? 'Service availability' : 'توفر الخدمات'} hint={en ? 'Live dependency checks performed by the server.' : 'فحوص حية على التبعيات بيعملها الخادم.'}>
          {health.state.status === 'loading' && <AdminLoadingState label={t('acRunningChecks')} />}
          {health.state.status === 'error' && (
            <AdminErrorState title={t('acCheckFailed')} message={health.state.error} onRetry={health.retry} retryLabel={t('acRetry')} />
          )}
          {health.state.status === 'ready' && (
            <ul className="ac-health">
              {health.state.data.checks.map((check) => (
                <li key={check.id} className="ac-health__row">
                  <span className="ac-health__label">{check.label}</span>
                  <AdminStatusBadge tone={check.ok ? 'ok' : 'error'}>{check.ok ? t('acCheckPassed') : t('acCheckFailed')}</AdminStatusBadge>
                  {check.detail && <span className="ac-health__detail">{check.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </AdminCard>
      </div>

      <p className="ac-footnote">
        {t('acCoverageHint')}
        {' '}
        {t('acGeneratedAt')}: {new Date(data.generatedAt).toLocaleString(en ? 'en-US' : 'ar-EG')}
        {data.truncated && <span className="ac-badge ac-badge--warn" style={{ marginInlineStart: 8 }}>{en ? 'Directory truncated' : 'الدليل مقطوع'}</span>}
      </p>
    </>
  )
}
