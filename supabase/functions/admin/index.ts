// Admin edge function: authentication, authorization, owner analytics,
// user directory, announcements and the append-only audit log.
//
// Secrets required (configure via `supabase secrets set`):
//   SUPABASE_SERVICE_ROLE_KEY (provided automatically by Supabase)
//   ADMIN_EMAILS: comma-separated allowlist, e.g. "owner@example.com"
//
// ───────────────────────────────────────────────────────────────────────────
// ACTIONS
//
// Authenticated non-admin:
//   gate       — lightweight allowlist answer (never reveals the allowlist)
//   heartbeat  — update own last_seen_at
//   feed       — own announcements
//   read       — mark own announcement read
//
// Owner only (verified JWT + server-side ADMIN_EMAILS, every request):
//   metrics       — the original KPI bundle (kept for compatibility)
//   users         — searchable/paginated registered users
//   user          — one account's detail
//   directory     — filtered/sorted export set (bounded)
//   send          — create announcement + delivery fan-out
//   recipients    — recipient count for an audience, resolved server-side
//   history       — sent announcements with delivery counts
//   analytics     — activity/registration aggregates the schema really records
//   audit         — append-only owner action log (list + append)
//   health        — live dependency diagnostics
//   audit:log     — append one owner action
//
// SECURITY MODEL (unchanged and non-negotiable)
//   - The Authorization bearer token is verified against the auth service on
//     EVERY request; no client-supplied identity is trusted.
//   - The allowlist lives only in the ADMIN_EMAILS secret. `admin_allowlist`
//     (a table) is NOT consulted for authorization: a table a signed-in user
//     could ever write to is not an authoritative source of privilege.
//   - CORS preflight is answered before authentication because browsers send
//     no Authorization header on OPTIONS. A successful preflight grants
//     nothing — it carries no data and bypasses no check.
//   - The service-role key exists only inside this function.
// ───────────────────────────────────────────────────────────────────────────
import { createClient, type User } from 'https://esm.sh/@supabase/supabase-js@2'

/** Minimal structural type for a delivery row returned by the feed query. */
interface DeliveryRow {
  announcement_id: string
  delivered_at: string
  read_at: string | null
}

/** Minimal structural type for announcement content rows. */
interface AnnouncementRow {
  id: string
  title: string
  body: string
  created_at: string
}



/** One authentication-directory account, normalised for the console. */
interface DirectoryUser {
  id: string
  email: string | null
  displayName: string
  createdAt: string
  lastSignInAt: string | null
  pushOptIn: boolean
}

/**
 * CORS headers for the admin function.
 *
 * The browser sends an OPTIONS preflight for every call to this function (it is
 * cross-origin, and the client attaches `authorization` + `apikey`). Browsers do
 * NOT include the Authorization header on a preflight, so a handler that checked
 * the bearer token first answered 403 to every preflight and the real POST was
 * never sent — which is why the admin tools never appeared after sign-in.
 *
 * `*` is safe here: authorization is enforced per request by verifying the JWT
 * and the server-side ADMIN_EMAILS allowlist, and `Vary` prevents any cache from
 * serving one account's response to another.
 */
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  // Explicit list: `*` is not honoured for these headers on a credentialed call.
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  Vary: 'authorization, apikey',
}

/**
 * Every response — success, 4xx and 5xx — carries CORS headers, so the browser
 * can read the body (including error text) instead of reporting an opaque
 * network failure.
 */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const deny = (msg: string) => json({ error: msg }, 403)

function allowlist(): string[] {
  const raw = Deno.env.get('ADMIN_EMAILS') ?? ''
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
}

function adminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )
}

function userClient(authHeader: string) {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  )
}

/**
 * Pages through the WHOLE auth directory.
 *
 * listUsers page N is the Nth slice of all users, so anything that has to see
 * every account (counts, search, exports, fan-out) must page rather than read
 * one slice. `maxPages` is a deliberate safety valve: it bounds the work a
 * single request can do so a privileged endpoint cannot become a long-running
 * query. When the bound is hit the caller is told, rather than being given a
 * silently truncated list.
 */
async function listAllUsers(
  admin: ReturnType<typeof adminClient>,
  maxPages = 20,
): Promise<{ users: User[]; truncated: boolean } | { error: string }> {
  const all: User[] = []
  for (let page = 1; page <= maxPages; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) return { error: error.message }
    const users = data?.users ?? []
    all.push(...users)
    if (users.length < 1000) return { users: all, truncated: false }
  }
  return { users: all, truncated: true }
}

function toDirectoryUser(u: User): DirectoryUser {
  return {
    id: u.id,
    email: u.email ?? null,
    displayName: String(u.user_metadata?.display_name ?? ''),
    createdAt: u.created_at,
    lastSignInAt: u.last_sign_in_at ?? null,
    pushOptIn: Boolean(u.user_metadata?.reminders_opt_in ?? false),
  }
}

/** Server-authoritative activity map: user_id → last_seen_at. */
async function activityMap(admin: ReturnType<typeof adminClient>): Promise<Map<string, string> | { error: string }> {
  const { data, error } = await admin.from('user_activity').select('user_id,last_seen_at')
  if (error) return { error: error.message }
  return new Map((data ?? []).map((row: { user_id: string; last_seen_at: string }) => [row.user_id, row.last_seen_at]))
}

/** Distinct users with either a browser subscription or an Android token. */
async function pushSubscriberIds(admin: ReturnType<typeof adminClient>): Promise<Set<string> | { error: string }> {
  const [web, android] = await Promise.all([
    admin.from('push_subscriptions').select('user_id'),
    admin.from('fcm_push_tokens').select('user_id'),
  ])
  if (web.error) return { error: web.error.message }
  if (android.error) return { error: android.error.message }
  return new Set([
    ...(web.data ?? []).map((row: { user_id: string }) => row.user_id),
    ...(android.data ?? []).map((row: { user_id: string }) => row.user_id),
  ])
}

interface WebPushSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

interface FcmServiceAccount {
  projectId: string
  clientEmail: string
  privateKey: string
}

interface PushOutcome {
  status: 'accepted' | 'failed' | 'expired'
  providerStatus: number | null
  errorCode: string | null
}

interface PushReport {
  status: 'not_configured' | 'no_subscriptions' | 'no_retryable_failures' | 'recalled' | 'sent' | 'partial' | 'failed' | 'recording_failed' | 'outcome_persistence_failed' | 'already_processed'
  attempted: number
  accepted: number
  failed: number
  expired: number
  remaining?: number
  error?: string
}

function validPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096) return false
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false
    const host = url.hostname.toLowerCase()
    return host === 'fcm.googleapis.com'
      || host.endsWith('.push.services.mozilla.com')
      || host === 'push.services.mozilla.com'
      || host === 'web.push.apple.com'
      || host.endsWith('.notify.windows.com')
  } catch {
    return false
  }
}

function validFcmToken(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 20
    && value.length <= 4096
    && !/[\u0000-\u0020\u007f]/.test(value)
}

function validDeviceId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

function parseWebPushSubscription(value: unknown): WebPushSubscription | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const keys = record.keys && typeof record.keys === 'object'
    ? record.keys as Record<string, unknown>
    : null
  if (!validPushEndpoint(record.endpoint)
    || !keys
    || typeof keys.p256dh !== 'string'
    || typeof keys.auth !== 'string'
    || !/^[A-Za-z0-9_-]+$/.test(keys.p256dh)
    || !/^[A-Za-z0-9_-]+$/.test(keys.auth)) return null
  return { endpoint: record.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }
}

async function subscriptionId(endpoint: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function pushConfiguration() {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
  const subject = Deno.env.get('VAPID_SUBJECT') ?? ''
  if (!publicKey || !privateKey || !subject) return null
  if (!subject.startsWith('mailto:') && !subject.startsWith('https://')) return null
  return { publicKey, privateKey, subject }
}

function fcmServiceAccount(): FcmServiceAccount | null {
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON') ?? ''
  if (!raw || raw.length > 32768) return null
  try {
    const account = JSON.parse(raw) as Record<string, unknown>
    if (account.project_id !== 'ulife-e4b04'
      || typeof account.client_email !== 'string'
      || !account.client_email.endsWith('.iam.gserviceaccount.com')
      || typeof account.private_key !== 'string'
      || !account.private_key.includes('-----BEGIN PRIVATE KEY-----')) return null
    return {
      projectId: account.project_id,
      clientEmail: account.client_email,
      privateKey: account.private_key,
    }
  } catch {
    return null
  }
}

function base64UrlEncode(value: string | Uint8Array): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function decodePrivateKey(value: string): Uint8Array<ArrayBuffer> {
  const body = value
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')
  const binary = atob(body)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

let cachedFcmAccessToken: { value: string; expiresAt: number; clientEmail: string } | null = null

async function fcmAccessToken(account: FcmServiceAccount): Promise<string> {
  if (cachedFcmAccessToken
    && cachedFcmAccessToken.clientEmail === account.clientEmail
    && cachedFcmAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedFcmAccessToken.value
  }

  const issuedAt = Math.floor(Date.now() / 1000)
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64UrlEncode(JSON.stringify({
    iss: account.clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: issuedAt,
    exp: issuedAt + 3600,
  }))
  const signingInput = `${header}.${claims}`
  const key = await crypto.subtle.importKey(
    'pkcs8',
    decodePrivateKey(account.privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  ))
  const assertion = `${signingInput}.${base64UrlEncode(signature)}`
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!response.ok) throw new Error('fcm_auth_failed')
  const result = await response.json() as { access_token?: unknown; expires_in?: unknown }
  if (typeof result.access_token !== 'string' || typeof result.expires_in !== 'number') {
    throw new Error('fcm_auth_failed')
  }
  cachedFcmAccessToken = {
    value: result.access_token,
    expiresAt: Date.now() + Math.max(0, result.expires_in - 60) * 1000,
    clientEmail: account.clientEmail,
  }
  return result.access_token
}

async function deliverFcmPush(
  token: string,
  payload: { title: string; body: string; url: string; announcementId: string },
  account: FcmServiceAccount,
): Promise<PushOutcome> {
  try {
    const accessToken = await fcmAccessToken(account)
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: payload.title, body: payload.body },
            data: { announcementId: payload.announcementId, url: payload.url },
          },
        }),
      },
    )
    if (response.ok) return { status: 'accepted', providerStatus: response.status, errorCode: null }

    const result = await response.json().catch(() => null) as {
      error?: { status?: unknown; details?: Array<{ errorCode?: unknown }> }
    } | null
    const providerCode = result?.error?.details?.find((detail) => typeof detail.errorCode === 'string')?.errorCode
    const errorCode = typeof providerCode === 'string' && /^[A-Z0-9_]+$/.test(providerCode)
      ? providerCode
      : 'provider_error'
    return {
      status: errorCode === 'UNREGISTERED' ? 'expired' : 'failed',
      providerStatus: response.status,
      errorCode,
    }
  } catch {
    return { status: 'failed', providerStatus: null, errorCode: 'fcm_transport_error' }
  }
}

