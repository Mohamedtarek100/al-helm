import { useEffect, useMemo, useRef, useState } from 'react'
import { useAdminPreferences } from '../../../services/edge/adminSettings'
import { useI18n } from '../../../i18n/useI18n'
import { useToast } from '../../../components/toastContext'
import {
  recallAnnouncement,
  getAdminHistory,
  getRecipientCount,
  logAdminAction,
  retryAnnouncementPush,
  sendAnnouncement,
  type AnnouncementHistoryRow,
  type RecipientCount,
} from '../../../services/edge/admin'
import { useAdminResource } from '../../../services/edge/adminData'
import { formatRate, rate } from '../../../services/edge/adminFormat'
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
} from '../AdminUI'
import { AdminFilterField, AdminSelect, AdminSearchInput } from '../AdminFilters'
import { AdminDefinitionList, AdminDrawer } from '../AdminDrawer'

const TITLE_LIMIT = 120
const BODY_LIMIT = 2000

/**
 * Announcements — compose, preview, recipient count, delivery, history.
 *
 * DESIGN DECISIONS THAT MATTER
 *
 * 1. The recipient count is resolved by the SERVER for the selected audience
 *    and re-resolved immediately before sending. It is never computed from a
 *    page of users the browser happens to hold, which would under-report.
 * 2. Sending is irreversible, so the confirmation states the exact count and
 *    the confirmation is on by default.
 * 3. Delivery reporting is real (`delivered` rows that exist, `opened` rows
 *    with `read_at`), and an open rate with no delivered rows is shown as “—”
 *    rather than 0%.
 */
type Tab = 'compose' | 'history'

