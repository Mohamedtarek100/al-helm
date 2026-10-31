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
  /** True while a retry is in flight but previous data is still shown. */
  refreshing: boolean
}

/**
 * Loads a privileged resource.
 *
 * `deps` must include anything that changes the identity of the request
 * (e.g. the admin user id) so a switch cannot surface another account's data.
 */
export function useAdminResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
): AdminResource<T> {
  const [state, setState] = useState<AdminResourceState<T>>({ status: 'loading', data: null, error: null })
  const [nonce, setNonce] = useState(0)
  const generation = useRef(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  useEffect(() => {
    const run = ++generation.current
    const controller = new AbortController()
    // Always clear to loading: after an account switch or retry, showing the
    // previous data even briefly would leak it across identities.
    setState({ status: 'loading', data: null, error: null })

    loaderRef.current(controller.signal)
      .then((data) => {
        if (run !== generation.current) return // superseded
        setState({ status: 'ready', data, error: null })
      })
      .catch((error: unknown) => {
        if (run !== generation.current) return
        if (controller.signal.aborted) return
        setState({
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const retry = useCallback(() => setNonce((value) => value + 1), [])
  return { state, retry, refreshing: state.status === 'loading' && nonce > 0 }
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
