import type { ReactNode } from 'react'
import { cn } from '../utils/cn'

/* ---- Progress bar --------------------------------------------------- */

interface ProgressBarProps {
  /** 0..1 — values above 1 clamp visually but keep the label honest. */
  value: number
  color?: string
  className?: string
  label?: string
  height?: number
}

export function ProgressBar({ value, color, className, label, height = 8 }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div
      className={cn('progress', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
      style={{ height }}
    >
      <span
        className="progress__fill"
        style={{ width: `${pct}%`, background: color ?? 'var(--clay)' }}
      />
    </div>
  )
}

/* ---- Progress ring -------------------------------------------------- */

interface ProgressRingProps {
  value: number
  size?: number
  thickness?: number
  color?: string
  trackColor?: string
  children?: ReactNode
  className?: string
  /** Rendered at the centre when no children are supplied. */
  caption?: ReactNode
}

export function ProgressRing({
  value,
  size = 120,
  thickness = 10,
  color = 'var(--clay)',
  trackColor = 'var(--line)',
  children,
  className,
  caption,
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(1, value))
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  const dash = circumference * clamped

  return (
    <div className={cn('ring', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={thickness}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="ring__progress"
        />
      </svg>
      <div className="ring__center">{children ?? caption}</div>
    </div>
  )
}

/* ---- Empty state ---------------------------------------------------- */

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  message: ReactNode
  action?: ReactNode
  className?: string
  compact?: boolean
}

export function EmptyState({ icon, title, message, action, className, compact }: EmptyStateProps) {
  return (
    <div className={cn('empty', compact && 'empty--compact', className)}>
      {icon && <div className="empty__icon">{icon}</div>}
      <h3 className="empty__title">{title}</h3>
      <p className="empty__message">{message}</p>
      {action && <div className="empty__action">{action}</div>}
    </div>
  )
}

/* ---- Skeleton ------------------------------------------------------- */

export function Skeleton({ className, width, height }: { className?: string; width?: string | number; height?: string | number }) {
  return <span className={cn('skeleton', className)} style={{ width, height }} aria-hidden="true" />
}

/* ---- Section header ------------------------------------------------- */

interface SectionHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  className?: string
}

export function SectionHeader({ title, subtitle, action, icon, className }: SectionHeaderProps) {
  return (
    <div className={cn('section-head', className)}>
      <div className="section-head__text">
        <h2 className="section-head__title">
          {icon && <span className="section-head__icon">{icon}</span>}
          {title}
        </h2>
        {subtitle && <p className="section-head__subtitle">{subtitle}</p>}
      </div>
      {action && <div className="section-head__action">{action}</div>}
    </div>
  )
}

/* ---- Stat tile ------------------------------------------------------ */

interface StatTileProps {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  accent?: string
  className?: string
}

export function StatTile({ label, value, hint, icon, accent, className }: StatTileProps) {
  return (
    <div className={cn('stat', className)} style={accent ? ({ '--stat-accent': accent } as React.CSSProperties) : undefined}>
      {icon && <span className="stat__icon">{icon}</span>}
      <div className="stat__text">
        <p className="stat__label">{label}</p>
        <p className="stat__value numeric">{value}</p>
        {hint && <p className="stat__hint">{hint}</p>}
      </div>
    </div>
  )
}
