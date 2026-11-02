import { supabase } from '../persistence/supabase'

/**
 * Thin client for the `admin` Supabase Edge Function.
 *
 * Every request carries the signed-in user's access token; the function
 * re-verifies it and checks the ADMIN_EMAILS allowlist server-side before
 * doing anything privileged. This module never sees or sends any
 * service-role key — Supabase injects that only inside the function.
 *
 * It also never *derives* privilege: nothing here decides whether the caller is
 * an owner. It only transports requests and their real outcomes.
 */

/* ------------------------------------------------------------------ */
/* Wire types                                                          */
/* ------------------------------------------------------------------ */

export interface AdminMetrics {
  totalRegistered: number
  newUsers7d: number
  newUsers30d: number
  active7: number
  active30: number
  pushOptIns: number
}

export interface AdminUserRow {
  id: string
  email: string | null
  displayName: string | null
  createdAt: string
  lastSeenAt: string | null
  pushOptIn: boolean
}

export interface AdminGate {
  isAdmin: boolean
  email: string | null
  error?: string
}

export interface AdminUsersPage {
  users: AdminUserRow[]
  page: number
  perPage: number
  total: number
  hasMore: boolean
  truncated: boolean
}

export type AdminActivityFilter = 'any' | 'active7' | 'active30' | 'inactive30' | 'never'
export type AdminPushFilter = 'any' | 'opted_in' | 'not_opted_in'
export type AdminUserSort = 'newest' | 'oldest' | 'name' | 'last_seen'

export interface AdminUserQuery {
  page?: number
  perPage?: number
  search?: string
  activity?: AdminActivityFilter
  push?: AdminPushFilter
  sort?: AdminUserSort
}

export interface AdminUserDetail {
  id: string
  email: string | null
  displayName: string
  createdAt: string
  lastSignInAt: string | null
  providers: string[]
  emailConfirmed: boolean
  pushSubscriptions: number
  fcmDevices: number
  pushOptIn: boolean
  announcementsDelivered: number
  announcementsOpened: number
  lastSeenAt: string | null
}

export interface AdminOverview {
  generatedAt: string
  windowDays: number
  truncated: boolean
  totalRegistered: number
  newUsers7d: number
  newUsers30d: number
  active7: number
  active30: number
  neverSeen: number
  inactive30: number
  trackedAccounts: number
  pushOptIns: number
  announcementsSent: number
  deliveries: number
  deliveriesOpened: number
  registrations: { date: string; count: number }[]
  recentUsers: AdminUserRow[]
}

export interface AdminAnalytics {
  generatedAt: string
  truncated: boolean
  registered: number
  heard: number
  active7: number
  active30: number
  recencyBuckets: { label: string; value: number }[]
  registrations: { date: string; count: number }[]
  announcementsSent: number
  deliveries: number
  deliveriesOpened: number
}

export interface AnnouncementHistoryRow {
  id: string
  title: string
  body?: string
  audience: string
  createdAt: string
  recipientCount: number
  openedCount?: number
  pushStatus?: string | null
  pushAttempted?: number
  pushAccepted?: number
  pushFailed?: number
  pushExpired?: number
  /** Set when the owner recalled this announcement. */
  revokedAt?: string | null
}

export interface SendResult {
  ok: boolean
  announcementId: string
  recipientCount: number
  duplicate?: boolean
  push: {
    status: 'not_configured' | 'no_subscriptions' | 'no_retryable_failures' | 'recalled' | 'sent' | 'partial' | 'failed' | 'recording_failed' | 'outcome_persistence_failed' | 'already_processed'
    attempted: number
    accepted: number
    failed: number
    expired: number
    remaining?: number
    originalStatus?: string | null
    error?: string
  }
}

export interface RecipientCount {
  audience: 'all' | 'opted_in'
  count: number
  truncated?: boolean
}

export interface AuditEntry {
  id: string
  actorEmail: string | null
  action: string
  actionLabel: string
  target: string | null
  detail: unknown
  createdAt: string
}

export interface HealthCheck {
  id: string
  label: string
  ok: boolean
  detail: string | null
}

export interface HealthReport {
  checkedAt: string
  elapsedMs: number
  checks: HealthCheck[]
  runtime: {
    adminAllowlistConfigured: boolean
    ownerEmail: string | null
    serviceRoleConfigured: boolean
    anonKeyConfigured: boolean
    webPushConfigured: boolean
    fcmConfigured: boolean
  }
}

export interface ExportResult {
  columns: string[]
  headers: string[]
  rows: string[]
  total: number
  exported: number
  truncated: boolean
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

function endpoint(action: string): string {
  const base = import.meta.env.VITE_SUPABASE_URL
  if (!base) throw new Error('Supabase is not configured.')
  // The action is also the path segment so each endpoint is individually
  // addressable in Supabase logs; the body repeats it for compatibility.
  return `${base}/functions/v1/admin/${encodeURIComponent(action)}`
}

async function accessToken(): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  const token = data.session?.access_token
  if (!token) throw new Error('Sign in is required.')
  return token
}

