import type { DrawingDocument, Point, Shape, Stroke, TextElement } from './drawing'

/**
 * Pure geometry for Dream Studio: hit-testing, element movement and the pan/zoom
 * viewport.
 *
 * Everything here is coordinate math with no canvas and no React, so it is fully
 * testable and cannot corrupt a drawing. The document keeps its own coordinates;
 * the viewport is a *view* transform applied at render time only.
 */

export type ElementRef =
  | { kind: 'stroke'; index: number }
  | { kind: 'shape'; index: number }
  | { kind: 'text'; index: number }

/** Axis-aligned bounding box, in document coordinates. */
export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** How far (in document units) a pointer may miss an element and still select it. */
export const HIT_TOLERANCE = 10

/** Approximate glyph box height/width used for text hit-testing. */
function textBox(element: TextElement): Bounds {
  const lines = element.text.split('\n')
  const widest = Math.max(...lines.map((line) => line.length))
  // 0.58em is a good average advance width for the app's sans stack.
  const width = Math.max(element.size, widest * element.size * 0.58)
  const height = lines.length * element.size * 1.25
  return { minX: element.x, minY: element.y, maxX: element.x + width, maxY: element.y + height }
}

export function strokeBounds(stroke: Stroke): Bounds {
  const xs = stroke.points.map((p) => p.x)
  const ys = stroke.points.map((p) => p.y)
  const pad = stroke.size / 2
  return { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad, maxX: Math.max(...xs) + pad, maxY: Math.max(...ys) + pad }
}

export function shapeBounds(shape: Shape): Bounds {
  const pad = shape.size / 2
  return {
    minX: Math.min(shape.from.x, shape.to.x) - pad,
    minY: Math.min(shape.from.y, shape.to.y) - pad,
    maxX: Math.max(shape.from.x, shape.to.x) + pad,
    maxY: Math.max(shape.from.y, shape.to.y) + pad,
  }
}

