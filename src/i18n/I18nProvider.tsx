import { useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { updateSettings, useSettings } from '../services/store'
import { toValidDate } from '../services/date'
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
  const t = useCallback((key: TranslationKey, params?: Record<string, string | number>) => {
    const raw = messages[language][key]
    if (!params) return raw
    let result: string = raw
    for (const [token, value] of Object.entries(params)) result = result.replaceAll(`{${token}}`, String(value))
    return result
  }, [language])
  const formatDate = useCallback((date: Date | string, options: Intl.DateTimeFormatOptions = { dateStyle: 'long' }) => {
    // Any unparsable date is rendered as an em dash. A raw `Intl.format()` on an
    // invalid Date throws RangeError('Invalid time value'), which used to
    // unmount the whole route — this keeps a bad record to one bad cell.
    const parsed = toValidDate(date)
    if (!parsed) return '—'
    try {
      return new Intl.DateTimeFormat(locale, { ...options, calendar: 'gregory' }).format(parsed)
    } catch {
      return '—'
    }
  }, [locale])
  const formatNumber = useCallback((value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, options).format(value), [locale])
  const value = useMemo(() => ({ language, dir, locale, t, formatDate, formatNumber, setLanguage }), [language, dir, locale, t, formatDate, formatNumber, setLanguage])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

