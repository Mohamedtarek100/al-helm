import { useI18n } from '../../../i18n/useI18n'
import { getAdminAnalytics, type AdminAnalytics } from '../../../services/edge/admin'
import { useAdminResource } from '../../../services/edge/adminData'
import { dayLabel, formatRate, rate } from '../../../services/edge/adminFormat'
import {
  AdminBarChart,
  AdminCard,
  AdminEmptyState,
  AdminErrorState,
  AdminFootNote,
  AdminLoadingState,
  AdminPageHeader,
  AdminProgressList,
  AdminStatCard,
  AdminStatusBadge,
} from '../AdminUI'

/**
 * Analytics
 *
 * The rule for this screen is: if the schema cannot measure it, say so.
 *
 *   - Registration counts, activity windows and announcement delivery/open
 *     counts are real: each is a count over a table or the auth directory.
 *   - Per-day ACTIVE users are NOT derivable: `user_activity` stores only the
 *     most recent heartbeat per account, so a past day's distinct actives were
 *     overwritten. The console reports the latest-heartbeat distribution
 *     instead and labels it as such — it does not draw a fake curve.
 *   - Study-session aggregates are deliberately absent: that content lives
 *     behind per-account RLS and is not exposed to any owner endpoint.
 */
export function AnalyticsSection({ userId, refreshKey }: { userId: string | null; refreshKey: number }) {
  const { t, language } = useI18n()
  const en = language === 'en'
  const { state, retry } = useAdminResource<AdminAnalytics>(() => getAdminAnalytics(), [userId, refreshKey])

  const header = (
    <AdminPageHeader
      eyebrow={t('adminConsoleSection')}
      title={t('acAnalyticsTitle')}
      description={t('acAnalyticsSubtitle')}
    />
  )

  if (state.status === 'loading') return <>{header}<AdminLoadingState label={t('adminLoading')} /></>
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
  // Retention is measured against accounts that can report at all (those with
  // a heartbeat), not against the whole directory.
  const retention7 = rate(data.active7, data.heard)
  const retention30 = rate(data.active30, data.heard)
  const openRate = rate(data.deliveriesOpened, data.deliveries)
  const heardRate = rate(data.heard, data.registered)

  const recency = data.recencyBuckets.map((bucket) => ({
    label: bucket.label,
    value: bucket.value,
  }))

  const funnel = [
    { label: t('acFunnelRegistered'), value: data.registered, tone: 'info' as const },
    { label: t('acFunnelHeard'), value: data.heard, tone: 'info' as const },
    { label: t('acFunnelActive30'), value: data.active30, tone: 'warn' as const },
    { label: t('acFunnelActive7'), value: data.active7, tone: 'ok' as const },
  ]

  return (
    <>
      {header}

      <div className="ac-grid ac-grid--stats">
        <AdminStatCard label={t('acKpiRegistered')} value={data.registered} period={t('acAllTime')} index={0} />
        <AdminStatCard
          label={t('acFunnelHeard')}
          value={data.heard}
          period={t('acAllTime')}
          index={1}
          tone="info"
          footnote={`${formatRate(heardRate)} ${en ? 'of registered accounts' : 'من الحسابات المسجلة'}`}
        />
        <AdminStatCard
          label={t('acKpiActive7')}
          value={data.active7}
          period={t('acLast7')}
          index={2}
          tone="ok"
          footnote={`${formatRate(retention7)} ${en ? 'retention' : 'بقاء'}`}
        />
        <AdminStatCard
          label={t('acKpiActive30')}
          value={data.active30}
          period={t('acLast30')}
          index={3}
          tone="warn"
          footnote={`${formatRate(retention30)} ${en ? 'retention' : 'بقاء'}`}
        />
      </div>

      <div className="ac-grid ac-grid--panels" style={{ marginTop: 'var(--ac-space-3)' }}>
        <AdminCard title={t('acRetentionTitle')} hint={t('acRetentionHint')}>
          <AdminProgressList
            rows={[
              { label: t('acLast7'), value: data.active7, max: Math.max(data.heard, 1), tone: 'ok' },
              { label: t('acLast30'), value: data.active30, max: Math.max(data.heard, 1), tone: 'info' },
            ]}
            formatValue={(value) => new Intl.NumberFormat(en ? 'en-US' : 'ar-EG').format(value)}
          />
        </AdminCard>

        <AdminCard title={t('acFunnelTitle')} hint={t('acFunnelHint')}>
          <AdminProgressList
            rows={funnel}
            formatValue={(value) => new Intl.NumberFormat(en ? 'en-US' : 'ar-EG').format(value)}
          />
        </AdminCard>
      </div>

      <div className="ac-grid ac-grid--panels" style={{ marginTop: 'var(--ac-space-3)' }}>
        <AdminCard
          title={t('acSignupsTitle')}
          hint={t('acSignupsHint')}
          action={<AdminStatusBadge tone="info">{t('acLast30')}</AdminStatusBadge>}
        >
          <AdminBarChart
            data={data.registrations.map((point) => ({ label: dayLabel(point.date, language), value: point.count }))}
            ariaLabel={t('acSignupsTitle')}
            emptyLabel={t('acNoSignups')}
            formatValue={(value) => new Intl.NumberFormat(en ? 'en-US' : 'ar-EG').format(value)}
          />
        </AdminCard>

        <AdminCard title={en ? 'Heartbeat recency' : 'حداثة النبضات'} hint={t('acDailyActivityHint')}>
          <AdminProgressList
            rows={recency.map((bucket) => ({ label: bucket.label, value: bucket.value, tone: 'info' as const }))}
            emptyLabel={t('acNoActivityDays')}
            formatValue={(value) => new Intl.NumberFormat(en ? 'en-US' : 'ar-EG').format(value)}
          />
          <AdminFootNote>
            {en
              ? 'The activity table keeps only the latest heartbeat per account, so a per-day distinct-active series cannot be reconstructed. This distribution is the exact data that exists.'
              : 'جدول النشاط بيحتفظ بآخر نبضة لكل حساب فقط، فمش ممكن نبني سلسلة نشاط يومي. التوزيع ده هو البيانات الموجودة فعلًا.'}
          </AdminFootNote>
        </AdminCard>
      </div>

      <div style={{ marginTop: 'var(--ac-space-3)' }}>
        <AdminCard title={t('acAnnouncementsTitle')} hint={t('acAnnouncementsHint')}>
          <AdminProgressList
            rows={[
              { label: t('acKpiAnnouncements'), value: data.announcementsSent, tone: 'info' },
              { label: t('acDelivered'), value: data.deliveries, tone: 'info' },
              { label: t('acOpened'), value: data.deliveriesOpened, tone: 'ok' },
            ]}
            formatValue={(value) => new Intl.NumberFormat(en ? 'en-US' : 'ar-EG').format(value)}
          />
          <AdminFootNote>
            {t('acOpenRate')}: <strong style={{ color: 'var(--ac-text)' }}>{formatRate(openRate)}</strong>
            {' · '}
            {en ? 'Opened is a delivery row whose read_at is set by the recipient app.' : 'الفتح معناه صف توصيل اتحدد فيه read_at من تطبيق المستلم.'}
          </AdminFootNote>
        </AdminCard>
      </div>

      <div style={{ marginTop: 'var(--ac-space-3)' }}>
        <AdminCard title={t('acNotMeasured')} hint={t('acNotMeasuredBody')}>
          <AdminEmptyState
            title={t('acSessionsMetric')}
            description={t('acSessionsUnavailable')}
          />
        </AdminCard>
      </div>

      <p className="ac-footnote">
        {t('acGeneratedAt')}: {new Date(data.generatedAt).toLocaleString(en ? 'en-US' : 'ar-EG')}
      </p>
    </>
  )
}
