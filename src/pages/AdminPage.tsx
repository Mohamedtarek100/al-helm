import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageFrame, PageHeading } from './PageFrame'
import { useI18n } from '../i18n/useI18n'
import { useToast } from '../components/toastContext'
import {
  getAdminGate, getAdminHistory, getAdminMetrics, getAdminUsers, sendAnnouncement,
  type AdminGate, type AdminMetrics, type AdminUserRow, type AnnouncementHistoryRow,
} from '../services/edge/admin'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { EmptyState } from '../components/Display'
import { Field, TextArea, TextInput } from '../components/Field'
import { ConfirmDialog } from '../components/Modal'
import { BellIcon, TrendIcon, UserIcon } from '../components/icons'
import { supabase } from '../services/persistence/supabase'

/**
 * Owner-only admin dashboard.
 *
 * Security model: this page is only a view. Every privileged read and write
 * goes through the `admin` Edge Function, which re-verifies the caller's JWT
 * and checks the server-side ADMIN_EMAILS allowlist. The gate result only
 * decides which UI to render — it never grants access by itself.
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
  const [status, setStatus] = useState<'loading' | 'denied' | 'unconfigured' | 'signed-out' | 'ready' | 'error'>('loading')
  const [gate, setGate] = useState<AdminGate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    setStatus('loading'); setError(null)
    void (async () => {
      try {
        if (!supabase) { if (!cancelled) setStatus('unconfigured'); return }
        const { data } = await supabase.auth.getSession()
        if (!data.session) { if (!cancelled) setStatus('signed-out'); return }
        const result = await getAdminGate()
        if (cancelled) return
        setGate(result)
        if (result.error === 'not_configured') setStatus('unconfigured')
        else setStatus(result.isAdmin ? 'ready' : 'denied')
      } catch (e) {
        if (cancelled) return
        const message = e instanceof Error ? e.message : String(e)
        setError(message)
        setStatus(/unauthenticated|sign in|bearer/i.test(message) ? 'signed-out' : 'error')
      }
    })()
    return () => { cancelled = true }
  }, [nonce])

  const refresh = () => setNonce((value) => value + 1)

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

  return (
    <PageFrame className="page-stack admin-page">
      <PageHeading
        eyebrow={en ? 'Owner tools' : 'أدوات المالك'}
        title={t('adminTitle')}
        subtitle={gate?.email ?? ''}
        action={<Button variant="secondary" onClick={refresh}>{t('adminRefresh')}</Button>}
      />
      <nav className="subnav admin-subnav" aria-label={t('adminTitle')}>
        {TABS.map((item) => (
          <button key={item.id} type="button" className={`subnav__item ${tab === item.id ? 'subnav__item--active' : ''}`} aria-current={tab === item.id} onClick={() => setTab(item.id)}>
            {t(item.key)}
          </button>
        ))}
      </nav>
      {tab === 'overview' && <Overview />}
      {tab === 'users' && <Users />}
      {tab === 'send' && <Send onSent={() => setTab('history')} />}
      {tab === 'history' && <History refreshKey={nonce} />}
    </PageFrame>
  )
}

/* ------------------------------------------------------------------ */
/* Shared async state                                                 */
/* ------------------------------------------------------------------ */

