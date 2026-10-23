import { useEffect, useState } from 'react'
import { PageFrame, PageHeading } from './PageFrame'
import { useI18n } from '../i18n/useI18n'
import { useToast } from '../components/toastContext'
import {
  getAdminGate,
  getAdminMetrics,
  getAdminUsers,
  sendAnnouncement,
  getAdminHistory,
  type AdminMetrics,
  type AdminUserRow,
  type AnnouncementHistoryRow,
} from '../services/edge/admin'
import { Card, CardHeader, CardBody } from '../components/Card'
import { Button } from '../components/Button'
import { Field, TextInput, TextArea, Select } from '../components/Field'

const TABS = ['metrics', 'users', 'send', 'history'] as const
type Tab = (typeof TABS)[number]

export function AdminPage() {
  const { t } = useI18n()
  const [gateLoading, setGateLoading] = useState(true)
  const [gateError, setGateError] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [unconfigured, setUnconfigured] = useState(false)
  const [tab, setTab] = useState<Tab>('metrics')

  useEffect(() => {
    let cancelled = false
    setGateLoading(true)
    getAdminGate()
      .then((gate) => {
        if (cancelled) return
        setIsAdmin(gate.isAdmin)
        setUnconfigured(false)
        setGateError(null)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const message = e instanceof Error ? e.message : String(e)
        setGateError(message)
        setUnconfigured(message.toLowerCase().includes('not_configured'))
      })
      .finally(() => {
        if (!cancelled) setGateLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (gateLoading) {
    return (
      <PageFrame className="admin-page">
        <PageHeading title={t('adminTitle')} subtitle={t('adminLoading')} />
      </PageFrame>
    )
  }

  if (!isAdmin) {
    return (
      <PageFrame className="admin-page">
        <PageHeading
          title={t('adminTitle')}
          subtitle={unconfigured ? t('adminUnconfigured') : t('adminDenied')}
        />
        {gateError && !unconfigured && (
          <Card className="admin-page__card"><p className="t-muted">{gateError}</p></Card>
        )}
      </PageFrame>
    )
  }

  return (
    <PageFrame className="admin-page">
      <PageHeading title={t('adminTitle')} subtitle={t('adminRegistered')} />
      <nav className="admin-page__tabs" aria-label={t('adminTitle')}>
        {TABS.map((key) => (
          <Button key={key} variant={tab === key ? 'primary' : 'ghost'} onClick={() => setTab(key)}>
            {t(`adminTab_${key}` as Parameters<ReturnType<typeof useI18n>['t']>[0])}
          </Button>
        ))}
      </nav>
      {tab === 'metrics' && <MetricsTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'send' && <SendTab />}
      {tab === 'history' && <HistoryTab />}
    </PageFrame>
  )
}

function MetricsTab() {
  const { t } = useI18n()
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getAdminMetrics()
      .then((m) => {
        if (!cancelled) setMetrics(m)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <Card className="admin-page__card"><p className="t-muted">{error}</p></Card>
  if (!metrics) return <Card className="admin-page__card"><p className="t-muted">{t('adminLoading')}</p></Card>

  type Key = Parameters<ReturnType<typeof useI18n>['t']>[0]
  const cards: Array<[Key, number]> = [
    ['adminRegistered', metrics.totalRegistered],
    ['adminNew7', metrics.newUsers7d],
    ['adminNew30', metrics.newUsers30d],
    ['adminActive7', metrics.active7],
    ['adminActive30', metrics.active30],
    ['adminOptIn', metrics.pushOptIns],
  ]
  return (
    <Card className="admin-page__card">
      <div className="admin-page__metrics">
        {cards.map(([key, value]) => (
          <div key={key} className="admin-page__metric">
            <strong>{value}</strong>
            <span>{t(key)}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

function UsersTab() {
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<AdminUserRow[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(() => {
      getAdminUsers(page + 1, search)
        .then((res) => {
          if (cancelled) return
          setRows(res.users)
          setHasMore(res.hasMore)
          setError(null)
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e))
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [page, search])

  return (
    <Card className="admin-page__card">
      <Field label={t('adminSearchPlaceholder')}>
        <TextInput value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} />
      </Field>
      {error && <p className="t-muted">{error}</p>}
      {loading ? (
        <p className="t-muted">{t('adminLoading')}</p>
      ) : (
        <table className="admin-page__table">
          <thead><tr>
            <th>{t('adminEmail')}</th>
            <th>{t('adminDisplayName')}</th>
            <th>{t('adminRegisteredCol')}</th>
            <th>{t('adminLastSeen')}</th>
            <th>{t('adminOptIn')}</th>
          </tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>{u.email ?? '—'}</td>
                <td>{u.displayName || '—'}</td>
                <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                <td>{u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleDateString() : '—'}</td>
                <td>{u.pushOptIn ? t('adminYes') : t('adminNo')}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5}>{t('adminNoUsers')}</td></tr>}
          </tbody>
        </table>
      )}
      <div className="admin-page__pager">
        <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>{t('adminPrev')}</Button>
        <Button variant="ghost" size="sm" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>{t('adminNext')}</Button>
      </div>
    </Card>
  )
}

function SendTab() {
  const { t } = useI18n()
  const { notify } = useToast()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<'all' | 'opted_in'>('all')
  const [sending, setSending] = useState(false)
  const [preview, setPreview] = useState(false)

  const send = async () => {
    setSending(true)
    try {
      const result = await sendAnnouncement(title, body, audience)
      notify(t('adminSent', { count: result.recipientCount }), 'success')
      setTitle('')
      setBody('')
      setPreview(false)
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : t('adminSendFailed'), 'danger')
    } finally {
      setSending(false)
    }
  }

  if (preview) {
    return (
      <Card className="admin-page__card">
        <CardHeader title={title} subtitle={audience === 'all' ? t('adminAudienceAll') : t('adminAudienceOptedIn')} />
        <CardBody>
          <p className="admin-page__preview-body">{body}</p>
          <div className="admin-page__actions">
            <Button variant="ghost" onClick={() => setPreview(false)}>{t('adminCancel')}</Button>
            <Button variant="primary" loading={sending} onClick={() => void send()}>
              {sending ? t('adminSending') : t('adminSend')}
            </Button>
          </div>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card className="admin-page__card">
      <Field label={t('adminTitlePlaceholder')}>
        <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={t('adminMessagePlaceholder')}>
        <TextArea value={body} onChange={(e) => setBody(e.target.value)} rows={6} />
      </Field>
      <Field label={t('adminAudience')}>
        <Select value={audience} onChange={(e) => setAudience(e.target.value === 'opted_in' ? 'opted_in' : 'all')}>
          <option value="all">{t('adminAudienceAll')}</option>
          <option value="opted_in">{t('adminAudienceOptedIn')}</option>
        </Select>
      </Field>
      <div className="admin-page__actions">
        <Button variant="primary" disabled={!title.trim() || !body.trim()} onClick={() => setPreview(true)}>
          {t('adminPreview')}
        </Button>
      </div>
    </Card>
  )
}

function HistoryTab() {
  const { t } = useI18n()
  const [rows, setRows] = useState<AnnouncementHistoryRow[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getAdminHistory()
      .then((res) => {
        if (!cancelled) setRows(res.history)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <Card className="admin-page__card"><p className="t-muted">{error}</p></Card>
  if (!rows.length) return <Card className="admin-page__card"><p className="t-muted">{t('adminNoHistory')}</p></Card>
  return (
    <Card className="admin-page__card">
      <table className="admin-page__table">
        <thead><tr>
          <th>{t('adminTitleCol')}</th>
          <th>{t('adminSentAt')}</th>
          <th>{t('adminAudience')}</th>
          <th>{t('adminRecipientsCol')}</th>
        </tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td>{a.title}</td>
              <td>{new Date(a.createdAt).toLocaleString()}</td>
              <td>{a.audience === 'opted_in' ? t('adminAudienceOptedIn') : t('adminAudienceAll')}</td>
              <td>{t('adminRecipients', { count: a.recipientCount })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
