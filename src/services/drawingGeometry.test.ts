import { describe, expect, it } from 'vitest'
import { emptyDocument } from './drawing'
import type { DrawingDocument, Shape, TextElement } from './drawing'
import {
  hitTest,
  moveElement,
  deleteElement,
  translateElement,
  distanceToStroke,
  distanceToShape,
  elementBounds,
  toScreen,
  toDocument,
  panBy,
  zoomAt,
  clampScale,
  clampViewport,
  DEFAULT_VIEWPORT,
  MIN_SCALE,
  MAX_SCALE,
  type ElementRef,
} from './drawingGeometry'

/**
 * Selection, movement and viewport math.
 *
 * The invariant that matters most: navigating the canvas must NEVER change
 * document coordinates. Only `moveElement` changes geometry, and it returns a
 * new document.
 */

const stroke = (points: Array<[number, number]>) => ({ points: points.map(([x, y]) => ({ x, y })), color: '#000', size: 4, eraser: false })
const rect: Shape = { id: 's1', kind: 'rect', from: { x: 100, y: 100 }, to: { x: 200, y: 160 }, color: '#b66b52', size: 4 }
const circle: Shape = { id: 's2', kind: 'ellipse', from: { x: 300, y: 100 }, to: { x: 400, y: 200 }, color: '#89977b', size: 4 }
const line: Shape = { id: 's3', kind: 'line', from: { x: 500, y: 100 }, to: { x: 600, y: 200 }, color: '#34312f', size: 2 }
const text: TextElement = { id: 't1', x: 50, y: 300, text: 'Hello', color: '#34312f', size: 28 }

const doc = (): DrawingDocument => ({
  ...emptyDocument(),
  strokes: [stroke([[10, 10], [110, 10]])],
  shapes: [rect, circle, line],
  texts: [text],
})

describe('hit testing', () => {
  it('selects a stroke along its polyline', () => {
    expect(hitTest(doc(), { x: 60, y: 11 })).toEqual<ElementRef>({ kind: 'stroke', index: 0 })
  })

  it('misses a point far from any element', () => {
    expect(hitTest(doc(), { x: 700, y: 500 })).toBeNull()
  })

  it('selects a rectangle on its edge, not its centre', () => {
    expect(hitTest(doc(), { x: 100, y: 130 })).toEqual<ElementRef>({ kind: 'shape', index: 0 })
    // The interior is empty for an outline shape.
    expect(hitTest(doc(), { x: 150, y: 130 })).toBeNull()
  })

  it('selects an ellipse on its curve, not its centre', () => {
    expect(hitTest(doc(), { x: 350, y: 100 })).toEqual<ElementRef>({ kind: 'shape', index: 1 })
    expect(hitTest(doc(), { x: 350, y: 150 })).toBeNull()
  })

  it('selects a line', () => {
    expect(hitTest(doc(), { x: 550, y: 150 })).toEqual<ElementRef>({ kind: 'shape', index: 2 })
  })

  it('selects text inside its box', () => {
    expect(hitTest(doc(), { x: 60, y: 310 })).toEqual<ElementRef>({ kind: 'text', index: 0 })
  })

  it('prefers the topmost element (text over shapes over strokes)', () => {
    const overlapping: DrawingDocument = {
      ...emptyDocument(),
      strokes: [stroke([[0, 0], [200, 200]])],
      shapes: [{ ...rect, from: { x: 0, y: 0 }, to: { x: 200, y: 200 } }],
      texts: [{ id: 't', x: 0, y: 0, text: 'X', color: '#000', size: 40 }],
    }
    // A point on the rect edge AND inside the text box → text wins.
    expect(hitTest(overlapping, { x: 5, y: 5 })?.kind).toBe('text')
  })

  it('never selects an eraser stroke', () => {
    const erased: DrawingDocument = { ...emptyDocument(), strokes: [{ ...stroke([[0, 0], [100, 0]]), eraser: true }] }
    expect(hitTest(erased, { x: 50, y: 0 })).toBeNull()
  })

  it('tolerates a near miss within the hit tolerance', () => {
    expect(hitTest(doc(), { x: 60, y: 18 })).not.toBeNull()
    expect(hitTest(doc(), { x: 60, y: 40 })).toBeNull()
  })
})