async function deliverWebPush(
  subscription: WebPushSubscription,
  payload: { title: string; body: string; url: string; announcementId: string },
  config: { publicKey: string; privateKey: string; subject: string },
): Promise<PushOutcome> {
  try {
    const { default: webpush } = await import('npm:web-push@3.6.7')
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey)
    const response = await webpush.sendNotification(subscription, JSON.stringify(payload), {
      TTL: '86400',
      urgency: 'normal',
    })
    return { status: 'accepted', providerStatus: response.statusCode, errorCode: null }
  } catch (error) {
    const providerStatus = error && typeof error === 'object' && 'statusCode' in error
      && typeof error.statusCode === 'number' ? error.statusCode : null
    const errorCode = error && typeof error === 'object' && 'code' in error
      && typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : 'provider_error'
    return {
      status: providerStatus === 404 || providerStatus === 410 ? 'expired' : 'failed',
      providerStatus,
      errorCode,
    }
  }
}

async function persistPushSummary(
  admin: ReturnType<typeof adminClient>,
  announcementId: string,
  report: PushReport,
  resolvedFailures = 0,
): Promise<void> {
  const { error } = await admin.rpc('record_announcement_push_summary', {
    p_announcement_id: announcementId,
    p_status: report.status,
    p_attempted: report.attempted,
    p_accepted: report.accepted,
    p_failed: report.failed,
    p_expired: report.expired,
    p_resolved_failed: resolvedFailures,
  })
  if (error) {
    report.status = 'outcome_persistence_failed'
    report.error = safeDbError(error, 'push outcome summary')
  }
}

async function sendAnnouncementWebPush(
  admin: ReturnType<typeof adminClient>,
  announcementId: string,
  recipients: string[],
  title: string,
  body: string,
): Promise<PushReport> {
  const config = pushConfiguration()
  if (!config) return { status: 'not_configured', attempted: 0, accepted: 0, failed: 0, expired: 0 }
  if (!recipients.length) return { status: 'no_subscriptions', attempted: 0, accepted: 0, failed: 0, expired: 0 }

  const recipientSet = new Set(recipients)
  const { data, error } = await admin
    .from('push_subscriptions')
    .select('id,user_id,subscription')
    .in('user_id', recipients)
  if (error) {
    return {
      status: 'failed',
      attempted: 0,
      accepted: 0,
      failed: 0,
      expired: 0,
      error: safeDbError(error, 'push subscriptions'),
    }
  }
  const subscriptions = (data ?? []).filter((row: { user_id: string }) => recipientSet.has(row.user_id))
  if (!subscriptions.length) return { status: 'no_subscriptions', attempted: 0, accepted: 0, failed: 0, expired: 0 }

  const parsed = subscriptions.map((row: { id: string; user_id: string; subscription: unknown }) => ({
    id: row.id,
    userId: row.user_id,
    subscription: parseWebPushSubscription(row.subscription),
  }))
  const attemptedAt = new Date().toISOString()
  const { error: recordError } = await admin.from('announcement_push_deliveries').insert(
    parsed.map((entry) => ({
      announcement_id: announcementId,
      user_id: entry.userId,
      subscription_id: entry.id,
      provider: 'webpush',
      status: 'pending',
      attempt_count: 1,
      attempted_at: attemptedAt,
      updated_at: attemptedAt,
      error_code: entry.subscription ? null : 'invalid_subscription',
    })),
  )
  if (recordError) {
    return {
      status: 'recording_failed',
      attempted: 0,
      accepted: 0,
      failed: 0,
      expired: 0,
      error: safeDbError(recordError, 'push outcome'),
    }
  }

  const report: PushReport = { status: 'sent', attempted: 0, accepted: 0, failed: 0, expired: 0 }
  const payload = {
    title,
    body,
    url: `#/notifications?announcementId=${encodeURIComponent(announcementId)}`,
    announcementId,
  }
  for (let offset = 0; offset < parsed.length; offset += 10) {
    const batch = parsed.slice(offset, offset + 10)
    await Promise.all(batch.map(async (entry) => {
      const outcome = entry.subscription
        ? await deliverWebPush(entry.subscription, payload, config)
        : { status: 'failed' as const, providerStatus: null, errorCode: 'invalid_subscription' }
      report.attempted += entry.subscription ? 1 : 0
      if (outcome.status === 'accepted') report.accepted += 1
      else if (outcome.status === 'expired') report.expired += 1
      else report.failed += 1

      const updatedAt = new Date().toISOString()
      const { error: updateError } = await admin
        .from('announcement_push_deliveries')
        .update({
          status: outcome.status,
          provider_status: outcome.providerStatus,
          error_code: outcome.errorCode,
          attempted_at: updatedAt,
          accepted_at: outcome.status === 'accepted' ? updatedAt : null,
          updated_at: updatedAt,
        })
        .eq('announcement_id', announcementId)
        .eq('user_id', entry.userId)
        .eq('provider', 'webpush')
        .eq('subscription_id', entry.id)
      if (updateError) {
        report.status = 'outcome_persistence_failed'
        report.error = safeDbError(updateError, 'push outcome')
      }

      if (outcome.status === 'expired') {
        const { error: deleteError } = await admin.from('push_subscriptions')
          .delete()
          .eq('user_id', entry.userId)
          .eq('id', entry.id)
        if (deleteError) {
          report.status = 'outcome_persistence_failed'
          report.error = safeDbError(deleteError, 'expired subscription cleanup')
        }
      }
    }))
  }
  if (report.status !== 'outcome_persistence_failed' && report.failed + report.expired > 0) {
    report.status = report.accepted > 0 ? 'partial' : 'failed'
  }
  return report
}

async function sendAnnouncementFcm(
  admin: ReturnType<typeof adminClient>,
  announcementId: string,
  recipients: string[],
  title: string,
  body: string,
): Promise<PushReport> {
  const account = fcmServiceAccount()
  if (!account) return { status: 'not_configured', attempted: 0, accepted: 0, failed: 0, expired: 0 }
  if (!recipients.length) return { status: 'no_subscriptions', attempted: 0, accepted: 0, failed: 0, expired: 0 }

  const recipientSet = new Set(recipients)
  const { data, error } = await admin.from('fcm_push_tokens')
    .select('token_hash,user_id,token')
    .in('user_id', recipients)
  if (error) {
    return {
      status: 'failed',
      attempted: 0,
      accepted: 0,
      failed: 0,
      expired: 0,
      error: safeDbError(error, 'FCM registrations'),
    }
  }
  const tokens = (data ?? []).filter((row: { user_id: string }) => recipientSet.has(row.user_id))
  if (!tokens.length) return { status: 'no_subscriptions', attempted: 0, accepted: 0, failed: 0, expired: 0 }

  const attemptedAt = new Date().toISOString()
  const { error: recordError } = await admin.from('announcement_push_deliveries').insert(
    tokens.map((row: { token_hash: string; user_id: string }) => ({
      announcement_id: announcementId,
      user_id: row.user_id,
      subscription_id: row.token_hash,
      provider: 'fcm',
      status: 'pending',
      attempt_count: 1,
      attempted_at: attemptedAt,
      updated_at: attemptedAt,
    })),
  )
  if (recordError) {
    return {
      status: 'recording_failed',
      attempted: 0,
      accepted: 0,
      failed: 0,
      expired: 0,
      error: safeDbError(recordError, 'push outcome'),
    }
  }

  const report: PushReport = { status: 'sent', attempted: 0, accepted: 0, failed: 0, expired: 0 }
  const payload = {
    title,
    body,
    url: `#/notifications?announcementId=${encodeURIComponent(announcementId)}`,
    announcementId,
  }
  for (let offset = 0; offset < tokens.length; offset += 10) {
    await Promise.all(tokens.slice(offset, offset + 10).map(async (row: {
      token_hash: string
      user_id: string
      token: string
    }) => {
      report.attempted += 1
      const outcome = await deliverFcmPush(row.token, payload, account)
      if (outcome.status === 'accepted') report.accepted += 1
      else if (outcome.status === 'expired') report.expired += 1
      else report.failed += 1

      const updatedAt = new Date().toISOString()
      const { error: updateError } = await admin.from('announcement_push_deliveries')
        .update({
          status: outcome.status,
          provider_status: outcome.providerStatus,
          error_code: outcome.errorCode,
          attempted_at: updatedAt,
          accepted_at: outcome.status === 'accepted' ? updatedAt : null,
          updated_at: updatedAt,
        })
        .eq('announcement_id', announcementId)
        .eq('user_id', row.user_id)
        .eq('provider', 'fcm')
        .eq('subscription_id', row.token_hash)
      if (updateError) {
        report.status = 'outcome_persistence_failed'
        report.error = safeDbError(updateError, 'push outcome')
      }

      if (outcome.status === 'expired') {
        const { error: deleteError } = await admin.from('fcm_push_tokens')
          .delete()
          .eq('user_id', row.user_id)
          .eq('token_hash', row.token_hash)
        if (deleteError) {
          report.status = 'outcome_persistence_failed'
          report.error = safeDbError(deleteError, 'expired FCM token cleanup')
        }
      }
    }))
  }
  if (report.status !== 'outcome_persistence_failed' && report.failed + report.expired > 0) {
    report.status = report.accepted > 0 ? 'partial' : 'failed'
  }
  return report
}

