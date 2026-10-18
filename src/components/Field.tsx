import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { useId } from 'react'
import { cn } from '../utils/cn'

/* ---- Field wrapper ------------------------------------------------- */

interface FieldProps {
  label: string
  hint?: ReactNode
  error?: string | null
  required?: boolean
  className?: string
  children: ReactNode
}

export function Field({ label, hint, error, required, className, children }: FieldProps) {
  return (
    <label className={cn('field', error && 'field--invalid', className)}>
      <span className="field__label">
        {label}
        {required && <span className="field__req" aria-hidden="true"> *</span>}
      </span>
      {children}
      {error ? (
        <span className="field__error" role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="field__hint">{hint}</span>
      )}
    </label>
  )
}

/* ---- Text input ---------------------------------------------------- */

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export function TextInput({ className, invalid, ...rest }: TextInputProps) {
  return <input className={cn('input', invalid && 'input--invalid', className)} {...rest} />
}

/* ---- Textarea ------------------------------------------------------ */

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export function TextArea({ className, invalid, ...rest }: TextAreaProps) {
  return <textarea className={cn('input', 'input--area', invalid && 'input--invalid', className)} {...rest} />
}

/* ---- Select -------------------------------------------------------- */

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean
}

export function Select({ className, invalid, children, ...rest }: SelectProps) {
  return (
    <span className="select-wrap">
      <select className={cn('input', 'input--select', invalid && 'input--invalid', className)} {...rest}>
        {children}
      </select>
      <svg className="select-wrap__caret" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m6 9.5 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

/* ---- Toggle switch ------------------------------------------------- */

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: ReactNode
  disabled?: boolean
  className?: string
}

export function Toggle({ checked, onChange, label, description, disabled, className }: ToggleProps) {
  const id = useId()
  return (
    <div className={cn('toggle-row', className)}>
      <div className="toggle-row__text">
        <label htmlFor={id} className="toggle-row__label">
          {label}
        </label>
        {description && <p className="toggle-row__desc">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={cn('toggle', checked && 'toggle--on')}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle__knob" />
      </button>
    </div>
  )
}

/* ---- Segmented control -------------------------------------------- */

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
}

interface SegmentedProps<T extends string> {
  value: T
  options: SegmentOption<T>[]
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  className?: string
  'aria-label'?: string
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  className,
  'aria-label': ariaLabel,
}: SegmentedProps<T>) {
  return (
    <div className={cn('segmented', `segmented--${size}`, className)} role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={cn('segmented__item', value === option.value && 'segmented__item--active')}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/* ---- Colour swatch picker ------------------------------------------ */

interface ColorSwatchesProps {
  value: string
  options: { key: string; hex: string; label: string }[]
  onChange: (key: string) => void
  className?: string
}

export function ColorSwatches({ value, options, onChange, className }: ColorSwatchesProps) {
  return (
    <div className={cn('swatches', className)} role="radiogroup" aria-label="لون المادة">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          role="radio"
          aria-checked={value === option.key}
          aria-label={option.label}
          title={option.label}
          className={cn('swatch', value === option.key && 'swatch--active')}
          style={{ '--swatch': option.hex } as React.CSSProperties}
          onClick={() => onChange(option.key)}
        />
      ))}
    </div>
  )
}
