import { useEffect, useRef, type ReactNode } from 'react'
import { AdminButton } from './AdminUI'

/**
 * Side panel used for detail views.
 *
 * Accessibility handled explicitly rather than assumed:
 *   - `role="dialog"` + `aria-modal` so assistive tech announces a modal,
 *   - Escape closes,
 *   - focus moves into the panel on open and returns to the trigger on close,
 *   - the backdrop is a real button (keyboard reachable), not a clickable div.
 */
export function AdminDrawer({
  open,
  title,
  description,
  onClose,
  closeLabel,
  children,
  footer,
}: {
  open: boolean
  title: ReactNode
  description?: ReactNode
  onClose: () => void
  closeLabel: string
  children: ReactNode
  footer?: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = panelRef.current
    // Focus the panel itself first: focusing an arbitrary child can scroll the
    // page and can land on something the user did not expect to activate.
    panel?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      restoreRef.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="ac-drawer-layer">
      <button type="button" className="ac-drawer-backdrop" aria-label={closeLabel} onClick={onClose} />
      <div
        className="ac-drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ac-drawer-title"
        ref={panelRef}
        tabIndex={-1}
      >
        <header className="ac-drawer-panel__head">
          <div>
            <h2 className="ac-drawer-panel__title" id="ac-drawer-title">{title}</h2>
            {description && <p className="ac-card__hint" style={{ margin: '4px 0 0' }}>{description}</p>}
          </div>
          <AdminButton variant="ghost" size="sm" onClick={onClose} ariaLabel={closeLabel}>✕</AdminButton>
        </header>
        <div className="ac-drawer-panel__body">{children}</div>
        {footer && <footer className="ac-drawer-panel__footer">{footer}</footer>}
      </div>
    </div>
  )
}

/** Definition list used by every detail panel. */
export function AdminDefinitionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="ac-dl">
      {items.map((item) => (
        <div key={item.label} className="ac-dl__row">
          <dt className="ac-dl__term">{item.label}</dt>
          <dd className="ac-dl__value">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
