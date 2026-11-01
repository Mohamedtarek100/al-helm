/**
 * Motion helpers for the Owner Control Center.
 *
 * Kept out of AdminUI so that module exports components only (Fast Refresh).
 * Every helper degrades to a plain, instant appearance when the user asked the
 * OS to reduce motion.
 */

/** True when the user asked the OS to reduce motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Standard entrance: fade + small rise. Collapses to a plain fade when reduced. */
export function fadeRise(index = 0) {
  if (prefersReducedMotion()) {
    return { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0 } }
  }
  return {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.32, delay: Math.min(index * 0.04, 0.24), ease: [0.22, 1, 0.36, 1] as const },
  }
}
