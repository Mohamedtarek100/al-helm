import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../utils/cn'

/**
 * `Card` renders as several different tags, so its attributes are typed
 * against the common `HTMLElement` base rather than `HTMLDivElement`.
 * Typing against a concrete element would make the `<li>` variant reject
 * handlers whose event targets differ (e.g. `onCopy`, `onCut`).
 */
interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Slightly recessed paper — good for grouped lists inside a card. */
  sunk?: boolean
  padded?: boolean
  interactive?: boolean
  as?: 'div' | 'section' | 'article' | 'li'
}

export function Card({
  sunk = false,
  padded = true,
  interactive = false,
  as: Tag = 'div',
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <Tag
      className={cn(
        'card',
        sunk && 'card--sunk',
        padded && 'card--padded',
        interactive && 'card--interactive',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  )
}

interface CardHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  eyebrow?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  className?: string
}

export function CardHeader({ title, subtitle, eyebrow, action, icon, className }: CardHeaderProps) {
  return (
    <header className={cn('card__head', className)}>
      {icon && <span className="card__head-icon">{icon}</span>}
      <div className="card__head-text">
        {eyebrow && <p className="card__eyebrow">{eyebrow}</p>}
        <h3 className="card__title">{title}</h3>
        {subtitle && <p className="card__subtitle">{subtitle}</p>}
      </div>
      {action && <div className="card__action">{action}</div>}
    </header>
  )
}

export function CardBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('card__body', className)} {...rest}>
      {children}
    </div>
  )
}

export function CardFooter({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('card__footer', className)} {...rest}>
      {children}
    </div>
  )
}
