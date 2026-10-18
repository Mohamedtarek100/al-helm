import type { ReactNode } from 'react'
import { cn } from '../utils/cn'

export function PageFrame({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('app-page page-enter', className)}>{children}</div>
}

export function PageHeading({ eyebrow, title, subtitle, action }: { eyebrow?: string; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="page-heading">
      <div className="page-heading__copy">
        {eyebrow && <p className="page-heading__eyebrow">{eyebrow}</p>}
        <h1 className="page-heading__title">{title}</h1>
        {subtitle && <p className="page-heading__subtitle">{subtitle}</p>}
      </div>
      {action}
    </header>
  )
}
