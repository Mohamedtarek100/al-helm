import { Capacitor } from '@capacitor/core'
import { supabase } from './persistence/supabase'

/**
 * Android (native) OAuth return flow.
 *
 * PROBLEM
 *   On Android, `signInWithOAuth` opens an external browser (Chrome Custom
 *   Tab). The provider redirects back to a URL, but without an intent filter
 *   the OS has no reason to hand that URL to the installed app, so the user is
 *   stranded in Chrome while the app still shows "signed out".
 *
 * SOLUTION
 *   Redirect to a custom scheme registered by this app:
 *
 *       com.alhelm.studyplanner://auth-callback
 *
 *   The Android manifest declares an intent-filter for that scheme (see
 *   android/app/src/main/AndroidManifest.xml). When Chrome returns, the OS
 *   launches the app and Capacitor emits `appUrlOpen`. We then exchange the
 *   returned credentials for a session and clean the URL.
 *
 * SECURITY
 *   - Supabase issues BOTH a `code` (PKCE flow) and a one-time `access_token`
 *     + `refresh_token`, and both are bound to the initiating flow. We never
 *     fabricate a session from arbitrary query parameters.
 *   - The `state` parameter is preserved end-to-end by the SDK; this module
 *     does not disable or bypass it.
 *   - Nothing secret is logged or stored outside the SDK's own storage.
 */

export const ANDROID_AUTH_SCHEME = 'com.alhelm.studyplanner'
export const ANDROID_AUTH_CALLBACK = `${ANDROID_AUTH_SCHEME}://auth-callback`

/** The redirect target for the current platform. */
export function authRedirectFor(platform: string = Capacitor.getPlatform()): string {
  return platform === 'android' ? ANDROID_AUTH_CALLBACK : ''
}

export interface ParsedAuthCallback {
  code: string | null
  accessToken: string | null
  refreshToken: string | null
  error: string | null
  errorDescription: string | null
}

/**
 * Parses a callback URL. Both the query string (`?code=`) and the fragment
 * (`#access_token=`) forms are supported, because Supabase uses the fragment
 * for the implicit flow and the query for PKCE.
 */
export function parseAuthCallback(url: string): ParsedAuthCallback {
  const empty: ParsedAuthCallback = { code: null, accessToken: null, refreshToken: null, error: null, errorDescription: null }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return empty
  }
  // Fragment params live before the '#'; a HashRouter also uses '#', so read the
  // fragment only when it looks like a query string.
  const fragment = parsed.hash.startsWith('#') ? new URLSearchParams(parsed.hash.slice(1)) : new URLSearchParams()
  const fromQuery = (key: string) => parsed.searchParams.get(key)
  const pick = (key: string) => fromQuery(key) ?? fragment.get(key)
  return {
    code: pick('code'),
    accessToken: pick('access_token'),
    refreshToken: pick('refresh_token'),
    error: pick('error'),
    errorDescription: pick('error_description'),
  }
}

/** True when the URL is this app's own auth callback. */
export function isAuthCallbackUrl(url: string): boolean {
  return typeof url === 'string' && url.startsWith(`${ANDROID_AUTH_SCHEME}://auth-callback`)
}

/** Prevents two listeners/duplicate events from exchanging the same code twice. */
let handledCode: string | null = null
export function __resetNativeAuthForTests(): void { handledCode = null }

/**
 * Completes the session from a callback URL.
 * Returns the signed-in user id, or null when the URL was not a usable callback.
 */
export async function handleAuthCallback(url: string): Promise<string | null> {
  if (!supabase || !isAuthCallbackUrl(url)) return null
  const parsed = parseAuthCallback(url)
  if (parsed.error) throw new Error(parsed.errorDescription || parsed.error)
  if (!parsed.code && !(parsed.accessToken && parsed.refreshToken)) return null
  // Idempotent: the OS can deliver the same URL more than once.
  const dedupeKey = parsed.code ?? parsed.accessToken
  if (dedupeKey && handledCode === dedupeKey) return null
  handledCode = dedupeKey

  if (parsed.code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(parsed.code)
    if (error) throw error
    return data.session?.user.id ?? null
  }
  const { data, error } = await supabase.auth.setSession({
    access_token: parsed.accessToken as string,
    refresh_token: parsed.refreshToken as string,
  })
  if (error) throw error
  return data.session?.user.id ?? null
}

/**
 * Installs the native listener. Returns a teardown; a no-op on web.
 * `onSignedIn` runs after a session is established so the caller can refresh
 * persistence, admin state and navigation exactly once.
 */
export function installNativeAuthListener(onSignedIn: (userId: string) => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => undefined
  let disposed = false
  let handle: { remove: () => Promise<void> } | null = null

  void (async () => {
    try {
      const { App } = await import('@capacitor/app')
      handle = await App.addListener('appUrlOpen', ({ url }) => {
        if (disposed) return
        void handleAuthCallback(url)
          .then((userId) => { if (userId && !disposed) onSignedIn(userId) })
          .catch((error: unknown) => {
            // A failed exchange leaves the user signed out; the UI reads the
            // session itself, so nothing is left in a half-authenticated state.
            if (import.meta.env.DEV) console.warn('Native auth callback failed:', error instanceof Error ? error.message : error)
          })
      })
    } catch {
      /* plugin unavailable: web behaviour is unaffected */
    }
  })()

  return () => {
    disposed = true
    void handle?.remove()
  }
}
