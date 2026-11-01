import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AdminStatusBadge } from './AdminUI'
import { prefersReducedMotion } from './motion'
import { cn } from '../../utils/cn'

/**
 * Owner Control Center shell: sidebar + topbar + workspace.
 *
 * The console owns its own dark palette via `.ac-root`; it never overrides the
 * normal 4uLife theme. Navigation is driven by the caller so authorization
 * stays the single source of truth for what exists.
 */

export interface AdminNavItem {
  id: string
  label: ReactNode
  icon: ReactNode
  /** Rendered but visually marked as upcoming; never a fake tool. */
  comingSoon?: boolean
}

export interface AdminLayoutProps {
  nav: AdminNavItem[]
  active: string
  onNavigate: (id: string) => void
  title: ReactNode
  eyebrow?: ReactNode
  /**
   * The SERVER-confirmed owner email (from the gate), never a client guess.
   * `null` renders a neutral, honest label rather than a placeholder address.
   */
  ownerEmail: string | null
  /**
   * Live authorization state, also server-derived. The console is only
   * mounted once the gate reports `authorized`; this prop keeps the indicator
   * truthful if the gate later re-resolves (token refresh failure, sign-out).
   */
  authorization?: 'authorized' | 'verifying' | 'denied' | 'unknown'
  status?: { tone: 'ok' | 'warn' | 'error' | 'info' | 'muted'; label: ReactNode }
  onRefresh?: () => void
  refreshing?: boolean
  labels?: {
    openNav?: string
    closeNav?: string
    refresh?: string
    refreshing?: string
    workspace?: string
    sections?: string
    soon?: string
    authorized?: string
    verifying?: string
    denied?: string
    unknown?: string
  }
  /** Console name; localized by the page, English fallbacks here. */
  brand?: { title: string; subtitle: string }
  children: ReactNode
}

/**
 * Owner indicator states.
 *
 * REGRESSION THIS PREVENTS: the previous indicator was a hardcoded green dot
 * with its colour inlined from a CSS variable that the dot itself set, so it
 * always looked "healthy" — even while the gate was still resolving or had
 * just been invalidated. It now reflects the real, server-derived state.
 */
const AUTHORIZATION_INDICATOR: Record<
  NonNullable<AdminLayoutProps['authorization']>,
  { tone: 'ok' | 'warn' | 'error' | 'muted'; label: string }
> = {
  authorized: { tone: 'ok', label: 'Verified' },
  verifying: { tone: 'warn', label: 'Verifying' },
  denied: { tone: 'error', label: 'Not authorized' },
  unknown: { tone: 'muted', label: 'Unknown' },
}

const DRAWER_MOTION = prefersReducedMotion()
  ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
  : {
      initial: { x: '-100%' },
      animate: { x: 0 },
      exit: { x: '-100%' },
      transition: { type: 'tween' as const, duration: 0.26, ease: [0.22, 1, 0.36, 1] as const },
    }