function combinePushReports(reports: PushReport[]): PushReport {
  const attempted = reports.reduce((sum, report) => sum + report.attempted, 0)
  const accepted = reports.reduce((sum, report) => sum + report.accepted, 0)
  const failed = reports.reduce((sum, report) => sum + report.failed, 0)
  const expired = reports.reduce((sum, report) => sum + report.expired, 0)
  const errors = [...new Set(reports.map((report) => report.error).filter((error): error is string => Boolean(error)))]
  let status: PushReport['status']

  if (reports.some((report) => report.status === 'outcome_persistence_failed')) {
    status = 'outcome_persistence_failed'
  } else if (reports.some((report) => report.status === 'recording_failed')) {
    status = 'recording_failed'
  } else if (failed + expired > 0) {
    status = accepted > 0 ? 'partial' : 'failed'
  } else if (attempted > 0) {
    status = 'sent'
  } else if (reports.some((report) => report.status === 'failed')) {
    status = 'failed'
  } else if (reports.some((report) => report.status === 'not_configured')) {
    status = 'not_configured'
  } else {
    status = 'no_subscriptions'
  }

  return {
    status,
    attempted,
    accepted,
    failed,
    expired,
    ...(errors.length ? { error: errors.join(' ') } : {}),
  }
}

async function sendAnnouncementPush(
  admin: ReturnType<typeof adminClient>,
  announcementId: string,
  recipients: string[],
  title: string,
  body: string,
): Promise<PushReport> {
  const reports = await Promise.all([
    sendAnnouncementWebPush(admin, announcementId, recipients, title, body),
    sendAnnouncementFcm(admin, announcementId, recipients, title, body),
  ])
  return combinePushReports(reports)
}

async function retryAnnouncementPush(
  admin: ReturnType<typeof adminClient>,
  announcementId: string,
): Promise<PushReport> {
  const webPushConfig = pushConfiguration()
  const fcmConfig = fcmServiceAccount()
  if (!webPushConfig && !fcmConfig) return { status: 'not_configured', attempted: 0, accepted: 0, failed: 0, expired: 0 }

  const { data: announcement, error: announcementError } = await admin.from('announcements')
    .select('id,title,body,revoked_at')
    .eq('id', announcementId)
    .maybeSingle()
  if (announcementError) {
    return {
      status: 'failed',
      attempted: 0,
      accepted: 0,
      failed: 0,
      expired: 0,
      error: safeDbError(announcementError, 'announcement'),
    }
  }
  if (!announcement) {
    return { status: 'failed', attempted: 0, accepted: 0, failed: 0, expired: 0, error: 'Announcement not found.' }
  }
  if (announcement.revoked_at) {
    return { status: 'recalled', attempted: 0, accepted: 0, failed: 0, expired: 0 }
  }

  const MAX_ATTEMPTS = 5
  const { data: failures, count, error: failuresError } = await admin.from('announcement_push_deliveries')
    .select('user_id,subscription_id,attempt_count,provider', { count: 'exact' })
    .eq('announcement_id', announcementId)
    .eq('status', 'failed')
    .lt('attempt_count', MAX_ATTEMPTS)
    .limit(100)
  if (failuresError) {
    return {
      status: 'failed',
      attempted: 0,
      accepted: 0,
      failed: 0,
      expired: 0,
      error: safeDbError(failuresError, 'push outcome'),
    }
  }
  const retryable = (failures ?? []).filter((row: { provider: string }) =>
    (row.provider === 'webpush' && webPushConfig) || (row.provider === 'fcm' && fcmConfig),
  )
  if (!retryable.length && failures?.length) {
    return { status: 'not_configured', attempted: 0, accepted: 0, failed: 0, expired: 0, remaining: count ?? failures.length }
  }
  if (!retryable.length) {
    return { status: 'no_retryable_failures', attempted: 0, accepted: 0, failed: 0, expired: 0, remaining: 0 }
  }

  const report: PushReport = { status: 'sent', attempted: 0, accepted: 0, failed: 0, expired: 0, remaining: count ?? retryable.length }
  let claimedCount = 0
  const now = new Date().toISOString()
  for (const row of retryable as { user_id: string; subscription_id: string; attempt_count: number; provider: 'webpush' | 'fcm' }[]) {
    const { data: claimed, error: claimError } = await admin.from('announcement_push_deliveries')
      .update({ status: 'pending', attempt_count: row.attempt_count + 1, attempted_at: now, updated_at: now })
      .eq('announcement_id', announcementId)
      .eq('user_id', row.user_id)
      .eq('provider', row.provider)
      .eq('subscription_id', row.subscription_id)
      .eq('status', 'failed')
      .lt('attempt_count', MAX_ATTEMPTS)
      .select('user_id,subscription_id')
      .maybeSingle()
    if (claimError) {
      report.status = 'recording_failed'
      report.error = safeDbError(claimError, 'push retry claim')
      continue
    }
    if (!claimed) continue
    claimedCount += 1

    let outcome: PushOutcome
    let savedRegistration = false
    if (row.provider === 'webpush') {
      const { data: saved, error: subscriptionError } = await admin.from('push_subscriptions')
        .select('id,user_id,subscription')
        .eq('user_id', row.user_id)
        .eq('id', row.subscription_id)
        .maybeSingle()
      if (subscriptionError) {
        outcome = { status: 'failed', providerStatus: null, errorCode: 'subscription_lookup_failed' }
      } else if (!saved) {
        outcome = { status: 'expired', providerStatus: null, errorCode: 'subscription_removed' }
      } else {
        savedRegistration = true
        const subscription = parseWebPushSubscription(saved.subscription)
        if (!subscription) {
          outcome = { status: 'failed', providerStatus: null, errorCode: 'invalid_subscription' }
        } else {
          report.attempted += 1
          outcome = await deliverWebPush(subscription, {
            title: announcement.title,
            body: announcement.body,
            url: `#/notifications?announcementId=${encodeURIComponent(announcementId)}`,
            announcementId,
          }, webPushConfig as NonNullable<typeof webPushConfig>)
        }
      }
    } else {
      const { data: saved, error: tokenError } = await admin.from('fcm_push_tokens')
        .select('token_hash,user_id,token')
        .eq('user_id', row.user_id)
        .eq('token_hash', row.subscription_id)
        .maybeSingle()
      if (tokenError) {
        outcome = { status: 'failed', providerStatus: null, errorCode: 'token_lookup_failed' }
      } else if (!saved) {
        outcome = { status: 'expired', providerStatus: null, errorCode: 'token_removed' }
      } else {
        savedRegistration = true
        report.attempted += 1
        outcome = await deliverFcmPush(saved.token, {
          title: announcement.title,
          body: announcement.body,
          url: `#/notifications?announcementId=${encodeURIComponent(announcementId)}`,
          announcementId,
        }, fcmConfig as FcmServiceAccount)
      }
    }

    if (outcome.status === 'accepted') report.accepted += 1
    else if (outcome.status === 'expired') report.expired += 1
    else report.failed += 1

    const updatedAt = new Date().toISOString()
    const { error: updateError } = await admin.from('announcement_push_deliveries')
      .update({
        status: outcome.status,
        provider_status: outcome.providerStatus,
        error_code: outcome.errorCode,
        updated_at: updatedAt,
        accepted_at: outcome.status === 'accepted' ? updatedAt : null,
      })
      .eq('announcement_id', announcementId)
      .eq('user_id', row.user_id)
      .eq('provider', row.provider)
      .eq('subscription_id', row.subscription_id)
    if (updateError) {
      report.status = 'outcome_persistence_failed'
      report.error = safeDbError(updateError, 'push outcome')
    }
    if (outcome.status === 'expired' && savedRegistration) {
      const table = row.provider === 'webpush' ? 'push_subscriptions' : 'fcm_push_tokens'
      const key = row.provider === 'webpush' ? 'id' : 'token_hash'
      const { error: deleteError } = await admin.from(table)
        .delete()
        .eq('user_id', row.user_id)
        .eq(key, row.subscription_id)
      if (deleteError) {
        report.status = 'outcome_persistence_failed'
        report.error = safeDbError(deleteError, 'expired push registration cleanup')
      }
    }
  }

  if (claimedCount === 0 && report.status === 'sent') {
    return { status: 'no_retryable_failures', attempted: 0, accepted: 0, failed: 0, expired: 0, remaining: count ?? 0 }
  }

  if (report.status !== 'outcome_persistence_failed' && report.status !== 'recording_failed') {
    if (report.failed + report.expired > 0) report.status = report.accepted > 0 ? 'partial' : 'failed'
  }
  const { count: remaining } = await admin.from('announcement_push_deliveries')
    .select('*', { count: 'exact', head: true })
    .eq('announcement_id', announcementId)
    .eq('status', 'failed')
    .lt('attempt_count', MAX_ATTEMPTS)
  report.remaining = remaining ?? 0
  if (report.remaining > 0 && report.status === 'sent') report.status = 'partial'
  await persistPushSummary(admin, announcementId, report, claimedCount)
  return report
}

