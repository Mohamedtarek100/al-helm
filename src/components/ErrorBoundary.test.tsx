import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'

/**
 * Route-level recovery.
 *
 * Root cause this guards: a component that threw during render unmounted the
 * entire React root — `#root` became empty and the user got a blank page with
 * no way back (that is exactly how the Exams page failed). These tests prove a
 * render error is contained and recoverable instead.
 */

function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Invalid time value')
  return <p>recovered content</p>
}

describe('ErrorBoundary', () => {
  it('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('recovered content')).toBeTruthy()
  })

  it('shows a recovery panel instead of unmounting the tree', () => {
    // React logs the caught error; keep the test output readable.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      render(
        <ErrorBoundary onError={() => undefined}>
          <Boom shouldThrow />
        </ErrorBoundary>,
      )
      expect(screen.getByRole('alert')).toBeTruthy()
      // The original message is surfaced, not swallowed.
      expect(screen.getByText('Invalid time value')).toBeTruthy()
      expect(screen.queryByText('recovered content')).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })

  it('recovers when the user retries after the cause is gone', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let shouldThrow = true
    function Flaky() {
      return <Boom shouldThrow={shouldThrow} />
    }
    try {
      render(
        <ErrorBoundary onError={() => undefined}>
          <Flaky />
        </ErrorBoundary>,
      )
      expect(screen.getByRole('alert')).toBeTruthy()

      // The underlying problem is fixed, then the user retries.
      shouldThrow = false
      fireEvent.click(screen.getByRole('button', { name: /Try again/i }))
      expect(screen.getByText('recovered content')).toBeTruthy()
    } finally {
      spy.mockRestore()
    }
  })

  it('reports the failure through onError for diagnostics', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const onError = vi.fn()
    try {
      render(
        <ErrorBoundary onError={onError}>
          <Boom shouldThrow />
        </ErrorBoundary>,
      )
      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
    } finally {
      spy.mockRestore()
    }
  })

  it('uses a custom fallback when one is supplied', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      render(
        <ErrorBoundary onError={() => undefined} fallback={(error) => <p>custom: {error.message}</p>}>
          <Boom shouldThrow />
        </ErrorBoundary>,
      )
      expect(screen.getByText('custom: Invalid time value')).toBeTruthy()
    } finally {
      spy.mockRestore()
    }
  })
})
