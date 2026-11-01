import type { ReactNode } from 'react'
import { AdminButton } from './AdminUI'

/**
 * Console filter bar.
 *
 * A labelled group of native controls so keyboard and screen-reader users get
 * the same filtering as pointer users. Every control is a real `<select>` /
 * `<input>`; nothing is a custom widget that only responds to clicks.
 */
export function AdminFilterBar({
  children,
  active,
  onClear,
  clearLabel,
}: {
  children: ReactNode
  active: boolean
  onClear: () => void
  clearLabel: string
}) {
  return (
    <div className="ac-filters" role="group">
      <div className="ac-filters__fields">{children}</div>
      {active && (
        <AdminButton variant="ghost" size="sm" onClick={onClear}>
          {clearLabel}
        </AdminButton>
      )}
    </div>
  )
}

export function AdminFilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="ac-filters__field">
      <span className="ac-filters__label">{label}</span>
      {children}
    </label>
  )
}

/** Native select styled by the console. Kept unstyled-by-library on purpose. */
export function AdminSelect<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
  ariaLabel?: string
}) {
  return (
    <select
      className="ac-input ac-select"
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  )
}

export function AdminSearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  ariaLabel: string
}) {
  return (
    <input
      className="ac-input"
      type="search"
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

/** Prev/next pagination with an honest range readout. */
export function AdminPager({
  page,
  onPrev,
  onNext,
  canPrev,
  canNext,
  rangeLabel,
  prevLabel,
  nextLabel,
  busy,
}: {
  page: number
  onPrev: () => void
  onNext: () => void
  canPrev: boolean
  canNext: boolean
  rangeLabel: ReactNode
  prevLabel: string
  nextLabel: string
  busy?: boolean
}) {
  return (
    <nav className="ac-pager" aria-label={rangeLabel == null ? undefined : String(rangeLabel)}>
      <span className="ac-pager__range">{rangeLabel}</span>
      <div className="ac-pager__buttons">
        <AdminButton size="sm" variant="ghost" onClick={onPrev} disabled={!canPrev || busy}>{prevLabel}</AdminButton>
        <span className="ac-pager__page" aria-current="page">{page}</span>
        <AdminButton size="sm" variant="ghost" onClick={onNext} disabled={!canNext || busy}>{nextLabel}</AdminButton>
      </div>
    </nav>
  )
}