export function AnnouncementsSection({
  userId,
  refreshKey,
  onSent,
}: {
  userId: string | null
  refreshKey: number
  onSent: () => void
}) {
  const { t, language } = useI18n()
  const { notify } = useToast()
  const en = language === 'en'
  // Read once per mount from the shared preference store so the Owner
  // Settings toggle actually governs this confirmation step.
  const { preferences } = useAdminPreferences()
  const confirmBeforeSend = preferences.confirmBeforeSend

  const [tab, setTab] = useState<Tab>('compose')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<'all' | 'opted_in'>('all')
  const [sendRequestId, setSendRequestId] = useState<string | null>(null)
  // `resolvedFor` records which request produced this result, so "loading" is
  // computed rather than written into state from inside the effect.
  const [countState, setCountState] = useState<{
    resolvedFor: string | null
    status: 'ready' | 'error'
    count: number | null
    error: string | null
  }>({ resolvedFor: null, status: 'ready', count: null, error: null })
  const [countNonce, setCountNonce] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const sendInFlight = useRef(false)
  const [historySearch, setHistorySearch] = useState('')
  const [selected, setSelected] = useState<AnnouncementHistoryRow | null>(null)
  const [recallTarget, setRecallTarget] = useState<AnnouncementHistoryRow | null>(null)
  const [recalling, setRecalling] = useState(false)
  const [retryingPush, setRetryingPush] = useState(false)

  /**
   * Recalls a sent announcement from every recipient's inbox.
   *
   * The server does the work; this only reports the outcome. On success the
   * history is refetched so the recalled state comes from the backend rather
   * than being assumed locally.
   */
  const doRecall = async (announcementId: string) => {
    setRecalling(true)
    try {
      const result = await recallAnnouncement(announcementId)
      notify(t('acRecallDone', { count: result.revokedRecipients }), 'success')
      setRecallTarget(null)
      setSelected(null)
      history.retry()
      onSent()
    } catch (error) {
      notify(error instanceof Error ? error.message : t('acRecallFailed'), 'danger')
    } finally {
      setRecalling(false)
    }
  }

  const doRetryPush = async (announcementId: string) => {
    setRetryingPush(true)
    try {
      const { push } = await retryAnnouncementPush(announcementId)
      if (push.status === 'not_configured') {
        notify(t('acRetryPushNotConfigured'), 'warning')
      } else if (push.status === 'recalled') {
        notify(t('acRetryPushRecalled'), 'warning')
      } else if (push.status === 'no_retryable_failures') {
        notify(t('acRetryPushNone'), 'info')
      } else {
        notify(t('acRetryPushOutcome', {
          attempted: push.attempted,
          accepted: push.accepted,
          failed: push.failed + push.expired,
          remaining: push.remaining ?? 0,
        }), push.failed + push.expired > 0 || (push.remaining ?? 0) > 0 || Boolean(push.error) ? 'warning' : 'success')
        if (push.error) notify(push.error, 'warning')
      }
      setSelected(null)
      history.retry()
    } catch (error) {
      notify(error instanceof Error ? error.message : t('acRetryPushFailed'), 'danger')
    } finally {
      setRetryingPush(false)
    }
  }
  const [previewTime] = useState(() => new Date().toLocaleString(en ? 'en-US' : 'ar-EG', { dateStyle: 'medium', timeStyle: 'short' }))

  // Resolve the recipient count for the CURRENT audience, and re-resolve when
  // the owner asks for it. A failure is shown; it never falls back to a guess.
  //
  // The "loading" state is derived from the key that resolved last, not set
  // eagerly inside the effect: two synchronous setState calls in one effect
  // cause a cascading re-render, and the eager call could also overwrite a
  // newer count with an older one's loading state.
  const countKey = `${audience}:${countNonce}:${userId ?? ''}`
  useEffect(() => {
    let cancelled = false
    getRecipientCount(audience)
      .then((result: RecipientCount) => {
        if (!cancelled) setCountState({ resolvedFor: countKey, status: 'ready', count: result.count, error: null })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCountState({
            resolvedFor: countKey,
            status: 'error',
            count: null,
            error: error instanceof Error ? error.message : t('acRecipientCountFailed'),
          })
        }
      })
    return () => { cancelled = true }
  }, [audience, userId, t, countKey])

  // A request is in flight whenever the resolved key is not the current one.
  const countLoading = countState.resolvedFor !== countKey

  const history = useAdminResource<{ history: AnnouncementHistoryRow[] }>(
    () => getAdminHistory(),
    [userId, refreshKey],
  )

  const titleError = title.length > TITLE_LIMIT ? t('acMessageLength', { used: title.length, max: TITLE_LIMIT }) : null
  const bodyError = body.length > BODY_LIMIT ? t('acMessageLength', { used: body.length, max: BODY_LIMIT }) : null
  const valid = title.trim().length > 0 && body.trim().length > 0 && !titleError && !bodyError

  const doSend = async () => {
    if (sendInFlight.current) return
    sendInFlight.current = true
    setConfirming(false)
    setSending(true)
    const requestId = sendRequestId ?? crypto.randomUUID()
    setSendRequestId(requestId)
    try {
      const result = await sendAnnouncement(title.trim(), body.trim(), audience, requestId)
      if (result.duplicate) {
        notify(t('acSendDuplicate', { count: result.recipientCount }), 'info')
      } else if (result.push.status === 'not_configured') {
        notify(t('acSendInAppOnly', { count: result.recipientCount }), 'warning')
      } else if (result.push.status === 'no_subscriptions') {
        notify(t('acSendNoSubscriptions', { count: result.recipientCount }), 'info')
      } else if (result.push.error && result.push.attempted > 0) {
        notify(t('acSendPushPersistenceWarning', {
          attempted: result.push.attempted,
          accepted: result.push.accepted,
          failed: result.push.failed + result.push.expired,
          reason: result.push.error,
        }), 'warning')
      } else if (result.push.error) {
        notify(t('acSendPushUnavailable', { count: result.recipientCount, reason: result.push.error }), 'warning')
      } else {
        notify(t('acSendPushOutcome', {
          count: result.recipientCount,
          attempted: result.push.attempted,
          accepted: result.push.accepted,
          failed: result.push.failed + result.push.expired,
        }), result.push.failed + result.push.expired > 0 ? 'warning' : 'success')
      }
      setTitle('')
      setBody('')
      setSendRequestId(null)
      setTab('history')
      onSent()
      void logAdminAction('announcement_send', result.announcementId, {
        audience,
        recipientCount: result.recipientCount,
      }).catch(() => undefined)
    } catch (error) {
      notify(error instanceof Error ? error.message : t('acSendFailed'), 'danger')
    } finally {
      setSending(false)
      sendInFlight.current = false
    }
  }

  const requestSend = () => {
    if (!valid || sending) return
    if (confirmBeforeSend) setConfirming(true)
    else void doSend()
  }

  const historyRows = useMemo(() => {
    if (history.state.status !== 'ready') return []
    const needle = historySearch.trim().toLowerCase()
    if (!needle) return history.state.data.history
    return history.state.data.history.filter((row) => row.title.toLowerCase().includes(needle))
  }, [history.state, historySearch])

  const historyColumns: AdminColumn<AnnouncementHistoryRow>[] = [
    { key: 'title', header: t('adminTitleCol'), render: (row) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <b style={row.revokedAt ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>{row.title}</b>
        {row.revokedAt && <AdminStatusBadge tone="muted">{t('acRecalledBadge')}</AdminStatusBadge>}
      </span>
    ) },
    {
      key: 'audience',
      header: t('acAudienceLabel'),
      render: (row) => (row.audience === 'opted_in' ? t('adminAudienceOptedIn') : t('adminAudienceAll')),
      hideOnMobile: true,
    },
    {
      key: 'sent',
      header: t('adminSentAt'),
      render: (row) => new Date(row.createdAt).toLocaleString(en ? 'en-US' : 'ar-EG'),
      hideOnMobile: true,
    },
    {
      key: 'delivered',
      header: t('acDelivered'),
      render: (row) => t('adminRecipients', { count: row.recipientCount }),
      align: 'end',
    },
    {
      key: 'opened',
      header: t('acOpened'),
      render: (row) => (
        <AdminStatusBadge tone={row.recipientCount > 0 && (row.openedCount ?? 0) > 0 ? 'ok' : 'muted'}>
          {`${row.openedCount ?? 0} · ${formatRate(rate(row.openedCount ?? 0, row.recipientCount))}`}
        </AdminStatusBadge>
      ),
      align: 'end',
    },
    {
      key: 'push',
      header: t('acPushStatus'),
      render: (row) => {
        const status = row.pushStatus ?? null
        const isConfiguredGap = status === null || status === 'not_configured' || status === 'no_subscriptions'
        const failed = (row.pushFailed ?? 0) + (row.pushExpired ?? 0)
        const tone = isConfiguredGap
          ? 'muted'
          : status === 'sent' && failed === 0
            ? 'ok'
            : status === 'partial' || status === 'outcome_persistence_failed'
              ? 'warn'
              : 'error'
        const label = status === null
          ? t('acPushNotRecorded')
          : status === 'not_configured'
            ? t('acPushNotConfigured')
            : status === 'no_subscriptions'
              ? t('acPushNoSubscriptions')
              : status === 'recording_failed'
                ? t('acPushRecordingFailed')
                : status === 'outcome_persistence_failed'
                  ? t('acPushOutcomePersistenceFailed')
                  : status === 'failed'
                    ? t('acPushDeliveryFailed')
              : t('acPushOutcomes', {
                accepted: row.pushAccepted ?? 0,
                attempted: row.pushAttempted ?? 0,
                failed,
              })
        return <AdminStatusBadge tone={tone}>{label}</AdminStatusBadge>
      },
      hideOnMobile: true,
    },
  ]

  const totalDelivered = history.state.status === 'ready'
    ? history.state.data.history.reduce((sum, row) => sum + row.recipientCount, 0) : 0
  const totalOpened = history.state.status === 'ready'
    ? history.state.data.history.reduce((sum, row) => sum + (row.openedCount ?? 0), 0) : 0
  const totalPushAccepted = history.state.status === 'ready'
    ? history.state.data.history.reduce((sum, row) => sum + (row.pushAccepted ?? 0), 0) : 0

  return (
    <>
      <AdminPageHeader
        eyebrow={t('adminConsoleSection')}
        title={t('adminAnnouncements')}
        description={t('acAnnounceSubtitle')}
        actions={
          <div className="ac-segmented" role="group" aria-label={t('adminAnnouncements')}>
            {(['compose', 'history'] as Tab[]).map((value) => (
              <button
                key={value}
                type="button"
                className={tab === value ? 'ac-segmented__item ac-segmented__item--active' : 'ac-segmented__item'}
                aria-pressed={tab === value}
                onClick={() => setTab(value)}
              >
                {value === 'compose' ? t('acAnnounceCompose') : t('acAnnounceHistory')}
              </button>
            ))}
          </div>
        }
      />

      {tab === 'compose' && (
        <div className="ac-grid ac-grid--panels">
          <AdminCard title={t('acAnnounceCompose')}>
            <p className="alert alert--warning" role="note">
              {en
                ? 'This creates in-app inbox entries. Push-provider acceptance is reported separately and does not prove a browser or phone displayed the notification.'
                : 'ده بيضيف الإعلان لصندوق الإشعارات داخل التطبيق. قبول مزود Push بيتعرض لوحده ومش دليل إن المتصفح أو الموبايل عرض الإشعار.'}
            </p>
            <div className="ac-form">
              <label className="ac-field">
                <span className="ac-field__label">{t('adminTitleCol')}</span>
                <input
                  className={titleError ? 'ac-input ac-input--invalid' : 'ac-input'}
                  value={title}
                  disabled={sending}
                  maxLength={TITLE_LIMIT + 20}
                  onChange={(event) => { setTitle(event.target.value); setSendRequestId(null) }}
                  placeholder={t('adminTitlePlaceholder')}
                />
                <span className="ac-field__meta">{t('acMessageLength', { used: title.length, max: TITLE_LIMIT })}</span>
              </label>

              <label className="ac-field">
                <span className="ac-field__label">{t('acBodyLabel')}</span>
                <textarea
                  className={bodyError ? 'ac-input ac-input--invalid' : 'ac-input ac-textarea'}
                  rows={7}
                  value={body}
                  disabled={sending}
                  maxLength={BODY_LIMIT + 50}
                  onChange={(event) => { setBody(event.target.value); setSendRequestId(null) }}
                  placeholder={t('adminMessagePlaceholder')}
                />
                <span className="ac-field__meta">{t('acMessageLength', { used: body.length, max: BODY_LIMIT })}</span>
              </label>

              <AdminFilterField label={t('adminAudience')}>
                <AdminSelect<'all' | 'opted_in'>
                  value={audience}
                  onChange={(value) => { setAudience(value); setSendRequestId(null) }}
                  ariaLabel={t('adminAudience')}
                  disabled={sending}
                  options={[
                    { value: 'all', label: t('adminAudienceAll') },
                    { value: 'opted_in', label: t('adminAudienceOptedIn') },
                  ]}
                />
              </AdminFilterField>
              <p className="ac-footnote">
                {audience === 'all' ? t('acAudienceAllHint') : t('acAudienceOptInHint')}
              </p>

              <div className="ac-send-row">
                <div className="ac-send-row__count">
                  <span className="ac-card__hint">{t('acRecipientCount')}</span>
                  {countLoading && <strong className="ac-send-row__number">…</strong>}
                  {!countLoading && countState.status === 'error' && (
                    <span className="ac-send-row__error" role="alert">{countState.error ?? t('acRecipientCountFailed')}</span>
                  )}
                  {!countLoading && countState.status === 'ready' && (
                    <strong className="ac-send-row__number">{countState.count === 0 ? '0' : countState.count}</strong>
                  )}
                </div>
                <AdminButton size="sm" variant="ghost" onClick={() => setCountNonce((value) => value + 1)}>
                  {t('acRecalculate')}
                </AdminButton>
              </div>

              <div className="ac-form__actions">
                <AdminButton
                  variant="primary"
                  onClick={requestSend}
                  disabled={!valid || sending || (!countLoading && countState.status === 'ready' && countState.count === 0)}
                  loading={sending}
                >
                  {sending ? t('adminSending') : t('adminSend')}
                </AdminButton>
                {!countLoading && countState.status === 'ready' && countState.count === 0 && (
                  <span className="ac-field__meta">{t('acNoRecipients')}</span>
                )}
              </div>
            </div>
          </AdminCard>

          <AdminCard title={t('acPreviewDevice')} hint={t('acPreviewEmpty')}>
            <div className="ac-phone">
              <div className="ac-phone__screen">
                <div className="ac-phone__appbar">4uLife</div>
                <div className="ac-phone__notice">
                  <span className="ac-phone__icon" aria-hidden="true">✦</span>
                  <div>
                    <b>{title.trim() || t('adminTitlePlaceholder')}</b>
                    <p>{body.trim() || t('adminMessagePlaceholder')}</p>
                    {/* The timestamp is fixed at mount so render stays pure. */}
                    <time>{previewTime}</time>
                  </div>
                </div>
              </div>
            </div>
            <p className="ac-footnote">
              {en
                ? 'This preview uses the exact limits the server enforces. Recipients see the notice in the app’s notifications feed.'
                : 'المعاينة بنفس الحدود اللي الخادم بيفرضها. المستلمين بيشوفوا الإشعار في قائمة الإشعارات داخل التطبيق.'}
            </p>
          </AdminCard>
        </div>
      )}

      {tab === 'history' && (
        <>
          <div className="ac-grid ac-grid--stats" style={{ marginBottom: 'var(--ac-space-3)' }}>
            <AdminStatCard label={t('acKpiAnnouncements')} value={history.state.status === 'ready' ? history.state.data.history.length : null} index={0} />
            <AdminStatCard label={t('acDelivered')} value={history.state.status === 'ready' ? totalDelivered : null} index={1} tone="info" />
            <AdminStatCard
              label={t('acOpened')}
              value={history.state.status === 'ready' ? totalOpened : null}
              index={2}
              tone="ok"
              footnote={`${t('acOpenRate')}: ${formatRate(rate(totalOpened, totalDelivered))}`}
            />
            <AdminStatCard
              label={t('acPushAccepted')}
              value={history.state.status === 'ready' ? totalPushAccepted : null}
              index={3}
              tone="info"
              footnote={t('acPushAcceptanceNotDisplay')}
            />
          </div>

          <AdminCard
            title={t('acAnnounceHistory')}
            hint={t('acHistoryHint')}
            action={
              <div style={{ minWidth: 220 }}>
                <AdminSearchInput
                  value={historySearch}
                  onChange={setHistorySearch}
                  placeholder={t('acSearchHistory')}
                  ariaLabel={t('acSearchHistory')}
                />
              </div>
            }
            padded={false}
          >
            {history.state.status === 'loading' && <AdminLoadingState label={t('adminLoading')} />}
            {history.state.status === 'error' && (
              <AdminErrorState
                title={t('adminUnavailable')}
                message={history.state.error}
                onRetry={history.retry}
                retryLabel={t('adminRefresh')}
              />
            )}
            {history.state.status === 'ready' && (
              <AdminDataTable
                caption={t('acAnnounceHistory')}
                columns={historyColumns}
                rows={historyRows}
                rowKey={(row) => row.id}
                onRowClick={(row) => setSelected(row)}
                selectedKey={selected?.id ?? null}
                empty={
                  <AdminEmptyState
                    title={history.state.data.history.length === 0 ? t('acHistoryEmpty') : t('acAnnounceSearchEmpty')}
                  />
                }
              />
            )}
          </AdminCard>
        </>
      )}

      <AdminDrawer
        open={selected !== null}
        title={selected?.title ?? t('acDetailTitle')}
        description={t('acDetailTitle')}
        closeLabel={t('acClose')}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            <AdminDefinitionList
              items={[
                { label: t('acAudienceLabel'), value: selected.audience === 'opted_in' ? t('adminAudienceOptedIn') : t('adminAudienceAll') },
                { label: t('adminSentAt'), value: new Date(selected.createdAt).toLocaleString(en ? 'en-US' : 'ar-EG') },
                { label: t('acDetailDelivered'), value: String(selected.recipientCount) },
                { label: t('acDetailOpened'), value: `${selected.openedCount ?? 0} (${formatRate(rate(selected.openedCount ?? 0, selected.recipientCount))})` },
                { label: t('acDetailUnopened'), value: String(Math.max(0, selected.recipientCount - (selected.openedCount ?? 0))) },
              ]}
            />
            {selected.body && (
              <div style={{ marginTop: 16 }}>
                <p className="ac-card__hint" style={{ marginBottom: 6 }}>{t('acBodyLabel')}</p>
                <div className="ac-quoted">{selected.body}</div>
              </div>
            )}

            {(selected.pushFailed ?? 0) > 0 && !selected.revokedAt && (
              <div style={{ marginTop: 18 }}>
                <p className="ac-footnote" style={{ marginBottom: 8 }}>{t('acRetryPushHint')}</p>
                <AdminButton
                  loading={retryingPush}
                  disabled={retryingPush || recalling}
                  onClick={() => { void doRetryPush(selected.id) }}
                >
                  {t('acRetryPush')}
                </AdminButton>
              </div>
            )}

            {/* RECALL — removes the announcement from every recipient's inbox.
                Shown only while it is still live, and it requires confirmation
                because it is irreversible. */}
            <div style={{ marginTop: 18 }}>
              {selected.revokedAt ? (
                <p className="ac-footnote" style={{ color: 'var(--ac-emerald)' }}>
                  {t('acRecalledOn', { at: new Date(selected.revokedAt).toLocaleString(en ? 'en-US' : 'ar-EG') })}
                </p>
              ) : (
                <>
                  <p className="ac-footnote" style={{ marginBottom: 8 }}>{t('acRecallHint')}</p>
                  {recallTarget?.id === selected.id ? (
                    <div className="ac-form__actions">
                      <AdminButton variant="ghost" onClick={() => setRecallTarget(null)}>{t('adminCancel')}</AdminButton>
                      <AdminButton variant="danger" loading={recalling} onClick={() => { void doRecall(selected.id) }}>
                        {t('acRecallConfirm')}
                      </AdminButton>
                    </div>
                  ) : (
                    <AdminButton variant="danger" onClick={() => setRecallTarget(selected)} disabled={recalling}>
                      {t('acRecall')}
                    </AdminButton>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </AdminDrawer>

      {confirming && (
        <div className="ac-drawer-layer ac-drawer-layer--confirm">
          <button type="button" className="ac-drawer-backdrop" aria-label={t('adminCancel')} onClick={() => setConfirming(false)} />
          <div className="ac-confirm" role="alertdialog" aria-modal="true" aria-labelledby="ac-confirm-title">
            <h2 className="ac-drawer-panel__title" id="ac-confirm-title">{t('acSendTitle')}</h2>
            <p className="ac-state__desc" style={{ margin: '8px 0 4px' }}>
              {t('acSendConfirmBody', { count: countState.count ?? 0 })}
            </p>
            <p className="ac-footnote" style={{ margin: '0 0 14px' }}>{title || t('adminTitlePlaceholder')}</p>
            <div className="ac-form__actions">
              <AdminButton variant="ghost" onClick={() => setConfirming(false)}>{t('adminCancel')}</AdminButton>
              <AdminButton variant="primary" onClick={() => { void doSend() }} loading={sending}>{t('adminSend')}</AdminButton>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