/** Type guard for the `{ error: string }` shape the helpers return on failure. */
function isFailure<T extends object>(value: T | { error: string }): value is { error: string } {
  return 'error' in value
}

const ACRONYMS: Record<string, string> = {
  tls: 'TLS', jwt: 'JWT', rls: 'RLS', cors: 'CORS', utc: 'UTC', id: 'ID', api: 'API', csv: 'CSV', kpi: 'KPI', url: 'URL',
}

/** Builds a CSV cell that cannot break out of its quoted field. */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  // Guard against spreadsheet formula injection: a leading = + - @ makes a
  // spreadsheet treat the cell as a formula.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

/** Human label for an audit action key ("announcement_send" → "Announcement send"). */
function humanAction(action: string): string {
  return action.split('_').map((part) => ACRONYMS[part] ?? (part.charAt(0).toUpperCase() + part.slice(1))).join(' ')
}

/* ------------------------------------------------------------------ */
/* Audit detail — CONSTRUCTED, never forwarded                        */
/* ------------------------------------------------------------------ */

/** Actions an owner may append. Anything else is rejected. */
const AUDIT_ACTIONS = ['app_open', 'user_export', 'recipients_preview', 'settings_update'] as const
type AuditAction = typeof AUDIT_ACTIONS[number]

/** Audit detail is a small, flat, typed record — never arbitrary JSON. */
type AuditDetail = Record<string, string | number | boolean | string[]>

/** Longest string kept in any audit field; longer input is rejected, not cut. */
const AUDIT_MAX_STRING = 120
/** Longest array (e.g. exported column names) kept in an audit field. */
const AUDIT_MAX_ARRAY = 20

/** Integer in [min, max], or null when the input is not one. */
function boundedInt(value: unknown, min: number, max: number): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null
  return parsed >= min && parsed <= max ? parsed : null
}

/** Short, single-line string, or null. Control characters are refused. */
function boundedString(value: unknown, max = AUDIT_MAX_STRING): string | null {
  if (typeof value !== 'string') return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) return null
  return trimmed
}

/** Upper-case identifier such as a CSV column name, or null. */
function columnList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  if (value.length === 0 || value.length > AUDIT_MAX_ARRAY) return null
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(item)) return null
    out.push(item)
  }
  return out
}

/**
 * Builds the audit `detail` for one action from validated primitives only.
 *
 * CHANGED for security: the client's `detail` object used to be stored as-is
 * whenever it happened to be a JSON object. That let a caller place arbitrary
 * structure — and arbitrary length — into a table that is permanent and cannot
 * be deleted. Now the caller supplies named scalar fields, each is validated
 * against an allowlist of the shape the action actually needs, and anything
 * unrecognised is simply not written.
 *
 * Returns null when the action needs no detail, or when the supplied values are
 * absent — detail is optional, so a missing value is not an error. A value that
 * is PRESENT but invalid is likewise dropped rather than rejecting the whole
 * audit entry: losing an audit record is worse than losing one optional field.
 */
function buildAuditDetail(action: AuditAction, input: unknown): AuditDetail | null {
  const source = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>
  const detail: AuditDetail = {}

  switch (action) {
    case 'app_open': {
      // Viewport width only — a coarse device-class signal, no device identity.
      const width = boundedInt(source.viewport, 200, 20000)
      if (width !== null) detail.viewport = width
      break
    }
    case 'user_export': {
      const exported = boundedInt(source.exported, 0, 100000)
      const total = boundedInt(source.total, 0, 10000000)
      const columns = columnList(source.columns)
      if (exported !== null) detail.exported = exported
      if (total !== null) detail.total = total
      if (columns) detail.columns = columns
      break
    }
    case 'recipients_preview': {
      if (source.audience === 'all' || source.audience === 'opted_in') detail.audience = source.audience
      const count = boundedInt(source.count, 0, 10000000)
      if (count !== null) detail.count = count
      break
    }
    case 'settings_update': {
      const key = boundedString(source.key, 40)
      if (key && /^[a-z][A-Za-z]{0,39}$/.test(key)) detail.key = key
      // Only primitives are recorded; an object/array value is never persisted.
      const value = source.value
      if (typeof value === 'boolean' || typeof value === 'number') detail.value = value
      else if (typeof value === 'string' && value.length <= 40) detail.value = value
      break
    }
  }

  return Object.keys(detail).length > 0 ? detail : null
}

/**
 * Maps a database error to a client-facing message.
 *
 * PostgREST messages can name tables, columns and constraints. Owners are
 * trusted for DATA, but an error string is not data and there is no reason to
 * hand them schema internals — so known classes are translated and the raw
 * message is kept server-side for diagnostics.
 */
function safeDbError(error: { message?: string; code?: string } | null | undefined, context: string): string {
  const raw = error?.message ?? 'unknown database error'
  console.error(`[admin] ${context} failed: ${raw}`)
  if (/does not exist/i.test(raw)) return 'A required database table is missing. Apply pending migrations.'
  if (/permission denied|42501/i.test(`${error?.code ?? ''} ${raw}`)) return 'The server is not permitted to complete this operation.'
  if (/duplicate key|unique/i.test(raw)) return 'That record already exists.'
  return `The ${context} request could not be completed.`
}

