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
//   feed       — (authenticated non-admin) own announcements
//   read       — (authenticated non-admin) mark own announcement read
import { createClient, type User } from 'https://esm.sh/@supabase/supabase-js@2'

/** Shape of an auth directory user, subset used by this function. */
interface DirectoryUser {
  id: string
  email: string | null
  created_at: string
  user_metadata?: { display_name?: string; reminders_opt_in?: boolean }
}

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

  if (action === 'feed') {
    // Any signed-in user: their own announcements via announcement_delivery.
    // RLS allows reading only own delivery rows, so the user-scoped client is
    // already safe; this returns joined content server-side.
    const { data, error } = await userClient(authHeader)
      .from('announcement_delivery')
      .select('delivered_at,read_at,announcement_id,announcements(title,body,created_at)')
      .eq('user_id', user.id)
      .order('delivered_at', { ascending: false })
      .limit(50)
    if (error) return json({ error: error.message }, 500)
    const feed = (data ?? []).map((row) => {
      const ann = Array.isArray(row.announcements) ? row.announcements[0] : row.announcements
      return {
        id: row.announcement_id,
        title: ann?.title ?? '',
        body: ann?.body ?? '',
        createdAt: ann?.created_at ?? row.delivered_at,
        deliveredAt: row.delivered_at,
        readAt: row.read_at,
      }
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
    const [act7, act30, subs] = await Promise.all([
      admin.from('user_activity').select('*', { count: 'exact', head: true }).gte('last_seen_at', weekAgo),
      admin.from('user_activity').select('*', { count: 'exact', head: true }).gte('last_seen_at', monthAgo),
      admin.from('push_subscriptions').select('*', { count: 'exact', head: true }),
    ])
    // Surface query failures instead of silently reporting zero counts.
    for (const result of [act7, act30, subs]) {
      if (result.error) return json({ error: result.error.message }, 500)
    }
    const active7 = act7.count ?? 0
    const active30 = act30.count ?? 0
    const pushOptIns = subs.count ?? 0
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
      for (const u of (data?.users ?? []) as User[]) {
        totalRegistered++
        if (u.created_at >= weekCutoff) newUsers7d++
        if (u.created_at >= monthCutoff) newUsers30d++
      }
      if (!data?.users?.length || data.users.length < 1000) break
      page++
    }
    return json({ totalRegistered, newUsers7d, newUsers30d, active7, active30, pushOptIns })
  }

  if (action === 'users') {
    // True server-side search + pagination over the full auth user set.
    // listUsers page N is the Nth slice of ALL users, so matching users can
    // be found across the whole directory — not just within one requested
    // page — by paging through auth and filtering server-side.
    const requestedPage = Math.max(1, Math.floor(Number((body as { page?: number }).page ?? 1)))
    const search = String((body as { search?: string }).search ?? '').trim().toLowerCase()
    const perPage = 20

    const matches: AdminRow[] = []
    let matched = 0
    let page = 1
    let hasMore = false

    for (;;) {
      const { data: list, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) return json({ error: error.message }, 500)
      const users = list?.users ?? []
      if (users.length === 0) break

      for (const u of users) {
        const email = (u.email ?? '').toLowerCase()
        const name = String(u.user_metadata?.display_name ?? '').toLowerCase()
        if (search && !email.includes(search) && !name.includes(search)) continue
        if (matched < (requestedPage - 1) * perPage) {
          matched++
          continue
        }
        if (matches.length < perPage) {
          matches.push({
            id: u.id,
            email: u.email,
            displayName: u.user_metadata?.display_name ?? '',
            createdAt: u.created_at,
            lastSeenAt: null,
            pushOptIn: Boolean(u.user_metadata?.reminders_opt_in ?? false),
          })
        }
        matched++
      }

      if (matches.length >= perPage && matched > (requestedPage - 1) * perPage + perPage) {
        hasMore = true
        break
      }
      if (users.length < 1000) {
        hasMore = matched > (requestedPage - 1) * perPage + matches.length
        break
      }
      page++
    }

    // Attach last_seen_at where tracked.
    const { data: activity } = await admin.from('user_activity').select('user_id,last_seen_at')
    const byId = new Map((activity ?? []).map((a) => [a.user_id, a.last_seen_at]))
    for (const row of matches) row.lastSeenAt = byId.get(row.id) ?? null
    return json({ users: matches, page: requestedPage, hasMore })
  }

  if (action === 'send') {
    const title = String((body as { title?: string }).title ?? '').trim()
    const message = String((body as { message?: string }).message ?? '').trim()
    const audience = (body as { audience?: string }).audience === 'opted_in' ? 'opted_in' : 'all'
    if (!title || !message) return json({ error: 'Title and message are required.' }, 400)
    // Resolve recipients server-side. opted_in requires a push subscription.
    let recipients: string[] = []
    if (audience === 'opted_in') {
      const { data: subs, error: subsErr } = await admin.from('push_subscriptions').select('user_id')
      if (subsErr) return json({ error: subsErr.message }, 500)
      recipients = [...new Set((subs ?? []).map((s) => s.user_id))]
    } else {
      // 'all' must include every registered account, not only users who have
      // sent a heartbeat. Page through the full auth directory server-side.
      let page = 1
      for (;;) {
        const { data: list, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
        if (error) return json({ error: error.message }, 500)
        const users = list?.users ?? []
        if (users.length === 0) break
        recipients.push(...users.map((u: User) => u.id))
        if (users.length < 1000) break
        page++
      }
    }
    const { data: ann, error: annErr } = await admin.from('announcements').insert({ title, body: message, audience, created_by: user.id }).select().single()
    if (annErr) return json({ error: annErr.message }, 500)
    if (recipients.length) {
      const { error: delErr } = await admin.from('announcement_delivery').insert(
        recipients.map((uid: string) => ({ announcement_id: ann.id, user_id: uid })),
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
    return json({ history: (data ?? []).map((a: { id: string; title: string; body: string; audience: string; created_at: string; announcement_delivery?: { count: number }[] }) => ({ id: a.id, title: a.title, body: a.body, audience: a.audience, createdAt: a.created_at, recipientCount: a.announcement_delivery?.[0]?.count ?? 0 })) })
  }

  return json({ error: 'Unknown action.' }, 400)
})
