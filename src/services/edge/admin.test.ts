import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

/**
 * Contract regression tests for the admin edge-function client.
 *
 * These verify the request shape (action in body, bearer token header) and
 * error propagation against a mocked `fetch` — the exact contract the Deno
 * function in supabase/functions/admin implements. They do not exercise the
 * deployed function; live verification is an external setup step.
 */

const fetchMock = vi.fn()

vi.mock('../persistence/supabase', () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { access_token: 'tok-123' } }, error: null }),
    },
  },
}))

;(import.meta.env as Record<string, string>).VITE_SUPABASE_URL = 'https://example.supabase.co'

import {
  getAdminGate,
  getAdminMetrics,
  getAdminUsers,
  sendAnnouncement,
  getAdminHistory,
  heartbeat,
  adminFetch,
  getAnnouncementFeed,
  markAnnouncementRead,
} from './admin'

function okResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('admin edge client contract', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the action in the body and the bearer token in the header', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ isAdmin: true, email: 'a@b.c' }))
    const gate = await getAdminGate()
    expect(gate).toEqual({ isAdmin: true, email: 'a@b.c' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://example.supabase.co/functions/v1/admin/gate')
    expect(init.headers.Authorization).toBe('Bearer tok-123')
    expect(JSON.parse(init.body).action).toBe('gate')
  })

  it('getAdminUsers forwards page and search', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ users: [], page: 2, hasMore: false }))
    const res = await getAdminUsers(2, 'ali')
    expect(res.hasMore).toBe(false)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ action: 'users', page: 2, search: 'ali' })
  })

  it('user rows use the pushOptIn field (not optedIn) — contract regression', async () => {
    // The Edge Function must return pushOptIn; the UI reads u.pushOptIn.
    // This test pins the wire contract so a backend rename cannot silently
    // break the dashboard again.
    fetchMock.mockResolvedValueOnce(okResponse({
      users: [{ id: 'u1', email: 'a@b.c', displayName: 'A', createdAt: '2026-01-01', lastSeenAt: null, pushOptIn: true }],
      page: 1,
      hasMore: false,
    }))
    const res = await getAdminUsers(1)
    expect(res.users[0].pushOptIn).toBe(true)
    expect('optedIn' in res.users[0]).toBe(false)
  })

  it('feed and read actions hit their endpoints with the announcement id', async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse({ feed: [{ id: 'a1', title: 'T', body: 'B', createdAt: '2026-01-01', deliveredAt: '2026-01-01', readAt: null }] }))
      .mockResolvedValueOnce(okResponse({ ok: true }))
    const feed = await getAnnouncementFeed()
    expect(feed.feed[0].readAt).toBeNull()
    await markAnnouncementRead('a1')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ action: 'read', announcementId: 'a1' })
  })

  it('sendAnnouncement passes title, message and audience', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ ok: true, announcementId: 'x', recipientCount: 3 }))
    const res = await sendAnnouncement('hi', 'there', 'all')
    expect(res.recipientCount).toBe(3)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ action: 'send', title: 'hi', message: 'there', audience: 'all' })
  })

  it('metrics and history hit their endpoints with bearer auth', async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse({ totalRegistered: 1, newUsers7d: 0, newUsers30d: 0, active7: 0, active30: 0, pushOptIns: 0 }))
      .mockResolvedValueOnce(okResponse({ history: [] }))
      .mockResolvedValueOnce(okResponse({ ok: true }))
    await getAdminMetrics()
    await getAdminHistory()
    await heartbeat()
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      'https://example.supabase.co/functions/v1/admin/metrics',
      'https://example.supabase.co/functions/v1/admin/history',
      'https://example.supabase.co/functions/v1/admin/heartbeat',
    ])
  })

  it('throws the server error message on non-2xx responses', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(403, 'Not an authorized admin.'))
    await expect(getAdminGate()).rejects.toThrow('Not an authorized admin.')
  })

  it('throws a generic message when the response body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('gateway timeout', { status: 504 }))
    await expect(adminFetch('metrics')).rejects.toThrow('Request failed (504)')
  })
})
