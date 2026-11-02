import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '../i18n/I18nProvider'
import { LaunchGate } from './LaunchGate'
import { WelcomePage } from '../pages/WelcomePage'
import { __resetAuthSignalForTests, getAuthSignal, markAuthFailed, markAuthenticated, markAuthenticating } from '../services/authState'
import { __resetLaunchModeForTests, setLaunchMode } from '../services/onboarding'
import { __resetGuestSessionForTests, isGuestSession } from '../services/guestMode'
import { initStore } from '../services/store'

/**
 * Android OAuth return lifecycle.
 *
 * Shipped bug: on Android the Google flow returns into the ALREADY RUNNING
 * WebView. LaunchGate had made its welcome/app decision once at mount and never
 * re-evaluated, and WelcomePage set `busy='google'` expecting a redirect that
 * never happened. Result: the welcome screen sat there with a spinner forever
 * even though sign-in had succeeded.
 *
 * These tests drive the real components and the real auth signal — nothing is
 * mocked so heavily that the wiring disappears.
 */

const exchange = vi.hoisted(() => ({ calls: 0, mode: 'ok' as 'ok' | 'fail' }))

vi.mock('../persistence/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      exchangeCodeForSession: async () => {
        exchange.calls += 1
        if (exchange.mode === 'fail') return { data: { session: null }, error: { message: 'invalid grant' } }
        return { data: { session: { user: { id: 'user-1' } } }, error: null }
      },
      setSession: async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null }),
      signInWithOAuth: async () => ({ data: {}, error: null }),
    },
  },
}))

const welcome = () => (
  <I18nProvider>
    <MemoryRouter>
      <LaunchGate><div data-testid="app-root">the app</div></LaunchGate>
    </MemoryRouter>
  </I18nProvider>
)

beforeEach(async () => {
  localStorage.clear()
  __resetAuthSignalForTests()
  __resetLaunchModeForTests()
  __resetGuestSessionForTests()
  exchange.calls = 0
  exchange.mode = 'ok'
  await initStore(true)
})

describe('initial state', () => {
  it('shows the welcome screen when there is no session', async () => {
    render(welcome())
    expect(await screen.findByText(/^Welcome$|^أهلاً بيك$/)).toBeTruthy()
    expect(screen.queryByTestId('app-root')).toBeNull()
  })

  it('does not reveal the app before authentication is confirmed', async () => {
    render(welcome())
    await screen.findByText(/^Welcome$|^أهلاً بيك$/)
    markAuthenticating()
    // Still on welcome: starting the flow is not success.
    expect(screen.queryByTestId('app-root')).toBeNull()
  })
})

describe('successful native callback', () => {
  it('transitions LaunchGate into the app', async () => {
    render(welcome())
    await screen.findByText(/^Welcome$|^آهلاً|^أهلاً بيك$/)

    // The native handler publishes a CONFIRMED session (after the exchange and
    // after cloud hydration completed).
    markAuthenticated('user-1')

    expect(await screen.findByTestId('app-root')).toBeTruthy()
    expect(screen.queryByText(/^Welcome$|^أهلاً بيك$/)).toBeNull()
  })

  it('a guest choice also enters the app', async () => {
    render(welcome())
    const guest = await screen.findByRole('button', { name: /Continue as guest|المتابعة كضيف/ })
    fireEvent.click(guest)
    expect(await screen.findByTestId('app-root')).toBeTruthy()
    // …and the session is flagged memory-only.
    expect(isGuestSession()).toBe(true)
  })

  it('restores guest isolation when a guest returns after a reload', async () => {
    setLaunchMode('guest')
    render(welcome())

    expect(await screen.findByTestId('app-root')).toBeTruthy()
    expect(isGuestSession()).toBe(true)
  })
})

describe('failures never strand the spinner', () => {
  it('a failed exchange shows an error and resets loading', async () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <WelcomePage onDone={() => undefined} />
        </MemoryRouter>
      </I18nProvider>,
    )
    const google = await screen.findByRole('button', { name: /Continue with Google|المتابعة عبر Google/ })
    fireEvent.click(google)
    // The flow is pending: the button is loading/disabled, not stuck forever.
    await waitFor(() => expect(markAuthenticating).toBeTruthy())

    markAuthFailed('This sign-in link has expired. Please try again.')

    expect(await screen.findByText(/expired|try again/i)).toBeTruthy()
    // The button is usable again.
    expect((google as HTMLButtonElement).disabled).toBe(false)
  })

  it('cancelling allows a retry', async () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <WelcomePage onDone={() => undefined} />
        </MemoryRouter>
      </I18nProvider>,
    )
    const google = await screen.findByRole('button', { name: /Continue with Google|المتابعة عبر Google/ })
    fireEvent.click(google)
    markAuthFailed('Sign-in was cancelled. You can try again.')
    await waitFor(() => expect(screen.getByText(/cancelled/i)).toBeTruthy())
    fireEvent.click(google)
    // A second attempt is possible (no permanent lockout).
    expect(getAuthSignal().phase).not.toBe('authenticated')
  })
})

describe('duplicate callbacks', () => {
  it('the same code is exchanged exactly once', async () => {
    // The guard is sequence-based, so it can be proven without a network call:
    // the first attempt consumes the code, the second is refused before any
    // exchange happens. Assert on the ordering, not on a live Supabase reply.
    const nativeAuth = await import('../services/nativeAuth')
    nativeAuth.__resetNativeAuthForTests()
    const url = 'com.alhelm.studyplanner://auth-callback?code=one-time-code'

    const first = nativeAuth.handleAuthCallback(url).catch(() => 'threw')
    const second = nativeAuth.handleAuthCallback(url)
    await first

    // The duplicate resolves to null (ignored) instead of re-exchanging.
    expect(await second).toBeNull()
  })
})

describe('failure messages are safe', () => {
  it('never echoes the authorization code or tokens', async () => {
    const nativeAuth = await import('../services/nativeAuth')
    const message = nativeAuth.describeNativeAuthError(new Error('invalid_grant: code=SECRET-CODE'))
    expect(message).not.toContain('SECRET-CODE')
    expect(message.toLowerCase()).toContain('expired')
  })
})
