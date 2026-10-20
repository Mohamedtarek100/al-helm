import { useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { updateSettings, useSettings } from '../services/store'
import { I18nContext } from './useI18n'
import { messages, type Language, type TranslationKey } from './translations'

export function I18nProvider({ children }: { children: ReactNode }) {
  const settings = useSettings()
  const language: Language = settings.language === 'ar' ? 'ar' : 'en'
  const dir: 'ltr' | 'rtl' = language === 'ar' ? 'rtl' : 'ltr'

  useEffect(() => {
    document.documentElement.lang = language === 'ar' ? 'ar-EG' : 'en-US'
    document.documentElement.dir = dir
  }, [language, dir])

  const locale: 'en-US' | 'ar-EG' = language === 'ar' ? 'ar-EG' : 'en-US'
  const setLanguage = useCallback((next: Language) => updateSettings({ language: next }), [])
  const t = useCallback((key: TranslationKey) => messages[language][key], [language])
  const formatDate = useCallback((date: Date | string, options: Intl.DateTimeFormatOptions = { dateStyle: 'long' }) => {
    const parsed = typeof date === 'string' ? (() => { const [year, month, day] = date.split('-').map(Number); return new Date(year, month - 1, day) })() : date
    return new Intl.DateTimeFormat(locale, { ...options, calendar: 'gregory' }).format(parsed)
  }, [locale])
  const formatNumber = useCallback((value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, options).format(value), [locale])
  const value = useMemo(() => ({ language, dir, locale, t, formatDate, formatNumber, setLanguage }), [language, dir, locale, t, formatDate, formatNumber, setLanguage])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

