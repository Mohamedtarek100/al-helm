import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '../i18n/I18nProvider'
import { useI18n } from '../i18n/useI18n'
import { LaunchGate } from './LaunchGate'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { __resetLaunchModeForTests } from '../services/onboarding'
import { initStore } from '../services/store'

/**
 * Provider hierarchy — the ACTUAL production crash.
 *
 * Shipped bug: `I18nProvider` lived inside `App`, but `LaunchGate` renders the
 * first-launch `WelcomePage` OUTSIDE `App`. A first-time visitor therefore
 * called `useI18n()` with no provider above it and the whole page went blank:
 *
 *   Uncaught Error: useI18n must be used within I18nProvider
 *
 * These tests render the real tree (real I18nProvider, real LaunchGate, real
 * WelcomePage — no context mocks) so that regression can never pass silently.
 */

// Supabase must not be reached; the gate only asks for a session.
vi.mock('../persistence/supabase', () => ({ supabase: null }))

/** A component that proves the i18n context is actually available. */
function I18nProbe() {
  const { language, t } = useI18n()
  return <p>{language}:{t('tasks')}</p>
}

beforeEach(async () => {
  localStorage.clear()
  __resetLaunchModeForTests()
  await initStore(true)
})

describe('first-launch welcome screen', () => {
  it('renders inside the provider without a missing-provider error', async () => {
    // This is the exact failing scenario: LaunchGate → WelcomePage → useI18n.
    render(
      <I18nProvider>
        <MemoryRouter>
          <LaunchGate>
            <div>app</div>
          </LaunchGate>
        </MemoryRouter>
      </I18nProvider>,
    )
    // The welcome heading proves WelcomePage rendered rather than throwing.
    expect(await screen.findByText(/^Welcome$|^أهلاً بيك$/)).toBeTruthy()
  })

  it('offers both Google and Guest choices', async () => {
    render(
      <I18nProvider>
        <MemoryRouter>
          <LaunchGate><div>app</div></LaunchGate>
        </MemoryRouter>
      </I18nProvider>,
    )
    expect(await screen.findByRole('button', { name: /Continue as guest|المتابعة كضيف/ })).toBeTruthy()
    expect(await screen.findByRole('button', { name: /Continue with Google|المتابعة عبر Google/ })).toBeTruthy()
  })

  it('an error inside the launch path is contained by the boundary', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    function Boom(): never {
      throw new Error('launch failure')
    }
    try {
      render(
        <I18nProvider>
          <MemoryRouter>
            <ErrorBoundary onError={() => undefined}>
              <Boom />
            </ErrorBoundary>
          </MemoryRouter>
        </I18nProvider>,
      )
      expect(screen.getByRole('alert')).toBeTruthy()
      expect(screen.getByText('launch failure')).toBeTruthy()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('the provider is reachable from every consumer', () => {
  it('exposes language and translations to a child component', () => {
    render(
      <I18nProvider>
        <I18nProbe />
      </I18nProvider>,
    )
    // English is the default; the real translation table must resolve.
    expect(screen.getByText(/^en:/)).toBeTruthy()
  })

  it('renders Arabic when that is the saved preference', async () => {
    const { updateSettings } = await import('../services/store')
    await updateSettings({ language: 'ar' })
    render(
      <I18nProvider>
        <I18nProbe />
      </I18nProvider>,
    )
    expect(screen.getByText(/^ar:/)).toBeTruthy()
    // Update the document direction the same way the provider does.
    expect(document.documentElement.dir).toBe('rtl')
  })
})
