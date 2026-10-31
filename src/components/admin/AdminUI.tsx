import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { cn } from '../../utils/cn'

/**
 * Shared primitives for the Owner Control Center.
 *
 * Deliberately a small, coherent set — every component here is used by at least
 * one real module. Styling lives in styles/admin.css under `.ac-*`, scoped to
 * `.ac-root`, so nothing leaks into the normal 4uLife interface.
 */

/* ------------------------------------------------------------------ */
/* Motion                                                              */
/* ------------------------------------------------------------------ */

/** True when the user asked the OS to reduce motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Standard entrance: fade + small rise. Collapses to a plain fade when reduced. */
export function fadeRise(index = 0) {
  if (prefersReducedMotion()) {
    return { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0 } }
  }
  return {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.32, delay: Math.min(index * 0.04, 0.24), ease: [0.22, 1, 0.36, 1] as const },
  }
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

export function AdminCard({
  title,
  hint,
  action,
  children,
  interactive = false,
  className,
  padded = true,
}: {
  title?: ReactNode
  hint?: ReactNode
  action?: ReactNode
  children: ReactNode
  interactive?: boolean
  className?: string
  padded?: boolean
}) {
  return (
    <section
      className={cn('ac-card', interactive && 'ac-card--interactive', className)}
      style={padded ? undefined : { padding: 0 }}
    >
      {(title || action) && (
        <header className="ac-card__head" style={padded ? undefined : { padding: '16px 16px 0' }}>
          <div>
            {title && <h2 className="ac-card__title">{title}</h2>}
            {hint && <p className="ac-card__hint" style={{ margin: '4px 0 0' }}>{hint}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

/** Page title + optional description and actions. */
export function AdminPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="ac-page-header">
      <div>
        {eyebrow && <p className="ac-topbar__eyebrow" style={{ margin: '0 0 6px' }}>{eyebrow}</p>}
        <h1 className="ac-page-header__title">{title}</h1>
        {description && <p className="ac-page-header__desc">{description}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
    </header>
  )
}

export function AdminSection({ title, children, id }: { title?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} style={{ marginBottom: 'var(--ac-space-4)' }} aria-label={typeof title === 'string' ? title : undefined}>
      {title && <h2 className="ac-card__title" style={{ margin: '0 0 12px', fontSize: '0.9rem' }}>{title}</h2>}
      {children}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

export type AdminTone = 'ok' | 'warn' | 'error' | 'info' | 'muted'

export function AdminStatusBadge({ tone = 'muted', children }: { tone?: AdminTone; children: ReactNode }) {
  return (
    <span className={`ac-badge ac-badge--${tone}`}>
      <i className="ac-badge__dot" aria-hidden="true" />
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

export function AdminButton({
  children,
  onClick,
  variant = 'default',
  disabled,
  loading,
  type = 'button',
  ariaLabel,
  icon,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'ghost'
  disabled?: boolean
  loading?: boolean
  type?: 'button' | 'submit'
  ariaLabel?: string
  icon?: ReactNode
}) {
  return (
    <button
      type={type}
      className={cn('ac-btn', variant === 'primary' && 'ac-btn--primary', variant === 'ghost' && 'ac-btn--ghost')}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={ariaLabel}
    >
      {loading ? <span className="ac-badge__dot" aria-hidden="true" /> : icon}
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Data states                                                         */
/* ------------------------------------------------------------------ */

export function AdminSkeleton({ height = 18, width = '100%', count = 1 }: { height?: number; width?: string | number; count?: number }) {
  return (
    <div style={{ display: 'grid', gap: 8 }} aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <span key={index} className="ac-skeleton" style={{ height, width, display: 'block' }} />
      ))}
    </div>
  )
}

/**
 * Loading state that announces itself to screen readers.
 * `label` is required so the user always knows WHAT is loading.
 */
export function AdminLoadingState({ label }: { label: string }) {
  return (
    <div className="ac-state" role="status" aria-live="polite">
      <AdminSkeleton height={16} width="60%" count={3} />
      <p className="ac-state__desc" style={{ marginTop: 8 }}>{label}</p>
    </div>
  )
}

export function AdminEmptyState({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="ac-state" role="status">
      <p className="ac-state__title">{title}</p>
      {description && <p className="ac-state__desc">{description}</p>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  )
}

/**
 * Failure state. `message` must be the REAL error — never a fabricated value.
 * Retry is offered only when the caller can actually retry.
 */
export function AdminErrorState({ title, message, onRetry, retryLabel = 'Retry' }: { title: ReactNode; message?: ReactNode; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div className="ac-state" role="alert">
      <p className="ac-state__title">{title}</p>
      {message && <p className="ac-state__desc">{message}</p>}
      {onRetry && <AdminButton onClick={onRetry}>{retryLabel}</AdminButton>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Table                                                               */
/* ------------------------------------------------------------------ */

export interface AdminColumn<T> {
  key: string
  header: ReactNode
  /** Cell renderer. Must not perform requests. */
  render: (row: T) => ReactNode
  /** Hide below this breakpoint to keep mobile usable. */
  hideOnMobile?: boolean
  align?: 'start' | 'end'
}

/**
 * Responsive data table.
 *
 * Below 720px it switches to stacked "card" rows so nothing is clipped and no
 * horizontal scrolling is needed inside the Android WebView.
 */
export function AdminDataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  caption,
}: {
  columns: AdminColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  empty?: ReactNode
  caption?: string
}) {
  if (rows.length === 0) return <>{empty ?? null}</>

  return (
    <div className="ac-table-wrap">
      <table className="ac-table" aria-label={caption}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" data-align={column.align ?? 'start'} data-mobile={column.hideOnMobile ? 'hide' : 'show'}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  data-align={column.align ?? 'start'}
                  data-mobile={column.hideOnMobile ? 'hide' : 'show'}
                  // Shown as the field name when rows stack on narrow screens.
                  data-label={typeof column.header === 'string' ? column.header : undefined}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Stat card                                                           */
/* ------------------------------------------------------------------ */

/**
 * A single KPI.
 *
 * `value` may be null to represent "unavailable" — which is rendered as an
 * explicit "Unavailable" badge rather than a misleading 0.
 */
export function AdminStatCard({
  label,
  value,
  unit,
  period,
  source,
  index = 0,
  tone = 'info',
}: {
  label: ReactNode
  value: number | string | null
  unit?: string
  period?: ReactNode
  source?: ReactNode
  index?: number
  tone?: AdminTone
}) {
  const unavailable = value === null || value === undefined
  return (
    <motion.div {...fadeRise(index)} className="ac-card ac-card--interactive">
      <div className="ac-card__head">
        <span className="ac-card__hint">{label}</span>
        {period && <AdminStatusBadge tone={tone}>{period}</AdminStatusBadge>}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <strong style={{ fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
          {unavailable ? '—' : typeof value === 'number' ? value.toLocaleString() : value}
        </strong>
        {unit && <span className="ac-card__hint">{unit}</span>}
      </div>
      {unavailable && (
        <p className="ac-card__hint" style={{ margin: '6px 0 0' }}>Unavailable</p>
      )}
      {source && <p className="ac-card__hint" style={{ margin: '8px 0 0' }}>{source}</p>}
    </motion.div>
  )
}