function useAsync<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true })
  const [retryKey, setRetryKey] = useState(0)
  useEffect(() => {
    let cancelled = false
    setState((prev) => ({ ...prev, loading: true, error: null }))
    loader()
      .then((data) => { if (!cancelled) setState({ data, error: null, loading: false }) })
      .catch((error: unknown) => { if (!cancelled) setState({ data: null, error: error instanceof Error ? error.message : String(error), loading: false }) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, retryKey])
  return { ...state, retry: () => setRetryKey((value) => value + 1) }
}

function LoadingCards() {
  return <div className="skeleton-stack" aria-hidden="true"><span className="skeleton skeleton--card" /><span className="skeleton skeleton--card" /></div>
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n()
  return (
    <Card>
      <EmptyState
        icon={<TrendIcon size={24} />}
        title={t('adminUnavailable')}
        message={message}
        action={<Button size="sm" onClick={onRetry}>{t('adminRefresh')}</Button>}
      />
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Tabs                                                               */
/* ------------------------------------------------------------------ */

function Overview() {
  const { t } = useI18n()
  const { data, error, loading, retry } = useAsync<AdminMetrics>(() => getAdminMetrics(), [])
  if (loading) return <LoadingCards />
  if (error || !data) return <ErrorCard message={error ?? ''} onRetry={retry} />
  const cards: { label: string; value: number; accent: string }[] = [
    { label: t('adminRegistered'), value: data.totalRegistered, accent: 'var(--clay)' },
    { label: t('adminNew7'), value: data.newUsers7d, accent: 'var(--sage)' },
    { label: t('adminNew30'), value: data.newUsers30d, accent: 'var(--dusty-blue)' },
    { label: t('adminActive7'), value: data.active7, accent: 'var(--amber)' },
    { label: t('adminActive30'), value: data.active30, accent: 'var(--plum)' },
    { label: t('adminOptIn'), value: data.pushOptIns, accent: 'var(--charcoal)' },
  ]
  return (
    <div className="admin-metrics">
      {cards.map((card) => (
        <Card key={card.label} className="admin-metric">
          <span className="admin-metric__icon" style={{ background: card.accent }} aria-hidden="true"><TrendIcon size={16} /></span>
          <strong className="admin-metric__value">{card.value.toLocaleString()}</strong>
          <span className="admin-metric__label">{card.label}</span>
        </Card>
      ))}
    </div>
  )
}

function Users() {
  const { t, language } = useI18n()
  const en = language === 'en'
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search.trim()); setPage(1) }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const { data, error, loading, retry } = useAsync(() => getAdminUsers(page, query), [page, query])

  return (
    <Card className="admin-panel">
      <div className="admin-panel__toolbar">
        <TextInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('adminSearchPlaceholder')}
          aria-label={t('adminSearchPlaceholder')}
          type="search"
          className="admin-panel__search"
        />
      </div>
      {loading && <LoadingCards />}
      {!loading && error && <ErrorCard message={error} onRetry={retry} />}
      {!loading && !error && data && (
        <>
          {data.users.length === 0 ? (
            <EmptyState title={t('adminNoUsers')} message={en ? 'No registered account matches this search.' : 'مفيش حساب مطابق للبحث.'} />
          ) : (
            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{t('adminEmail')}</th>
                    <th>{t('adminDisplayName')}</th>
                    <th>{t('adminRegisteredCol')}</th>
                    <th>{t('adminLastSeen')}</th>
                    <th>{t('adminOptIn')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((user: AdminUserRow) => (
                    <tr key={user.id}>
                      <td className="admin-table__email">{user.email ?? '—'}</td>
                      <td>{user.displayName || '—'}</td>
                      <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                      <td>{user.lastSeenAt ? new Date(user.lastSeenAt).toLocaleString() : '—'}</td>
                      <td><span className={`status-dot ${user.pushOptIn ? 'status-dot--on' : ''}`} />{user.pushOptIn ? t('adminYes') : t('adminNo')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="admin-pager">
            <Button size="sm" variant="ghost" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>{t('adminPrev')}</Button>
            <span className="t-xs t-muted">{en ? `Page ${page}` : `صفحة ${page}`}</span>
            <Button size="sm" variant="ghost" disabled={!data.hasMore || loading} onClick={() => setPage((value) => value + 1)}>{t('adminNext')}</Button>
          </div>
        </>
      )}
    </Card>
  )
}

function Send({ onSent }: { onSent: () => void }) {
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
    <div className="admin-send">
      <Card className="admin-panel">
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
      </Card>

      <Card className="admin-preview">
        <p className="t-xs t-muted">{t('adminPreview')}</p>
        <div className="notification-row">
          <span className="notification-row__icon"><BellIcon size={18} /></span>
          <div className="notification-row__body">
            <b>{title || t('adminTitlePlaceholder')}</b>
            <p style={{ whiteSpace: 'pre-wrap' }}>{body || t('adminMessagePlaceholder')}</p>
            <time>{new Date().toLocaleString(en ? 'en-US' : 'ar-EG', { dateStyle: 'medium', timeStyle: 'short' })}</time>
          </div>
        </div>
      </Card>

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

function History({ refreshKey }: { refreshKey: number }) {
  const { t, language } = useI18n()
  const en = language === 'en'
  const { data, error, loading, retry } = useAsync(() => getAdminHistory(), [refreshKey])
  if (loading) return <LoadingCards />
  if (error || !data) return <ErrorCard message={error ?? ''} onRetry={retry} />
  if (data.history.length === 0) {
    return <Card><EmptyState icon={<BellIcon size={24} />} title={t('adminNoHistory')} message={en ? 'Announcements you send will appear here.' : 'الإعلانات اللي ترسليها هتظهر هنا.'} /></Card>
  }
  return (
    <Card className="admin-panel">
      <div className="table-scroll">
        <table className="admin-table">
          <thead>
            <tr><th>{t('adminTitleCol')}</th><th>{t('adminAudience')}</th><th>{t('adminSentAt')}</th><th>{t('adminRecipientsCol')}</th></tr>
          </thead>
          <tbody>
            {data.history.map((row: AnnouncementHistoryRow) => (
              <tr key={row.id}>
                <td>{row.title}</td>
                <td>{row.audience === 'opted_in' ? t('adminAudienceOptIn') : t('adminAudienceAll')}</td>
                <td>{new Date(row.createdAt).toLocaleString()}</td>
                <td>{t('adminRecipients', { count: row.recipientCount })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
