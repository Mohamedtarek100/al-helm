import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Connectivity / sync status.
 *
 * The rule under test: the UI must never claim cloud confirmation that did not
 * happen, and must distinguish "device offline" from "device online but service
 * unreachable". Supabase is mocked so no network call is made.
 */

const state = vi.hoisted(() => ({ configured: true, sessionThrows: false }))

vi.mock('./persistence/supabase', () => {
  const client = {
    auth: {
      getSession: async () => {
        if (state.sessionThrows) throw new Error('network down')
        return { data: { session: null }, error: null }
      },
    },
  }
  // Re-read `configured` on every access so tests can toggle it after import
  // (the module under test captures `supabase` once, like production code does).
  return {
    get supabase() {
      return state.configured ? client : null
    },
  }
})

const persistenceState = vi.hoisted(() => ({ mode: 'local' as 'local' | 'cloud', error: null as string | null }))

vi.mock('./store', () => ({
  activePersistenceMode: () => persistenceState.mode,
  getPersistenceError: () => persistenceState.error,
}))

const sync = await import('./syncStatus')

beforeEach(() => {
  state.configured = true
  state.sessionThrows = false
  persistenceState.mode = 'local'
  persistenceState.error = null
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})

describe('honest state reporting', () => {
  it('reports local-only when cloud is not configured (never "synced")', () => {
    state.configured = false
    sync.reconcileWithStore()
    const status = sync.getSyncStatus()
    expect(status.localOnly).toBe(true)
    expect(status.sync).toBe('local-only')
  })

  it('does not mark local-only data as synced when a cloud op is attempted', () => {
    state.configured = false
    sync.markSyncing()
    sync.markSynced()
    expect(sync.getSyncStatus().sync).not.toBe('synced')
  })

  it('reports failure distinctly from success when the cloud save fails', () => {
    sync.markSyncing()
    expect(sync.getSyncStatus().sync).toBe('syncing')
    sync.markSyncFailed('network timeout')
    const status = sync.getSyncStatus()
    expect(status.sync).toBe('failed')
    expect(status.error).toBe('network timeout')
  })

  it('records a timestamp only on a real success', () => {
    sync.markSynced()
    expect(sync.getSyncStatus().lastSyncedAt).not.toBeNull()
  })

  it('surfaces a store persistence error rather than claiming success', () => {
    persistenceState.mode = 'cloud'
    persistenceState.error = 'Cloud save failed'
    sync.reconcileWithStore()
    expect(sync.getSyncStatus().sync).toBe('failed')
    expect(sync.getSyncStatus().error).toBe('Cloud save failed')
  })
})

describe('device offline vs service unreachable', () => {
  it('reports offline without probing when the browser is offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    const result = await sync.probeCloudReachable(true)
    expect(result).toBe('offline')
    expect(sync.getSyncStatus().connection).toBe('offline')
  })

  it('reports "unreachable" (not offline) when the device is online but the service fails', async () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    state.sessionThrows = true
    const result = await sync.probeCloudReachable(true)
    expect(result).toBe('unreachable')
    // The device itself is still online — a distinct state.
    expect(sync.getSyncStatus().connection).toBe('unreachable')
  })

  it('reports online when the service answers', async () => {
    state.sessionThrows = false
    const result = await sync.probeCloudReachable(true)
    expect(result).toBe('online')
  })

  it('treats a missing cloud configuration as online-local, not unreachable', async () => {
    state.configured = false
    const result = await sync.probeCloudReachable(true)
    expect(result).toBe('online')
    expect(sync.getSyncStatus().localOnly).toBe(true)
  })
})

describe('listener subscription', () => {
  it('notifies subscribers on a real change and not on a no-op', () => {
    const listener = vi.fn()
    const unsubscribe = sync.subscribeSyncStatus(listener)
    sync.markSyncFailed('boom')
    const callsAfterChange = listener.mock.calls.length
    expect(callsAfterChange).toBeGreaterThan(0)
    // Re-applying the identical state must not spam subscribers.
    sync.markSyncFailed('boom')
    expect(listener.mock.calls.length).toBe(callsAfterChange)
    unsubscribe()
  })
})
