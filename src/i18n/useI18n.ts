import { createContext, useContext } from 'react'
import type { Language, TranslationKey } from './translations'

export interface I18nValue {
  language: Language
  dir: 'ltr' | 'rtl'
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
  locale: 'en-US' | 'ar-EG'
  formatDate: (date: Date | string, options?: Intl.DateTimeFormatOptions) => string
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string
  setLanguage: (language: Language) => void
}

export const I18nContext = createContext<I18nValue | null>(null)

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used within I18nProvider')
  return value
}
