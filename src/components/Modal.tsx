import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon } from './icons'
import { IconButton } from './Button'
import { cn } from '../utils/cn'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** 'sheet' slides up from the bottom on phones — better for long forms. */
  variant?: 'dialog' | 'sheet'
  size?: 'sm' | 'md' | 'lg'
  labelledBy?: string
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  variant = 'dialog',
  size = 'md',
  labelledBy,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const lastFocused = useRef<HTMLElement | null>(null)

  // Keep the latest callback in a ref so the open/close lifecycle effect does
  // not re-run when the caller passes a fresh inline onClose on every render
  // (re-running it would restore/steal focus and break typing mid-word).
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Escape closes; focus is trapped inside while open.
  useEffect(() => {
    if (!open) return
    lastFocused.current = document.activeElement as HTMLElement | null

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Move focus into the panel without stealing it from the first control.
    const timer = window.setTimeout(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(
        'input:not([type="hidden"]),textarea,select,button',
      )
      ;(target ?? panelRef.current)?.focus()
    }, 40)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      window.clearTimeout(timer)
      lastFocused.current?.focus?.()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className={cn('modal-scrim', variant === 'sheet' && 'modal-scrim--sheet')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={cn('modal', `modal--${variant}`, `modal--${size}`)}
      >
        {variant === 'sheet' && <span className="modal__grip" aria-hidden="true" />}
        <header className="modal__head">
          <div className="modal__head-text">
            <h2 className="modal__title" id={labelledBy}>
              {title}
            </h2>
            {subtitle && <p className="modal__subtitle">{subtitle}</p>}
          </div>
          <IconButton label="إغلاق" onClick={() => onCloseRef.current()} size="sm">
            <CloseIcon size={18} />
          </IconButton>
        </header>

        <div className="modal__body">{children}</div>

        {footer && <footer className="modal__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}

/* ---- Confirmation dialog ------------------------------------------- */

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'تأكيد',
  cancelLabel = 'رجوع',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn--ghost btn--md" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={cn('btn', destructive ? 'btn--danger' : 'btn--primary', 'btn--md')}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="modal__message">{message}</p>
    </Modal>
  )
}
