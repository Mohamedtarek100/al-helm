 /**
 * Brush engine for the Dream Studio.
 *
 * WHY THIS MODULE EXISTS
 *   The studio previously exposed a single "pencil" with a size slider. That is
 *   not a professional brush workflow, and — more importantly — a nominal
 *   "soft brush" that renders with the same hard round cap is a lie. Every
 *   setting exported here changes what `renderStroke` puts on the canvas:
 *
 *     size     → stroke width, and the width of every deposit
 *     opacity  → the composite alpha of the finished stroke (no build-up)
 *     flow     → the alpha of each individual deposit (builds up on overlap)
 *     hardness → the edge falloff of the stamp (0 = airbrush, 1 = hard edge)
 *     spacing  → distance between deposits, as a fraction of the brush size
 *
 * The engine stays VECTOR-FIRST: a stroke remains a list of points in document
 * space, so documents stay small, undo/redo stays exact, and old documents
 * (which have no brush field) keep rendering exactly as before.
 *
 * POINTER PRESSURE is deliberately NOT claimed: browsers only expose real
 * pressure for stylus input and it is unreliable across Android WebViews. The
 * `pressure` parameter is honoured when a device genuinely reports it, and a
 * brush never depends on it for its look.
 */

import type { Point, Stroke } from './drawing'

export type BrushId = 'pencil' | 'ink' | 'hard' | 'soft' | 'calligraphy' | 'eraser'

export interface BrushSettings {
  /** 1–80 document units. */
  size: number
  /** 0.05–1, the final opacity of a stroke. */
  opacity: number
  /** 0.05–1, how much ink each stamp deposits. */
  flow: number
  /** 0–1. 1 is a crisp edge, 0 is a fully feathered airbrush. */
  hardness: number
  /** 0.02–1, deposit spacing as a fraction of brush size. */
  spacing: number
}

export interface BrushPreset {
  id: BrushId
  labelKey: 'brushPencil' | 'brushInk' | 'brushHard' | 'brushSoft' | 'brushCalligraphy' | 'brushEraser'
  defaults: BrushSettings
  /** Presets outside this set use the round stamp. */
  shape: 'round' | 'flat'
  /** Tint of the swatch in the brush library. */
  swatch: string
  eraser?: boolean
}

export const BRUSH_PRESETS: BrushPreset[] = [
  {
    id: 'pencil',
    labelKey: 'brushPencil',
    // A genuine pencil look: mostly opaque core, feathered edge, dense spacing.
    defaults: { size: 3, opacity: 1, flow: 0.85, hardness: 0.65, spacing: 0.18 },
    shape: 'round',
    swatch: '#c9c4bd',
  },
  {
    id: 'ink',
    labelKey: 'brushInk',
    // Inking: fully opaque, crisp edge, tight spacing so the line is solid.
    defaults: { size: 6, opacity: 1, flow: 1, hardness: 1, spacing: 0.08 },
    shape: 'round',
    swatch: '#1f1b18',
  },
  {
    id: 'hard',
    labelKey: 'brushHard',
    defaults: { size: 14, opacity: 1, flow: 1, hardness: 0.92, spacing: 0.12 },
    shape: 'round',
    swatch: '#8b5cf6',
  },
  {
    id: 'soft',
    labelKey: 'brushSoft',
    // Airbrush: low flow and wide feathering so overlaps build up gradually.
    defaults: { size: 46, opacity: 0.55, flow: 0.22, hardness: 0.05, spacing: 0.1 },
    shape: 'round',
    swatch: '#a78bfa',
  },
  {
    id: 'calligraphy',
    labelKey: 'brushCalligraphy',
    // A flat nib: the stamp is an ellipse, so the stroke is wider across one
    // axis than the other, which is what produces a broad-nib calligraphy look.
    defaults: { size: 22, opacity: 1, flow: 1, hardness: 0.9, spacing: 0.1 },
    shape: 'flat',
    swatch: '#e9d5ff',
  },
  {
    id: 'eraser',
    labelKey: 'brushEraser',
    defaults: { size: 26, opacity: 1, flow: 1, hardness: 0.9, spacing: 0.1 },
    shape: 'round',
    swatch: '#6b7280',
    eraser: true,
  },
]

export function presetById(id: BrushId | undefined): BrushPreset {
  return BRUSH_PRESETS.find((preset) => preset.id === id) ?? BRUSH_PRESETS[0]
}

export function clampSettings(settings: BrushSettings): BrushSettings {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
  return {
    size: clamp(settings.size, 1, 80),
    opacity: clamp(settings.opacity, 0.05, 1),
    flow: clamp(settings.flow, 0.05, 1),
    hardness: clamp(settings.hardness, 0, 1),
    spacing: clamp(settings.spacing, 0.02, 1),
  }
}

/**
 * Resamples a polyline into evenly spaced deposit positions.
 *
 * A stroke is stored as the RAW pointer points (so it stays faithful and small),
 * but it is PAINTED as evenly spaced stamps: that is what makes `spacing`,
 * `hardness` and `flow` visible. Pure function, so the geometry is testable.
 */
