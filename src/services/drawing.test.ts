import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CANVAS_H, CANVAS_W, DRAWING_MODEL_VERSION, PAPER_BACKGROUND, appendPoint, clearDraft, commitStroke,
  emptyDocument, isEmptyDocument, listDrafts, loadDraft, parseDocument, pointFromClient, redoStroke,
  renderDocument, saveDraft, serializeDocument, strokeCount, undoStroke,
  type DrawingDocument, type Stroke,
} from './drawing'

/**
 * Drawing document model tests.
 *
 * These exercise the REAL production module — the one SketchCanvas renders
 * from — rather than a re-implementation in the test file. The invariant under
 * test is the single rule that fixes the "drawing disappears" bug: the vector
 * document is the source of truth, and every operation (serialise, parse,
 * undo/redo, resize, remount) must preserve it exactly.
 */

const stroke = (points: Array<[number, number]>, extra: Partial<Stroke> = {}): Stroke => ({
  points: points.map(([x, y]) => ({ x, y })),
  color: '#34312f',
  size: 3,
  eraser: false,
  ...extra,
})

const doc = (strokes: Stroke[], paper: DrawingDocument['paper'] = 'cream'): DrawingDocument => ({
  version: DRAWING_MODEL_VERSION,
  width: CANVAS_W,
  height: CANVAS_H,
  paper,
  strokes,
})

/** Minimal 2D-context recorder; jsdom has no canvas implementation. */
function recorder() {
  const calls: string[] = []
  const ctx = {
    canvas: { width: CANVAS_W, height: CANVAS_H },
    globalCompositeOperation: 'source-over',
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    save: (): void => { calls.push('save') },
    restore: (): void => { calls.push('restore') },
    setTransform: (...args: number[]): void => { calls.push(`setTransform(${args[0]})`) },
    clearRect: (): void => { calls.push('clearRect') },
    fillRect: (): void => { calls.push('fillRect') },
    beginPath: (): void => { calls.push('beginPath') },
    moveTo: (): void => { calls.push('moveTo') },
    lineTo: (): void => { calls.push('lineTo') },
    quadraticCurveTo: (): void => { calls.push('quad') },
    arc: (): void => { calls.push('arc') },
    fill: (): void => { calls.push('fill') },
    stroke: (): void => { calls.push('stroke') },
  }
  // Record the fill colour at the moment fillRect runs: replaying strokes
  // overwrites ctx.fillStyle, so reading it afterwards proves nothing.
  const fills: string[] = []
  const rawFillRect = ctx.fillRect.bind(ctx)
  ctx.fillRect = (): void => { fills.push(String(ctx.fillStyle)); rawFillRect() }
  const canvas = {
    width: CANVAS_W,
    height: CANVAS_H,
    getContext: () => ctx,
  }
  return { canvas: canvas as unknown as HTMLCanvasElement, calls, ctx, fills }
}

