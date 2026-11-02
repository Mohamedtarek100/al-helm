import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../../../i18n/useI18n'
import { useToast } from '../../../components/toastContext'
import {
  getAdminDirectoryExport,
  getAdminUser,
  getAdminUsers,
  logAdminAction,
  type AdminActivityFilter,
  type AdminPushFilter,
  type AdminUserDetail,
  type AdminUserQuery,
  type AdminUserRow,
  type AdminUserSort,
  type AdminUsersPage,
} from '../../../services/edge/admin'
import { useAdminResource } from '../../../services/edge/adminData'
import { activityStatus, daysSince, toCsv, formatRate, rate } from '../../../services/edge/adminFormat'
import { downloadCsv, exportFilename } from '../../../services/edge/adminDownload'
import {
  AdminButton,
  AdminCard,
  AdminDataTable,
  AdminEmptyState,
  AdminErrorState,
  AdminLoadingState,
  AdminPageHeader,
  AdminStatusBadge,
  type AdminColumn,
} from '../AdminUI'
import { AdminFilterBar, AdminFilterField, AdminPager, AdminSearchInput, AdminSelect } from '../AdminFilters'
import { AdminDefinitionList, AdminDrawer } from '../AdminDrawer'

/**
 * User directory.
 *
 * Search, filtering, sorting and pagination all happen on the SERVER: the
 * browser never receives the full account list for a normal page view. That
 * keeps a privileged read small, keeps the numbers honest (`total` is a real
 * server count), and means a filter cannot silently apply to one page only —
 * the previous implementation filtered the current slice, so "active users"
 * hid matches that lived on later pages.
 *
 * CSV export goes through a separate, bounded server action that returns only
 * an explicit column list. Sign-in tokens, private content and user-authored
 * text are never part of it.
 */
