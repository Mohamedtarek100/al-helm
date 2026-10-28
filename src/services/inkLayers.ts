/**
 * Offscreen ink layer for a drawing document.
 *
 * WHY THIS EXISTS (root cause of the eraser bug):
 * Eraser strokes composite with `destination-out`, which removes every pixel
 * it touches. When the paper was painted into the SAME canvas, an eraser pass
 * also deleted the paper, and the later "repair" pass re-applied paper over
 * the erased area — which restored the ink too. Measured symptoms: erasing
 * one band made total ink go 645 -> 1007, and erasing one stroke destroyed an
 * unrelated stroke far away.
 *
 * The correct model is two layers:
 *
 *     paper layer (never touched by tools)
 *   + ink layer   (strokes, including erasers, live ONLY here)
 *   = composite   (what the user sees)
 *
 * On the ink layer `destination-out` removes ink and nothing else, which is
 * exactly the eraser's contract. No repair heuristics are needed.
 */

import {
  CANVAS_H, CANVAS_W, PAPER_BACKGROUND,
  drawShape, drawStrokePath, drawText,
  type DrawingDocument, type PaperKind, type Shape, type Stroke,
} from './drawing'

/**
 * Paints the paper only. Kept separate from ink so an eraser can never touch it.
 */
export function paintPaper(
  ctx: CanvasRenderingContext2D,
  paper: PaperKind,
  width: number,
  height: number,
): void {
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
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

/** Paints one stroke onto the INK layer using the correct composite operation. */
export function paintInkStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  if (!stroke.points.length) return
  ctx.save()
  ctx.globalAlpha = 1
  if (stroke.eraser) {
    // Removes ink only — this canvas holds no paper.
    ctx.globalCompositeOperation = 'destination-out'
    ctx.strokeStyle = 'rgba(0,0,0,1)'
    ctx.fillStyle = 'rgba(0,0,0,1)'
  } else {
    ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = stroke.color
    ctx.fillStyle = stroke.color
  }
  drawStrokePath(ctx, stroke)
  ctx.restore()
}

export interface InkLayers {
  paper: HTMLCanvasElement
  ink: HTMLCanvasElement
}

/** Creates the two offscreen layers at a given pixel size. */
export function createLayers(width: number, height: number): InkLayers | null {
  if (typeof document === 'undefined') return null
  const make = () => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width))
    canvas.height = Math.max(1, Math.round(height))
    return canvas
  }
  return { paper: make(), ink: make() }
}

/**
 * Rebuilds the ink layer from the document's stroke list.
 * Every stroke is replayed in order onto a clean transparent canvas, so an
 * eraser removes exactly the ink drawn before it. Rebuilding never touches the
 * paper layer.
 */
export function renderInkLayer(
  inkCanvas: HTMLCanvasElement | null,
  doc: DrawingDocument,
  options: { live?: Stroke | null; liveShape?: Shape | null; pixelRatio?: number } = {},
): void {
  if (!inkCanvas) return
  const ctx = inkCanvas.getContext('2d')
  if (!ctx) return
  const ratio = Math.max(1, options.pixelRatio ?? 1)
  const targetW = Math.round(doc.width * ratio)
  const targetH = Math.round(doc.height * ratio)
  if (inkCanvas.width !== targetW || inkCanvas.height !== targetH) {
    inkCanvas.width = targetW
    inkCanvas.height = targetH
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.clearRect(0, 0, inkCanvas.width, inkCanvas.height)
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  for (const stroke of doc.strokes) paintInkStroke(ctx, stroke)
  // Shapes and text live on the INK layer too, so they behave exactly like ink:
  // an eraser removes them, and they never touch the paper layer.
  ctx.globalCompositeOperation = 'source-over'
  for (const shape of doc.shapes ?? []) drawShape(ctx, shape)
  for (const element of doc.texts ?? []) drawText(ctx, element)
  if (options.live) paintInkStroke(ctx, options.live)
  // Preview of a shape currently being dragged.
  if (options.liveShape) {
    ctx.globalCompositeOperation = 'source-over'
    drawShape(ctx, options.liveShape)
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

/**
 * Composites paper + ink onto the visible canvas.
 * The ink layer is drawn with `source-over`, so erased areas simply show the
 * paper underneath — never a transparent hole, never a coloured patch.
 */
export function compositeLayers(
  target: HTMLCanvasElement | null,
  layers: InkLayers,
  paper: PaperKind,
  docWidth = CANVAS_W,
  docHeight = CANVAS_H,
): void {
  if (!target) return
  const ctx = target.getContext('2d')
  if (!ctx) return
  const paperCtx = layers.paper.getContext('2d')
  if (paperCtx) {
    // Repaint paper only when its size or style changed; cheap and idempotent.
    const wantsW = layers.ink.width
    const wantsH = layers.ink.height
    if (layers.paper.width !== wantsW || layers.paper.height !== wantsH) {
      layers.paper.width = wantsW
      layers.paper.height = wantsH
    }
    const ratio = wantsW / docWidth
    paperCtx.setTransform(1, 0, 0, 1, 0, 0)
    paperCtx.globalCompositeOperation = 'source-over'
    paperCtx.clearRect(0, 0, wantsW, wantsH)
    paperCtx.setTransform(ratio, 0, 0, ratio, 0, 0)
    paintPaper(paperCtx, paper, docWidth, docHeight)
    paperCtx.setTransform(1, 0, 0, 1, 0, 0)
  }

  if (target.width !== layers.ink.width || target.height !== layers.ink.height) {
    target.width = layers.ink.width
    target.height = layers.ink.height
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.clearRect(0, 0, target.width, target.height)
  ctx.drawImage(layers.paper, 0, 0)
  ctx.drawImage(layers.ink, 0, 0)
}

/** Samples the visible colour at a document-space point (eyedropper). */
export function sampleColor(target: HTMLCanvasElement | null, x: number, y: number, ratio = 1): string | null {
  if (!target) return null
  const ctx = target.getContext('2d')
  if (!ctx) return null
  try {
    const d = ctx.getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data
    const hex = (n: number) => n.toString(16).padStart(2, '0')
    return `#${hex(d[0])}${hex(d[1])}${hex(d[2])}`
  } catch {
    return null
  }
}
