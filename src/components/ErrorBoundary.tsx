import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Last-resort render guard.
 *
 * A component that throws during render normally takes the *entire* app down:
 * React unmounts the root, `#root` becomes empty and the user sees a blank
 * page with no way back — which is exactly what the Exams route did. This
 * boundary keeps the shell alive and offers a recovery action instead.
 *
 * It deliberately does not try to repair application state: the failed
 * subtree is discarded, the error is reported, and the user chooses whether to
 * retry the route or return home.
 */

interface Props {
  children: ReactNode
  /** Rendered instead of the default panel; receives the error and a reset. */
  fallback?: (error: Error, reset: () => void) => ReactNode
  /** Where the failure is reported. Defaults to `console.error` in dev builds. */
  onError?: (error: Error, info: ErrorInfo) => void
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (this.props.onError) this.props.onError(error, info)
    else if (import.meta.env.DEV) console.error('Render error caught by ErrorBoundary:', error, info.componentStack)
  }

  private reset = (): void => this.setState({ error: null })

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)
    return <ErrorPanel error={error} onReset={this.reset} />
  }
}

/**
 * Bilingual recovery panel. Kept dependency-free (inline styles, no i18n hook)
 * so it still renders if the failure was inside the providers themselves.
 */
export function ErrorPanel({ error, onReset }: { error: Error; onReset: () => void }) {
  return (
    <div className="error-panel" role="alert" style={{ maxWidth: 560, margin: '48px auto', padding: 24 }}>
      <h1 style={{ fontSize: '1.25rem', marginBottom: 8 }}>Something went wrong · حصلت مشكلة</h1>
      <p style={{ marginBottom: 8 }}>
        This page could not be displayed. Your saved data is safe on this device.
      </p>
      <p style={{ marginBottom: 8 }} dir="rtl">
        الصفحة دي مقدرتش تتعرض. بياناتك المحفوظة على الجهاز آمنة.
      </p>
      <p style={{ marginBottom: 16, fontFamily: 'monospace', fontSize: 12, opacity: 0.75, wordBreak: 'break-word' }}>
        {error.message}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn--primary btn--md" onClick={onReset}>
          Try again · حاولي تاني
        </button>
        <a className="btn btn--ghost btn--md" href="#/">
          Home · الرئيسية
        </a>
      </div>
    </div>
  )
}