Deno.serve(async (req) => {
  // CORS preflight MUST be answered before any authentication. A preflight
  // carries no Authorization header, so authenticating first rejects it.
  // Answering it grants nothing: no data is read and no check is skipped for
  // the real request that follows.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return deny('Missing bearer token.')
  const { data: userData, error: userErr } = await userClient(authHeader).auth.getUser()
  if (userErr || !userData?.user) return deny('Unauthenticated.')
  const user = userData.user
  // Trim AND lower-case both sides. A Google account can carry mixed case, and
  // a pasted allow-list entry can carry a trailing space that is invisible in
  // the dashboard; without trimming, an authorised owner is silently denied.
  // `allowlist()` applies the same normalisation to ADMIN_EMAILS.
  const email = (user.email ?? '').trim().toLowerCase()

  const body = await req.json().catch(() => ({}))
  const action = (body as { action?: string }).action

  if (action === 'gate') {
    // Lightweight access check: never reveals the allowlist, only whether the
    // signed-in email is on it. Metrics are fetched separately so an
    // unauthorized visitor gets no data at all.
    const admins = allowlist()
    if (admins.length === 0) return json({ isAdmin: false, email, error: 'not_configured' })
    return json({ isAdmin: admins.includes(email), email })
  }

  if (action === 'heartbeat') {
    // Throttled activity tracking; user may only update their own row.
    const { error } = await adminClient()
      .from('user_activity')
      .upsert({ user_id: user.id, last_seen_at: new Date().toISOString() })
    if (error) return json({ error: safeDbError(error, 'admin data') }, 500)
    return json({ ok: true })
  }

  if (action === 'feed') {
    // Recipient feed: two-step server-side join.
    //
    // Step 1 (user client, RLS-scoped): fetch the caller's own delivery rows
    // only — the RLS policy `auth.uid() = user_id` makes client-supplied IDs
    // irrelevant here.
    //
    // Step 2 (service role): fetch announcement content for exactly those
    // delivery ids. This avoids relying on a cross-table RLS join, since
    // `announcements` intentionally has no client-facing SELECT policy (a
    // grant alone does not bypass RLS).
    const { data: deliveries, error: delErr } = await userClient(authHeader)
      .from('announcement_delivery')
      .select('announcement_id,delivered_at,read_at')
      .eq('user_id', user.id)
      // Recalled announcements disappear from the recipient's feed. Applied
      // server-side so no client can resurrect one by skipping a local check.
      .is('revoked_at', null)
      .order('delivered_at', { ascending: false })
      .limit(50)
    if (delErr) return json({ error: safeDbError(delErr, 'announcement feed') }, 500)
    const ids = (deliveries ?? []).map((d) => d.announcement_id)
    if (ids.length === 0) return json({ feed: [] })
    const { data: anns, error: annErr } = await adminClient()
      .from('announcements')
      .select('id,title,body,created_at')
      .in('id', ids)
    if (annErr) return json({ error: safeDbError(annErr, 'admin data') }, 500)
    // Keep the key/value types explicit. Without the tuple assertion, TypeScript
    // can infer `(string | AnnouncementRow)[]` instead of a Map entry tuple,
    // making `byId.get()` return an unusable/unknown value in the feed mapper.
    const byId = new Map<string, AnnouncementRow>(
      (anns ?? []).map((a): [string, AnnouncementRow] => [a.id, a as AnnouncementRow]),
    )
    const feed = (deliveries ?? []).flatMap((d: DeliveryRow) => {
      const ann: AnnouncementRow | undefined = byId.get(d.announcement_id)
      if (!ann) return [] // announcement deleted — skip instead of showing an empty row
      return [{
        id: ann.id,
        title: ann.title,
        body: ann.body,
        createdAt: ann.created_at,
        deliveredAt: d.delivered_at,
        readAt: d.read_at,
      }]
    })
    return json({ feed })
  }

  if (action === 'read') {
    // Mark one of the user's own delivery rows as read. Only own rows are
    // updatable (RLS enforces user_id = auth.uid()).
    const announcementId = String((body as { announcementId?: string }).announcementId ?? '')
    if (!announcementId) return json({ error: 'announcementId is required.' }, 400)
    const { error } = await userClient(authHeader)
      .from('announcement_delivery')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('announcement_id', announcementId)
      .is('read_at', null)
    if (error) return json({ error: safeDbError(error, 'admin data') }, 500)
    return json({ ok: true })
  }

  if (action === 'push:register') {
    if (!pushConfiguration()) return json({ error: 'Browser push is not configured on the server.' }, 503)
    const subscription = parseWebPushSubscription((body as { subscription?: unknown }).subscription)
    if (!subscription) return json({ error: 'A valid browser push subscription is required.' }, 400)
    const admin = adminClient()
    const id = await subscriptionId(subscription.endpoint)

    // An endpoint belongs to the currently authenticated account in this
    // browser. Removing any prior owner prevents a shared device from sending
    // a later account's notifications to the previous account's session.
    const { error: previousOwnerError } = await admin.from('push_subscriptions')
      .delete()
      .eq('endpoint', subscription.endpoint)
      .neq('user_id', user.id)
    if (previousOwnerError) return json({ error: safeDbError(previousOwnerError, 'push subscription') }, 500)

    const { error } = await admin.from('push_subscriptions').upsert({
      id,
      user_id: user.id,
      endpoint: subscription.endpoint,
      subscription,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,endpoint' })
    if (error) return json({ error: safeDbError(error, 'push subscription') }, 500)
    return json({ ok: true })
  }

  if (action === 'push:status') {
    const endpoint = (body as { endpoint?: unknown }).endpoint
    if (endpoint !== undefined && !validPushEndpoint(endpoint)) {
      return json({ error: 'A valid browser push endpoint is required.' }, 400)
    }
    let subscribed = false
    if (typeof endpoint === 'string') {
      const { data, error } = await adminClient().from('push_subscriptions')
        .select('id')
        .eq('user_id', user.id)
        .eq('endpoint', endpoint)
        .maybeSingle()
      if (error) return json({ error: safeDbError(error, 'push subscription') }, 500)
      subscribed = Boolean(data)
    }
    return json({ configured: Boolean(pushConfiguration()), subscribed })
  }

  if (action === 'push:delete') {
    const endpoint = (body as { endpoint?: unknown }).endpoint
    if (!validPushEndpoint(endpoint)) return json({ error: 'A valid browser push endpoint is required.' }, 400)
    const { error } = await adminClient().from('push_subscriptions')
      .delete()
      .eq('user_id', user.id)
      .eq('endpoint', endpoint)
    if (error) return json({ error: safeDbError(error, 'push subscription') }, 500)
    return json({ ok: true })
  }

  if (action === 'fcm:register') {
    const registration = body as { token?: unknown; deviceId?: unknown }
    if (!validFcmToken(registration.token) || !validDeviceId(registration.deviceId)) {
      return json({ error: 'A valid Android push token and device ID are required.' }, 400)
    }
    const admin = adminClient()
    const tokenHash = await subscriptionId(registration.token)
    const { error: removePreviousOwnerError } = await admin.from('fcm_push_tokens')
      .delete()
      .eq('token_hash', tokenHash)
    if (removePreviousOwnerError) return json({ error: safeDbError(removePreviousOwnerError, 'FCM registration') }, 500)

    const { error } = await admin.from('fcm_push_tokens').upsert({
      token_hash: tokenHash,
      user_id: user.id,
      device_id: registration.deviceId,
      token: registration.token,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,device_id' })
    if (error) return json({ error: safeDbError(error, 'FCM registration') }, 500)
    return json({ ok: true, configured: Boolean(fcmServiceAccount()) })
  }

  if (action === 'fcm:status') {
    const deviceId = (body as { deviceId?: unknown }).deviceId
    if (!validDeviceId(deviceId)) return json({ error: 'A valid device ID is required.' }, 400)
    const { data, error } = await adminClient().from('fcm_push_tokens')
      .select('token_hash')
      .eq('user_id', user.id)
      .eq('device_id', deviceId)
      .maybeSingle()
    if (error) return json({ error: safeDbError(error, 'FCM registration') }, 500)
    return json({ configured: Boolean(fcmServiceAccount()), registered: Boolean(data) })
  }

  if (action === 'fcm:delete') {
    const deviceId = (body as { deviceId?: unknown }).deviceId
    if (!validDeviceId(deviceId)) return json({ error: 'A valid device ID is required.' }, 400)
    const { error } = await adminClient().from('fcm_push_tokens')
      .delete()
      .eq('user_id', user.id)
      .eq('device_id', deviceId)
    if (error) return json({ error: safeDbError(error, 'FCM registration') }, 500)
    return json({ ok: true })
  }

  // ────────────────────────────────────────────────────────────────────
  // Everything below requires the admin allowlist (server-side only).
  // ────────────────────────────────────────────────────────────────────
  const admins = allowlist()
  if (admins.length === 0) return deny('Admin allowlist is not configured. Access denied.')
  if (!email || !admins.includes(email)) return deny('Not an authorized admin.')
  const admin = adminClient()

  /* ---------------------------------------------------------------- */
  /* Legacy KPI bundle (kept so an older client cannot break)          */
  /* ---------------------------------------------------------------- */

  if (action === 'metrics') {
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString()
    const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString()
    const [act7, act30, subscribers] = await Promise.all([
      admin.from('user_activity').select('*', { count: 'exact', head: true }).gte('last_seen_at', weekAgo),
      admin.from('user_activity').select('*', { count: 'exact', head: true }).gte('last_seen_at', monthAgo),
      pushSubscriberIds(admin),
    ])
    // Surface query failures instead of silently reporting zero counts.
    for (const result of [act7, act30]) {
      if (result.error) return json({ error: safeDbError(result.error, 'admin data') }, 500)
    }
    if (isFailure(subscribers)) return json({ error: safeDbError({ message: subscribers.error }, 'admin data') }, 500)
    const active7 = act7.count ?? 0
    const active30 = act30.count ?? 0
    const pushOptIns = subscribers.size
    // Registered-user counts come from the auth system (server-side only).
    const listed = await listAllUsers(admin, 40)
    if (isFailure(listed)) return json({ error: safeDbError({ message: listed.error }, 'metrics') }, 500)
    let totalRegistered = 0
    let newUsers7d = 0
    let newUsers30d = 0
    const weekCutoff = new Date(Date.now() - 7 * 864e5).toISOString()
    const monthCutoff = new Date(Date.now() - 30 * 864e5).toISOString()
    for (const u of listed.users) {
      totalRegistered++
      if (u.created_at >= weekCutoff) newUsers7d++
      if (u.created_at >= monthCutoff) newUsers30d++
    }
    return json({ totalRegistered, newUsers7d, newUsers30d, active7, active30, pushOptIns })
  }

  /* ---------------------------------------------------------------- */
  /* Overview: one request, one timeline, honest coverage figures      */
  /* ---------------------------------------------------------------- */

  if (action === 'overview') {
    const now = Date.now()
    const weekAgo = new Date(now - 7 * 864e5).toISOString()
    const monthAgo = new Date(now - 30 * 864e5).toISOString()
    const windowStart = (body as { windowDays?: number }).windowDays === 90 ? 90 : 30

    const listed = await listAllUsers(admin, 40)
    if (isFailure(listed)) return json({ error: safeDbError({ message: listed.error }, 'admin data') }, 500)

    const activity = await activityMap(admin)
    if (isFailure(activity)) return json({ error: activity.error }, 500)

    const subscribers = await pushSubscriberIds(admin)
    if (isFailure(subscribers)) return json({ error: subscribers.error }, 500)

    const [annCount, deliveryCount, deliveryOpen] = await Promise.all([
      admin.from('announcements').select('*', { count: 'exact', head: true }),
      admin.from('announcement_delivery').select('*', { count: 'exact', head: true }),
      admin.from('announcement_delivery').select('*', { count: 'exact', head: true }).not('read_at', 'is', null),
    ])
    for (const result of [annCount, deliveryCount, deliveryOpen]) {
      if (result.error) return json({ error: safeDbError(result.error, 'admin data') }, 500)
    }

    const users = listed.users
    const newUsers7d = users.filter((u) => u.created_at >= weekAgo).length
    const newUsers30d = users.filter((u) => u.created_at >= monthAgo).length

    // Activity windows are computed against the heartbeat table, which is the
    // only activity source. An account that never sent a heartbeat is NOT
    // counted as inactive — it is counted as "never seen", so a rate is never
    // computed against a population that cannot report.
    let active7 = 0
    let active30 = 0
    let neverSeen = 0
    let inactive30 = 0
    let tracked = 0
    for (const u of users) {
      const seen = activity.get(u.id)
      if (!seen) { neverSeen++; continue }
      tracked++
      if (seen >= weekAgo) active7++
      if (seen >= monthAgo) active30++
      else inactive30++
    }

    // Registration timeline (all registrations, bucketed by UTC day).
    const days: { date: string; count: number }[] = []
    for (let offset = windowStart - 1; offset >= 0; offset--) {
      const day = new Date(now - offset * 864e5).toISOString().slice(0, 10)
      days.push({ date: day, count: 0 })
    }
    const dayIndex = new Map(days.map((d, index) => [d.date, index]))
    for (const u of users) {
      const index = dayIndex.get(u.created_at.slice(0, 10))
      if (index !== undefined) days[index].count++
    }

    const newest = [...users]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 5)
      .map((u) => ({
        id: u.id,
        email: u.email ?? null,
        displayName: String(u.user_metadata?.display_name ?? ''),
        createdAt: u.created_at,
        lastSeenAt: activity.get(u.id) ?? null,
        pushOptIn: Boolean(u.user_metadata?.reminders_opt_in ?? false),
      }))

    const deliveredRows = deliveryCount.count ?? 0
    const openedRows = deliveryOpen.count ?? 0

    return json({
      generatedAt: new Date(now).toISOString(),
      windowDays: windowStart,
      truncated: listed.truncated,
      totalRegistered: users.length,
      newUsers7d,
      newUsers30d,
      active7,
      active30,
      neverSeen,
      inactive30,
      trackedAccounts: tracked,
      pushOptIns: subscribers.size,
      // Denominators are stated so the client never invents a percentage
      // base: opt-in rate is over registered accounts, read rate over
      // delivered rows.
      announcementsSent: annCount.count ?? 0,
      deliveries: deliveredRows,
      deliveriesOpened: openedRows,
      registrations: days,
      recentUsers: newest,
    })
  }

  /* ---------------------------------------------------------------- */
  /* Users: server-side search, filter, sort, pagination              */
  /* ---------------------------------------------------------------- */

  if (action === 'users') {
    const payload = body as {
      page?: number
      perPage?: number
      search?: string
      activity?: 'any' | 'active7' | 'active30' | 'inactive30' | 'never'
      push?: 'any' | 'opted_in' | 'not_opted_in'
      sort?: 'newest' | 'oldest' | 'name' | 'last_seen'
    }
    const perPage = [10, 20, 50].includes(Number(payload.perPage)) ? Number(payload.perPage) : 20
    const requestedPage = Math.max(1, Math.floor(Number(payload.page ?? 1)))
    const search = String(payload.search ?? '').trim().toLowerCase()
    const activityFilter = payload.activity ?? 'any'
    const pushFilter = payload.push ?? 'any'
    const sort = payload.sort ?? 'newest'

    const listed = await listAllUsers(admin, 40)
    if (isFailure(listed)) return json({ error: safeDbError({ message: listed.error }, 'admin data') }, 500)
    const activity = await activityMap(admin)
    if (isFailure(activity)) return json({ error: activity.error }, 500)
    const subscribers = await pushSubscriberIds(admin)
    if (isFailure(subscribers)) return json({ error: subscribers.error }, 500)

    const now = Date.now()
    const weekAgo = new Date(now - 7 * 864e5).toISOString()
    const monthAgo = new Date(now - 30 * 864e5).toISOString()

    let rows = listed.users.map(toDirectoryUser).filter((row) => {
      if (search) {
        const haystackEmail = (row.email ?? '').toLowerCase()
        const haystackName = row.displayName.toLowerCase()
        if (!haystackEmail.includes(search) && !haystackName.includes(search)) return false
      }
      const seen = activity.get(row.id) ?? null
      // Push opt-in is the union of the auth metadata flag and a registered
      // subscription; either one means the account can receive a push.
      const canPush = row.pushOptIn || subscribers.has(row.id)
      if (pushFilter === 'opted_in' && !canPush) return false
      if (pushFilter === 'not_opted_in' && canPush) return false
      if (activityFilter === 'never' && seen) return false
      if (activityFilter === 'active7' && !(seen && seen >= weekAgo)) return false
      if (activityFilter === 'active30' && !(seen && seen >= monthAgo)) return false
      if (activityFilter === 'inactive30' && !(seen && seen < monthAgo)) return false
      return true
    })

    rows = rows.sort((a, b) => {
      if (sort === 'oldest') return a.createdAt < b.createdAt ? -1 : 1
      if (sort === 'name') return a.displayName.localeCompare(b.displayName)
      if (sort === 'last_seen') {
        const aSeen = activity.get(a.id) ?? ''
        const bSeen = activity.get(b.id) ?? ''
        return aSeen < bSeen ? 1 : -1
      }
      return a.createdAt < b.createdAt ? 1 : -1
    })

    const total = rows.length
    const start = (requestedPage - 1) * perPage
    const pageRows = rows.slice(start, start + perPage).map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      createdAt: row.createdAt,
      lastSeenAt: activity.get(row.id) ?? null,
      pushOptIn: row.pushOptIn || subscribers.has(row.id),
    }))

    return json({
      users: pageRows,
      page: requestedPage,
      perPage,
      total,
      hasMore: start + perPage < total,
      truncated: listed.truncated,
    })
  }

  if (action === 'user') {
    const userId = String((body as { userId?: string }).userId ?? '')
    if (!userId) return json({ error: 'userId is required.' }, 400)
    // Look the account up in the directory rather than guessing from a table:
    // the console must never fabricate a profile for an unknown id.
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (error || !data?.user) return json({ error: error?.message ?? 'Account not found.' }, 404)
    const u = data.user
    const { data: activityRow, error: activityError } = await admin
      .from('user_activity')
      .select('last_seen_at')
      .eq('user_id', userId)
      .maybeSingle()
    if (activityError) return json({ error: safeDbError(activityError, 'admin data') }, 500)
    const { count: subscriptionCount, error: subscriptionError } = await admin
      .from('push_subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
    if (subscriptionError) return json({ error: safeDbError(subscriptionError, 'admin data') }, 500)
    const { count: fcmDeviceCount, error: fcmDeviceError } = await admin
      .from('fcm_push_tokens')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
    if (fcmDeviceError) return json({ error: safeDbError(fcmDeviceError, 'admin data') }, 500)
    const { count: deliveredCount, error: deliveredError } = await admin
      .from('announcement_delivery')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
    if (deliveredError) return json({ error: safeDbError(deliveredError, 'admin data') }, 500)
    const { count: openedCount, error: openedError } = await admin
      .from('announcement_delivery')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .not('read_at', 'is', null)
    if (openedError) return json({ error: safeDbError(openedError, 'admin data') }, 500)

    return json({
      user: {
        id: u.id,
        email: u.email ?? null,
        displayName: String(u.user_metadata?.display_name ?? ''),
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
        // Only provider NAMES are exposed — never tokens or identities.
        providers: (u.app_metadata?.providers as string[] | undefined) ?? [],
        emailConfirmed: Boolean(u.email_confirmed_at),
        pushSubscriptions: (subscriptionCount ?? 0) + (fcmDeviceCount ?? 0),
        fcmDevices: fcmDeviceCount ?? 0,
        pushOptIn: Boolean(u.user_metadata?.reminders_opt_in ?? false),
        announcementsDelivered: deliveredCount ?? 0,
        announcementsOpened: openedCount ?? 0,
        lastSeenAt: (activityRow?.last_seen_at as string | undefined) ?? null,
      },
    })
  }

  if (action === 'directory' || action === 'export') {
    // Bounded export: the console asks for a column list and gets at most
    // MAX_EXPORT rows of exactly those columns. Tokens, private content and
    // user-authored text are never included.
    const MAX_EXPORT = 5000
    const ALLOWED_COLUMNS = ['id', 'email', 'displayName', 'createdAt', 'lastSeenAt', 'pushOptIn', 'status'] as const
    const requested = Array.isArray((body as { columns?: string[] }).columns)
      ? (body as { columns: string[] }).columns
      : [...ALLOWED_COLUMNS]
    const columns = requested.filter((c): c is typeof ALLOWED_COLUMNS[number] => (ALLOWED_COLUMNS as readonly string[]).includes(c))
    if (columns.length === 0) return json({ error: 'No valid columns requested.' }, 400)

    const listed = await listAllUsers(admin, 40)
    if (isFailure(listed)) return json({ error: safeDbError({ message: listed.error }, 'admin data') }, 500)
    const activity = await activityMap(admin)
    if (isFailure(activity)) return json({ error: activity.error }, 500)
    const subscribers = await pushSubscriberIds(admin)
    if (isFailure(subscribers)) return json({ error: subscribers.error }, 500)

    const all = listed.users.map((u) => {
      const row = toDirectoryUser(u)
      const lastSeenAt = activity.get(u.id) ?? null
      const pushOptIn = row.pushOptIn || subscribers.has(u.id)
      const status = !lastSeenAt ? 'never' : lastSeenAt >= new Date(Date.now() - 7 * 864e5).toISOString() ? 'active' : 'idle'
      return { id: row.id, email: row.email, displayName: row.displayName, createdAt: row.createdAt, lastSeenAt, pushOptIn, status }
    })
    const rows = all.slice(0, MAX_EXPORT).map((row) => {
      const cells: string[] = []
      for (const column of columns) {
        const value = column === 'pushOptIn' ? (row.pushOptIn ? 'yes' : 'no') : row[column]
        cells.push(csvCell(value))
      }
      return cells.join(',')
    })
    return json({
      columns,
      headers: columns.map((column) => (column === 'pushOptIn' ? 'push_opt_in' : column.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`))),
      rows,
      total: all.length,
      exported: rows.length,
      truncated: listed.truncated || all.length > MAX_EXPORT,
    })
  }

  /* ---------------------------------------------------------------- */
  /* Announcements                                                    */
  /* ---------------------------------------------------------------- */

  if (action === 'recipients') {
    const audience = (body as { audience?: string }).audience === 'opted_in' ? 'opted_in' : 'all'
    if (audience === 'opted_in') {
      const ids = await pushSubscriberIds(admin)
      if (isFailure(ids)) return json({ error: safeDbError({ message: ids.error }, 'recipients') }, 500)
      return json({ audience, count: ids.size })
    }
    const listed = await listAllUsers(admin, 40)
    if (isFailure(listed)) return json({ error: safeDbError({ message: listed.error }, 'admin data') }, 500)
    return json({ audience, count: listed.users.length, truncated: listed.truncated })
  }

  if (action === 'send') {
    const title = String((body as { title?: string }).title ?? '').trim()
    const message = String((body as { message?: string }).message ?? '').trim()
    const audience = (body as { audience?: string }).audience === 'opted_in' ? 'opted_in' : 'all'
    const rawRequestId = String((body as { requestId?: string }).requestId ?? '').trim()
    const requestId = rawRequestId || crypto.randomUUID()
    if (!title || !message) return json({ error: 'Title and message are required.' }, 400)
    // Server-side limits mirror the client's counters so a hand-crafted request
    // cannot bypass them.
    if (title.length > 120) return json({ error: 'The title is too long (120 characters maximum).' }, 400)
    if (message.length > 2000) return json({ error: 'The message is too long (2000 characters maximum).' }, 400)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      return json({ error: 'A valid requestId is required.' }, 400)
    }

    const duplicateResult = async (
      announcementId: string,
      savedPush: { push_status?: string | null; push_attempted?: number; push_accepted?: number; push_failed?: number; push_expired?: number },
    ) => {
      const { count, error: countError } = await admin.from('announcement_delivery')
        .select('*', { count: 'exact', head: true })
        .eq('announcement_id', announcementId)
      if (countError) return json({ error: safeDbError(countError, 'announcement delivery') }, 500)
      return json({
        ok: true,
        duplicate: true,
        announcementId,
        recipientCount: count ?? 0,
        push: {
          status: 'already_processed',
          originalStatus: savedPush.push_status ?? null,
          attempted: savedPush.push_attempted ?? 0,
          accepted: savedPush.push_accepted ?? 0,
          failed: savedPush.push_failed ?? 0,
          expired: savedPush.push_expired ?? 0,
        },
      })
    }

    const { data: existing, error: existingError } = await admin.from('announcements')
      .select('id,push_status,push_attempted,push_accepted,push_failed,push_expired')
      .eq('request_id', requestId)
      .maybeSingle()
    if (existingError) return json({ error: safeDbError(existingError, 'announcement idempotency') }, 500)
    if (existing) return await duplicateResult(existing.id, existing)

    // Resolve recipients server-side. opted_in requires a push subscription.
    let recipients: string[] = []
    if (audience === 'opted_in') {
      const ids = await pushSubscriberIds(admin)
      if (isFailure(ids)) return json({ error: safeDbError({ message: ids.error }, 'recipients') }, 500)
      recipients = [...ids]
    } else {
      // 'all' must include every registered account, not only users who have
      // sent a heartbeat. Page through the full auth directory server-side.
      const listed = await listAllUsers(admin, 40)
      if (isFailure(listed)) return json({ error: safeDbError({ message: listed.error }, 'recipient list') }, 500)
      recipients = listed.users.map((u: User) => u.id)
    }

    const { data: ann, error: annErr } = await admin.from('announcements')
      .insert({ title, body: message, audience, created_by: user.id, request_id: requestId })
      .select()
      .single()
    if (annErr) {
      if (annErr.code === '23505') {
        const { data: raced, error: raceError } = await admin.from('announcements')
            .select('id,push_status,push_attempted,push_accepted,push_failed,push_expired')
          .eq('request_id', requestId)
          .maybeSingle()
        if (raceError) return json({ error: safeDbError(raceError, 'announcement idempotency') }, 500)
          if (raced) return await duplicateResult(raced.id, raced)
      }
      return json({ error: safeDbError(annErr, 'announcement') }, 500)
    }
    if (recipients.length) {
      const { error: delErr } = await admin.from('announcement_delivery').insert(
        recipients.map((uid: string) => ({ announcement_id: ann.id, user_id: uid })),
      )
      if (delErr) return json({ error: safeDbError(delErr, 'announcement fan-out') }, 500)
    }
    let push: PushReport
    try {
      push = await sendAnnouncementPush(admin, ann.id, recipients, title, message)
    } catch (error) {
      push = {
        status: 'failed',
        attempted: 0,
        accepted: 0,
        failed: 0,
        expired: 0,
        error: safeDbError({ message: error instanceof Error ? error.message : 'Unknown push error' }, 'push delivery'),
      }
    }
    await persistPushSummary(admin, ann.id, push)
    // Recorded after the fact, best-effort: a failed audit insert must never
    // turn a successful send into a 500 the owner would then retry (sending
    // the announcement twice). `detail` is built from values this handler
    // already validated — audience is a fixed literal, the counts are integers
    // it computed, and the title was length-checked above before insertion.
    await admin.from('admin_audit_log').insert({
      actor_id: user.id,
      actor_email: email,
      action: 'announcement_send',
      target: ann.id,
      detail: {
        title: title.slice(0, AUDIT_MAX_STRING),
        audience,
        recipientCount: recipients.length,
        pushStatus: push.status,
        pushAttempted: push.attempted,
        pushAccepted: push.accepted,
        pushFailed: push.failed + push.expired,
      },
    })
    return json({ ok: true, announcementId: ann.id, recipientCount: recipients.length, push })
  }

  if (action === 'push:retry') {
    const announcementId = String((body as { announcementId?: string }).announcementId ?? '').trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(announcementId)) {
      return json({ error: 'A valid announcementId is required.' }, 400)
    }
    const push = await retryAnnouncementPush(admin, announcementId)
    return json({ ok: true, announcementId, push })
  }

  if (action === 'history') {
    const { data, error } = await admin
      .from('announcements')
      .select('id,title,body,audience,created_at,revoked_at,announcement_delivery(count),push_status,push_attempted,push_accepted,push_failed,push_expired')
      .order('created_at', { ascending: false }).limit(100)
    if (error) return json({ error: safeDbError(error, 'admin data') }, 500)
    const ids = (data ?? []).map((a: { id: string }) => a.id)
    // Read counts per announcement come from a second aggregate query so the
    // history shows real delivery outcomes rather than just the fan-out size.
    const openedByAnnouncement = new Map<string, number>()
    const deliveredByAnnouncement = new Map<string, number>()
    if (ids.length) {
      const { data: rows, error: rowsError } = await admin
        .from('announcement_delivery')
        .select('announcement_id,read_at')
        .in('announcement_id', ids)
      if (rowsError) return json({ error: safeDbError(rowsError, 'admin data') }, 500)
      for (const row of rows ?? []) {
        const id = (row as { announcement_id: string }).announcement_id
        deliveredByAnnouncement.set(id, (deliveredByAnnouncement.get(id) ?? 0) + 1)
        if ((row as { read_at: string | null }).read_at) {
          openedByAnnouncement.set(id, (openedByAnnouncement.get(id) ?? 0) + 1)
        }
      }
    }
    return json({
      history: (data ?? []).map((a: {
        id: string
        title: string
        body: string
        audience: string
        created_at: string
        revoked_at?: string | null
        announcement_delivery?: { count: number }[]
        push_status?: string | null
        push_attempted?: number
        push_accepted?: number
        push_failed?: number
        push_expired?: number
      }) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        audience: a.audience,
        createdAt: a.created_at,
        revokedAt: a.revoked_at ?? null,
        recipientCount: deliveredByAnnouncement.get(a.id) ?? a.announcement_delivery?.[0]?.count ?? 0,
        openedCount: openedByAnnouncement.get(a.id) ?? 0,
        pushStatus: a.push_status ?? null,
        pushAttempted: a.push_attempted ?? 0,
        pushAccepted: a.push_accepted ?? 0,
        pushFailed: a.push_failed ?? 0,
        pushExpired: a.push_expired ?? 0,
      })),
    })
  }

  /* ---------------------------------------------------------------- */
  /* Announcement recall                                             */
  /* ---------------------------------------------------------------- */

  if (action === 'recall') {
    // Owner-only (this runs below the allowlist gate). Recall is
    // SERVER-AUTHORITATIVE: it stamps `revoked_at` on every delivery row for the
    // announcement, so the next feed fetch — on any device, including one that
    // was offline — no longer returns it.
    const announcementId = String((body as { announcementId?: string }).announcementId ?? '').trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(announcementId)) {
      return json({ error: 'A valid announcementId is required.' }, 400)
    }
    const now = new Date().toISOString()

    // Stamp the announcement itself first: the admin history reads this, and an
    // announcement with no delivery rows yet still needs to be recalled.
    const { data: announcement, error: annError } = await admin
      .from('announcements')
      .update({ revoked_at: now })
      .eq('id', announcementId)
      .select('id')
      .maybeSingle()
    if (annError) return json({ error: safeDbError(annError, 'announcement recall') }, 500)
    if (!announcement) return json({ error: 'Announcement not found.' }, 404)

    // Stamp only THIS announcement's delivery rows. Scoping by announcement_id
    // is what guarantees no other notification is touched.
    const { data: revokedRows, error: deliveryError } = await admin
      .from('announcement_delivery')
      .update({ revoked_at: now })
      .eq('announcement_id', announcementId)
      .is('revoked_at', null)
      .select('user_id')
    if (deliveryError) return json({ error: safeDbError(deliveryError, 'announcement recall') }, 500)

    const revokedCount = (revokedRows ?? []).length
    // Best-effort audit: a failed log must not make a completed recall look
    // failed (the owner would retry against an already-recalled message).
    await admin.from('admin_audit_log').insert({
      actor_id: user.id,
      actor_email: email,
      action: 'announcement_recall',
      target: announcementId,
      detail: { revokedRecipients: revokedCount },
    })

    return json({ ok: true, announcementId, revokedRecipients: revokedCount, revokedAt: now })
  }

  /* ---------------------------------------------------------------- */
  /* Analytics                                                        */
  /* ---------------------------------------------------------------- */

  if (action === 'analytics') {
    const listed = await listAllUsers(admin, 40)
    if (isFailure(listed)) return json({ error: safeDbError({ message: listed.error }, 'admin data') }, 500)
    const users = listed.users

    // Heap-bounded distinct-day counting. The schema records only the LATEST
    // heartbeat per account, so per-day distinct activity cannot be
    // reconstructed retroactively — this reports what the table can support.
    const { data: activityRows, error: activityError } = await admin
      .from('user_activity')
      .select('user_id,last_seen_at')
    if (activityError) return json({ error: safeDbError(activityError, 'admin data') }, 500)

    const now = Date.now()
    const bucket = (days: number) => new Date(now - days * 864e5).toISOString()
    const active7 = (activityRows ?? []).filter((r: { last_seen_at: string }) => r.last_seen_at >= bucket(7)).length
    const active30 = (activityRows ?? []).filter((r: { last_seen_at: string }) => r.last_seen_at >= bucket(30)).length
    const heard = (activityRows ?? []).length

    const [annCount, deliveryCount, deliveryOpen] = await Promise.all([
      admin.from('announcements').select('*', { count: 'exact', head: true }),
      admin.from('announcement_delivery').select('*', { count: 'exact', head: true }),
      admin.from('announcement_delivery').select('*', { count: 'exact', head: true }).not('read_at', 'is', null),
    ])
    for (const result of [annCount, deliveryCount, deliveryOpen]) {
      if (result.error) return json({ error: safeDbError(result.error, 'admin data') }, 500)
    }

    // Heartbeat arrival spread: how recently each tracked account reported.
    const recencyBuckets = [
      { label: '24h', min: 1, max: 1 },
      { label: '7d', min: 1, max: 7 },
      { label: '30d', min: 1, max: 30 },
      { label: '90d', min: 1, max: 90 },
    ].map((b) => ({
      label: b.label,
      value: (activityRows ?? []).filter((r: { last_seen_at: string }) => {
        const age = (now - new Date(r.last_seen_at).getTime()) / 864e5
        return age >= b.min - 1e-9 && age <= b.max
      }).length,
    }))

    // Daily registration series over 30 days, from the auth directory.
    const days: { date: string; count: number }[] = []
    for (let offset = 29; offset >= 0; offset--) {
      days.push({ date: new Date(now - offset * 864e5).toISOString().slice(0, 10), count: 0 })
    }
    const dayIndex = new Map(days.map((d, i) => [d.date, i]))
    for (const u of users) {
      const index = dayIndex.get(u.created_at.slice(0, 10))
      if (index !== undefined) days[index].count++
    }

    return json({
      generatedAt: new Date(now).toISOString(),
      truncated: listed.truncated,
      registered: users.length,
      heard,
      active7,
      active30,
      recencyBuckets,
      registrations: days,
      announcementsSent: annCount.count ?? 0,
      deliveries: deliveryCount.count ?? 0,
      deliveriesOpened: deliveryOpen.count ?? 0,
    })
  }

  /* ---------------------------------------------------------------- */
  /* Audit log (append-only)                                          */
  /* ---------------------------------------------------------------- */

  if (action === 'audit') {
    const limit = Math.min(200, Math.max(1, Number((body as { limit?: number }).limit ?? 50)))
    const search = String((body as { search?: string }).search ?? '').trim().toLowerCase()
    const { data, error } = await admin
      .from('admin_audit_log')
      .select('id,actor_email,action,target,detail,created_at')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return json({ error: safeDbError(error, 'admin data') }, 500)
    const entries = (data ?? [])
      .map((row: { id: string; actor_email: string | null; action: string; target: string | null; detail: unknown; created_at: string }) => ({
        id: row.id,
        actorEmail: row.actor_email,
        action: row.action,
        actionLabel: humanAction(row.action),
        target: row.target,
        detail: row.detail,
        createdAt: row.created_at,
      }))
      .filter((row: { action: string; target: string | null }) => !search || row.action.toLowerCase().includes(search) || String(row.target ?? '').toLowerCase().includes(search))
    return json({ entries, appendOnly: true })
  }

  if (action === 'audit:log') {
    const auditAction = String((body as { actionName?: string }).actionName ?? '').trim()
    // A whitelist keeps the log meaningful and prevents a client from writing
    // arbitrary strings into an append-only table.
    if (!(AUDIT_ACTIONS as readonly string[]).includes(auditAction)) {
      return json({ error: 'Unknown audit action.' }, 400)
    }
    const boundedTarget = boundedString((body as { target?: string }).target, 200)
    // `detail` is CONSTRUCTED here from named, validated fields. The caller's
    // object is never forwarded: only the primitives this action declares can
    // reach the table, so an arbitrary payload cannot be persisted.
    const detail = buildAuditDetail(auditAction as AuditAction, (body as { detail?: unknown }).detail)
    const { error } = await admin.from('admin_audit_log').insert({
      actor_id: user.id,
      actor_email: email,
      action: auditAction,
      target: boundedTarget,
      detail,
    })
    if (error) return json({ error: safeDbError(error, 'audit') }, 500)
    return json({ ok: true })
  }

  /* ---------------------------------------------------------------- */
  /* Health                                                           */
  /* ---------------------------------------------------------------- */

  if (action === 'health') {
    const started = Date.now()
    const checks: { id: string; label: string; ok: boolean; detail: string | null }[] = []

    // The query builders are thenable but not real promises, so each check is
    // awaited before it is handed back — reporting a builder as "ok" would be
    // a fabricated green light.
    const record = async (id: string, label: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
      const checkStart = Date.now()
      try {
        const result = await run()
        checks.push({ id, label, ok: !result.error, detail: result.error?.message ?? null })
      } catch (error) {
        checks.push({ id, label, ok: false, detail: error instanceof Error ? error.message : 'Unknown error' })
      }
      return Date.now() - checkStart
    }

    await record('database', 'Announcements table', async () => ({ error: (await admin.from('announcements').select('*', { count: 'exact', head: true })).error }))
    await record('delivery', 'Delivery table', async () => ({ error: (await admin.from('announcement_delivery').select('*', { count: 'exact', head: true })).error }))
    await record('activity', 'Activity table', async () => ({ error: (await admin.from('user_activity').select('*', { count: 'exact', head: true })).error }))
    await record('push', 'Push subscriptions', async () => ({ error: (await admin.from('push_subscriptions').select('*', { count: 'exact', head: true })).error }))
    await record('fcm', 'Android FCM registrations', async () => ({ error: (await admin.from('fcm_push_tokens').select('*', { count: 'exact', head: true })).error }))
    await record('audit', 'Audit log', async () => ({ error: (await admin.from('admin_audit_log').select('*', { count: 'exact', head: true })).error }))
    await record('auth', 'Authentication directory', async () => {
      const { error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 })
      return { error: error ? { message: error.message } : null }
    })

    return json({
      checkedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      checks,
      // Runtime facts the server can verify about itself.
      runtime: {
        adminAllowlistConfigured: allowlist().length > 0,
        ownerEmail: email,
        serviceRoleConfigured: Boolean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')),
        anonKeyConfigured: Boolean(Deno.env.get('SUPABASE_ANON_KEY')),
        webPushConfigured: Boolean(pushConfiguration()),
        fcmConfigured: Boolean(fcmServiceAccount()),
      },
    })
  }

  return json({ error: 'Unknown action.' }, 400)
})
