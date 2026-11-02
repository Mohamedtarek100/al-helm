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
  CANVAS_H, CANVAS_W, DEFAULT_LAYER_ID, PAPER_BACKGROUND,
  drawShape, drawText,
  type DrawingDocument, type DrawingLayer, type PaperKind, type Shape, type Stroke,
} from './drawing'
import { paintBrushStroke, settingsOf } from './brushes'

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
  // The brush engine applies the preset's size/opacity/flow/hardness/spacing.
  // A stroke with no `brush` (every document written before v4) resolves to the
  // pencil preset, whose defaults reproduce the old hard round line exactly.
  //
  // THE ERASER IS FORCED TO FULL STRENGTH. Its settings are only ever exposed
  // to the user as size, and a partial-alpha eraser would leave a translucent
  // ghost of the stroke it was meant to remove — the eraser contract is
  // "remove", not "fade".
  const effective = stroke.eraser
    ? { ...settingsOf({ ...stroke, brush: stroke.brush ?? 'eraser' }), opacity: 1, flow: 1 }
    : settingsOf({ ...stroke, brush: stroke.brush ?? 'pencil' })
  // The eraser's colour is an opaque-alpha MASK, not paint: it must be the
  // engine's fixed mask value regardless of any colour stored on the stroke.
  paintBrushStroke(ctx, stroke.eraser ? { ...stroke, color: ERASER_MASK } : stroke, effective)
  ctx.restore()
}

/** The eraser's only colour: fully opaque black, consumed by destination-out. */
export const ERASER_MASK = 'rgba(0,0,0,1)'

export interface InkLayers {
  paper: HTMLCanvasElement
  ink: HTMLCanvasElement
}

const workCanvases = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>()

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
  const layers: DrawingLayer[] = doc.layers?.length
    ? doc.layers
    : [{ id: DEFAULT_LAYER_ID, name: 'Layer 1', visible: true }]
  const fallbackLayerId = layers[0].id
  const activeLayerId = layers.some((layer) => layer.id === doc.activeLayerId)
    ? doc.activeLayerId
    : fallbackLayerId
  const drawLayer = (target: CanvasRenderingContext2D, layerId: string, preview: boolean) => {
    target.setTransform(ratio, 0, 0, ratio, 0, 0)
    for (const stroke of doc.strokes) {
      if ((stroke.layerId ?? fallbackLayerId) === layerId) paintInkStroke(target, stroke)
    }
    target.globalCompositeOperation = 'source-over'
    for (const shape of doc.shapes ?? []) {
      if ((shape.layerId ?? fallbackLayerId) === layerId) drawShape(target, shape)
    }
    for (const element of doc.texts ?? []) {
      if ((element.layerId ?? fallbackLayerId) === layerId) drawText(target, element)
    }
    if (preview && options.live) paintInkStroke(target, options.live)
    if (preview && options.liveShape) {
      target.globalCompositeOperation = 'source-over'
      drawShape(target, options.liveShape)
    }
  }

  const visibleLayers = layers.filter((layer) => layer.visible)
  if (visibleLayers.length <= 1) {
    const layer = visibleLayers[0]
    if (layer) drawLayer(ctx, layer.id, layer.id === activeLayerId)
  } else {
    let workCanvas = workCanvases.get(inkCanvas)
    if (!workCanvas) {
      workCanvas = document.createElement('canvas')
      workCanvases.set(inkCanvas, workCanvas)
    }
    if (workCanvas.width !== targetW || workCanvas.height !== targetH) {
      workCanvas.width = targetW
      workCanvas.height = targetH
    }
    const workCtx = workCanvas.getContext('2d')
    if (workCtx) {
      for (const layer of visibleLayers) {
        workCtx.setTransform(1, 0, 0, 1, 0, 0)
        workCtx.globalCompositeOperation = 'source-over'
        workCtx.globalAlpha = 1
        workCtx.clearRect(0, 0, targetW, targetH)
        drawLayer(workCtx, layer.id, layer.id === activeLayerId)
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1
        ctx.drawImage(workCanvas, 0, 0)
      }
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
}

/**
 * Composites paper + ink onto the visible canvas.
 *
 * The visible canvas' backing store is document × device pixel ratio — the SAME
 * size as the ink layer, so paper and ink share one coordinate space.
 *
 * The ELEMENT is what fills the stage: CSS sizes it (max-width/max-height plus
 * the document aspect ratio), so the bitmap is scaled to fit without ever being
 * stretched. Doing the letterboxing HERE instead put paper and ink at different
 * scales, which is how the artwork came to be drawn above its own page.
 */
export function compositeLayers(
  target: HTMLCanvasElement | null,
  layers: InkLayers,
  paper: PaperKind,
  docWidth = CANVAS_W,
  docHeight = CANVAS_H,
  /** Backing-store pixel ratio. Must be the SAME ratio `renderInkLayer` used. */
  pixelRatio = Math.min(3, Math.max(1, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1)),
): void {
  void paper
  void pixelRatio
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

  // The BACKING STORE follows the element's CSS box × DPR. The element is sized
  // by CSS to the document's aspect ratio (`aspect-ratio: 900/620`), so the
  // bitmap fills it EXACTLY — no letterboxing, no dark bands.
  //
  // The box is read here rather than trusted from a previous paint: during the
  // first frames after a layout change, `getBoundingClientRect()` still reports
  // the old box, which is how the paper ended up drawn 242px tall inside a
  // 620px element. A zero/absent rect (tests, SSR) falls back to the document
  // size so the function stays pure and usable outside a browser.
  const boxRect = typeof target.getBoundingClientRect === 'function' ? target.getBoundingClientRect() : null
  const boxW = boxRect && boxRect.width > 1 ? boxRect.width : 0
  const boxH = boxRect && boxRect.height > 1 ? boxRect.height : 0
  const desiredW = boxW ? Math.round(boxW * pixelRatio) : Math.max(1, Math.round(docWidth * pixelRatio))
  const desiredH = boxH ? Math.round(boxH * pixelRatio) : Math.max(1, Math.round(docHeight * pixelRatio))
  if (target.width !== desiredW) target.width = desiredW
  if (target.height !== desiredH) target.height = desiredH
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.clearRect(0, 0, target.width, target.height)
  // The element already has the document ratio, so the bitmap fills it. Drawing
  // at `min()` scale with centring offsets was what left the paper as a band in
  // the middle of the canvas.
  ctx.drawImage(layers.paper, 0, 0, target.width, target.height)
  ctx.drawImage(layers.ink, 0, 0, target.width, target.height)
  canvasFit = { offsetX: 0, offsetY: 0, scale: target.width / docWidth }
}

/**
 * Geometry of the paper inside the visible canvas, in backing-store pixels.
 *
 * Written by `compositeLayers` and read by pointer handling so a stroke lands
 * where the user touched, even when the paper is letterboxed inside a canvas
 * that fills a differently-shaped stage.
 */
export let canvasFit: { offsetX: number; offsetY: number; scale: number } | null = null

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