export function UsersSection({ userId, pageSize }: { userId: string | null; pageSize: number }) {
  const { t, language } = useI18n()
  const { notify } = useToast()
  const en = language === 'en'

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [activity, setActivity] = useState<AdminActivityFilter>('any')
  const [push, setPush] = useState<AdminPushFilter>('any')
  const [sort, setSort] = useState<AdminUserSort>('newest')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  // Debounced server search. `page` is reset in the same timeout so the two
  // state updates cannot disagree about which page is being requested.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 320)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Any filter change restarts at page 1 unless the page itself changed.
  const changeFilter = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value)
    setPage(1)
  }

  const query: AdminUserQuery = useMemo(
    () => ({ page, perPage: pageSize, search, activity, push, sort }),
    [page, pageSize, search, activity, push, sort],
  )

  const { state, retry } = useAdminResource<AdminUsersPage>(
    () => getAdminUsers(query),
    [userId, pageSize, search, activity, push, sort],
  )

  // A null id resolves to null WITHOUT a request: a closed drawer must not
  // probe the server with a placeholder id.
  const detail = useAdminResource<{ user: AdminUserDetail } | null>(
    () => (selectedId ? getAdminUser(selectedId) : Promise.resolve(null)),
    [userId, selectedId],
  )

  const filtersActive = search !== '' || activity !== 'any' || push !== 'any' || sort !== 'newest'

  const clearFilters = () => {
    setSearchInput('')
    setSearch('')
    setActivity('any')
    setPush('any')
    setSort('newest')
    setPage(1)
  }

  const statusLabel = (row: AdminUserRow) => {
    const status = activityStatus(row.lastSeenAt)
    if (status === 'active') return t('acUserStatusActive')
    if (status === 'idle') return t('acUserStatusIdle')
    return t('acUserStatusNever')
  }

  const statusTone = (row: AdminUserRow) => {
    const status = activityStatus(row.lastSeenAt)
    return status === 'active' ? 'ok' : status === 'idle' ? 'warn' : 'muted'
  }

  const columns: AdminColumn<AdminUserRow>[] = [
    {
      key: 'email',
      header: t('adminEmail'),
      render: (row) => <span className="ac-mono">{row.email ?? '—'}</span>,
    },
    {
      key: 'name',
      header: t('adminDisplayName'),
      render: (row) => row.displayName || '—',
      hideOnMobile: true,
    },
    {
      key: 'created',
      header: t('adminRegisteredCol'),
      render: (row) => new Date(row.createdAt).toLocaleDateString(en ? 'en-US' : 'ar-EG'),
      hideOnMobile: true,
    },
    {
      key: 'seen',
      header: t('adminLastSeen'),
      render: (row) => (row.lastSeenAt ? new Date(row.lastSeenAt).toLocaleDateString(en ? 'en-US' : 'ar-EG') : '—'),
      hideOnMobile: true,
    },
    {
      key: 'status',
      header: t('acUserStatus'),
      render: (row) => <AdminStatusBadge tone={statusTone(row)}>{statusLabel(row)}</AdminStatusBadge>,
    },
  ]

  const exportCsv = async () => {
    setExporting(true)
    try {
      const result = await getAdminDirectoryExport(['email', 'displayName', 'createdAt', 'lastSeenAt', 'pushOptIn', 'status'])
      if (result.rows.length === 0) {
        notify(t('acExportEmpty'), 'info')
        return
      }
      const csv = toCsv(result.headers, result.rows)
      const ok = downloadCsv(exportFilename('4ulife-users'), csv)
      if (!ok) {
        notify(t('acExportEmpty'), 'danger')
        return
      }
      notify(t('acExportSafe', { count: result.exported }), 'success')
      // Best-effort: a failed audit write must not make a completed export look
      // like it failed.
      void logAdminAction('user_export', null, {
        exported: result.exported,
        total: result.total,
        columns: result.columns,
      }).catch(() => undefined)
    } catch (error) {
      notify(error instanceof Error ? error.message : t('acExportEmpty'), 'danger')
    } finally {
      setExporting(false)
    }
  }

  const pageData = state.status === 'ready' ? state.data : null
  const from = pageData && pageData.total > 0 ? (pageData.page - 1) * pageData.perPage + 1 : 0
  const to = pageData ? Math.min(pageData.page * pageData.perPage, pageData.total) : 0
  const detailUser = detail.state.status === 'ready' ? detail.state.data?.user ?? null : null

  return (
    <>
      <AdminPageHeader
        eyebrow={t('adminConsoleSection')}
        title={t('acUsersTitle')}
        description={t('acUsersSubtitle')}
        actions={
          <AdminButton
            variant="primary"
            onClick={() => { void exportCsv() }}
            loading={exporting}
            disabled={state.status !== 'ready'}
          >
            {exporting ? t('acExporting') : t('acExportCsv')}
          </AdminButton>
        }
      />

      <AdminCard padded={false}>
        <div style={{ padding: '14px 14px 0' }}>
          <AdminFilterBar active={filtersActive} onClear={clearFilters} clearLabel={t('acClearFilters')}>
            <AdminFilterField label={t('acFilterSearch')}>
              <AdminSearchInput
                value={searchInput}
                onChange={setSearchInput}
                placeholder={t('adminSearchPlaceholder')}
                ariaLabel={t('adminSearchPlaceholder')}
              />
            </AdminFilterField>
            <AdminFilterField label={t('acFilterActivity')}>
              <AdminSelect<AdminActivityFilter>
                value={activity}
                onChange={changeFilter(setActivity)}
                ariaLabel={t('acFilterActivity')}
                options={[
                  { value: 'any', label: t('acFilterAny') },
                  { value: 'active7', label: t('acFilterActive7') },
                  { value: 'active30', label: t('acFilterActive30') },
                  { value: 'inactive30', label: t('acFilterInactive30') },
                  { value: 'never', label: t('acFilterNever') },
                ]}
              />
            </AdminFilterField>
            <AdminFilterField label={t('acFilterPush')}>
              <AdminSelect<AdminPushFilter>
                value={push}
                onChange={changeFilter(setPush)}
                ariaLabel={t('acFilterPush')}
                options={[
                  { value: 'any', label: t('acFilterAll') },
                  { value: 'opted_in', label: t('acFilterOptedIn') },
                  { value: 'not_opted_in', label: t('acFilterNotOptedIn') },
                ]}
              />
            </AdminFilterField>
            <AdminFilterField label={t('acFilterSort')}>
              <AdminSelect<AdminUserSort>
                value={sort}
                onChange={changeFilter(setSort)}
                ariaLabel={t('acFilterSort')}
                options={[
                  { value: 'newest', label: t('acSortNewest') },
                  { value: 'oldest', label: t('acSortOldest') },
                  { value: 'name', label: t('acSortName') },
                  { value: 'last_seen', label: t('acSortLastSeen') },
                ]}
              />
            </AdminFilterField>
          </AdminFilterBar>
        </div>

        {state.status === 'loading' && <AdminLoadingState label={t('adminLoading')} />}
        {state.status === 'error' && (
          <AdminErrorState title={t('adminUnavailable')} message={state.error} onRetry={retry} retryLabel={t('adminRefresh')} />
        )}
        {state.status === 'ready' && (
          <>
            <AdminDataTable
              caption={t('acUsersTitle')}
              columns={columns}
              rows={state.data.users}
              rowKey={(row) => row.id}
              selectedKey={selectedId}
              onRowClick={(row) => setSelectedId(row.id)}
              empty={
                <AdminEmptyState
                  title={t('adminNoUsers')}
                  description={filtersActive ? (en ? 'Try removing a filter.' : 'جرّبي تشيلي فلتر.') : undefined}
                />
              }
            />
            <AdminPager
              page={state.data.page}
              onPrev={() => setPage((value) => Math.max(1, value - 1))}
              onNext={() => setPage((value) => value + 1)}
              canPrev={state.data.page > 1}
              canNext={state.data.hasMore}
              rangeLabel={t('acShowingRange', { from, to, total: state.data.total })}
              prevLabel={t('adminPrev')}
              nextLabel={t('adminNext')}
            />
          </>
        )}
      </AdminCard>

      <p className="ac-footnote">{t('acExportNote')}</p>

      <AdminDrawer
        open={selectedId !== null}
        title={t('acUserDetail')}
        description={t('acUserDetailHint')}
        closeLabel={t('acClose')}
        onClose={() => setSelectedId(null)}
      >
        {detail.state.status === 'loading' && <AdminLoadingState label={t('adminLoading')} />}
        {detail.state.status === 'error' && (
          <AdminErrorState title={t('adminUnavailable')} message={detail.state.error} onRetry={detail.retry} retryLabel={t('acRetry')} />
        )}
        {selectedId !== null && detail.state.status === 'ready' && !detailUser && (
          <AdminEmptyState title={t('acSelectUser')} />
        )}
        {detailUser && (
          <>
            <AdminDefinitionList
              items={[
                { label: t('adminEmail'), value: <span className="ac-mono">{detailUser.email ?? '—'}</span> },
                { label: t('adminDisplayName'), value: detailUser.displayName || '—' },
                { label: t('acUserId'), value: <span className="ac-mono ac-mono--wrap">{detailUser.id}</span> },
                { label: t('adminRegisteredCol'), value: new Date(detailUser.createdAt).toLocaleString(en ? 'en-US' : 'ar-EG') },
                {
                  label: t('acUserDaysSinceSeen'),
                  value: detailUser.lastSeenAt ? new Date(detailUser.lastSeenAt).toLocaleString(en ? 'en-US' : 'ar-EG') : t('acUserStatusNever'),
                },
                {
                  label: t('acUserStatus'),
                  value: (
                    <AdminStatusBadge tone={detailUser.lastSeenAt ? 'ok' : 'muted'}>
                      {detailUser.lastSeenAt ? `${daysSince(detailUser.lastSeenAt)} ${en ? 'days ago' : 'يوم'}` : t('acUserStatusNever')}
                    </AdminStatusBadge>
                  ),
                },
                { label: t('acFilterPush'), value: detailUser.pushOptIn ? t('acFilterOptedIn') : t('acFilterNotOptedIn') },
                { label: en ? 'Push subscriptions' : 'اشتراكات الإشعارات', value: String(detailUser.pushSubscriptions) },
                { label: t('adminFcmDevices'), value: String(detailUser.fcmDevices) },
                { label: en ? 'Providers' : 'مزودو الدخول', value: detailUser.providers.length ? detailUser.providers.join(', ') : '—' },
                { label: en ? 'Email verified' : 'البريد موثّق', value: detailUser.emailConfirmed ? t('adminYes') : t('adminNo') },
                { label: t('acDetailDelivered'), value: String(detailUser.announcementsDelivered) },
                {
                  label: t('acDetailOpened'),
                  value: `${detailUser.announcementsOpened} (${formatRate(rate(detailUser.announcementsOpened, detailUser.announcementsDelivered))})`,
                },
              ]}
            />
            <p className="ac-footnote" style={{ marginTop: 12 }}>
              {en
                ? 'Only identity and messaging metadata are shown. Journal entries, tasks, drawings and private notes are protected by row-level security and are never readable from this console.'
                : 'بيتم عرض بيانات الهوية وبيانات الرسائل فقط. المذكرات والمهام والرسومات والملاحظات الخاصة محمية بـ RLS ومش ممكن تتقري من اللوحة دي.'}
            </p>
          </>
        )}
      </AdminDrawer>
    </>
  )
}
