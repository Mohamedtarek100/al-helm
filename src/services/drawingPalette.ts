/**
 * Dream Studio colour palette and recent-colour history.
 *
 * Pure functions only: no React, no canvas, no storage side effects beyond the
 * injected list. That keeps the behaviour testable and lets the canvas stay a
 * thin renderer.
 */

/** The curated palette, grouped so the toolbar can show rows. */
export const PALETTE_GROUPS: { label: string; colors: string[] }[] = [
  {
    label: 'Ink',
    colors: ['#34312f', '#5c5550', '#8a817a', '#b8ada2'],
  },
  {
    label: 'Warm',
    colors: ['#b66b52', '#d98c6a', '#e7c9c0', '#c99a4e', '#f2d9a0'],
  },
  {
    label: 'Cool',
    colors: ['#89977b', '#aabcc8', '#6d8ea3', '#8c6a82', '#c3d6c0'],
  },
  {
    label: 'Paper',
    colors: ['#fdf8ef', '#ffffff', '#d8c8aa'],
  },
]

/** Flat list, in display order, for lookups and tests. */
export const PALETTE: string[] = PALETTE_GROUPS.flatMap((group) => group.colors)

export const MAX_RECENT_COLORS = 6

const HEX = /^#[0-9a-f]{6}$/i

/** True for a 6-digit hex colour. The <input type="color"> control emits exactly this. */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value)
}

/** Normalises to lower-case hex, or null when the value is not a colour. */
export function normalizeHex(value: unknown): string | null {
  return isHexColor(value) ? value.toLowerCase() : null
}

/**
 * Adds a colour to the front of the recent list.
 * - Invalid values are ignored (the previous list is returned unchanged).
 * - A repeat moves to the front instead of duplicating.
 * - The list is capped at `MAX_RECENT_COLORS`.
 */
export function pushRecentColor(recent: string[], color: unknown): string[] {
  const next = normalizeHex(color)
  if (!next) return [...recent]
  return [next, ...recent.filter((entry) => entry.toLowerCase() !== next)].slice(0, MAX_RECENT_COLORS)
}

/** Parses a stored recent-colour list defensively. */
export function parseRecentColors(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of raw) {
    const hex = normalizeHex(entry)
    if (hex && !seen.has(hex)) {
      seen.add(hex)
      out.push(hex)
    }
    if (out.length >= MAX_RECENT_COLORS) break
  }
  return out
}

/**
 * Chooses black or white text for a swatch so the label stays readable.
 * Uses the standard relative-luminance threshold.
 */
export function contrastTextFor(hex: string): '#000000' | '#ffffff' {
  const color = normalizeHex(hex)
  if (!color) return '#000000'
  const r = parseInt(color.slice(1, 3), 16) / 255
  const g = parseInt(color.slice(3, 5), 16) / 255
  const b = parseInt(color.slice(5, 7), 16) / 255
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
  return luminance > 0.179 ? '#000000' : '#ffffff'
}
