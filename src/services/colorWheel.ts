/**
 * Colour-wheel geometry for the Dream Studio picker.
 *
 * Pure functions only — no React, no DOM, no canvas. The wheel is rendered from
 * these numbers, which means the mapping between a pointer position and the
 * colour it selects can be tested without a browser, and the component stays a
 * thin renderer.
 *
 * MODEL: a circular HSV wheel.
 *   - Angle around the wheel is hue (0° red → 360° red).
 *   - Distance from the centre is saturation (0 at centre → 1 at the rim).
 *   - Brightness/value is a separate control, because a wheel alone cannot
 *     express black: every fully-desaturated colour at value 1 is white.
 *
 * The wheel is expressed in 0–1 unit coordinates so it scales to any size.
 */

export interface Hsv {
  /** 0–360 */
  h: number
  /** 0–1 */
  s: number
  /** 0–1 */
  v: number
}

export interface Rgb {
  r: number
  g: number
  b: number
}

/** Point in the wheel's own coordinate space: -1..1 on both axes. */
export interface WheelPoint {
  x: number
  y: number
}

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value)

/** Converts HSV to an `#rrggbb` string. Hue wraps; s/v are clamped. */
export function hsvToHex({ h, s, v }: Hsv): string {
  const hue = ((h % 360) + 360) % 360
  const sat = clamp01(s)
  const val = clamp01(v)
  const c = val * sat
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = val - c
  let r = 0
  let g = 0
  let b = 0
  if (hue < 60) { r = c; g = x }
  else if (hue < 120) { r = x; g = c }
  else if (hue < 180) { g = c; b = x }
  else if (hue < 240) { g = x; b = c }
  else if (hue < 300) { r = x; b = c }
  else { r = c; b = x }
  const to255 = (channel: number) => Math.round((channel + m) * 255)
  return `#${[to255(r), to255(g), to255(b)].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

/** Converts `#rrggbb` to HSV. Returns null for anything that is not a colour. */
export function hexToHsv(hex: string): Hsv | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const int = parseInt(match[1], 16)
  const r = ((int >> 16) & 0xff) / 255
  const g = ((int >> 8) & 0xff) / 255
  const b = (int & 0xff) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  let h = 0
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max }
}

/**
 * Maps a unit-radius wheel position to HSV.
 *
 * Coordinates are -1..1 with (0,0) at the centre. Anything outside the circle
 * is clamped onto the rim, so dragging past the edge keeps tracking instead of
 * producing an out-of-range saturation.
 */
export function pointToHsv(point: WheelPoint, value = 1): Hsv {
  const distance = Math.hypot(point.x, point.y)
  const scale = distance > 1 ? 1 / distance : 1
  const x = point.x * scale
  const y = point.y * scale
  // Angle measured from the positive x axis, converted to hue where 0° is red
  // at the right of the wheel and increases counter-clockwise like a colour
  // wheel (y grows downward in screen space, hence the negation).
  let hue = (Math.atan2(-y, x) * 180) / Math.PI
  if (hue < 0) hue += 360
  // `Math.atan2(-0, -1)` yields -PI, which makes `hue` normalise to -0. A
  // negative zero is numerically equal to 0 but NOT deep-equal to it, so it
  // would fail strict comparisons (and serialise as `` in some JSON paths).
  // Adding 0 normalises -0 to +0 without affecting any other value.
  return { h: hue + 0, s: clamp01(distance), v: clamp01(value) }
}

/** Inverse of `pointToHsv`: where the handle sits for a given colour. */
export function hsvToPoint({ h, s }: Hsv): WheelPoint {
  const radians = (h * Math.PI) / 180
  return { x: Math.cos(radians) * clamp01(s), y: -Math.sin(radians) * clamp01(s) }
}

/** Fraction of the wheel radius, for positioning the handle with a percentage. */
export function pointToPercent(point: WheelPoint): { left: string; top: string } {
  return {
    left: `${((point.x + 1) / 2) * 100}%`,
    top: `${((point.y + 1) / 2) * 100}%`,
  }
}

/**
 * Converts a client pixel position inside an element to a wheel point.
 *
 * Kept separate from the component so the hit maths (including the aspect ratio
 * of a non-square box) is testable. A non-square element would otherwise skew
 * the hue direction and make the wheel feel wrong.
 */
export function clientToWheelPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): WheelPoint {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
  const x = ((clientX - rect.left) / rect.width) * 2 - 1
  const y = ((clientY - rect.top) / rect.height) * 2 - 1
  return { x, y }
}

/**
 * The professional fixed palette: neutrals first (the colours a sketch actually
 * needs), then a balanced spectrum. `#000000` and `#ffffff` are explicit so
 * black and white are always one tap away rather than approximated.
 */
export const STUDIO_PALETTE: { labelKey: string; colors: string[] }[] = [
  { labelKey: 'sketchPaletteNeutral', colors: ['#000000', '#3a3a3a', '#6b6b6b', '#a3a3a3', '#d4d4d4', '#ffffff'] },
  { labelKey: 'sketchPaletteWarm', colors: ['#7f1d1d', '#dc2626', '#f97316', '#f59e0b', '#facc15', '#fde68a'] },
  { labelKey: 'sketchPaletteCool', colors: ['#065f46', '#16a34a', '#0ea5e9', '#1d4ed8', '#6366f1', '#a855f7'] },
  { labelKey: 'sketchPaletteEarth', colors: ['#78350f', '#a16207', '#4d7c0f', '#155e75', '#1e3a8a', '#4c1d95'] },
]

/** Flat list in display order. */
export const STUDIO_PALETTE_FLAT: string[] = STUDIO_PALETTE.flatMap((group) => group.colors)

/**
 * Reads a stored custom colour safely.
 * Returns null rather than throwing, so a corrupted preference can never break
 * the studio on open.
 */
export function readStoredColor(raw: unknown): string | null {
  return typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : null
}
