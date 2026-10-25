/**
 * Drawing document model — the durable source of truth for the studio canvas.
 *
 * A drawing is a plain JSON document (`DrawingDocument`) of strokes in the
 * canvas' logical coordinate space (CANVAS_W × CANVAS_H). The canvas element is
 * only a *view* of that document:
 *
 *   document  ──render──▶ <canvas>          (fast, incremental)
 *   document  ──serialise──▶ JSON  ──▶ localStorage / artwork record
 *   <canvas>  ──toBlob──▶  PNG Blob ──▶ IndexedDB / Supabase storage
 *
 * Because the strokes live in React state (not only in the bitmap), a React
 * re-render, theme change, DPR/resize, tab switch or remount can always redraw
 * the exact same artwork. Nothing in this module touches the DOM, which keeps
 * it unit-testable and safe to call from effects.
 */

export const CANVAS_W = 900
export const CANVAS_H = 620
export const DRAWING_MODEL_VERSION = 2

export type PaperKind = 'white' | 'cream' | 'grid'
export type Tool = 'pencil' | 'eraser'

export interface Point {
  x: number
  y: number
}

export interface Stroke {
  points: Point[]
  color: string
  size: number
  eraser: boolean
}

export interface DrawingDocument {
  version: number
  width: number
  height: number
  paper: PaperKind
  strokes: Stroke[]
}

export const PAPER_BACKGROUND: Record<PaperKind, string> = {
  white: '#ffffff',
  cream: '#fdf8ef',
  grid: '#fdf8ef',
}

export const PAPER_SWATCH: Record<PaperKind, string> = {
  white: '#ffffff',
  cream: '#fdf8ef',
  grid: '#f2ead9',
}

export function emptyDocument(paper: PaperKind = 'cream'): DrawingDocument {
  return { version: DRAWING_MODEL_VERSION, width: CANVAS_W, height: CANVAS_H, paper, strokes: [] }
}

/** Defensive parse: any malformed point/stroke is dropped, never thrown. */
function cleanStroke(value: unknown): Stroke | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<Stroke>
  if (!Array.isArray(candidate.points)) return null
  const points = candidate.points
    .filter((p): p is Point => Boolean(p) && typeof p === 'object' && Number.isFinite((p as Point).x) && Number.isFinite((p as Point).y))
    .map((p) => ({ x: p.x, y: p.y }))
  if (points.length === 0) return null
  const size = Number(candidate.size)
  return {
    points,
    color: typeof candidate.color === 'string' && candidate.color ? candidate.color : '#34312f',
    size: Number.isFinite(size) && size > 0 ? Math.min(60, size) : 3,
    eraser: candidate.eraser === true,
  }
}

export function parseDocument(raw: string | null | undefined): DrawingDocument | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const doc = parsed as Partial<DrawingDocument>
  if (!Array.isArray(doc.strokes)) return null
  const strokes = doc.strokes.map(cleanStroke).filter((s): s is Stroke => s !== null)
  const paper: PaperKind = doc.paper === 'white' || doc.paper === 'grid' || doc.paper === 'cream' ? doc.paper : 'cream'
  return {
    version: DRAWING_MODEL_VERSION,
    width: Number(doc.width) > 0 ? Number(doc.width) : CANVAS_W,
    height: Number(doc.height) > 0 ? Number(doc.height) : CANVAS_H,
    paper,
    strokes,
  }
}

export function serializeDocument(doc: DrawingDocument): string {
  return JSON.stringify({ ...doc, version: DRAWING_MODEL_VERSION })
}

export function strokeCount(doc: DrawingDocument): number {
  return doc.strokes.length
}

export function isEmptyDocument(doc: DrawingDocument): boolean {
  // Eraser-only marks leave no visible ink even if strokes exist.
  return doc.strokes.every((s) => s.eraser)
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

type Ctx = CanvasRenderingContext2D

function drawPaper(ctx: Ctx, paper: PaperKind, width: number, height: number): void {
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = PAPER_BACKGROUND[paper]
  ctx.fillRect(0, 0, width, height)
  if (paper === 'grid') {
    ctx.strokeStyle = 'rgba(52,49,47,0.09)'
    ctx.lineWidth = 1
    for (let x = 0; x <= width; x += 30) {
      ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, height); ctx.stroke()
    }
    for (let y = 0; y <= height; y += 30) {
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(width, y + 0.5); ctx.stroke()
    }
  }
  ctx.restore()
}

export function drawStroke(ctx: Ctx, stroke: Stroke): void {
  const { points } = stroke
  if (!points.length) return
  ctx.save()
  ctx.globalCompositeOperation = stroke.eraser ? 'destination-out' : 'source-over'
  ctx.strokeStyle = stroke.eraser ? 'rgba(0,0,0,1)' : stroke.color
  ctx.fillStyle = stroke.color
  ctx.lineWidth = stroke.size
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (points.length === 1) {
    // A tap is a dot, not an invisible zero-length line.
    ctx.beginPath()
    ctx.arc(points[0].x, points[0].y, Math.max(0.6, stroke.size / 2), 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length - 1; i += 1) {
      const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 }
      ctx.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y)
    }
    const last = points[points.length - 1]
    ctx.lineTo(last.x, last.y)
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * Renders the full document onto the canvas' backing store.
 * `live` is the stroke currently under the pointer (drawn on top, not yet
 * committed). Returns silently when the 2D context is unavailable (jsdom).
 */
