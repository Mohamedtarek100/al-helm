import { describe, expect, it } from 'vitest'
import {
  BRUSH_PRESETS,
  clampSettings,
  paintBrushStroke,
  presetById,
  resampleStroke,
  settingsOf,
} from './brushes'
import { parseDocument, serializeDocument } from './drawing'

/**
 * Brush engine.
 *
 * These tests assert the CONTRACT the UI advertises: every setting must change
 * what is painted. A decorative slider that is stored but never read is exactly
 * the kind of "professional brush settings" defect this release fixes, so each
 * setting is proven against a recording canvas context.
 */

function recordingContext() {
  const calls: { method: string; lineWidth?: number; alpha?: number; fillStyle?: unknown; arcRadius?: number }[] = []
  const state = { lineWidth: 1, globalAlpha: 1, globalCompositeOperation: 'source-over' as GlobalCompositeOperation, fillStyle: '' as unknown }
  const ctx = {
    save() {},
    restore() {
      state.globalAlpha = 1
    },
    setTransform() {},
    get globalAlpha() { return state.globalAlpha },
    set globalAlpha(value: number) { state.globalAlpha = value },
    get globalCompositeOperation() { return state.globalCompositeOperation },
    set globalCompositeOperation(value: GlobalCompositeOperation) { state.globalCompositeOperation = value },
    get lineWidth() { return state.lineWidth },
    set lineWidth(value: number) { state.lineWidth = value },
    get strokeStyle() { return '' },
    set strokeStyle(_value: string) { /* recorded via calls */ },
    get fillStyle() { return state.fillStyle },
    set fillStyle(value: unknown) { state.fillStyle = value },
    set lineCap(_v: string) {},
    set lineJoin(_v: string) {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    stroke() { calls.push({ method: 'stroke', lineWidth: state.lineWidth, alpha: state.globalAlpha }) },
    fill() { calls.push({ method: 'fill', alpha: state.globalAlpha, fillStyle: state.fillStyle }) },
    arc(_x: number, _y: number, radius: number) { calls.push({ method: 'arc', arcRadius: radius }) },
    ellipse() { calls.push({ method: 'ellipse' }) },
    createRadialGradient() { return { addColorStop() {} } },
    drawImage() {},
    clearRect() {},
    fillRect() {},
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

const line = { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], color: '#ff0000', size: 10, eraser: false }

describe('brush presets', () => {
  it('ships the professional set the studio advertises', () => {
    expect(BRUSH_PRESETS.map((preset) => preset.id)).toEqual(['pencil', 'ink', 'hard', 'soft', 'calligraphy', 'eraser'])
  })

  it('falls back to a real preset for an unknown brush id', () => {
    // A document written by a newer build must still paint something sensible.
    expect(presetById('watercolor' as never).id).toBe('pencil')
    expect(presetById(undefined).id).toBe('pencil')
  })

  it('clamps settings into ranges the engine and UI can represent', () => {
    const clamped = clampSettings({ size: 999, opacity: 0, flow: 5, hardness: -3, spacing: 0 })
    expect(clamped.size).toBe(80)
    expect(clamped.opacity).toBe(0.05)
    expect(clamped.flow).toBe(1)
    expect(clamped.hardness).toBe(0)
    expect(clamped.spacing).toBe(0.02)
  })
})

describe('every brush setting changes the painted output', () => {
  const paint = (patch: Partial<typeof BRUSH_PRESETS[0]['defaults']>) => {
    const { ctx, calls } = recordingContext()
    paintBrushStroke(ctx, line, clampSettings({ size: 10, opacity: 1, flow: 1, hardness: 1, spacing: 0.1, ...patch }))
    return calls
  }

  it('size sets the stroke width', () => {
    expect(paint({ size: 4 }).at(-1)?.lineWidth).toBe(4)
    expect(paint({ size: 30 }).at(-1)?.lineWidth).toBe(30)
  })

  it('opacity is the alpha of the finished stroke', () => {
    expect(paint({ opacity: 0.4 })[0].alpha).toBeCloseTo(0.4)
  })

  it('flow changes the alpha of each deposit on a soft brush', () => {
    const low = paint({ hardness: 0, flow: 0.2 })
    const high = paint({ hardness: 0, flow: 0.9 })
    // Deposits are fills; a lower flow must produce a lower alpha per stamp.
    expect(Math.max(...low.filter((call) => call.method === 'fill').map((call) => call.alpha ?? 0)))
      .toBeLessThan(Math.max(...high.filter((call) => call.method === 'fill').map((call) => call.alpha ?? 0)))
  })

  it('hardness switches from a stamped gradient to a solid path', () => {
    const soft = paint({ hardness: 0.1 })
    const hard = paint({ hardness: 1 })
    expect(soft.some((call) => call.method === 'fill')).toBe(true)
    expect(soft.some((call) => call.method === 'stroke')).toBe(false)
    expect(hard.some((call) => call.method === 'stroke')).toBe(true)
    expect(hard.some((call) => call.method === 'fill')).toBe(false)
  })

  it('spacing changes the number of deposits', () => {
    const sparse = paint({ hardness: 0, spacing: 1 })
    const dense = paint({ hardness: 0, spacing: 0.05 })
    expect(dense.length).toBeGreaterThan(sparse.length)
  })
})

describe('resampleStroke', () => {
  it('keeps a single tap as a single stamp', () => {
    expect(resampleStroke([{ x: 5, y: 5 }], 0.1, 10)).toEqual([{ x: 5, y: 5 }])
  })

  it('is evenly spaced along the line', () => {
    const out = resampleStroke([{ x: 0, y: 0 }, { x: 50, y: 0 }], 0.1, 10)
    // step = 1px → one deposit per pixel, plus the endpoint.
    expect(out.length).toBeGreaterThanOrEqual(51)
    expect(out[1].x - out[0].x).toBeCloseTo(1, 5)
  })

  it('ends at the final pointer position', () => {
    const out = resampleStroke([{ x: 0, y: 0 }, { x: 37, y: 0 }], 0.25, 10)
    expect(out.at(-1)).toEqual({ x: 37, y: 0 })
  })
})

describe('settingsOf', () => {
  it('a legacy stroke with no brush resolves to the pencil preset at its stored size', () => {
    const settings = settingsOf({ size: 12 })
    expect(settings.size).toBe(12)
    expect(settings.hardness).toBe(presetById('pencil').defaults.hardness)
  })

  it('a stored opacity overrides the preset default', () => {
    expect(settingsOf({ size: 10, brush: 'ink', opacity: 0.3 }).opacity).toBeCloseTo(0.3)
  })
})

describe('document compatibility', () => {
  it('round-trips brush fields through serialise/parse', () => {
    const doc = parseDocument(JSON.stringify({
      version: 3,
      width: 900,
      height: 620,
      paper: 'cream',
      strokes: [{ points: [{ x: 1, y: 2 }], color: '#000000', size: 20, eraser: false, brush: 'soft', opacity: 0.5 }],
    }))
    expect(doc?.strokes[0].brush).toBe('soft')
    expect(doc?.strokes[0].opacity).toBeCloseTo(0.5)
    expect(doc?.version).toBe(4)
  })

  it('keeps a pre-v4 document drawable and unchanged in geometry', () => {
    const doc = parseDocument(JSON.stringify({
      version: 2,
      width: 900,
      height: 620,
      paper: 'grid',
      strokes: [{ points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], color: '#123456', size: 3, eraser: false }],
    }))
    expect(doc?.strokes).toHaveLength(1)
    expect(doc?.strokes[0].brush).toBeUndefined()
    expect(doc?.paper).toBe('grid')
    // Serialising the migrated document must still be re-readable.
    expect(parseDocument(serializeDocument(doc!))?.strokes[0].points).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }])
  })
})
