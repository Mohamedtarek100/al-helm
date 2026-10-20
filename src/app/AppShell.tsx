import { NavLink, Outlet } from 'react-router-dom'
import { BellIcon, CalendarIcon, CheckSquareIcon, CogIcon, HomeIcon, PaletteIcon, TimerIcon, TrendIcon } from '../components/icons'
import { useCollection } from '../services/store'
import { cn } from '../utils/cn'
import { useI18n } from '../i18n/useI18n'
import type { TranslationKey } from '../i18n/translations'

const nav: { to: string; key: TranslationKey; icon: typeof HomeIcon; end?: boolean }[] = [
  { to: '/', key: 'home', icon: HomeIcon, end: true },
  { to: '/schedule', key: 'schedule', icon: CalendarIcon },
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

export function AppShell() {
  const { t, language, setLanguage } = useI18n()
  const notifications = useCollection('notifications')
  const tasks = useCollection('tasks')
  const unread = notifications.filter((item) => !item.read).length
  const openTasks = tasks.filter((item) => !item.completed).length
  return (
    <div className="app-frame">
      <header className="app-topbar">
        <Brand />
        <div className="topbar-actions">
          <span className="topbar-date">{t('tagline')}</span>
          <button className="language-toggle" type="button" onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')} aria-label={language === 'en' ? 'Switch to Arabic' : 'Switch to English'}>{language === 'en' ? 'العربية' : 'English'}</button>
          <NavLink className="topbar-bell" to="/notifications" aria-label={t('notifications')}>
            <BellIcon size={20} />
            {unread > 0 && <span className="topbar-badge">{unread}</span>}
          </NavLink>
        </div>
      </header>
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
