import { NavLink, Outlet } from 'react-router-dom'
import { BellIcon, CalendarIcon, CheckSquareIcon, CogIcon, HomeIcon, PaletteIcon, TimerIcon, TrendIcon } from '../components/icons'
import { useCollection } from '../services/store'
import { cn } from '../utils/cn'

const nav = [
  { to: '/', label: 'الرئيسية', icon: HomeIcon, end: true },
  { to: '/schedule', label: 'جدولي', icon: CalendarIcon },
  { to: '/tasks', label: 'مهامي', icon: CheckSquareIcon },
  { to: '/focus', label: 'جلسة تركيز', icon: TimerIcon },
  { to: '/studio', label: 'مرسم الحلم', icon: PaletteIcon },
  { to: '/progress', label: 'إنجازاتي', icon: TrendIcon },
  { to: '/notifications', label: 'الإشعارات', icon: BellIcon },
  { to: '/settings', label: 'إعداداتي', icon: CogIcon },
]

function Brand() {
  return (
    <div className="app-brand">
      <img className="brand-mark" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
      <div>
        <div className="brand-wordmark">الحُلم</div>
        <div className="brand-caption">كل صفحة بتقرّبك من الحلم</div>
      </div>
    </div>
  )
}

export function AppShell() {
  const notifications = useCollection('notifications')
  const tasks = useCollection('tasks')
  const unread = notifications.filter((item) => !item.read).length
  const openTasks = tasks.filter((item) => !item.completed).length
  return (
    <div className="app-frame">
      <header className="app-topbar">
        <Brand />
        <div className="topbar-actions">
          <span className="topbar-date">دفتر رحلتك الفنية</span>
          <NavLink className="topbar-bell" to="/notifications" aria-label="الإشعارات">
            <BellIcon size={20} />
            {unread > 0 && <span className="topbar-badge">{unread}</span>}
          </NavLink>
        </div>
      </header>
      <div className="app-body">
        <aside className="sidebar" aria-label="التنقل الرئيسي">
          <p className="sidebar__caption">مساحة رحلتك</p>
          <nav className="nav-list">
            {nav.map(({ to, label, icon: Icon, end }) => {
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
              <p className="sidebar-note__title">إلى الفنانة التي لم تصل بعد</p>
              <p className="sidebar-note__text">لكنها بدأت بالفعل — خطوة صغيرة كل يوم.</p>
            </div>
          </div>
        </aside>
        <main className="main-content" id="main-content"><Outlet /></main>
      </div>
      <nav className="mobile-nav" aria-label="التنقل السريع">
        <div className="mobile-nav__items">
          {nav.filter((item) => ['/', '/schedule', '/tasks', '/focus', '/studio'].includes(item.to)).map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cn('mobile-nav__link', isActive && 'mobile-nav__link--active')}>
              <span className="mobile-nav__icon"><Icon size={20} />{to === '/tasks' && openTasks > 0 && <span className="mobile-nav__badge">{openTasks}</span>}</span>
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