describe('distance helpers', () => {
  it('measures distance to a stroke polyline', () => {
    expect(distanceToStroke({ x: 60, y: 20 }, stroke([[10, 10], [110, 10]]))).toBeCloseTo(10)
  })

  it('measures distance to a shape outline', () => {
    expect(distanceToShape({ x: 150, y: 130 }, rect)).toBeGreaterThan(20)
    expect(distanceToShape({ x: 350, y: 100 }, circle)).toBeLessThan(6)
  })

  it('returns bounds for each element kind', () => {
    expect(elementBounds(doc(), { kind: 'stroke', index: 0 })).toMatchObject({ minY: 8 })
    expect(elementBounds(doc(), { kind: 'shape', index: 0 })).toMatchObject({ minX: 98 })
    expect(elementBounds(doc(), { kind: 'text', index: 0 })).toMatchObject({ minX: 50, minY: 300 })
  })

  it('returns null for an out-of-range reference', () => {
    expect(elementBounds(doc(), { kind: 'shape', index: 99 })).toBeNull()
  })
})

describe('moving and deleting', () => {
  it('moves a stroke without mutating the original', () => {
    const before = doc()
    const original = JSON.stringify(before)
    const moved = moveElement(before, { kind: 'stroke', index: 0 }, 25, -5)
    expect(moved.strokes[0].points[0]).toEqual({ x: 35, y: 5 })
    expect(JSON.stringify(before)).toBe(original)
  })

  it('moves a shape by translating both corners', () => {
    const moved = moveElement(doc(), { kind: 'shape', index: 0 }, 10, 10)
    expect(moved.shapes![0]).toMatchObject({ from: { x: 110, y: 110 }, to: { x: 210, y: 170 } })
  })

  it('moves text', () => {
    const moved = moveElement(doc(), { kind: 'text', index: 0 }, -20, 40)
    expect(moved.texts![0]).toMatchObject({ x: 30, y: 340 })
  })

  it('deletes only the referenced element', () => {
    const after = deleteElement(doc(), { kind: 'shape', index: 1 })
    expect(after.shapes).toHaveLength(2)
    expect(after.shapes!.map((s) => s.id)).toEqual(['s1', 's3'])
    expect(after.strokes).toHaveLength(1)
    expect(after.texts).toHaveLength(1)
  })

  it('translateElement is kind-agnostic', () => {
    expect(translateElement(text, 1, 2)).toMatchObject({ x: 51, y: 302 })
    expect(translateElement(line, 1, 2)).toMatchObject({ from: { x: 501, y: 102 } })
  })
})

describe('viewport', () => {
  it('clamps zoom to the supported range', () => {
    expect(clampScale(0.01)).toBe(MIN_SCALE)
    expect(clampScale(99)).toBe(MAX_SCALE)
    expect(clampScale(Number.NaN)).toBe(1)
  })

  it('screen <-> document conversion round-trips', () => {
    const viewport = { scale: 2, offsetX: 30, offsetY: -40 }
    const docPoint = { x: 123, y: 77 }
    const roundTrip = toDocument(toScreen(docPoint, viewport), viewport)
    expect(roundTrip.x).toBeCloseTo(123)
    expect(roundTrip.y).toBeCloseTo(77)
  })

  it('panning changes only the viewport, never the document', () => {
    const before = JSON.stringify(doc())
    const panned = panBy(DEFAULT_VIEWPORT, 40, 25, 900, 620)
    expect(panned).toMatchObject({ offsetX: 40, offsetY: 25, scale: 1 })
    expect(JSON.stringify(doc())).toBe(before)
  })

  it('refuses to pan the drawing out of reach', () => {
    const far = panBy(DEFAULT_VIEWPORT, 99_999, 99_999, 900, 620)
    expect(far.offsetX).toBeLessThanOrEqual(900)
    expect(far.offsetY).toBeLessThanOrEqual(620)
  })

  it('zooming keeps the pointer anchored to the same document point', () => {
    const pointer = { x: 450, y: 310 }
    const anchorBefore = toDocument(pointer, DEFAULT_VIEWPORT)
    const zoomed = zoomAt(DEFAULT_VIEWPORT, pointer, 2, 900, 620)
    const anchorAfter = toDocument(pointer, zoomed)
    expect(zoomed.scale).toBe(2)
    expect(anchorAfter.x).toBeCloseTo(anchorBefore.x)
    expect(anchorAfter.y).toBeCloseTo(anchorBefore.y)
  })

  it('zoom is ignored when already at a limit', () => {
    const maxed = { scale: MAX_SCALE, offsetX: 0, offsetY: 0 }
    expect(zoomAt(maxed, { x: 10, y: 10 }, 2, 900, 620)).toBe(maxed)
  })

  it('clampViewport normalises a corrupted viewport', () => {
    const fixed = clampViewport({ scale: 99, offsetX: 1e9, offsetY: -1e9 }, 900, 620)
    expect(fixed.scale).toBe(MAX_SCALE)
    expect(fixed.offsetX).toBeLessThanOrEqual(900)
    expect(fixed.offsetY).toBeGreaterThanOrEqual(-620)
  })
})