describe('drawing document: creation & serialisation', () => {
  it('starts empty with the expected logical size and paper', () => {
    const empty = emptyDocument()
    expect(empty.width).toBe(CANVAS_W)
    expect(empty.height).toBe(CANVAS_H)
    expect(empty.paper).toBe('cream')
    expect(empty.strokes).toEqual([])
    expect(empty.version).toBe(DRAWING_MODEL_VERSION)
  })

  it('round-trips strokes, colours, sizes and eraser flags through JSON', () => {
    const original = doc([stroke([[10, 10], [20, 30], [40, 25]]), stroke([[0, 0], [5, 5]], { color: '#b66b52', size: 9 })])
    const parsed = parseDocument(serializeDocument(original))
    expect(parsed).not.toBeNull()
    expect(parsed!.strokes).toEqual(original.strokes)
    expect(parsed!.paper).toBe('cream')
    expect(parsed!.width).toBe(CANVAS_W)
  })

  it('preserves point ordering exactly (no sorting, no dedupe)', () => {
    const points: Array<[number, number]> = [[300, 50], [10, 400], [150, 150], [10, 400]]
    const parsed = parseDocument(serializeDocument(doc([stroke(points)])))!
    expect(parsed.strokes[0].points).toEqual(points.map(([x, y]) => ({ x, y })))
  })

  it('keeps the paper choice across a round trip', () => {
    for (const paper of ['white', 'cream', 'grid'] as const) {
      expect(parseDocument(serializeDocument(doc([], paper)))!.paper).toBe(paper)
    }
  })

  it('returns null for unparseable or structurally invalid input', () => {
    expect(parseDocument(null)).toBeNull()
    expect(parseDocument('')).toBeNull()
    expect(parseDocument('not json')).toBeNull()
    expect(parseDocument('{"strokes":"nope"}')).toBeNull()
  })

  it('drops malformed strokes and points instead of throwing', () => {
    const raw = JSON.stringify({
      version: 2, width: CANVAS_W, height: CANVAS_H, paper: 'cream',
      strokes: [
        { points: [{ x: 1, y: 2 }, { x: 'bad', y: 3 }, { x: 4, y: 5 }], color: '#000', size: 2 },
        { points: [] },
        { points: [{ x: 1, y: 1 }], size: 0, color: '' },
        'garbage',
      ],
    })
    const parsed = parseDocument(raw)!
    expect(parsed.strokes).toHaveLength(2)
    expect(parsed.strokes[0].points).toEqual([{ x: 1, y: 2 }, { x: 4, y: 5 }])
    // Fallbacks applied for invalid size/colour.
    expect(parsed.strokes[1].size).toBe(3)
    expect(parsed.strokes[1].color).toBe('#34312f')
  })

  it('serialises every record with the current model version', () => {
    const stale = { ...doc([stroke([[1, 1], [2, 2]])]), version: 1 }
    expect(JSON.parse(serializeDocument(stale)).version).toBe(DRAWING_MODEL_VERSION)
  })
})

describe('drawing document: pointer maths & point sampling', () => {
  it('maps client coordinates into document space regardless of display size', () => {
    const rect = { left: 10, top: 20, width: 450, height: 310 } // exactly half scale
    const p = pointFromClient(10 + 225, 20 + 155, rect, { width: CANVAS_W, height: CANVAS_H })
    expect(p.x).toBeCloseTo(CANVAS_W / 2, 5)
    expect(p.y).toBeCloseTo(CANVAS_H / 2, 5)
  })

  it('is independent of device pixel ratio (CSS-pixel input only)', () => {
    const rect = { left: 0, top: 0, width: 300, height: 200 }
    const a = pointFromClient(150, 100, rect, { width: CANVAS_W, height: CANVAS_H })
    const b = pointFromClient(150, 100, rect, { width: CANVAS_W, height: CANVAS_H })
    expect(a).toEqual(b)
    expect(a.x).toBeCloseTo(CANVAS_W / 2, 5)
  })

  it('falls back to the document size when the element has no measured size', () => {
    const p = pointFromClient(0, 0, { left: 0, top: 0, width: 0, height: 0 }, { width: 100, height: 50 })
    expect(p).toEqual({ x: 0, y: 0 })
  })

  it('appends points in order and skips sub-threshold jitter', () => {
    let s: Stroke = { points: [{ x: 0, y: 0 }], color: '#000', size: 2, eraser: false }
    s = appendPoint(s, { x: 0.2, y: 0.2 }, 1.4) // ignored: too close
    s = appendPoint(s, { x: 5, y: 0 }, 1.4)
    s = appendPoint(s, { x: 10, y: 0 }, 1.4)
    expect(s.points).toEqual([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }])
  })

  it('does not mutate the previous stroke when appending', () => {
    const before: Stroke = { points: [{ x: 0, y: 0 }], color: '#000', size: 2, eraser: false }
    const after = appendPoint(before, { x: 20, y: 20 })
    expect(before.points).toHaveLength(1)
    expect(after.points).toHaveLength(2)
  })
})

