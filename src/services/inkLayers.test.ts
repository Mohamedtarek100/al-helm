import { describe, expect, it } from 'vitest'
import { paintInkStroke, paintPaper } from './inkLayers'
import { drawShape, drawText } from './drawing'
import type { Stroke } from './drawing'

/**
 * Two-layer eraser model (root-cause regression).
 *
 * The previous single-canvas design let an eraser pass (destination-out) delete
 * unrelated ink. Real-browser evidence before the fix:
 *   erased band 413 -> 0, untouched band 807 -> 0   (destroyed)
 * After the fix:
 *   erased band 413 -> 0, untouched band 807 -> 807
 *
 * These tests pin the layer contract that makes that possible: ink strokes only
 * ever composite with source-over on the ink layer, except erasers which use
 * destination-out — and NOTHING paints the paper onto the ink layer.
 */

function recorder() {
  const ops: Array<{ kind: string; composite: string; style?: string }> = []
  let composite = 'source-over'
  let style = ''
  const state: string[] = []
  const ctx = {
    canvas: { width: 900, height: 620 },
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    fillStyle: '',
    get globalCompositeOperation() { return composite },
    set globalCompositeOperation(v: string) { composite = v },
    get strokeStyle() { return style },
    set strokeStyle(v: string) { style = v },
    save() { state.push(composite) },
    restore() { composite = state.pop() ?? 'source-over' },
    setTransform() {},
    clearRect() { ops.push({ kind: 'clearRect', composite }) },
    fillRect() { ops.push({ kind: 'fillRect', composite, style }) },
    font: '',
    textBaseline: 'alphabetic',
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    arc() {},
    ellipse() {},
    rect() {},
    fill() { ops.push({ kind: 'fill', composite, style }) },
    stroke() { ops.push({ kind: 'stroke', composite, style }) },
    // Shapes/text are drawn with the same composite contract as ink, so they are
    // recorded through stroke()/fill() and inherit every existing assertion.
    fillText(text: string) { ops.push({ kind: 'text', composite, style: `${style}:${text}` }) },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops }
}

const pen = (color = '#34312f'): Stroke => ({
  points: [{ x: 10, y: 10 }, { x: 200, y: 10 }],
  color,
  size: 8,
  eraser: false,
})
const eraser = (): Stroke => ({ points: [{ x: 10, y: 10 }, { x: 200, y: 10 }], color: '#000', size: 20, eraser: true })

describe('v3 shapes and text live on the ink layer', () => {
  const shape = (kind: 'rect' | 'ellipse' | 'line') => ({
    id: `s_${kind}`, kind, from: { x: 10, y: 10 }, to: { x: 90, y: 60 }, color: '#b66b52', size: 4,
  }) as const

  it('draws a shape with source-over onto the ink layer', () => {
    const { ctx, ops } = recorder()
    // drawShape is exercised through the exported renderer used by the canvas.
    drawShape(ctx, shape('rect') as never)
    expect(ops.at(-1)).toMatchObject({ kind: 'stroke', composite: 'source-over' })
  })

  it('draws text with source-over', () => {
    const { ctx, ops } = recorder()
    drawText(ctx, { id: 't', x: 5, y: 5, text: 'Hello', color: '#34312f', size: 28 })
    expect(ops.at(-1)).toMatchObject({ kind: 'text', composite: 'source-over' })
  })

  it('never paints the paper while drawing shapes or text', () => {
    const { ctx, ops } = recorder()
    drawShape(ctx, shape('ellipse') as never)
    drawText(ctx, { id: 't', x: 0, y: 0, text: 'x', color: '#000', size: 20 })
    expect(ops.some((o) => o.kind === 'fillRect')).toBe(false)
  })

  it('a later eraser can still remove a shape (single ink layer)', () => {
    const { ctx, ops } = recorder()
    drawShape(ctx, shape('line') as never)
    paintInkStroke(ctx, eraser())
    expect(ops.at(-1)).toMatchObject({ kind: 'stroke', composite: 'destination-out' })
  })
})

describe('ink layer contract', () => {
  it('pen strokes composite with source-over onto the ink layer', () => {
    const { ctx, ops } = recorder()
    paintInkStroke(ctx, pen('#b66b52'))
    expect(ops.at(-1)).toMatchObject({ kind: 'stroke', composite: 'source-over', style: '#b66b52' })
  })

  it('eraser strokes composite with destination-out', () => {
    const { ctx, ops } = recorder()
    paintInkStroke(ctx, eraser())
    expect(ops.at(-1)).toMatchObject({ kind: 'stroke', composite: 'destination-out' })
  })

  it('the eraser never picks a visible colour (it cannot paint)', () => {
    const { ctx, ops } = recorder()
    paintInkStroke(ctx, eraser())
    const strokeOp = ops.find((o) => o.kind === 'stroke')
    // It uses an opaque black purely as a mask for destination-out, never a
    // user-visible paint colour, and never the paper colour.
    expect(strokeOp?.style).toBe('rgba(0,0,0,1)')
    expect(strokeOp?.style).not.toBe('#ffffff')
    expect(strokeOp?.style).not.toBe('#fdf8ef')
  })

  it('never paints the paper onto the ink layer (no fillRect/paper draws)', () => {
    const { ctx, ops } = recorder()
    paintInkStroke(ctx, pen())
    paintInkStroke(ctx, eraser())
    paintInkStroke(ctx, pen('#89977b'))
    // The ink layer must remain transparent where nothing is drawn.
    expect(ops.some((o) => o.kind === 'fillRect')).toBe(false)
  })

  it('restores composite state so later strokes are unaffected', () => {
    const { ctx, ops } = recorder()
    paintInkStroke(ctx, eraser())   // destination-out, must be scoped
    paintInkStroke(ctx, pen('#34312f'))
    const strokes = ops.filter((o) => o.kind === 'stroke')
    expect(strokes[0].composite).toBe('destination-out')
    expect(strokes[1].composite).toBe('source-over')
  })
})

describe('paper layer contract', () => {
  it('paints opaque paper with source-over and never erases', () => {
    const { ctx, ops } = recorder()
    paintPaper(ctx, 'cream', 900, 620)
    const fills = ops.filter((o) => o.kind === 'fillRect')
    expect(fills.length).toBeGreaterThan(0)
    expect(fills.every((f) => f.composite === 'source-over')).toBe(true)
  })

  it('draws a grid only for the grid paper', () => {
    const grid = recorder()
    paintPaper(grid.ctx, 'grid', 900, 620)
    const plain = recorder()
    paintPaper(plain.ctx, 'white', 900, 620)
    expect(grid.ops.filter((o) => o.kind === 'stroke').length).toBeGreaterThan(0)
    expect(plain.ops.filter((o) => o.kind === 'stroke').length).toBe(0)
  })

  it('never uses destination-out on the paper layer', () => {
    const { ctx, ops } = recorder()
    paintPaper(ctx, 'grid', 900, 620)
    expect(ops.some((o) => o.composite === 'destination-out')).toBe(false)
  })
})
