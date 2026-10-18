import type { ReactNode } from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../utils/cn'
import { ToastContext, type ToastTone } from './toastContext'

interface Toast {
  id: number
  tone: ToastTone
  message: ReactNode
}

const TOAST_TTL = 3200

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const notify = useCallback(
    (message: ReactNode, tone: ToastTone = 'info') => {
      const id = nextId.current++
      setToasts((current) => [...current.slice(-2), { id, tone, message }])
      window.setTimeout(() => dismiss(id), TOAST_TTL)
    },
    [dismiss],
  )

  const value = useMemo(() => ({ notify }), [notify])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="toast-stack" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <button
              key={toast.id}
              type="button"
              className={cn('toast', `toast--${toast.tone}`)}
              onClick={() => dismiss(toast.id)}
            >
              {toast.message}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}