describe('drawing document: undo / redo / clear semantics', () => {
  const a = stroke([[0, 0], [10, 10]])
  const b = stroke([[20, 20], [30, 30]])
  const c = stroke([[40, 40], [50, 50]])

  it('commits strokes in order and empties the redo stack', () => {
    let h = { strokes: [] as Stroke[], redo: [] as Stroke[] }
    h = commitStroke(h, a)
    h = commitStroke(commitStroke(h, b), c)
    expect(h.strokes).toEqual([a, b, c])
    expect(h.redo).toEqual([])
  })

  it('new drawing after undo discards the redo stack (no resurrection)', () => {
    let h = commitStroke(commitStroke({ strokes: [], redo: [] }, a), b)
    h = undoStroke(h)
    expect(h.redo).toEqual([b])
    h = commitStroke(h, c)
    expect(h.strokes).toEqual([a, c])
    expect(h.redo).toEqual([])
  })

  it('undo then redo restores the same stroke object content', () => {
    let h = commitStroke(commitStroke({ strokes: [], redo: [] }, a), b)
    h = undoStroke(h)
    expect(h.strokes).toEqual([a])
    h = redoStroke(h)
    expect(h.strokes).toEqual([a, b])
    expect(h.redo).toEqual([])
  })

  it('undo/redo are no-ops at the boundaries', () => {
    const empty = { strokes: [] as Stroke[], redo: [] as Stroke[] }
    expect(undoStroke(empty)).toBe(empty)
    expect(redoStroke(empty)).toBe(empty)
  })

  it('undo walks back one stroke at a time and redo replays in order', () => {
    let h = commitStroke(commitStroke(commitStroke({ strokes: [], redo: [] }, a), b), c)
    h = undoStroke(undoStroke(h))
    expect(h.strokes).toEqual([a])
    expect(h.redo).toEqual([b, c])
    h = redoStroke(h)
    h = redoStroke(h)
    expect(h.strokes).toEqual([a, b, c])
  })
})

describe('drawing document: emptiness rules', () => {
  it('treats a document as empty when every stroke is an eraser pass', () => {
    expect(isEmptyDocument(doc([stroke([[1, 1], [2, 2]], { eraser: true })]))).toBe(true)
    expect(isEmptyDocument(doc([stroke([[1, 1], [2, 2]])]))).toBe(false)
    expect(isEmptyDocument(emptyDocument())).toBe(true)
    expect(strokeCount(doc([a1(), a1()]))).toBe(2)
  })
  function a1(): Stroke { return stroke([[0, 0], [1, 1]]) }
})

describe('renderDocument: DPR-aware painting', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('sizes the backing store to CSS size × pixel ratio', () => {
    const { canvas, calls } = recorder()
    renderDocument(canvas, doc([stroke([[0, 0], [10, 10]])]), { pixelRatio: 3 })
    expect(canvas.width).toBe(CANVAS_W * 3)
    expect(canvas.height).toBe(CANVAS_H * 3)
    // The transform scales the logical coordinate space, so strokes drawn in
    // document units stay aligned on high-DPI displays.
    expect(calls).toContain('setTransform(3)')
  })

  it('does not resize the backing store when the ratio is unchanged', () => {
    const { canvas } = recorder()
    renderDocument(canvas, doc([]), { pixelRatio: 2 })
    const w = canvas.width
    renderDocument(canvas, doc([]), { pixelRatio: 2 })
    expect(canvas.width).toBe(w)
  })

  it('repaints every stroke after a size change (resize must not erase ink)', () => {
    const { canvas, calls } = recorder()
    const three = doc([stroke([[0, 0], [1, 1]]), stroke([[2, 2], [3, 3]]), stroke([[4, 4], [5, 5]])])
    renderDocument(canvas, three, { pixelRatio: 1 })
    const firstPass = calls.filter((c) => c === 'stroke').length
    expect(firstPass).toBe(3)

    calls.length = 0
    renderDocument(canvas, three, { pixelRatio: 2 }) // simulates a DPR/resize change
    expect(calls).toContain('clearRect')
    expect(calls.filter((c) => c === 'stroke').length).toBe(3)
  })

  it('draws the in-progress stroke on top of committed ones', () => {
    const { canvas, calls } = recorder()
    renderDocument(canvas, doc([stroke([[0, 0], [1, 1]])]), { live: stroke([[2, 2], [3, 3]]), pixelRatio: 1 })
    expect(calls.filter((c) => c === 'stroke').length).toBe(2)
  })

  it('fills the chosen paper before drawing ink', () => {
    const { canvas, calls, fills } = recorder()
    renderDocument(canvas, doc([stroke([[1, 1], [9, 9]])], 'white'), { pixelRatio: 1 })
    expect(fills[0]).toBe(PAPER_BACKGROUND.white)
    const fillAt = calls.indexOf('fillRect')
    const inkAt = calls.indexOf('stroke')
    expect(fillAt).toBeGreaterThan(-1)
    expect(inkAt).toBeGreaterThan(-1)
    expect(fillAt).toBeLessThan(inkAt)
  })

  it('uses destination-out for eraser strokes so paper is preserved', () => {
    const { canvas, ctx } = recorder()
    const ops: string[] = []
    Object.defineProperty(ctx, 'globalCompositeOperation', {
      get: () => ops[ops.length - 1] ?? 'source-over',
      set: (v: string) => { ops.push(v) },
      configurable: true,
    })
    renderDocument(canvas, doc([stroke([[5, 5], [9, 9]], { eraser: true })]), { pixelRatio: 1 })
    expect(ops).toContain('destination-out')
  })

  it('renders a single-point stroke as a visible dot', () => {
    const { canvas, calls } = recorder()
    renderDocument(canvas, doc([stroke([[12, 12]])]), { pixelRatio: 1 })
    expect(calls).toContain('arc')
    expect(calls).toContain('fill')
  })

  it('is a no-op without a canvas element or 2D context (jsdom safety)', () => {
    expect(() => renderDocument(null, doc([]))).not.toThrow()
    const noCtx = { width: 1, height: 1, getContext: () => null } as unknown as HTMLCanvasElement
    expect(() => renderDocument(noCtx, doc([]))).not.toThrow()
  })
})

