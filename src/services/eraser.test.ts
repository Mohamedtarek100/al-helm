import { describe, expect, it } from 'vitest'
import { PAPER_BACKGROUND, drawStroke, drawStrokePath, renderDocument, emptyDocument, type Stroke } from './drawing'

/**
 * Eraser correctness — root cause regression.
 *
 * The original implementation painted `destination-out` directly over the paper
 * fill, which removed the paper along with the ink: erasing produced transparent
 * holes (416 sampled pixels) and visually erased nothing on a filled canvas.
 *
 * `renderDocument` now removes ink on the ink layer and re-applies the paper
 *behind* it (destination-over), so:
 *   - erasing reduces to paper, not to transparency;
 *   - the eraser never paints a colour (it can't "draw white");
 *   - patterned papers survive erasing.
 *
 * jsdom has no canvas implementation, so this suite uses a recording context
 * that tracks composite operations in call order.
 */

function recordingCtx() {
  const ops: string[] = []
  let composite = 'source-over'
  let strokeStyle = ''
  const state: string[] = []
  const ctx = {
    canvas: { width: 900, height: 620 },
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    fillStyle: '',
    get globalCompositeOperation() { return composite },
    set globalCompositeOperation(value: string) { composite = value; ops.push(`composite:${value}`) },
    get strokeStyle() { return strokeStyle },
    set strokeStyle(value: string) { strokeStyle = value; ops.push(`style:${value}`) },
    save() { state.push(composite); ops.push('save') },
    restore() { composite = state.pop() ?? 'source-over'; ops.push('restore') },
    setTransform() { ops.push('setTransform') },
    clearRect() { ops.push('clearRect') },
    fillRect() { ops.push('fillRect') },
    beginPath() { ops.push('beginPath') },
    moveTo() { ops.push('moveTo') },
    lineTo() { ops.push('lineTo') },
    quadraticCurveTo() { ops.push('quad') },
    arc() { ops.push('arc') },
    fill() { ops.push('fill') },
    stroke() { ops.push('stroke') },
  }
  const canvas = { width: 900, height: 620, getContext: () => ctx }
  return { canvas: canvas as unknown as HTMLCanvasElement, ops }
}

const line = (eraser = false, size = 10): Stroke => ({
  points: [{ x: 50, y: 50 }, { x: 200, y: 50 }, { x: 350, y: 50 }],
  color: '#34312f',
  size,
  eraser,
})

describe('eraser never paints a colour', () => {
  it('uses destination-out and never sets a visible ink colour for eraser strokes', () => {
    const { canvas, ops } = recordingCtx()
    drawStroke(canvas.getContext('2d') as never, line(true))
    expect(ops).toContain('composite:destination-out')
    // No ink-colour style is applied: the eraser cannot paint white/any colour.
    expect(ops.some((op) => op.startsWith('style:#'))).toBe(false)
  })

  it('uses source-over with the chosen colour for pen strokes', () => {
    const { canvas, ops } = recordingCtx()
    drawStroke(canvas.getContext('2d') as never, line(false))
    expect(ops).toContain('composite:source-over')
    expect(ops).toContain('style:#34312f')
  })

  it('honours the eraser size (adjustable eraser)', () => {
    const ctx = recordingCtx().canvas.getContext('2d') as unknown as { lineWidth: number }
    drawStrokePath(ctx as never, line(true, 42))
    expect(ctx.lineWidth).toBe(42)
  })
})

describe('erasing reduces to paper, not to transparency', () => {
  it('restores the paper layer BEHIND the ink after an eraser pass', () => {
    const { canvas, ops } = recordingCtx()
    renderDocument(canvas, { ...emptyDocument('cream'), strokes: [line(false), line(true)] }, { pixelRatio: 1 })

    const firstDestOut = ops.indexOf('composite:destination-out')
    const destinationOver = ops.indexOf('composite:destination-over')
    expect(firstDestOut).toBeGreaterThan(-1)
    // The paper is re-applied underneath, so no hole is left behind.
    expect(destinationOver).toBeGreaterThan(firstDestOut)
  })

  it('leaves the paper fill in place at the end of the render', () => {
    const { canvas, ops } = recordingCtx()
    renderDocument(canvas, { ...emptyDocument('grid'), strokes: [line(true)] }, { pixelRatio: 1 })
    // Paper is drawn at the start and again under the eraser; never removed.
    expect(ops.filter((op) => op === 'fillRect').length).toBeGreaterThanOrEqual(2)
    expect(ops[ops.length - 1]).toBe('composite:source-over')
  })

  it('works on every paper type without depending on a hard-coded white', () => {
    for (const paper of ['white', 'cream', 'grid'] as const) {
      const { canvas, ops } = recordingCtx()
      renderDocument(canvas, { ...emptyDocument(paper), strokes: [line(true)] }, { pixelRatio: 1 })
      const styles = ops.filter((op) => op.startsWith('style:'))
      // The eraser never substitutes an opaque colour for the paper.
      expect(styles).not.toContain(`style:${PAPER_BACKGROUND[paper] === '#ffffff' ? '#fdf8ef' : '#ffffff'}`)
      expect(ops).toContain('composite:destination-over')
    }
  })

  it('applies the same paper restoration to the live (in-progress) eraser stroke', () => {
    const { canvas, ops } = recordingCtx()
    renderDocument(canvas, { ...emptyDocument('cream'), strokes: [line(false)] }, { live: line(true), pixelRatio: 1 })
    expect(ops).toContain('composite:destination-out')
    expect(ops).toContain('composite:destination-over')
  })
})

describe('erasing and drawing coexist', () => {
  it('replays strokes in document order so later ink is not erased by earlier erasing', () => {
    const { canvas, ops } = recordingCtx()
    const eraseThenDraw = { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], color: '#b66b52', size: 4, eraser: false }
    renderDocument(canvas, { ...emptyDocument('cream'), strokes: [line(true), eraseThenDraw] }, { pixelRatio: 1 })
    const eraseAt = ops.indexOf('composite:destination-out')
    const drawAt = ops.lastIndexOf('composite:source-over')
    expect(eraseAt).toBeGreaterThan(-1)
    // The pen stroke is painted after the eraser pass.
    expect(drawAt).toBeGreaterThan(eraseAt)
  })

  it('survives alternating pen/eraser passes without a final transparent hole', () => {
    const { canvas, ops } = recordingCtx()
    renderDocument(canvas, { ...emptyDocument('cream'), strokes: [line(false), line(true), line(false), line(true)] }, { pixelRatio: 1 })
    expect(ops.filter((op) => op === 'composite:destination-over').length).toBe(2)
    expect(ops[ops.length - 1]).toBe('composite:source-over')
  })
})
