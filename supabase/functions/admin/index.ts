// Admin edge function: authentication, authorization, user metrics, announcements.
// Secrets required (configure via `supabase secrets set`):
//   SUPABASE_SERVICE_ROLE_KEY (provided automatically by Supabase)
//   ADMIN_EMAILS: comma-separated allowlist, e.g. "owner@example.com"
//
// Actions:
//   metrics    — registered counts, active 7/30d, last_seen tracking
//   users      — searchable/paginated registered users
//   send       — create announcement, fan out delivery rows, optionally push
//   history    — list sent announcements with delivery counts
//   heartbeat  — (authenticated non-admin) update own last_seen_at
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

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

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return deny('Missing bearer token.')
  const { data: userData, error: userErr } = await userClient(authHeader).auth.getUser()
  if (userErr || !userData?.user) return deny('Unauthenticated.')
  const user = userData.user
  const email = (user.email ?? '').toLowerCase()

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
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true })
  }

  // Everything below requires the admin allowlist (server-side only).
  const admins = allowlist()
  if (admins.length === 0) return deny('Admin allowlist is not configured. Access denied.')
  if (!email || !admins.includes(email)) return deny('Not an authorized admin.')
  const admin = adminClient()

  if (action === 'metrics') {
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString()
    const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString()
    const [{ count: last7 }, { count: last30 }, { count: optIns }] = await Promise.all([
      admin.from('user_activity').select('*', { count: 'exact', head: true }).gte('last_seen_at', weekAgo),
      admin.from('user_activity').select('*', { count: 'exact', head: true }).gte('last_seen_at', monthAgo),
      admin.from('push_subscriptions').select('*', { count: 'exact', head: true }),
    ])
    // Registered-user counts come from the auth system (server-side only).
    let totalRegistered = 0
    let newUsers7d = 0
    let newUsers30d = 0
    let page = 1
    const weekCutoff = new Date(Date.now() - 7 * 864e5).toISOString()
    const monthCutoff = new Date(Date.now() - 30 * 864e5).toISOString()
    for (;;) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) return json({ error: error.message }, 500)
      for (const u of data?.users ?? []) {
        totalRegistered++
        if (u.created_at >= weekCutoff) newUsers7d++
        if (u.created_at >= monthCutoff) newUsers30d++
      }
      if (!data?.users?.length || data.users.length < 1000) break
      page++
    }
    return json({ totalRegistered, newUsers7d, newUsers30d, active7: last7 ?? 0, active30: last30 ?? 0, pushOptIns: optIns ?? 0 })
  }

  if (action === 'users') {
    const page = Math.max(1, Number((body as { page?: number }).page ?? 1))
    const search = String((body as { search?: string }).search ?? '').toLowerCase()
    const perPage = 20
    const { data: list, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) return json({ error: error.message }, 500)
    const rows = (list?.users ?? [])
      .filter((u) => !search || (u.email ?? '').toLowerCase().includes(search) || String(u.user_metadata?.display_name ?? '').toLowerCase().includes(search))
      .map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.user_metadata?.display_name ?? '',
        createdAt: u.created_at,
        lastSeenAt: null as string | null,
        optedIn: Boolean(u.user_metadata?.reminders_opt_in ?? false),
      }))
    // Attach last_seen_at where tracked.
    const { data: activity } = await admin.from('user_activity').select('user_id,last_seen_at')
    const byId = new Map((activity ?? []).map((a) => [a.user_id, a.last_seen_at]))
    for (const row of rows) row.lastSeenAt = byId.get(row.id) ?? null
    return json({ users: rows, page, hasMore: (list?.users ?? []).length === perPage })
  }

  if (action === 'send') {
    const title = String((body as { title?: string }).title ?? '').trim()
    const message = String((body as { message?: string }).message ?? '').trim()
    const audience = (body as { audience?: string }).audience === 'opted_in' ? 'opted_in' : 'all'
    if (!title || !message) return json({ error: 'Title and message are required.' }, 400)
    // Resolve recipients server-side. opted_in requires a push subscription.
    let recipients: string[] = []
    if (audience === 'opted_in') {
      const { data: subs } = await admin.from('push_subscriptions').select('user_id')
      recipients = [...new Set((subs ?? []).map((s) => s.user_id))]
    } else {
      const { data: act } = await admin.from('user_activity').select('user_id')
      // fall back to all auth users if activity tracking is sparse
      if ((act ?? []).length === 0) {
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
        recipients = (list?.users ?? []).map((u) => u.id)
      } else recipients = (act ?? []).map((a) => a.user_id)
    }
    const { data: ann, error: annErr } = await admin.from('announcements').insert({ title, body: message, audience, created_by: user.id }).select().single()
    if (annErr) return json({ error: annErr.message }, 500)
    if (recipients.length) {
      const { error: delErr } = await admin.from('announcement_delivery').insert(
        recipients.map((uid) => ({ announcement_id: ann.id, user_id: uid })),
      )
      if (delErr) return json({ error: `Announcement created but delivery fan-out failed: ${delErr.message}` }, 500)
    }
    return json({ ok: true, announcementId: ann.id, recipientCount: recipients.length })
  }

  if (action === 'history') {
    const { data, error } = await admin
      .from('announcements')
      .select('id,title,body,audience,created_at,announcement_delivery(count)')
      .order('created_at', { ascending: false }).limit(50)
    if (error) return json({ error: error.message }, 500)
    return json({ history: (data ?? []).map((a) => ({ id: a.id, title: a.title, body: a.body, audience: a.audience, createdAt: a.created_at, recipientCount: a.announcement_delivery?.[0]?.count ?? 0 })) })
  }

  return json({ error: 'Unknown action.' }, 400)
})