export async function adminFetch<T>(action: string, body?: Record<string, unknown>): Promise<T> {
  const token = await accessToken()
  const response = await fetch(endpoint(action), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, ...(body ?? {}) }),
  })
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`)
  return payload
}

/* ------------------------------------------------------------------ */
/* Access                                                              */
/* ------------------------------------------------------------------ */

/** One-shot access check used by the page to decide access. */
export function getAdminGate(): Promise<AdminGate> {
  return adminFetch<AdminGate>('gate')
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

export function getAdminMetrics(): Promise<AdminMetrics> {
  return adminFetch<AdminMetrics>('metrics')
}

export function getAdminOverview(windowDays: 30 | 90 = 30): Promise<AdminOverview> {
  return adminFetch<AdminOverview>('overview', { windowDays })
}

export function getAdminUsers(query: AdminUserQuery = {}): Promise<AdminUsersPage> {
  return adminFetch<AdminUsersPage>('users', { ...query })
}

export function getAdminUser(userId: string): Promise<{ user: AdminUserDetail }> {
  return adminFetch<{ user: AdminUserDetail }>('user', { userId })
}

export function getAdminAnalytics(): Promise<AdminAnalytics> {
  return adminFetch<AdminAnalytics>('analytics')
}

export function getAdminDirectoryExport(columns?: string[]): Promise<ExportResult> {
  return adminFetch<ExportResult>('directory', columns ? { columns } : {})
}

export function getRecipientCount(audience: 'all' | 'opted_in'): Promise<RecipientCount> {
  return adminFetch<RecipientCount>('recipients', { audience })
}

export function sendAnnouncement(
  title: string,
  message: string,
  audience: 'all' | 'opted_in',
  requestId: string,
): Promise<SendResult> {
  return adminFetch<SendResult>('send', { title, message, audience, requestId })
}

export function retryAnnouncementPush(announcementId: string): Promise<{ ok: true; announcementId: string; push: SendResult['push'] }> {
  return adminFetch<{ ok: true; announcementId: string; push: SendResult['push'] }>('push:retry', { announcementId })
}

export function getAdminHistory(): Promise<{ history: AnnouncementHistoryRow[] }> {
  return adminFetch<{ history: AnnouncementHistoryRow[] }>('history')
}

/**
 * Recalls a sent announcement.
 *
 * Server-authoritative: the Edge Function stamps every delivery row for this
 * announcement, so it disappears from recipients' inboxes on all devices at the
 * next sync. This call only asks for that to happen — it does not remove
 * anything locally, and it cannot affect any other notification.
 */
export function recallAnnouncement(announcementId: string): Promise<{ ok: true; announcementId: string; revokedRecipients: number; revokedAt: string }> {
  return adminFetch<{ ok: true; announcementId: string; revokedRecipients: number; revokedAt: string }>('recall', { announcementId })
}

export function getAuditLog(options: { limit?: number; search?: string } = {}): Promise<{ entries: AuditEntry[]; appendOnly: boolean }> {
  return adminFetch<{ entries: AuditEntry[]; appendOnly: boolean }>('audit', options)
}

/**
 * Appends an audit entry.
 *
 * The server whitelists the action names it accepts AND validates every detail
 * field, so this is not a general write channel: `detail` values that the
 * action does not declare are ignored server-side, and the actor identity is
 * always taken from the verified JWT rather than from these arguments.
 *
 * Callers treat auditing as best-effort so a log problem cannot fail the
 * operation the owner actually asked for — but the failure is still surfaced
 * to the caller, never converted into a false success.
 */
export function logAdminAction(
  actionName: string,
  target?: string | null,
  detail?: Record<string, string | number | boolean | string[]>,
): Promise<{ ok: true }> {
  return adminFetch<{ ok: true }>('audit:log', { actionName, target: target ?? null, detail })
}

export function getAdminHealth(): Promise<HealthReport> {
  return adminFetch<HealthReport>('health')
}

/* ------------------------------------------------------------------ */
/* Non-privileged (any signed-in user)                                 */
/* ------------------------------------------------------------------ */

/** Throttled activity heartbeat — callable by any signed-in user. */
export function heartbeat(): Promise<{ ok: true }> {
  return adminFetch<{ ok: true }>('heartbeat')
}

export interface AnnouncementFeedRow {
  id: string
  title: string
  body: string
  createdAt: string
  deliveredAt: string
  readAt: string | null
}

/** Signed-in user: their own received announcements. */
export function getAnnouncementFeed(): Promise<{ feed: AnnouncementFeedRow[] }> {
  return adminFetch<{ feed: AnnouncementFeedRow[] }>('feed')
}

/** Mark one of the user's own announcements as read. */
export function markAnnouncementRead(announcementId: string): Promise<{ ok: true }> {
  return adminFetch<{ ok: true }>('read', { announcementId })
}