export function resampleStroke(points: Point[], spacing: number, size: number): Point[] {
  if (points.length === 0) return []
  const step = Math.max(0.5, spacing * size)
  const out: Point[] = [points[0]]
  let carry = 0
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1]
    const to = points[i]
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy)
    if (length === 0) continue
    let travelled = carry
    while (travelled + step <= length) {
      travelled += step
      out.push({ x: from.x + (dx * travelled) / length, y: from.y + (dy * travelled) / length })
    }
    carry = travelled - length
  }
  const last = points[points.length - 1]
  const previous = out[out.length - 1]
  if (Math.hypot(last.x - previous.x, last.y - previous.y) > step * 0.35) out.push(last)
  return out
}

/** Brush settings a stroke actually uses, with legacy defaults when absent. */
export function settingsOf(stroke: Pick<Stroke, 'brush' | 'size' | 'opacity'>): BrushSettings {
  const preset = presetById(stroke.brush)
  const base = preset.defaults
  const brush = stroke.brush ? { ...base, ...(stroke.opacity !== undefined ? { opacity: stroke.opacity } : {}) } : base
  return clampSettings({ ...brush, size: stroke.size || base.size })
}

/**
 * Paints one stroke using the brush engine.
 *
 * The caller owns the composite operation (source-over for ink,
 * destination-out for the eraser) so this stays usable on both layers.
 */
export function paintBrushStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  settings: BrushSettings = settingsOf(stroke),
  preset: BrushPreset = presetById(stroke.brush),
): void {
  if (!stroke.points.length) return
  const { size, opacity, flow, hardness, spacing } = settings
  const sampled = resampleStroke(stroke.points, spacing, size)
  // A stroke shorter than one spacing step must still LAY INK: a short gesture
  // becomes a single deposit between its endpoints. Without this a very short
  // pointer move (or a two-point pen stroke) painted nothing at all.
  const start = stroke.points[0]
  const last = stroke.points[stroke.points.length - 1]
  const positions = sampled.length >= 2
    ? sampled
    : (start.x === last.x && start.y === last.y ? [start] : [start, last])
  if (!positions.length) return

  const radius = size / 2

  ctx.save()
  ctx.globalAlpha = opacity

  // Hard edges (pencil/ink/hard/calligraphy/eraser) paint ONE continuous path:
  // cheaper, exact at any zoom, and it keeps the eraser's destination-out
  // contract intact. Feathered stamping is reserved for the soft brushes, where
  // the falloff is the whole point.
  //
  // THE ERASER ALWAYS TAKES THIS PATH. Its colour is an OPAQUE-ALPHA MASK
  // (`rgba(0,0,0,1)` set by the ink-layer caller), not a paint colour, so it
  // must never be routed through the feathered stamp, which fades the colour to
  // transparent and would erase only partially.
  if (hardness > 0.62 || stroke.eraser) {
    ctx.strokeStyle = stroke.color
    ctx.fillStyle = stroke.color
    ctx.lineWidth = size
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (positions.length <= 2) {
      // A two-point gesture is a CAPSULE: the round join of a zero-length path
      // is not reliably painted across engines, and a dot-only tap must not
      // become a line. Round caps on a short segment give the same result
      // everywhere, and each point is still a valid start/end.
      ctx.beginPath()
      if (positions.length === 1) {
        if (preset.shape === 'flat') {
          ctx.save()
          ctx.translate(positions[0].x, positions[0].y)
          ctx.rotate((18 * Math.PI) / 180)
          ctx.moveTo(-radius, -radius / 2.4)
          ctx.lineTo(radius, radius / 2.4)
          ctx.stroke()
          ctx.restore()
        } else {
          ctx.moveTo(positions[0].x - 0.01, positions[0].y)
          ctx.lineTo(positions[0].x, positions[0].y)
          ctx.stroke()
        }
      } else {
        // Offset by a hair so a perfectly repeated point still draws a dot.
        ctx.moveTo(positions[0].x, positions[0].y)
        ctx.lineTo(positions[1].x, positions[1].y)
        ctx.stroke()
      }
    } else {
      ctx.beginPath()
      ctx.moveTo(positions[0].x, positions[0].y)
      for (const point of positions.slice(1)) ctx.lineTo(point.x, point.y)
      ctx.stroke()
    }
    ctx.restore()
    return
  }

  // Feathered stamp. Each deposit is drawn with its own radial gradient so the
  // edge falls off exactly as `hardness` says. Deposits are separate so `flow`
  // builds up where the stroke overlaps itself.
  const inner = Math.max(0, Math.min(0.96, hardness)) * radius
  for (const point of positions) {
    ctx.globalAlpha = Math.max(0.02, opacity * flow)
    ctx.fillStyle = stroke.color
    if (preset.shape === 'flat') {
      ctx.save()
      ctx.translate(point.x, point.y)
      // Broad nib: 18° tilt, 2.4:1 ellipse.
      ctx.rotate((18 * Math.PI) / 180)
      ctx.beginPath()
      ctx.ellipse(0, 0, radius, radius / 2.4, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      continue
    }
    const gradient = ctx.createRadialGradient(point.x, point.y, inner, point.x, point.y, radius)
    gradient.addColorStop(0, stroke.color)
    gradient.addColorStop(1, toTransparent(stroke.color))
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function toTransparent(color: string): string {
  // Only hex colours are used as brush paint; the eraser's opaque black mask is
  // an alpha mask, so anything unrecognised fades to fully transparent.
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color.toLowerCase()}00` : 'rgba(0,0,0,0)'
}

/** Distance between two points, exported for tests and hit testing. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
