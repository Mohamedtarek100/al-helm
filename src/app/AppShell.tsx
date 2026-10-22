import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { BellIcon, CogIcon, HomeIcon, CalendarIcon, CheckSquareIcon, MenuIcon, CloseIcon, PaletteIcon, TimerIcon, TrendIcon, SunIcon, MoonIcon, MonitorIcon } from '../components/icons'
import { useCollection, updateSettings, useSettings } from '../services/store'
import { cn } from '../utils/cn'
import { useI18n } from '../i18n/useI18n'
import type { TranslationKey } from '../i18n/translations'
import type { Settings } from '../types'

const nav: { to: string; key: TranslationKey; icon: typeof HomeIcon; end?: boolean }[] = [
  { to: '/', key: 'home', icon: HomeIcon, end: true },
  { to: '/schedule', key: 'schedule', icon: CalendarIcon },
  { to: '/calendar', key: 'calendarPage', icon: CalendarIcon },
  { to: '/tasks', key: 'tasks', icon: CheckSquareIcon },
  { to: '/focus', key: 'focus', icon: TimerIcon },
  { to: '/studio', key: 'studio', icon: PaletteIcon },
  { to: '/progress', key: 'progress', icon: TrendIcon },
  { to: '/review', key: 'review', icon: CalendarIcon },
  { to: '/exams', key: 'exams', icon: CalendarIcon },
  { to: '/notifications', key: 'notifications', icon: BellIcon },
  { to: '/settings', key: 'settings', icon: CogIcon },
]

function Brand() {
  const { t } = useI18n()
  return (
    <div className="app-brand">
      <img className="brand-mark" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
      <div>
        <div className="brand-wordmark">{t('brand')}</div>
        <div className="brand-caption">{t('brandCaption')}</div>
      </div>
    </div>
  )
}

function ThemeToggle() {
  const { t } = useI18n()
  const settings = useSettings()
  const cycle: Settings['theme'][] = ['light', 'dark', 'system']
  const next = cycle[(cycle.indexOf(settings.theme) + 1) % 3]
  const Icon = settings.theme === 'dark' ? MoonIcon : settings.theme === 'system' ? MonitorIcon : SunIcon
  const label = settings.theme === 'dark' ? t('themeDark') : settings.theme === 'system' ? t('themeSystem') : t('themeLight')
  return (
    <button
      className="icon-btn icon-btn--ghost"
      type="button"
      aria-label={`${t('theme')}: ${label}`}
      title={`${t('theme')}: ${label}`}
      onClick={() => { void updateSettings({ theme: next }).catch(() => {}) }}
    >
      <Icon size={20} />
    </button>
  )
}

export function AppShell() {
  const { t, language, setLanguage } = useI18n()
  const notifications = useCollection('notifications')
  const tasks = useCollection('tasks')
  const unread = notifications.filter((item) => !item.read).length
  const openTasks = tasks.filter((item) => !item.completed).length
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  useEffect(() => { setMenuOpen(false) }, [location.pathname])
  return (
    <div className="app-frame">
      <header className="app-topbar">
        <div className="topbar-left">
          <button className="mobile-menu-btn" type="button" aria-expanded={menuOpen} aria-controls="mobile-drawer" aria-label={t('primaryNavigation')} onClick={() => setMenuOpen(true)}>
            <MenuIcon size={22} />
          </button>
          <Brand />
        </div>
        <div className="topbar-actions">
          <ThemeToggle />
          <button className="language-toggle" type="button" onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')} aria-label={language === 'en' ? 'Switch to Arabic' : 'Switch to English'}>{language === 'en' ? 'العربية' : 'English'}</button>
          <NavLink className="topbar-bell" to="/notifications" aria-label={t('notifications')}>
            <BellIcon size={20} />
            {unread > 0 && <span className="topbar-badge">{unread}</span>}
          </NavLink>
          <NavLink className="topbar-bell" to="/settings" aria-label={t('settings')}>
            <CogIcon size={20} />
          </NavLink>
        </div>
      </header>
      {menuOpen && (
        <div className="mobile-drawer" id="mobile-drawer" role="dialog" aria-modal="true" aria-label={t('primaryNavigation')}>
          <div className="mobile-drawer__backdrop" onClick={() => setMenuOpen(false)} />
          <aside className="mobile-drawer__panel" aria-label={t('primaryNavigation')}>
            <div className="mobile-drawer__head">
              <Brand />
              <button className="mobile-drawer__close" type="button" aria-label={t('close')} onClick={() => setMenuOpen(false)}>
                <CloseIcon size={20} />
              </button>
            </div>
            <nav className="mobile-drawer__nav">
              {nav.map(({ to, key, icon: Icon, end }) => {
                const label = t(key)
                const badge = to === '/tasks' ? openTasks : to === '/notifications' ? unread : 0
                return (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) => cn('mobile-drawer__link', isActive && 'mobile-drawer__link--active')}
                  >
                    <span className="mobile-drawer__icon"><Icon size={20} /></span>
                    <span className="mobile-drawer__label">{label}</span>
                    {badge > 0 && <span className="mobile-nav__badge">{badge}</span>}
                  </NavLink>
                )
              })}
            </nav>
          </aside>
        </div>
      )}
      <div className="app-body">
        <aside className="sidebar" aria-label={t('primaryNavigation')}>
          <p className="sidebar__caption">{t('navigation')}</p>
          <nav className="nav-list">
            {nav.map(({ to, key, icon: Icon, end }) => {
              const label = t(key)
              const badge = to === '/tasks' ? openTasks : to === '/notifications' ? unread : 0
              return (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) => cn('nav-link', isActive && 'nav-link--active')}
                >
                  <span className="nav-link__icon"><Icon size={20} /></span>
                  <span className="nav-link__label">{label}</span>
                  {badge > 0 && <span className="nav-link__badge">{badge}</span>}
                </NavLink>
              )
            })}
          </nav>
          <div className="sidebar__bottom">
            <div className="sidebar-note">
              <p className="sidebar-note__title">{t('secondaryMessage')}</p>
              <p className="sidebar-note__text">{t('encouragement')}</p>
            </div>
          </div>
        </aside>
        <main className="main-content" id="main-content"><Outlet /></main>
      </div>
      <nav className="mobile-nav" aria-label={t('quickNavigation')}>
        <div className="mobile-nav__items">
          {nav.filter((item) => ['/', '/schedule', '/tasks', '/focus', '/studio'].includes(item.to)).map(({ to, key, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cn('mobile-nav__link', isActive && 'mobile-nav__link--active')}>
              <span className="mobile-nav__icon"><Icon size={20} />{to === '/tasks' && openTasks > 0 && <span className="mobile-nav__badge">{openTasks}</span>}</span>
              <span>{t(key)}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
