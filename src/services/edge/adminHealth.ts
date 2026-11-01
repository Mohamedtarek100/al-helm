import { useSyncExternalStore } from 'react'
import { getAdminHealth, type HealthReport } from './admin'

/**
 * Shared health state for the Owner Control Center.
 *
 * WHY THIS EXISTS
 *   The header used to hardcode `status={{ tone: 'ok', label: 'VERIFIED' }}`
 *   while the Security panel simultaneously listed checks as "Not checked".
 *   The two surfaces disagreed because they did not share a source of truth —
 *   the badge was decoration, not state.
 *
 *   Now there is ONE health snapshot, and both the topbar and the Security
 *   panel derive from it. The badge can therefore never claim more than the
 *   checks actually established.
 *
 *   The store is a module singleton (like the admin gate) so every mounted
 *   admin surface observes the same result, and a "Run checks" press updates
 *   all of them at once.
 */

export type HealthSummary = 'unknown' | 'checking' | 'healthy' | 'degraded' | 'failed'

export interface HealthSnapshot {
  summary: HealthSummary
  report: HealthReport | null
  error: string | null
  /** ISO timestamp of the last completed run, or null when never run. */
  checkedAt: string | null
}

const IDLE: HealthSnapshot = { summary: 'unknown', report: null, error: null, checkedAt: null }

let snapshot: HealthSnapshot = IDLE
const listeners = new Set<() => void>()
let inFlight: Promise<HealthSnapshot> | null = null

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribeHealth(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getHealthSnapshot(): HealthSnapshot {
  return snapshot
}

export function useAdminHealth(): HealthSnapshot {
  return useSyncExternalStore(subscribeHealth, getHealthSnapshot, getHealthSnapshot)
}

/**
 * Derives the headline state from the individual checks.
 *
 * A check that did not run is NOT a pass. `degraded` is used when some checks
 * passed and one failed, so a single broken dependency does not read as "all
 * systems down"; `failed` means every check that ran failed.
 */
export function summarise(report: HealthReport | null): HealthSummary {
  if (!report) return 'unknown'
  const checks = report.checks
  if (checks.length === 0) return 'unknown'
  const failed = checks.filter((check) => !check.ok).length
  if (failed === 0) return 'healthy'
  if (failed === checks.length) return 'failed'
  return 'degraded'
}

/**
 * Runs the real server-side checks.
 *
 * Concurrent callers share one request, so double-clicking "Run checks" cannot
 * stack requests or let a slower earlier response overwrite a newer one.
 */
export async function runHealthChecks(): Promise<HealthSnapshot> {
  if (inFlight) return inFlight
  snapshot = { ...snapshot, summary: 'checking', error: null }
  emit()

  inFlight = (async () => {
    try {
      const report = await getAdminHealth()
      snapshot = { summary: summarise(report), report, error: null, checkedAt: report.checkedAt }
      return snapshot
    } catch (error) {
      // A failed REQUEST is not a failed system: report `unknown` with the real
      // message, rather than claiming the services are unhealthy.
      snapshot = {
        summary: 'unknown',
        report: null,
        error: error instanceof Error ? error.message : 'Health checks could not be run.',
        checkedAt: null,
      }
      return snapshot
    } finally {
      inFlight = null
      emit()
    }
  })()

  return inFlight
}

/** Test-only: resets module state between cases. */
export function __resetHealth(): void {
  inFlight = null
  snapshot = IDLE
  emit()
}
