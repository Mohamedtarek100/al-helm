import { useEffect, useState } from 'react'
import { useI18n } from '../../../i18n/useI18n'
import { useToast } from '../../../components/toastContext'
import {
  getAdminHistory, getAdminMetrics, getAdminUsers, sendAnnouncement,
  type AdminMetrics, type AdminUserRow, type AnnouncementHistoryRow,
} from '../../../services/edge/admin'
import { useAdminResource } from '../../../services/edge/adminData'
import { Button } from '../../../components/Button'
import { Card } from '../../../components/Card'
import { EmptyState } from '../../../components/Display'
import { Field, TextArea, TextInput } from '../../../components/Field'
import { ConfirmDialog } from '../../../components/Modal'
import { BellIcon, TrendIcon } from '../../../components/icons'
import { AdminCard, AdminDataTable, AdminEmptyState, AdminErrorState, AdminLoadingState, AdminStatCard, type AdminColumn } from '../AdminUI'

/**
 * The four sections that already worked, re-hosted in the new console shell.
 *
 * Behaviour is preserved exactly (same endpoints, same confirmation flow); only
 * the presentation and the loading/empty/error handling changed. These move to
 * their dedicated modules in Phase 2/3 — this file shrinks or disappears then.
 */

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

export function AdminOverview({ userId }: { userId: string | null }) {
  const { t } = useI18n()
  const { state, retry } = useAdminResource<AdminMetrics>(() => getAdminMetrics(), [userId])

  if (state.status === 'loading') return <AdminLoadingState label={t('adminLoading')} />
  if (state.status === 'error') {
    return (
      <AdminCard>
        <AdminErrorState title={t('adminUnavailable')} message={state.error} onRetry={retry} retryLabel={t('adminRefresh')} />
      </AdminCard>
    )
  }

  const data = state.data
  // Every value comes from the server. `null` is never coerced to 0.
  return (
    <div className="ac-grid ac-grid--stats">
      <AdminStatCard label={t('adminRegistered')} value={data.totalRegistered} period={t('adminAllTime')} index={0} />
      <AdminStatCard label={t('adminNew7')} value={data.newUsers7d} period="7d" index={1} tone="ok" />
      <AdminStatCard label={t('adminNew30')} value={data.newUsers30d} period="30d" index={2} tone="info" />
      <AdminStatCard label={t('adminActive7')} value={data.active7} period="7d" index={3} tone="ok" />
      <AdminStatCard label={t('adminActive30')} value={data.active30} period="30d" index={4} tone="info" />
      <AdminStatCard label={t('adminOptIn')} value={data.pushOptIns} period={t('adminAllTime')} index={5} tone="warn" />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

export function AdminUsers({ userId }: { userId: string | null }) {
  const { t, language } = useI18n()
  const en = language === 'en'
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search.trim()); setPage(1) }, 300)
    return () => clearTimeout(timer)
  }, [search])

  // `userId` is a dependency so an account switch cannot surface stale rows.
  const { state, retry } = useAdminResource(
    () => getAdminUsers(page, query),
    [page, query, userId],
  )

  const columns: AdminColumn<AdminUserRow>[] = [
    { key: 'email', header: t('adminEmail'), render: (row) => <span style={{ fontFamily: 'var(--ac-mono)', fontSize: '0.78rem' }}>{row.email ?? '—'}</span> },
    { key: 'name', header: t('adminDisplayName'), render: (row) => row.displayName || '—' },
    { key: 'created', header: t('adminRegisteredCol'), render: (row) => new Date(row.createdAt).toLocaleDateString(), hideOnMobile: true },
    { key: 'seen', header: t('adminLastSeen'), render: (row) => (row.lastSeenAt ? new Date(row.lastSeenAt).toLocaleString() : '—'), hideOnMobile: true },
    { key: 'optin', header: t('adminOptIn'), render: (row) => (row.pushOptIn ? t('adminYes') : t('adminNo')) },
  ]

  return (
    <AdminCard
      title={t('adminTab_users')}
      action={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <TextInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('adminSearchPlaceholder')}
            aria-label={t('adminSearchPlaceholder')}
            type="search"
          />
        </div>
      }
    >
      {state.status === 'loading' && <AdminLoadingState label={t('adminLoading')} />}
      {state.status === 'error' && <AdminErrorState title={t('adminUnavailable')} message={state.error} onRetry={retry} retryLabel={t('adminRefresh')} />}
      {state.status === 'ready' && (
        <>
          <AdminDataTable
            caption={t('adminTab_users')}
            columns={columns}
            rows={state.data.users}
            rowKey={(row) => row.id}
            empty={<AdminEmptyState title={t('adminNoUsers')} description={en ? 'No registered account matches this search.' : 'مفيش حساب مطابق للبحث.'} />}
          />
          <div className="admin-pager" style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end', marginTop: 12 }}>
            <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((v) => Math.max(1, v - 1))}>{t('adminPrev')}</Button>
            <span className="t-xs t-muted">{en ? `Page ${page}` : `صفحة ${page}`}</span>
            <Button size="sm" variant="ghost" disabled={!state.data.hasMore} onClick={() => setPage((v) => v + 1)}>{t('adminNext')}</Button>
          </div>
        </>
      )}
    </AdminCard>
  )
}

/* ------------------------------------------------------------------ */
/* Send                                                                */
/* ------------------------------------------------------------------ */

