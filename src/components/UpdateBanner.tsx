import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { checkApkUpdate, dismissVersion, type UpdateCheckResult } from '../services/apkUpdate'

/**
 * Optional APK update notice.
 *
 * Shown only on Android, only when a newer APK really exists, and only once per
 * version (a dismissal is remembered). It links to the download; the app never
 * fetches or installs an APK itself.
 */
export function UpdateBanner() {
  const { language } = useI18n()
  const en = language === 'en'
  const [result, setResult] = useState<UpdateCheckResult | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const { App } = await import('@capacitor/app')
        const info = await App.getInfo()
        const check = await checkApkUpdate({ currentVersion: info.version })
        if (active) setResult(check)
      } catch {
        // Plugin missing (web) or version unavailable: no banner.
      }
    })()
    return () => { active = false }
  }, [])

  if (!result?.available || result.dismissed || hidden || !result.manifest) return null

  const { version, apkUrl, notes } = result.manifest

  return (
    <div className="update-banner" role="status">
      <div className="update-banner__text">
        <b>{en ? `Version ${version} is available` : `الإصدار ${version} متاح`}</b>
        <span>{notes ?? (en ? 'A newer version of the app can be installed.' : 'فيه نسخة أحدث من التطبيق تقدر تتثبّت.')}</span>
        <span className="t-xs">
          {en
            ? 'Android will ask you to approve the installation. Only install from a source you trust.'
            : 'أندرويد هيطلب منك الموافقة على التثبيت. ثبّتي بس من مصدر تثقي فيه.'}
        </span>
      </div>
      <a className="btn btn--primary btn--sm" href={apkUrl} target="_blank" rel="noopener noreferrer">
        {en ? 'Download' : 'تحميل'}
      </a>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => { dismissVersion(version); setHidden(true) }}
        aria-label={en ? 'Dismiss this update notice' : 'تجاهل إشعار التحديث'}
      >
        {en ? 'Later' : 'لاحقًا'}
      </button>
    </div>
  )
}
