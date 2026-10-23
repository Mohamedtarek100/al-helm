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