export function AdminSend({ onSent }: { onSent: () => void }) {
  const { t, language } = useI18n()
  const { notify } = useToast()
  const en = language === 'en'
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<'all' | 'opted_in'>('all')
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)

  const send = async () => {
    setConfirming(false)
    setSending(true)
    try {
      const result = await sendAnnouncement(title.trim(), body.trim(), audience)
      notify(t('adminSentOk', { count: result.recipientCount }), 'success')
      setTitle(''); setBody('')
      onSent()
    } catch (error) {
      notify(error instanceof Error ? error.message : t('adminSendFailed'), 'danger')
    } finally {
      setSending(false)
    }
  }

  const valid = title.trim().length > 0 && body.trim().length > 0

  return (
    <div className="ac-grid ac-grid--panels">
      <AdminCard title={t('adminTab_send')}>
        <div className="form-grid">
          <Field label={t('adminTitleCol')} required className="form-grid__full">
            <TextInput value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('adminTitlePlaceholder')} maxLength={120} />
          </Field>
          <Field label={t('adminMessagePlaceholder')} required className="form-grid__full">
            <TextArea rows={6} value={body} onChange={(event) => setBody(event.target.value)} placeholder={t('adminMessagePlaceholder')} maxLength={2000} />
          </Field>
          <Field label={t('adminAudience')} className="form-grid__full">
            <div className="segmented" role="radiogroup" aria-label={t('adminAudience')}>
              <button type="button" role="radio" aria-checked={audience === 'all'} className={`segmented__item ${audience === 'all' ? 'segmented__item--active' : ''}`} onClick={() => setAudience('all')}>{t('adminAudienceAll')}</button>
              <button type="button" role="radio" aria-checked={audience === 'opted_in'} className={`segmented__item ${audience === 'opted_in' ? 'segmented__item--active' : ''}`} onClick={() => setAudience('opted_in')}>{t('adminAudienceOptIn')}</button>
            </div>
          </Field>
        </div>
        <div className="row row--end" style={{ marginTop: 14 }}>
          <Button variant="primary" disabled={!valid || sending} loading={sending} leadingIcon={<BellIcon size={16} />} onClick={() => setConfirming(true)}>
            {sending ? t('adminSending') : audience === 'all' ? t('adminConfirmSend') : t('adminSend')}
          </Button>
        </div>
      </AdminCard>

      <AdminCard title={t('adminPreview')}>
        <div className="notification-row">
          <span className="notification-row__icon"><BellIcon size={18} /></span>
          <div className="notification-row__body">
            <b>{title || t('adminTitlePlaceholder')}</b>
            <p style={{ whiteSpace: 'pre-wrap' }}>{body || t('adminMessagePlaceholder')}</p>
            <time>{new Date().toLocaleString(en ? 'en-US' : 'ar-EG', { dateStyle: 'medium', timeStyle: 'short' })}</time>
          </div>
        </div>
      </AdminCard>

      <ConfirmDialog
        open={confirming}
        title={t('adminSend')}
        message={audience === 'all' ? t('adminSendingToAll') : (en ? 'Send this announcement to push-opted-in users only?' : 'إرسال الإعلان للمفعّلين للإشعارات فقط؟')}
        confirmLabel={t('adminSend')}
        cancelLabel={t('adminCancel')}
        onConfirm={() => { void send() }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export function AdminHistory({ userId, refreshKey }: { userId: string | null; refreshKey: number }) {
  const { t, language } = useI18n()
  const en = language === 'en'
  const { state, retry } = useAdminResource(() => getAdminHistory(), [refreshKey, userId])

  if (state.status === 'loading') return <AdminLoadingState label={t('adminLoading')} />
  if (state.status === 'error') {
    return <AdminCard><AdminErrorState title={t('adminUnavailable')} message={state.error} onRetry={retry} retryLabel={t('adminRefresh')} /></AdminCard>
  }

  const columns: AdminColumn<AnnouncementHistoryRow>[] = [
    { key: 'title', header: t('adminTitleCol'), render: (row) => row.title },
    { key: 'audience', header: t('adminAudience'), render: (row) => (row.audience === 'opted_in' ? t('adminAudienceOptIn') : t('adminAudienceAll')) },
    { key: 'sent', header: t('adminSentAt'), render: (row) => new Date(row.createdAt).toLocaleString(), hideOnMobile: true },
    { key: 'count', header: t('adminRecipientsCol'), render: (row) => t('adminRecipients', { count: row.recipientCount }) },
  ]

  return (
    <AdminCard title={t('adminTab_history')}>
      <AdminDataTable
        caption={t('adminTab_history')}
        columns={columns}
        rows={state.data.history}
        rowKey={(row) => row.id}
        empty={<AdminEmptyState title={t('adminNoHistory')} description={en ? 'Announcements you send will appear here.' : 'الإعلانات اللي ترسليها هتظهر هنا.'} />}
      />
    </AdminCard>
  )
}

/** Shared "coming in a later phase" marker — never a fake, working-looking tool. */
export function RoadmapNotice({ title, description }: { title: string; description: string }) {
  const { t } = useI18n()
  return (
    <Card>
      <EmptyState icon={<TrendIcon size={24} />} title={`${title} — ${t('adminComingSoon')}`} message={description} />
    </Card>
  )
}
