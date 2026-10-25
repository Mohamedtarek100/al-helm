/**
 * Connectivity & synchronization status.
 *
 * Design rules (these are what make the indicator truthful):
 *  - `navigator.onLine` is only a HINT. "Online" means the browser has a
 *    network interface, not that Supabase is reachable.
 *  - Local durability is always reported separately from cloud confirmation.
 *    A local save is never labelled "Synced".
 *  - Reachability is probed with a bounded, throttled request, never on render
 *    and never in a tight loop.
 *  - A failed cloud read is never treated as "cloud is empty".
 *
 * The store owns the data; this module only observes and reports.
 */

import { useSyncExternalStore } from 'react'
import { supabase } from './persistence/supabase'
import { activePersistenceMode, getPersistenceError } from './store'

export type ConnectionState = 'online' | 'offline' | 'unreachable'
export type SyncState = 'local-only' | 'idle' | 'syncing' | 'synced' | 'failed' | 'sign-in-required'

export interface SyncStatus {
  /** Device network interface state, from the browser hint. */
  connection: ConnectionState
  /** What the data layer is actually doing. */
  sync: SyncState
  /** True when data lives only on this device (no cloud configured). */
  localOnly: boolean
  /** Human-readable underlying error, if any. */
  error: string | null
  /** Timestamp of the last successful cloud round trip. */
  lastSyncedAt: string | null
}

const PROBE_INTERVAL_MS = 45_000
const PROBE_TIMEOUT_MS = 6_000

let status: SyncStatus = {
  connection: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online',
  sync: 'idle',
  localOnly: !supabase,
  error: null,
  lastSyncedAt: null,
}

const listeners = new Set<() => void>()
let lastProbeAt = 0
let probeInFlight: Promise<ConnectionState> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null

function emit(): void {
  for (const listener of listeners) listener()
}

function setStatus(patch: Partial<SyncStatus>): void {
  const next = { ...status, ...patch }
  if (
    next.connection === status.connection &&
    next.sync === status.sync &&
    next.localOnly === status.localOnly &&
    next.error === status.error &&
    next.lastSyncedAt === status.lastSyncedAt
  ) return
  status = next
  emit()
}

export function getSyncStatus(): SyncStatus {
  return status
}

export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus)
}

/**
 * Probes whether Supabase is actually reachable. Bounded by a timeout and
 * throttled so the indicator can be consulted freely without hammering the API.
 */
export async function probeCloudReachable(force = false): Promise<ConnectionState> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setStatus({ connection: 'offline' })
    return 'offline'
  }
  if (!supabase) {
    setStatus({ connection: 'online', localOnly: true })
    return 'online'
  }
  const now = Date.now()
  if (!force && now - lastProbeAt < PROBE_INTERVAL_MS) return status.connection
  if (probeInFlight) return probeInFlight

  lastProbeAt = now
  probeInFlight = (async (): Promise<ConnectionState> => {
    try {
      const result = await Promise.race([
        supabase!.auth.getSession(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), PROBE_TIMEOUT_MS)),
      ])
      // Reaching the auth endpoint proves the project is reachable; an auth
      // error still proves reachability, so only a thrown/network error counts.
      void result
      setStatus({ connection: 'online' })
      return 'online'
    } catch {
      setStatus({ connection: 'unreachable' })
      return 'unreachable'
    } finally {
      probeInFlight = null
    }
  })()
  return probeInFlight
}

/** Called by the store around cloud operations so the badge reflects reality. */
export function markSyncing(): void {
  if (!supabase) return
  setStatus({ sync: 'syncing', error: null })
}

export function markSynced(): void {
  if (!supabase) return
  setStatus({ sync: 'synced', error: null, lastSyncedAt: new Date().toISOString() })
}

export function markSyncFailed(error: string | null): void {
  if (!supabase) return
  setStatus({ sync: 'failed', error })
}

/** Re-reads the store's persistence state without inventing any of it. */
export function reconcileWithStore(): void {
  if (!supabase) {
    setStatus({ localOnly: true, sync: 'local-only' })
    return
  }
  const mode = activePersistenceMode()
  const error = getPersistenceError()
  if (error) setStatus({ sync: 'failed', error, localOnly: mode === 'local' })
  else if (mode === 'local') setStatus({ sync: 'sign-in-required', localOnly: true })
  else setStatus({ sync: status.sync === 'syncing' ? 'syncing' : 'idle', error: null, localOnly: false })
}

/** Explicit user-triggered retry, with a single bounded schedule (no tight loop). */
export function scheduleRetry(run: () => Promise<void>, attempt = 0): void {
  if (retryTimer) clearTimeout(retryTimer)
  const delay = Math.min(30_000, 2_000 * 2 ** attempt)
  retryTimer = setTimeout(() => {
    retryTimer = null
    void run()
  }, delay)
}

export function cancelRetry(): void {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
}

/** Installs browser listeners once; returns a teardown for tests/HMR. */
export function initConnectivity(): () => void {
  if (typeof window === 'undefined') return () => undefined
  const onOnline = () => {
    setStatus({ connection: 'online' })
    void probeCloudReachable(true)
  }
  const onOffline = () => setStatus({ connection: 'offline', sync: supabase ? status.sync : 'local-only' })
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  reconcileWithStore()
  void probeCloudReachable()
  return () => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    cancelRetry()
  }
}