export function elementBounds(doc: DrawingDocument, ref: ElementRef): Bounds | null {
  if (ref.kind === 'stroke') {
    const stroke = doc.strokes[ref.index]
    return stroke ? strokeBounds(stroke) : null
  }
  if (ref.kind === 'shape') {
    const shape = doc.shapes?.[ref.index]
    return shape ? shapeBounds(shape) : null
  }
  const element = doc.texts?.[ref.index]
  return element ? textBox(element) : null
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  // Project p onto the segment, clamped to its endpoints.
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Distance from a point to a stroke's polyline (not its bounding box). */
export function distanceToStroke(point: Point, stroke: Stroke): number {
  if (stroke.points.length === 1) {
    return Math.hypot(point.x - stroke.points[0].x, point.y - stroke.points[0].y)
  }
  let best = Number.POSITIVE_INFINITY
  for (let i = 1; i < stroke.points.length; i += 1) {
    best = Math.min(best, distanceToSegment(point, stroke.points[i - 1], stroke.points[i]))
  }
  return best
}

/** Distance from a point to a shape's outline. */
export function distanceToShape(point: Point, shape: Shape): number {
  const { from, to } = shape
  if (shape.kind === 'line') return distanceToSegment(point, from, to)
  const box = shapeBounds(shape)
  if (shape.kind === 'rect') {
    const corners: Point[] = [
      { x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY },
      { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY },
    ]
    let best = Number.POSITIVE_INFINITY
    for (let i = 0; i < 4; i += 1) best = Math.min(best, distanceToSegment(point, corners[i], corners[(i + 1) % 4]))
    return best
  }
  // Ellipse: compare the normalised radius from the centre.
  const cx = (box.minX + box.maxX) / 2
  const cy = (box.minY + box.maxY) / 2
  const rx = Math.max(0.5, (box.maxX - box.minX) / 2)
  const ry = Math.max(0.5, (box.maxY - box.minY) / 2)
  const normalised = Math.hypot((point.x - cx) / rx, (point.y - cy) / ry)
  return Math.abs(normalised - 1) * Math.min(rx, ry)
}

function pointInBox(point: Point, box: Bounds, tolerance = 0): boolean {
  return point.x >= box.minX - tolerance && point.x <= box.maxX + tolerance &&
    point.y >= box.minY - tolerance && point.y <= box.maxY + tolerance
}

/**
 * Finds the topmost element under a document-space point.
 *
 * Search order is the paint order, reversed: text (drawn last) → shapes →
 * strokes. The first element whose geometry is within `tolerance` wins, so
 * overlapping elements select the one the user can actually see.
 */
export function hitTest(doc: DrawingDocument, point: Point, tolerance = HIT_TOLERANCE): ElementRef | null {
  const texts = doc.texts ?? []
  for (let i = texts.length - 1; i >= 0; i -= 1) {
    if (pointInBox(point, textBox(texts[i]), tolerance)) return { kind: 'text', index: i }
  }
  const shapes = doc.shapes ?? []
  for (let i = shapes.length - 1; i >= 0; i -= 1) {
    if (distanceToShape(point, shapes[i]) <= tolerance + shapes[i].size / 2) return { kind: 'shape', index: i }
  }
  for (let i = doc.strokes.length - 1; i >= 0; i -= 1) {
    const stroke = doc.strokes[i]
    // Eraser strokes are not selectable: they are a removal, not an object.
    if (stroke.eraser) continue
    if (distanceToStroke(point, stroke) <= tolerance + stroke.size / 2) return { kind: 'stroke', index: i }
  }
  return null
}

/** Applies a translation to any element, returning a new object (never mutates). */
export function translateElement<T extends Stroke | Shape | TextElement>(element: T, dx: number, dy: number): T {
  if ('points' in element) {
    return { ...element, points: element.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
  }
  if ('from' in element) {
    return {
      ...element,
      from: { x: element.from.x + dx, y: element.from.y + dy },
      to: { x: element.to.x + dx, y: element.to.y + dy },
    }
  }
  return { ...element, x: element.x + dx, y: element.y + dy }
}

/** Returns a new document with the referenced element translated. */
export function moveElement(doc: DrawingDocument, ref: ElementRef, dx: number, dy: number): DrawingDocument {
  if (ref.kind === 'stroke') {
    const strokes = doc.strokes.map((s, i) => (i === ref.index ? translateElement(s, dx, dy) : s))
    return { ...doc, strokes }
  }
  if (ref.kind === 'shape') {
    const shapes = (doc.shapes ?? []).map((s, i) => (i === ref.index ? translateElement(s, dx, dy) : s))
    return { ...doc, shapes }
  }
  const texts = (doc.texts ?? []).map((t, i) => (i === ref.index ? translateElement(t, dx, dy) : t))
  return { ...doc, texts }
}

/** Returns a new document with the referenced element removed. */
export function deleteElement(doc: DrawingDocument, ref: ElementRef): DrawingDocument {
  if (ref.kind === 'stroke') return { ...doc, strokes: doc.strokes.filter((_, i) => i !== ref.index) }
  if (ref.kind === 'shape') return { ...doc, shapes: (doc.shapes ?? []).filter((_, i) => i !== ref.index) }
  return { ...doc, texts: (doc.texts ?? []).filter((_, i) => i !== ref.index) }
}

/* ------------------------------------------------------------------ */
/* Viewport (pan + zoom)                                               */
/* ------------------------------------------------------------------ */

export interface Viewport {
  /** Zoom factor. 1 = 100%. */
  scale: number
  /** Translation in *document* units. */
  offsetX: number
  offsetY: number
}

export const MIN_SCALE = 0.5
export const MAX_SCALE = 4
export const DEFAULT_VIEWPORT: Viewport = { scale: 1, offsetX: 0, offsetY: 0 }

/** Clamps zoom to the supported range. */
export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
}

/**
 * Keeps the viewport from wandering so far that the drawing becomes unreachable.
 * The offset is limited to one canvas width/height beyond the edges.
 */
export function clampViewport(viewport: Viewport, docWidth: number, docHeight: number): Viewport {
  const scale = clampScale(viewport.scale)
  const limitX = docWidth
  const limitY = docHeight
  return {
    scale,
    offsetX: Math.max(-limitX, Math.min(limitX, viewport.offsetX)),
    offsetY: Math.max(-limitY, Math.min(limitY, viewport.offsetY)),
  }
}

/** Document point → screen (canvas) point. */
export function toScreen(point: Point, viewport: Viewport): Point {
  return { x: point.x * viewport.scale + viewport.offsetX, y: point.y * viewport.scale + viewport.offsetY }
}

/** Screen (canvas) point → document point. The inverse of toScreen. */
export function toDocument(point: Point, viewport: Viewport): Point {
  return { x: (point.x - viewport.offsetX) / viewport.scale, y: (point.y - viewport.offsetY) / viewport.scale }
}

/** Pans by a screen-space delta. */
export function panBy(viewport: Viewport, dxScreen: number, dyScreen: number, docWidth: number, docHeight: number): Viewport {
  return clampViewport({ ...viewport, offsetX: viewport.offsetX + dxScreen, offsetY: viewport.offsetY + dyScreen }, docWidth, docHeight)
}

/**
 * Zooms around a fixed screen point (the pointer), so the content under the
 * cursor stays under the cursor. Viewport-only: document coordinates of every
 * element are untouched.
 */
export function zoomAt(viewport: Viewport, screenPoint: Point, factor: number, docWidth: number, docHeight: number): Viewport {
  const nextScale = clampScale(viewport.scale * factor)
  if (nextScale === viewport.scale) return viewport
  const anchor = toDocument(screenPoint, viewport)
  const offsetX = screenPoint.x - anchor.x * nextScale
  const offsetY = screenPoint.y - anchor.y * nextScale
  return clampViewport({ scale: nextScale, offsetX, offsetY }, docWidth, docHeight)
}
