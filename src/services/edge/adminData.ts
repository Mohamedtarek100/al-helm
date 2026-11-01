import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Data-loading layer for the Owner Control Center.
 *
 * Guarantees that matter for a privileged console:
 *
 *  - **No fake values.** A failed request yields `error`, never a zero. Callers
 *    must render "unavailable", not "0".
 *  - **No infinite loading.** Every state resolves to success | empty | error.
 *  - **No stale results.** Each run is tagged with a generation; a response from
 *    an older generation (account switch, retry, unmount) is discarded.
 *  - **No duplicate requests.** The loader runs once per dependency change, not
 *    per render.
 *  - **Cancellation.** `AbortSignal` is passed through and honoured.
 */

export type AdminResourceState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'error'; data: null; error: string }

export interface AdminResource<T> {
  state: AdminResourceState<T>
  /** Re-runs the loader; safe to call from a Retry button. */
  retry: () => void
  /** True while a retry is in flight (previous data is not kept, by design). */
  refreshing: boolean
}

/**
 * Stable serialisation of the dependency list.
 *
 * Deliberately PURE: the loader is keyed on the VALUE. A non-serialisable
 * dependency (a function, a circular object) cannot be compared safely, so it
 * is described by type only — a caller that needs to reload passes a counter or
 * a primitive instead of an inline closure.
 */
export function depsKey(deps: unknown[]): string {
  return JSON.stringify(deps.map((value) => {
    if (value === null || typeof value !== 'object') return value
    try {
      return JSON.stringify(value)
    } catch {
      return `[unserializable:${Array.isArray(value) ? 'array' : 'object'}]`
    }
  }))
}

/**
 * Loads a privileged resource.
 *
 * `deps` must include anything that changes the identity of the request
 * (e.g. the admin user id) so a switch cannot surface another account's data.
 *
 * WHY THE DEPENDENCIES ARE NOT SPREAD INTO THE ARRAY
 *   `useEffect(..., [...deps, nonce])` changes the dependency ARRAY LENGTH
 *   between renders whenever a caller passes a different number of deps. React
 *   warns about that, and linting `deps` directly is impossible. The list is
 *   therefore serialised into one stable primitive, which has the same
 *   invalidation semantics without the variable-arity hazard.
 */
export function useAdminResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
): AdminResource<T> {
  const [nonce, setNonce] = useState(0)
  const generation = useRef(0)
  const key = depsKey(deps)

  /**
   * The result, tagged with the request identity that produced it.
   *
   * "Loading" is DERIVED from a tag mismatch instead of being written into
   * state from inside the effect. That removes the extra cascading render the
   * effect would otherwise trigger, and — more importantly — it makes a stale
   * result impossible to display: after an account switch the key changes, so
   * the previous account's data stops matching on the very same render, before
   * the new request has even started.
   */
  const [result, setResult] = useState<{ key: string; state: AdminResourceState<T> } | null>(null)

  // The loader is held in a ref so an inline arrow function in the caller does
  // not force a refetch on every render. It is written inside an effect (never
  // during render) and read only from the request that effect starts.
  const loaderRef = useRef(loader)
  useEffect(() => {
    loaderRef.current = loader
  }, [loader])

  useEffect(() => {
    const run = ++generation.current
    const controller = new AbortController()
    const requestKey = key
    const settle = (next: AdminResourceState<T>) => {
      // A superseded run (account switch, retry, unmount) must not write.
      if (run !== generation.current) return
      setResult({ key: requestKey, state: next })
    }

    loaderRef.current(controller.signal)
      .then((data) => settle({ status: 'ready', data, error: null }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        settle({
          status: 'error',
          data: null,
          error: error instanceof Error ? error.message : 'The request failed.',
        })
      })

    return () => {
      // Invalidate this run and cancel the request so a late response cannot
      // land after an account switch or unmount.
      generation.current += 1
      controller.abort()
    }
  }, [key, nonce])

  const retry = useCallback(() => setNonce((value) => value + 1), [])
  const current: AdminResourceState<T> = result && result.key === key
    ? result.state
    : { status: 'loading', data: null, error: null }

  return { state: current, retry, refreshing: current.status === 'loading' && nonce > 0 }
}

/**
 * A failed gate/session must never be retried as if it were a transient
 * network error: an expired token needs a fresh session, not another call.
 * Returns true when the message describes an authentication problem.
 */
export function isAuthFailure(message: string): boolean {
  return /unauthenticated|sign in is required|bearer|jwt|token/i.test(message)
}

/** True when a successful response is legitimately empty. */
export function isEmptyResult(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object' && 'users' in (value as Record<string, unknown>)) {
    return Array.isArray((value as { users: unknown[] }).users) && (value as { users: unknown[] }).users.length === 0
  }
  return false
}