export function AdminLayout({
  nav,
  active,
  onNavigate,
  title,
  eyebrow,
  ownerEmail,
  authorization = 'unknown',
  status,
  onRefresh,
  refreshing,
  labels,
  brand,
  children,
}: AdminLayoutProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const indicator = AUTHORIZATION_INDICATOR[authorization]
  const stateLabel = labels?.[authorization === 'authorized' ? 'authorized' : authorization] ?? indicator.label

  // Close the drawer on Escape; restore focus is handled by the trigger button.
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrawerOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  const navList = (collapsed = false, onPick?: () => void) => (
    <nav className="ac-nav" aria-label={labels?.sections ?? 'Owner console sections'}>
      <p className="ac-nav__label">{labels?.workspace ?? 'Workspace'}</p>
      {nav.map((item) => {
        const isActive = item.id === active
        return (
          <button
            key={item.id}
            type="button"
            className={cn('ac-nav__item', isActive && 'ac-nav__item--active')}
            onClick={() => {
              if (item.comingSoon) return
              onNavigate(item.id)
              onPick?.()
            }}
            aria-current={isActive ? 'page' : undefined}
            aria-disabled={item.comingSoon || undefined}
            // A coming-soon entry is genuinely non-interactive, not a dead button
            // pretending to work.
            disabled={item.comingSoon}
          >
            <span aria-hidden="true" style={{ display: 'inline-flex', flex: '0 0 auto' }}>{item.icon}</span>
            {!collapsed && <span className="ac-nav__text">{item.label}</span>}
            {!collapsed && item.comingSoon && <AdminStatusBadge tone="muted">{labels?.soon ?? 'Soon'}</AdminStatusBadge>}
          </button>
        )
      })}
    </nav>
  )

  return (
    <div className="ac-root">
      {/* ---------- Sidebar (desktop) ---------- */}
      <aside className="ac-sidebar" aria-label={labels?.sections ?? 'Owner console'}>
        <div className="ac-brand">
          <span className="ac-brand__mark" aria-hidden="true">4u</span>
          <div className="ac-brand__text">
            <div className="ac-brand__title">{brand?.title ?? 'Owner Control Center'}</div>
            <div className="ac-brand__subtitle">{brand?.subtitle ?? 'Command & Intelligence'}</div>
          </div>
        </div>
        {navList()}
      </aside>

      {/* ---------- Main ---------- */}
      <div className="ac-main">
        <header className="ac-topbar">
          <button
            type="button"
            className="ac-btn ac-btn--ghost ac-mobile-trigger"
            onClick={() => setDrawerOpen(true)}
            aria-label={labels?.openNav ?? 'Open console navigation'}
            aria-expanded={drawerOpen}
          >
            <span aria-hidden="true">☰</span>
          </button>

          <div className="ac-topbar__section">
            {eyebrow && <span className="ac-topbar__eyebrow">{eyebrow}</span>}
            <span className="ac-topbar__title">{title}</span>
          </div>

          <div className="ac-topbar__spacer" />

          {status && <AdminStatusBadge tone={status.tone}>{status.label}</AdminStatusBadge>}

          {onRefresh && (
            <button
              type="button"
              className="ac-btn ac-btn--ghost"
              onClick={onRefresh}
              disabled={refreshing}
              aria-busy={refreshing || undefined}
              aria-label={refreshing ? (labels?.refreshing ?? 'Refreshing') : (labels?.refresh ?? 'Refresh data')}
            >
              <span aria-hidden="true" style={{ display: 'inline-block' }}>{refreshing ? '◌' : '⟳'}</span>
            </button>
          )}

          {/*
            OWNER INDICATOR
            The dot colour comes from the badge tone class (never an inline
            colour), and both the dot and the label describe the REAL gate
            state. Nothing here asserts authority on its own: the server already
            authorized this session before the console was mounted.
          */}
          <div
            className={`ac-topbar__owner ac-topbar__owner--${indicator.tone}`}
            title={ownerEmail ?? undefined}
            role="status"
            aria-live="polite"
          >
            <i className="ac-badge__dot" aria-hidden="true" />
            <span>{ownerEmail ?? (authorization === 'authorized' ? 'Owner' : stateLabel)}</span>
            {ownerEmail && <span className="ac-topbar__owner-state">{stateLabel}</span>}
          </div>
        </header>

        <main className="ac-workspace" id="admin-workspace">
          {children}
        </main>
      </div>

      {/* ---------- Mobile drawer ---------- */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.button
              type="button"
              className="ac-drawer-backdrop"
              aria-label={labels?.closeNav ?? 'Close navigation'}
              onClick={() => setDrawerOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DRAWER_MOTION.transition.duration }}
            />
            <motion.aside className="ac-drawer" aria-label={labels?.sections ?? 'Owner console'} {...DRAWER_MOTION}>
              <div style={{ padding: '20px 16px' }}>
                <div className="ac-brand" style={{ marginBottom: 12 }}>
                  <span className="ac-brand__mark" aria-hidden="true">4u</span>
                  <div className="ac-brand__text">
                    <div className="ac-brand__title">{brand?.title ?? 'Owner Control Center'}</div>
                    <div className="ac-brand__subtitle">{brand?.subtitle ?? 'Command & Intelligence'}</div>
                  </div>
                </div>
                {navList(false, () => setDrawerOpen(false))}
                <button type="button" className="ac-btn ac-btn--ghost" style={{ marginTop: 12 }} onClick={() => setDrawerOpen(false)}>
                  {labels?.closeNav ?? 'Close'}
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