describe('draft autosave: survive a reload before "Save"', () => {
  beforeEach(() => { localStorage.clear() })

  it('persists and restores the exact document, title and artwork id', () => {
    const document = doc([stroke([[1, 2], [3, 4]])], 'grid')
    saveDraft({ document, title: 'Rose study', artworkId: 'art_1', savedAt: '2026-10-24T10:00:00.000Z' })
    const restored = loadDraft('art_1')
    expect(restored).not.toBeNull()
    expect(restored!.document.strokes).toEqual(document.strokes)
    expect(restored!.document.paper).toBe('grid')
    expect(restored!.title).toBe('Rose study')
    expect(restored!.artworkId).toBe('art_1')
  })

  it('keeps the new-drawing draft separate from a saved artwork draft', () => {
    saveDraft({ document: doc([stroke([[1, 1], [2, 2]])]), title: 'new', artworkId: null, savedAt: 'x' })
    saveDraft({ document: doc([stroke([[3, 3], [4, 4]])]), title: 'saved', artworkId: 'art_9', savedAt: 'x' })
    expect(loadDraft(null)!.title).toBe('new')
    expect(loadDraft('art_9')!.title).toBe('saved')
  })

  it('clearing a draft affects only that artwork', () => {
    saveDraft({ document: doc([stroke([[1, 1], [2, 2]])]), title: 'a', artworkId: 'a1', savedAt: 'x' })
    saveDraft({ document: doc([stroke([[1, 1], [2, 2]])]), title: 'b', artworkId: 'b1', savedAt: 'x' })
    clearDraft('a1')
    expect(loadDraft('a1')).toBeNull()
    expect(loadDraft('b1')).not.toBeNull()
  })

  it('recovers a non-empty draft list after an interrupted session', () => {
    saveDraft({ document: doc([stroke([[1, 1], [2, 2]])]), title: 'recovered', artworkId: null, savedAt: 'x' })
    const drafts = listDrafts()
    expect(drafts.length).toBe(1)
    expect(drafts[0].title).toBe('recovered')
  })

  it('ignores an empty draft in the recovery list (nothing to recover)', () => {
    saveDraft({ document: emptyDocument(), title: 'blank', artworkId: null, savedAt: 'x' })
    expect(listDrafts()).toHaveLength(0)
  })

  it('survives corrupt draft JSON without throwing', () => {
    localStorage.setItem('alhelm:studio-draft:new', '{{{not json')
    expect(loadDraft(null)).toBeNull()
    expect(() => listDrafts()).not.toThrow()
  })
})
