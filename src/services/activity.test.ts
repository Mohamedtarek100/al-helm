import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the edge client and Supabase session so the throttle logic is tested
// in isolation without a live backend.
const heartbeatMock = vi.fn(() => Promise.resolve({ ok: true as const }))
const getSessionMock = vi.fn<() => Promise<{ data: { session: { access_token: string } | null }; error: null }>>(
  () => Promise.resolve({ data: { session: { access_token: 'tok' } }, error: null }),
)

vi.mock('./edge/admin', () => ({
  heartbeat: (...args: unknown[]) => heartbeatMock(...(args as [])),
}))

vi.mock('./persistence/supabase', () => ({
  supabase: { auth: { getSession: () => getSessionMock() } },
}))

import { maybeHeartbeat, resetHeartbeatForTests, __internals } from './activity'

describe('activity heartbeat throttle', () => {
  beforeEach(() => {
    resetHeartbeatForTests()
    heartbeatMock.mockReset()
    heartbeatMock.mockImplementation(() => Promise.resolve({ ok: true as const }))
    getSessionMock.mockReset()
    getSessionMock.mockImplementation(() =>
      Promise.resolve({ data: { session: { access_token: 'tok' } }, error: null }),
    )
  })

  it('does not fire twice within the throttle window', async () => {
    const t0 = __internals.HEARTBEAT_INTERVAL_MS * 10
    const first = await maybeHeartbeat(t0)
    expect(first).toBe(true)
    const second = await maybeHeartbeat(t0 + 1000)
    expect(second).toBe(false)
    expect(heartbeatMock).toHaveBeenCalledTimes(1)
  })

  it('fires again after the interval elapses', async () => {
    const t0 = __internals.HEARTBEAT_INTERVAL_MS * 10
    await maybeHeartbeat(t0)
    await new Promise((r) => setTimeout(r, 0)) // let the in-flight chain settle
    const later = await maybeHeartbeat(t0 + __internals.HEARTBEAT_INTERVAL_MS + 1)
    expect(later).toBe(true)
    expect(heartbeatMock).toHaveBeenCalledTimes(2)
  })

  it('skips when no session exists', async () => {
    getSessionMock.mockImplementationOnce(() => Promise.resolve({ data: { session: null }, error: null }))
    const fired = await maybeHeartbeat(1000)
    expect(fired).toBe(false)
    expect(heartbeatMock).not.toHaveBeenCalled()
  })

  it('swallows heartbeat failures without breaking the caller', async () => {
    heartbeatMock.mockImplementationOnce(() => Promise.reject(new Error('network down')))
    const fired = await maybeHeartbeat(__internals.HEARTBEAT_INTERVAL_MS * 10)
    expect(fired).toBe(true)
    await new Promise((r) => setTimeout(r, 0)) // allow the rejection to settle
    expect(heartbeatMock).toHaveBeenCalledTimes(1)
  })
})