export function renderDocument(
  canvas: HTMLCanvasElement | null,
  doc: DrawingDocument,
  options: { live?: Stroke | null; pixelRatio?: number } = {},
): void {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const ratio = Math.max(1, options.pixelRatio ?? 1)
  const width = doc.width
  const height = doc.height
  const targetW = Math.round(width * ratio)
  const targetH = Math.round(height * ratio)
  // Setting width/height clears the bitmap, so only ever do it when the size
  // actually changes — and then immediately repaint from the document.
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW
    canvas.height = targetH
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  drawPaper(ctx, doc.paper, width, height)
  for (const stroke of doc.strokes) drawStroke(ctx, stroke)
  if (options.live) drawStroke(ctx, options.live)
}

/* ------------------------------------------------------------------ */
/* Pointer maths                                                       */
/* ------------------------------------------------------------------ */

/**
 * Converts a client (CSS pixel) coordinate into the logical document space,
 * independent of display size and device pixel ratio.
 */
export function pointFromClient(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  doc: Pick<DrawingDocument, 'width' | 'height'>,
): Point {
  const width = rect.width || doc.width
  const height = rect.height || doc.height
  return {
    x: ((clientX - rect.left) / width) * doc.width,
    y: ((clientY - rect.top) / height) * doc.height,
  }
}

/** Drops points closer than `minDistance` to keep stroke JSON small. */
export function appendPoint(stroke: Stroke, next: Point, minDistance = 1.4): Stroke {
  const last = stroke.points[stroke.points.length - 1]
  if (last) {
    const dx = next.x - last.x
    const dy = next.y - last.y
    if (dx * dx + dy * dy < minDistance * minDistance) return stroke
  }
  return { ...stroke, points: [...stroke.points, next] }
}

/* ------------------------------------------------------------------ */
/* Undo / redo semantics                                               */
/* ------------------------------------------------------------------ */

export interface DrawingHistory {
  strokes: Stroke[]
  redo: Stroke[]
}

export function commitStroke(history: DrawingHistory, stroke: Stroke): DrawingHistory {
  return { strokes: [...history.strokes, stroke], redo: [] }
}

export function undoStroke(history: DrawingHistory): DrawingHistory {
  if (history.strokes.length === 0) return history
  const strokes = history.strokes.slice(0, -1)
  const last = history.strokes[history.strokes.length - 1]
  // Push to the FRONT so redoStroke can shift from the front and replay the
  // strokes in the exact order they were undone. (A push/pop pair here made
  // redo after multiple undos restore strokes out of order: a, c, b.)
  return { strokes, redo: [last, ...history.redo] }
}

export function redoStroke(history: DrawingHistory): DrawingHistory {
  if (history.redo.length === 0) return history
  const [next, ...rest] = history.redo
  return { strokes: [...history.strokes, next], redo: rest }
}

export function clearHistory(_paper: PaperKind): DrawingHistory {
  return { strokes: [], redo: [] }
}

/** Eraser strokes never erase the paper itself — re-render always replays. */

/* ------------------------------------------------------------------ */
/* Draft autosave (per artwork, survives reload before "Save")         */
/* ------------------------------------------------------------------ */

const DRAFT_PREFIX = 'alhelm:studio-draft:'
export const DRAFT_NEW_ID = 'new'

export interface DrawingDraft {
  document: DrawingDocument
  title: string
  artworkId: string | null
  savedAt: string
}

function draftKey(artworkId: string | null): string {
  return `${DRAFT_PREFIX}${artworkId ?? DRAFT_NEW_ID}`
}

export function saveDraft(draft: DrawingDraft): void {
  try {
    localStorage.setItem(draftKey(draft.artworkId), JSON.stringify(draft))
  } catch {
    /* quota/unavailable — the in-memory document is still intact */
  }
}

export function loadDraft(artworkId: string | null): DrawingDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(artworkId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DrawingDraft>
    const document = parseDocument(typeof parsed.document === 'string' ? parsed.document : JSON.stringify(parsed.document ?? null))
    if (!document) return null
    return {
      document,
      title: typeof parsed.title === 'string' ? parsed.title : '',
      artworkId: typeof parsed.artworkId === 'string' ? parsed.artworkId : null,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export function clearDraft(artworkId: string | null): void {
  try {
    localStorage.removeItem(draftKey(artworkId))
  } catch {
    /* ignore */
  }
}

export function listDrafts(): DrawingDraft[] {
  const drafts: DrawingDraft[] = []
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (!key?.startsWith(DRAFT_PREFIX)) continue
      const raw = localStorage.getItem(key)
      if (!raw) continue
      try {
        const parsed = JSON.parse(raw) as Partial<DrawingDraft>
        const document = parseDocument(JSON.stringify(parsed.document ?? null))
        if (document && document.strokes.length > 0) {
          drafts.push({ document, title: String(parsed.title ?? ''), artworkId: parsed.artworkId ?? null, savedAt: String(parsed.savedAt ?? '') })
        }
      } catch {
        /* skip malformed draft */
      }
    }
  } catch {
    /* storage unavailable */
  }
  return drafts
}
