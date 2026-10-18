import type { ReactNode } from 'react'
import { createContext, useContext } from 'react'

export type ToastTone = 'info' | 'success' | 'warning' | 'danger'

export interface ToastContextValue {
  notify: (message: ReactNode, tone?: ToastTone) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside <ToastProvider>')
  return context
}
