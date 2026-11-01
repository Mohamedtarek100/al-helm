import type { CSSProperties, ReactNode } from 'react'
import { motion } from 'framer-motion'
import { cn } from '../../utils/cn'
import { fadeRise } from './motion'

/**
 * Shared primitives for the Owner Control Center.
 *
 * Deliberately a small, coherent set — every component here is used by at least
 * one real module. Styling lives in styles/admin.css under `.ac-*`, scoped to
 * `.ac-root`, so nothing leaks into the normal 4uLife interface.
 *
 * Motion helpers live in ./motion so this module exports components only (Fast
 * Refresh requires a component-only module).
 */

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
    <section className={cn('ac-card', interactive && 'ac-card--interactive', className)} style={padded ? undefined : { padding: 0 }}>
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
  size = 'md',
  disabled,
  loading,
  type = 'button',
  ariaLabel,
  icon,
  className,
}: {
  children?: ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  disabled?: boolean
  loading?: boolean
  type?: 'button' | 'submit'
  ariaLabel?: string
  icon?: ReactNode
  className?: string
}) {
  return (
    <button
      type={type}
      className={cn(
        'ac-btn',
        variant === 'primary' && 'ac-btn--primary',
        variant === 'ghost' && 'ac-btn--ghost',
        variant === 'danger' && 'ac-btn--danger',
        size === 'sm' && 'ac-btn--sm',
        className,
      )}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={ariaLabel}
    >
      {loading ? <i className="ac-spinner" aria-hidden="true" /> : icon}
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
 *
 * `onRowClick` makes rows keyboard-activatable (Enter/Space) — a div with a
 * click handler alone is not reachable without a pointer.
 */
export function AdminDataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  caption,
  onRowClick,
  selectedKey,
}: {
  columns: AdminColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  empty?: ReactNode
  caption?: string
  onRowClick?: (row: T) => void
  selectedKey?: string | null
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
          {rows.map((row) => {
            const key = rowKey(row)
            const selected = selectedKey === key
            return (
              <tr
                key={key}
                className={cn(selected && 'ac-table__row--selected', onRowClick && 'ac-table__row--clickable')}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={onRowClick ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onRowClick(row)
                  }
                } : undefined}
                aria-selected={onRowClick ? selected : undefined}
              >
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
            )
          })}
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
  unavailableLabel = 'Unavailable',
  footnote,
}: {
  label: ReactNode
  value: number | string | null
  unit?: string
  period?: ReactNode
  source?: ReactNode
  index?: number
  tone?: AdminTone
  unavailableLabel?: string
  footnote?: ReactNode
}) {
  const unavailable = value === null || value === undefined
  return (
    <motion.div {...fadeRise(index)} className="ac-card ac-card--interactive ac-stat">
      <div className="ac-card__head">
        <span className="ac-card__hint">{label}</span>
        {period && <AdminStatusBadge tone={tone}>{period}</AdminStatusBadge>}
      </div>
      <div className="ac-stat__value">
        <strong>{unavailable ? '—' : typeof value === 'number' ? value.toLocaleString() : value}</strong>
        {unit && <span className="ac-card__hint">{unit}</span>}
      </div>
      {unavailable && <p className="ac-card__hint" style={{ margin: '6px 0 0' }}>{unavailableLabel}</p>}
      {footnote && <p className="ac-card__hint" style={{ margin: '6px 0 0' }}>{footnote}</p>}
      {source && <p className="ac-card__hint" style={{ margin: '8px 0 0' }}>{source}</p>}
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* Charts (dependency-free, real data only)                            */
/* ------------------------------------------------------------------ */

/**
 * A compact bar chart.
 *
 * Deliberately hand-rolled: the project has no charting dependency, and adding
 * one for four screens would be a large bundle cost. Every bar is labelled with
 * its value in an accessible description, and the chart is a table for screen
 * readers (the SVG is decorative), so the data is never colour-only.
 */
export function AdminBarChart({
  data,
  height = 140,
  formatValue = (value: number) => String(value),
  emptyLabel,
  ariaLabel,
}: {
  data: { label: string; value: number }[]
  height?: number
  formatValue?: (value: number) => string
  emptyLabel: ReactNode
  ariaLabel: string
}) {
  if (data.length === 0) return <AdminEmptyState title={emptyLabel} />
  const max = Math.max(1, ...data.map((item) => item.value))
  return (
    <div className="ac-chart">
      <div className="ac-chart__bars" style={{ height }} role="img" aria-label={ariaLabel}>
        {data.map((item) => {
          const ratio = item.value / max
          return (
            <div key={item.label} className="ac-chart__col" title={`${item.label}: ${formatValue(item.value)}`}>
              <span className="ac-chart__value">{formatValue(item.value)}</span>
              <span
                className="ac-chart__bar"
                style={{ '--ac-bar-ratio': String(Math.max(ratio, item.value > 0 ? 0.04 : 0)) } as CSSProperties}
              />
              <span className="ac-chart__label">{item.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Horizontal progress rows — used for funnels and rate breakdowns. */
export function AdminProgressList({
  rows,
  emptyLabel,
  formatValue = (value: number) => String(value),
}: {
  rows: { label: string; value: number; max?: number; tone?: AdminTone }[]
  emptyLabel?: ReactNode
  formatValue?: (value: number) => string
}) {
  if (rows.length === 0) return emptyLabel ? <AdminEmptyState title={emptyLabel} /> : null
  const max = Math.max(1, ...rows.map((row) => row.max ?? row.value))
  return (
    <ul className="ac-progress">
      {rows.map((row) => (
        <li key={row.label} className="ac-progress__row">
          <span className="ac-progress__label">{row.label}</span>
          <span className={`ac-progress__track ac-progress__track--${row.tone ?? 'info'}`}>
            <i style={{ width: `${Math.min(100, (row.value / max) * 100)}%` }} />
          </span>
          <span className="ac-progress__value">{formatValue(row.value)}</span>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------ */
/* Footnote                                                            */
/* ------------------------------------------------------------------ */

/**
 * Small explanatory line under a panel — used for provenance notes
 * ("computed by the server at …", "not measured", …).
 */
export function AdminFootNote({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <p className="ac-footnote" style={style}>{children}</p>
}
