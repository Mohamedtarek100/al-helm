import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card } from './Card'
import { ConfirmDialog } from './Modal'
import { createArtwork, updateArtwork, useAppData } from '../services/store'
import { todayKey } from '../services/date'
import { useI18n } from '../i18n/useI18n'
import { compositeLayers, createLayers, renderInkLayer, type InkLayers } from '../services/inkLayers'
import {
  CANVAS_H, CANVAS_W, DEFAULT_LAYER_ID, PAPER_SWATCH, appendPoint, clearDraft, emptyDocument,
  loadDraft, parseDocument, pointFromClient, renderDocument, saveDraft,
  type DrawingDocument, type PaperKind, type Point, type Shape, type ShapeKind, type Stroke, type TextElement, type Tool,
} from '../services/drawing'
import { makeId } from '../services/drawing'
import { BRUSH_PRESETS, clampSettings, presetById, type BrushId, type BrushSettings } from '../services/brushes'
import { StudioShell, type StudioSheet } from './studio/StudioShell'
import { pushRecentColor, parseRecentColors } from '../services/drawingPalette'
import { STUDIO_PALETTE_FLAT } from '../services/colorWheel'
import {
  DEFAULT_VIEWPORT, deleteElement, elementBounds, hitTest, moveElement, panBy, zoomAt,
  type Bounds, type ElementRef, type Viewport,
} from '../services/drawingGeometry'

/**
 * Sketch board.
 *
 * Design rule that fixes the "drawing disappears" bug: the document (list of
 * strokes) is the source of truth and lives in React state. The <canvas> is
 * only a projection of it, so any re-render, theme change, resize, DPR change,
 * tab switch, remount or StrictMode double-effect can repaint the same artwork
 * instead of clearing it. The backing store follows the device pixel ratio;
 * pointer coordinates are converted into document space so high-DPI displays
 * and CSS scaling never distort strokes.
 */

// The palette lives in ONE place: services/colorWheel.ts (STUDIO_PALETTE). The
// previous drawingPalette.ts carried a SECOND, older palette that the canvas no
// longer used, so a colour could exist in the picker but not in the toolbar or
// vice-versa. The shared hex helpers moved there too, and only the recent-
// colour history still lives in drawingPalette.ts.
const PALETTE = STUDIO_PALETTE_FLAT
const DRAFT_DEBOUNCE_MS = 900
const AUTOSAVE_DEBOUNCE_MS = 2600
const HISTORY_LIMIT = 100

type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

interface SketchCanvasProps {
  /** Optional artwork id to open on mount (from "My gallery" → Edit drawing). */
  initialArtworkId?: string | null
}

export function SketchCanvas({ initialArtworkId = null }: SketchCanvasProps) {
  const { t, language } = useI18n()
  const data = useAppData()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [doc, setDoc] = useState<DrawingDocument>(() => loadDraft(null)?.document ?? emptyDocument())
  const [tool, setTool] = useState<Tool>('pencil')
  const [brushId, setBrushId] = useState<BrushId>('pencil')
  /** Per-brush settings, so switching presets never throws away a tuned brush. */
  const [brushSettings, setBrushSettings] = useState<Record<BrushId, BrushSettings>>(() => (
    Object.fromEntries(BRUSH_PRESETS.map((preset) => [preset.id, preset.defaults])) as Record<BrushId, BrushSettings>
  ))
  const [color, setColor] = useState(PALETTE[0])
  const [size, setSize] = useState(3)
  const activeBrush = presetById(brushId)
  const activeSettings = brushSettings[brushId]
  /**
   * Applies a settings change to the ACTIVE brush and mirrors the size into the
   * shared `size` state, because the eraser and the shapes read that value.
   */
  const patchBrush = useCallback((patch: Partial<BrushSettings>) => {
    setBrushSettings((current) => ({ ...current, [brushId]: clampSettings({ ...current[brushId], ...patch }) }))
    if (patch.size !== undefined) setSize(Math.round(clampSettings({ ...activeSettings, ...patch }).size))
  }, [brushId, activeSettings])
  const chooseBrush = useCallback((id: BrushId) => {
    setBrushId(id)
    // Choosing the eraser preset selects the eraser tool; choosing any paint
    // brush leaves a non-drawing tool (select/pan/shape) untouched.
    if (presetById(id).eraser) setTool('eraser')
    else if (tool === 'eraser') setTool('pencil')
  }, [tool])
  const [layerToDelete, setLayerToDelete] = useState<string | null>(null)
  const [shapeKind] = useState<ShapeKind>('rect')
  /** Recently used custom colours, persisted per device (drawingPalette is pure). */
  const [recentColors, setRecentColors] = useState<string[]>(() => {
    try { return parseRecentColors(JSON.parse(localStorage.getItem('alhelm.v1.recentColors') || '[]')) } catch { return [] }
  })
  const rememberColor = useCallback((hex: string) => {
    setRecentColors((prev) => {
      const next = pushRecentColor(prev, hex)
      try { localStorage.setItem('alhelm.v1.recentColors', JSON.stringify(next)) } catch { /* storage unavailable */ }
      return next
    })
  }, [])
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT)
  const [selected, setSelected] = useState<ElementRef | null>(null)
  /** In-flight selection drag and pan gesture (refs: never stale). */
  const dragRef = useRef<{ ref: ElementRef; last: Point; bounds: Bounds | null; origin: DrawingDocument } | null>(null)
  const panStartRef = useRef<{ x: number; y: number } | null>(null)
  /** Latest viewport, for pointer handlers (which must not capture stale state). */
  const viewportRef = useRef<Viewport>(DEFAULT_VIEWPORT)
  /** The shape being dragged (not yet committed). */
  const pendingShapeRef = useRef<Shape | null>(null)
  const [pendingShape, setPendingShape] = useState<Shape | null>(null)
  const [undoStack, setUndoStack] = useState<DrawingDocument[]>([])
  const [redoStack, setRedoStack] = useState<DrawingDocument[]>([])
  const [drawing, setDrawing] = useState(false)
  const [title, setTitle] = useState(() => loadDraft(null)?.title ?? '')
  const [savedId, setSavedId] = useState<string | null>(() => loadDraft(null)?.artworkId ?? null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [lockedNotice, setLockedNotice] = useState<string | null>(null)
  /** Which bottom-sheet panel is open on a compact screen. */
  const [sheet, setSheet] = useState<StudioSheet | null>(null)
  /**
   * Disabled layer ids.
   *
   * `doc.layers` is the PERSISTED structure and must not carry a lock flag
   * (locking is a session guard against stray touches, not document content),
   * so these live here and are enforced by the engine on every stroke.
   */
  const [lockedLayers, setLockedLayers] = useState<Set<string>>(() => new Set())
  /** Colours the user explicitly saved for reuse (device-local). */
  const [savedColors, setSavedColors] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('alhelm.v1.savedColors') || '[]')
      return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)).slice(0, 24) : []
    } catch { return [] }
  })
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [dpr, setDpr] = useState(() => (typeof window === 'undefined' ? 1 : Math.min(3, Math.max(1, window.devicePixelRatio || 1))))

  /** The stroke under the pointer (not yet committed to the document). */
  const currentRef = useRef<Stroke | null>(null)
  /** Strokes are mirrored in refs so pointer handlers never capture stale state. */
  const docRef = useRef(doc)
  docRef.current = doc
  const savedIdRef = useRef(savedId)
  savedIdRef.current = savedId
  const titleRef = useRef(title)
  titleRef.current = title
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveRef = useRef<() => Promise<void>>(async () => undefined)

  /* ---------------- rendering (two-layer model) ---------------- */

  /**
   * Paper and ink live on separate offscreen canvases. The visible canvas is
   * only ever a composite of the two, so an eraser (destination-out) can only
   * remove ink — it cannot damage the paper, and it cannot affect ink outside
   * the stroke it covers. This replaces the previous single-canvas approach,
   * which let erasing destroy unrelated strokes.
   */
  const layersRef = useRef<InkLayers | null>(null)

  const paint = useCallback((live?: Stroke | null) => {
    const document = docRef.current
    if (!layersRef.current) {
      layersRef.current = createLayers(document.width * dpr, document.height * dpr)
    }
    const layers = layersRef.current
    if (!layers) return
    // The ink layer is ALWAYS rendered at 1:1 in document space. Pan/zoom is
    // applied only when compositing to the visible canvas, so the saved drawing
    // geometry is never affected by navigation.
    renderInkLayer(layers.ink, document, { live: live ?? null, liveShape: pendingShapeRef.current, pixelRatio: dpr })
    // The SAME ratio is passed to the compositor so paper, ink and the visible
    // canvas share one coordinate space (a mismatch drew ink above the paper).
    compositeLayers(canvasRef.current, layers, document.paper, document.width, document.height, dpr)
  }, [dpr])

  // Apply the viewport to the visible canvas element only (CSS transform), so
  // export and hit-testing keep using document coordinates.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.style.transform = `translate(${viewport.offsetX}px, ${viewport.offsetY}px) scale(${viewport.scale})`
    // The transform is applied to the INNER canvas only; the wrapper keeps the
    // viewport-filling box, so panning/zooming never moves the stage itself.
    //
    // `transform-origin: center` (not `0 0`) keeps zoom anchored on the paper's
    // centre. With `0 0` the paper slid off the top-left of the stage as soon as
    // the user zoomed, which looked like the drawing had moved.
    canvas.style.transformOrigin = 'center center'
    canvas.style.cursor = tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair'
  }, [viewport, tool])

  // Pointer coordinates must be un-projected through the viewport.
  useEffect(() => { viewportRef.current = viewport }, [viewport])

  // Repaint whenever the document, DPR or paper changes. Never clears state.
  useEffect(() => { paint(null) }, [doc, paint])

  /**
   * Re-composite whenever the canvas BOX changes.
   *
   * `compositeLayers` sizes the backing store from the element's CSS box, but on
   * the first frames after mount — and after a rotation or a panel opening — the
   * box is not yet its final size, so the bitmap was painted at the old size and
   * the paper appeared as a band in the middle of a taller canvas (measured: a
   * 351×242 paper inside a 351×620 canvas on a phone). A ResizeObserver repaints
   * at the exact moment the box settles, for every layout, without polling.
   */
  useEffect(() => {
    const node = canvasRef.current
    if (!node || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(() => paint(null))
    observer.observe(node)
    return () => observer.disconnect()
  }, [paint])

  // Repaint while a shape is being dragged so the preview follows the pointer.
  useEffect(() => { paint(null) }, [pendingShape, paint])

  // Keep the backing store sharp when the window moves between displays.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const sync = () => setDpr((prev) => {
      const next = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
      return Math.abs(prev - next) < 0.01 ? prev : next
    })
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  /* ---------------- draft autosave ---------------- */

  const persistDraft = useCallback((document: DrawingDocument, artworkId: string | null, nextTitle: string) => {
    saveDraft({ document, title: nextTitle, artworkId, savedAt: new Date().toISOString() })
  }, [])

  const markDirty = useCallback(() => {
    setSaveState('dirty')
    if (draftTimer.current) clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(() => {
      draftTimer.current = null
      persistDraft(docRef.current, savedIdRef.current, titleRef.current)
    }, DRAFT_DEBOUNCE_MS)
  }, [persistDraft])

  const updateDoc = useCallback((
    next: DrawingDocument,
    options: { recordHistory?: boolean; preserveSelection?: boolean } = {},
  ) => {
    const previous = docRef.current
    if (options.recordHistory !== false && previous !== next) {
      setUndoStack((stack) => [...stack, previous].slice(-HISTORY_LIMIT))
      setRedoStack([])
    }
    docRef.current = next
    setDoc(next)
    // Selection is POSITIONAL, so every path that structurally changes the
    // document drops it in the same update. Previously an effect watched the
    // element counts and cleared the selection afterwards; that left one
    // render in which the delete button pointed at a shifted element.
    if (!options.preserveSelection) setSelected(null)
    markDirty()
  }, [markDirty])

  /* ---------------- pointer input ---------------- */

  const toPoint = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    // getBoundingClientRect already includes the CSS scale, so normalising to the
    // document size yields document coordinates directly — pan/zoom therefore
    // never corrupts where a stroke lands.
    return pointFromClient(event.clientX, event.clientY, rect, docRef.current)
  }

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* older webviews */ }

    // Pan: drag the viewport. Never writes to the document.
    if (tool === 'pan') {
      panStartRef.current = { x: event.clientX, y: event.clientY }
      setDrawing(true)
      return
    }

    // Select: pick the topmost element and start dragging it.
    if (tool === 'select') {
      const at = toPoint(event)
      const hit = hitTest(docRef.current, at)
      setSelected(hit)
      if (hit) {
        const bounds = elementBounds(docRef.current, hit)
        dragRef.current = { ref: hit, last: at, bounds, origin: docRef.current }
        setDrawing(true)
      }
      return
    }

    const activeLayer = docRef.current.layers?.find((layer) => layer.id === docRef.current.activeLayerId)
      ?? docRef.current.layers?.[0]
    if (activeLayer?.visible === false) return
    // A locked layer is READ-ONLY in the engine, not only in the panel: this is
    // what stops a stray palm touch from damaging finished line art.
    if (activeLayer?.locked === true || (activeLayer && lockedLayers.has(activeLayer.id))) {
      setLockedNotice(t('studioLayerLocked'))
      window.setTimeout(() => setLockedNotice(null), 2600)
      return
    }

    // Text: a tap places a text element; there is nothing to drag.
    if (tool === 'text') {
      const at = toPoint(event)
      const text = window.prompt(t('sketchTextPrompt'), '')
      if (text && text.trim()) {
        const element: TextElement = {
          id: makeId('txt'),
          layerId: activeLayer?.id ?? DEFAULT_LAYER_ID,
          x: at.x,
          y: at.y,
          text: text.trim(),
          color,
          size: Math.max(12, size * 6),
        }
        updateDoc({ ...docRef.current, texts: [...(docRef.current.texts ?? []), element] })
      }
      return
    }

    // Shapes drag from the start point to the current point.
    if (tool === 'shape') {
      const from = toPoint(event)
      pendingShapeRef.current = {
        id: makeId('shp'),
        layerId: activeLayer?.id ?? DEFAULT_LAYER_ID,
        kind: shapeKind,
        from,
        to: from,
        color,
        size,
      }
      setPendingShape(pendingShapeRef.current)
      setDrawing(true)
      return
    }

    currentRef.current = {
      layerId: activeLayer?.id ?? DEFAULT_LAYER_ID,
      points: [toPoint(event)],
      color,
      size: Math.max(1, activeSettings.size),
      eraser: tool === 'eraser' || activeBrush.eraser === true,
      brush: brushId,
      opacity: tool === 'eraser' ? 1 : activeSettings.opacity,
    }
    setDrawing(true)
    paint(currentRef.current)
  }

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Pan: translate the viewport only; document coordinates are untouched.
    const pan = panStartRef.current
    if (pan) {
      const dx = event.clientX - pan.x
      const dy = event.clientY - pan.y
      panStartRef.current = { x: event.clientX, y: event.clientY }
      setViewport((v) => panBy(v, dx, dy, docRef.current.width, docRef.current.height))
      return
    }

    // Select: drag the selected element (committed on pointer up).
    const drag = dragRef.current
    if (drag) {
      const at = toPoint(event)
      const next = moveElement(docRef.current, drag.ref, at.x - drag.last.x, at.y - drag.last.y)
      dragRef.current = { ...drag, last: at }
      updateDoc(next, { recordHistory: false, preserveSelection: true })
      return
    }

    // Shape drag: update the preview only (no document write per move).
    const shape = pendingShapeRef.current
    if (shape) {
      event.preventDefault()
      const next = { ...shape, to: toPoint(event) }
      pendingShapeRef.current = next
      setPendingShape(next)
      return
    }
    const live = currentRef.current
    if (!live) return
    event.preventDefault()
    const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? []
    let stroke = live
    if (coalesced.length > 1) {
      const rect = event.currentTarget.getBoundingClientRect()
      for (const point of coalesced) stroke = appendPoint(stroke, pointFromClient(point.clientX, point.clientY, rect, docRef.current), 0.8)
    } else {
      stroke = appendPoint(stroke, toPoint(event))
    }
    currentRef.current = stroke
    paint(stroke)
  }

  const cancelGesture = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    panStartRef.current = null
    pendingShapeRef.current = null
    currentRef.current = null
    setPendingShape(null)
    setDrawing(false)
    if (drag && docRef.current !== drag.origin) {
      updateDoc(drag.origin, { recordHistory: false })
    }
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch { /* capture may already have been released by the browser */ }
    paint(null)
  }

  const end = (event?: React.PointerEvent<HTMLCanvasElement>) => {
    if (panStartRef.current) {
      panStartRef.current = null
      setDrawing(false)
      return
    }
    if (dragRef.current) {
      const drag = dragRef.current
      dragRef.current = null
      setDrawing(false)
      if (docRef.current !== drag.origin) {
        setUndoStack((stack) => [...stack, drag.origin].slice(-HISTORY_LIMIT))
        setRedoStack([])
      }
      return
    }
    const shape = pendingShapeRef.current
    if (shape) {
      pendingShapeRef.current = null
      setPendingShape(null)
      setDrawing(false)
      if (event) {
        try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* not captured */ }
      }
      // Ignore a stray tap that never dragged (zero-size shape).
      const dragged = Math.abs(shape.to.x - shape.from.x) + Math.abs(shape.to.y - shape.from.y) > 2
      if (dragged) updateDoc({ ...docRef.current, shapes: [...(docRef.current.shapes ?? []), shape] })
      return
    }
    const live = currentRef.current
    if (!live) return
    currentRef.current = null
    setDrawing(false)
    if (event) {
      try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* not captured */ }
    }
    updateDoc({ ...docRef.current, strokes: [...docRef.current.strokes, live] })
    paint(null)
  }

  /* ---------------- history & tools ---------------- */

  /** Undo and redo complete document snapshots in actual operation order. */
  const undo = () => {
    if (!undoStack.length) return
    const previous = undoStack[undoStack.length - 1]
    setUndoStack((stack) => stack.slice(0, -1))
    setRedoStack((stack) => [...stack, docRef.current].slice(-HISTORY_LIMIT))
    updateDoc(previous, { recordHistory: false })
  }

  const redoAction = () => {
    if (!redoStack.length) return
    const next = redoStack[redoStack.length - 1]
    setRedoStack((stack) => stack.slice(0, -1))
    setUndoStack((stack) => [...stack, docRef.current].slice(-HISTORY_LIMIT))
    updateDoc(next, { recordHistory: false })
  }

  const changePaper = (paper: PaperKind) => updateDoc({ ...docRef.current, paper })

  /** Screen-space centre of the visible canvas, used as the zoom anchor. */
  const centerOfCanvas = (): Point => ({
    x: (docRef.current.width * viewport.scale) / 2,
    y: (docRef.current.height * viewport.scale) / 2,
  })

  /** Removes the selected element and clears the selection. */
  const deleteSelected = () => {
    if (!selected) return
    updateDoc(deleteElement(docRef.current, selected))
    setSelected(null)
  }
  // The selection delete action lives in the top bar; keep it reachable from
  // the keyboard for desktop users (Delete / Backspace removes the selection).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!selected) return
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        deleteSelected()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // `deleteSelected` is re-created every render but reads live state through
    // refs; re-subscribing on `selected` alone is enough and avoids tearing the
    // listener down on every unrelated render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])



  const clear = () => {
    setConfirmClear(false)
    const cleared = { ...docRef.current, strokes: [], shapes: [], texts: [] }
    updateDoc(cleared)
    // Clearing is an explicit action; the saved artwork is only replaced on Save.
    persistDraft(cleared, savedIdRef.current, titleRef.current)
  }

  const addLayer = () => {
    const current = docRef.current
    const layers = current.layers?.length
      ? current.layers
      : [{ id: DEFAULT_LAYER_ID, name: t('sketchLayerNumber', { count: 1 }), visible: true }]
    const layer = { id: makeId('lay'), name: t('sketchLayerNumber', { count: layers.length + 1 }), visible: true }
    updateDoc({ ...current, layers: [...layers, layer], activeLayerId: layer.id })
  }

  const selectLayer = (id: string) => {
    const current = docRef.current
    const layer = current.layers?.find((entry) => entry.id === id)
    if (!layer?.visible) return
    updateDoc({ ...current, activeLayerId: id }, { preserveSelection: true })
  }

  const renameLayer = (id: string, name: string) => {
    const current = docRef.current
    const layers = current.layers ?? []
    updateDoc({
      ...current,
      layers: layers.map((layer) => layer.id === id ? { ...layer, name: name.slice(0, 60) } : layer),
    }, { recordHistory: false, preserveSelection: true })
  }

  const moveLayer = (id: string, direction: -1 | 1) => {
    const current = docRef.current
    const layers = [...(current.layers ?? [])]
    const index = layers.findIndex((layer) => layer.id === id)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= layers.length) return
    ;[layers[index], layers[nextIndex]] = [layers[nextIndex], layers[index]]
    updateDoc({ ...current, layers })
  }

  const toggleLayerVisibility = (id: string) => {
    const current = docRef.current
    const layers = current.layers ?? []
    const layer = layers.find((entry) => entry.id === id)
    if (!layer) return
    if (layer.visible && layers.filter((entry) => entry.visible).length <= 1) return
    const nextLayers = layers.map((entry) => entry.id === id ? { ...entry, visible: !entry.visible } : entry)
    const nextActiveLayerId = id === current.activeLayerId && layer.visible
      ? nextLayers.find((entry) => entry.visible)?.id
      : current.activeLayerId
    updateDoc({ ...current, layers: nextLayers, activeLayerId: nextActiveLayerId }, { preserveSelection: true })
    setSelected(null)
  }

  /** Lock/unlock: a locked layer refuses strokes (enforced in `start`). */
  const toggleLayerLocked = (id: string) => {
    setLockedLayers((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const deleteLayer = () => {
    if (!layerToDelete) return
    const current = docRef.current
    const layers = current.layers ?? []
    if (layers.length <= 1) { setLayerToDelete(null); return }
    const fallback = layers.find((layer) => layer.id !== layerToDelete)?.id ?? DEFAULT_LAYER_ID
    // Elements on the removed layer are moved to the surviving layer rather than
    // deleted: deleting a LAYER must never silently destroy artwork the user can
    // still see, and an orphaned element would render on no layer at all.
    const next: DrawingDocument = {
      ...current,
      layers: layers.filter((layer) => layer.id !== layerToDelete),
      strokes: current.strokes.map((stroke) => (stroke.layerId ?? layers[0].id) === layerToDelete ? { ...stroke, layerId: fallback } : stroke),
      shapes: (current.shapes ?? []).map((shape) => (shape.layerId ?? layers[0].id) === layerToDelete ? { ...shape, layerId: fallback } : shape),
      texts: (current.texts ?? []).map((text) => (text.layerId ?? layers[0].id) === layerToDelete ? { ...text, layerId: fallback } : text),
      activeLayerId: current.activeLayerId === layerToDelete ? fallback : current.activeLayerId,
    }
    updateDoc(next)
    setLayerToDelete(null)
  }

  const exportPng = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${(titleRef.current.trim() || '4ulife-sketch')}.png`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }, 'image/png')
  }

  /* ---------------- saving ---------------- */

  const capture = (): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const canvas = canvasRef.current
      if (!canvas) { reject(new Error(language === 'en' ? 'Canvas is not ready.' : 'اللوحة غير جاهزة.')); return }
      if (typeof canvas.toBlob !== 'function') { reject(new Error('Canvas capture is not supported.')); return }
      canvas.toBlob((blob) => {
        if (blob && blob.size > 0) resolve(blob)
        else reject(new Error(language === 'en' ? 'Could not capture the drawing.' : 'تعذر تحويل الرسمة لصورة.'))
      }, 'image/png')
    })

  // `capture` is a plain function re-created on every render (it closes over
  // the current language for its error messages). Holding it in a ref means
  // `save` — which must stay stable enough for the autosave timers — always
  // calls the CURRENT version instead of one captured at first render.
  const captureRef = useRef(capture)
  captureRef.current = capture

  const save = useCallback(async (silent = false) => {
    if (autosaveTimer.current) { clearTimeout(autosaveTimer.current); autosaveTimer.current = null }
    setSaveError(null)
    if (!silent) setSaveState('saving')
    const snapshot = docRef.current
    const name = titleRef.current.trim() || (language === 'en' ? 'Untitled sketch' : 'اسكتش بدون عنوان')
    try {
      // 1. Capture the PNG BEFORE touching any metadata.
      const blob = await captureRef.current()
      // 2. Create/refresh the metadata row, including the vector model so the
      //    drawing can be reopened and edited (not only viewed).
      let artworkId = savedIdRef.current
      const payload = {
        title: name,
        imageUrl: '',
        imagePath: null,
        date: todayKey(),
        medium: language === 'en' ? 'Digital sketch' : 'رسم رقمي',
        source: 'drawn' as const,
        paper: snapshot.paper,
        drawing: JSON.stringify(snapshot),
      }
      if (!artworkId) {
        const created = await createArtwork({ ...payload, description: '', category: '', tags: [], favorite: false })
        artworkId = created.id
        savedIdRef.current = artworkId
        setSavedId(artworkId)
      } else {
        await updateArtwork(artworkId, payload)
      }
      // 3. Store the bytes durably, then verify them. Only a verified Blob
      //    counts as "saved".
      const { putImage, getImage } = await import('../services/artImages')
      await putImage(artworkId, blob)
      const stored = await getImage(artworkId)
      if (!stored || stored.size === 0) {
        throw new Error(language === 'en' ? 'The image could not be verified in local storage.' : 'تعذر التأكد من حفظ الصورة على الجهاز.')
      }
      clearDraft(null)
      clearDraft(artworkId)
      setSaveState('saved')
    } catch (error) {
      // Never touch the canvas: the user's drawing stays exactly as drawn.
      const message = error instanceof Error ? error.message : (language === 'en' ? 'Save failed.' : 'فشل الحفظ.')
      setSaveError(message)
      setSaveState('error')
      // Keep a recovery copy so a failed save can never lose strokes.
      persistDraft(snapshot, savedIdRef.current, titleRef.current)
    }
    // `clearDraft` is a module-level import, so its identity is stable and it
    // must not be listed as a dependency.
  }, [language, persistDraft])

  saveRef.current = () => save(false)
  const saveRefSilent = useRef(() => save(true))
  saveRefSilent.current = () => save(true)

  // Debounced autosave once drawing pauses — only for artwork the user has
  // already saved once, so we never create surprise records in the gallery.
  useEffect(() => {
    if (saveState !== 'dirty' || !savedId) return
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(() => { void saveRefSilent.current() }, AUTOSAVE_DEBOUNCE_MS)
    return () => { if (autosaveTimer.current) { clearTimeout(autosaveTimer.current); autosaveTimer.current = null } }
  }, [saveState, savedId, doc])

  // Flush the draft on page hide / unmount so a reload never loses the last view.
  useEffect(() => {
    const flush = () => {
      if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null }
      persistDraft(docRef.current, savedIdRef.current, titleRef.current)
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      flush()
    }
  }, [persistDraft])

  /* ---------------- opening an existing drawing ---------------- */

  const openArtwork = useCallback((id: string) => {
    const artwork = data.artworks.find((item) => item.id === id)
    if (!artwork) return
    const fromModel = parseDocument(artwork.drawing ?? null)
    if (fromModel) {
      docRef.current = fromModel
      setDoc(fromModel)
      setUndoStack([])
      setRedoStack([])
      setTitle(artwork.title)
      savedIdRef.current = artwork.id
      setSavedId(artwork.id)
      titleRef.current = artwork.title
      setSaveState('saved')
      setSaveError(null)
      persistDraft(fromModel, artwork.id, artwork.title)
      return
    }
    // Legacy drawing without a vector model: show the stored image on top of a
    // blank page so new strokes can be added over it. Keep history scoped to
    // the artwork currently being edited.
    setUndoStack([])
    setRedoStack([])
    setTitle(artwork.title)
    titleRef.current = artwork.title
    savedIdRef.current = artwork.id
    setSavedId(artwork.id)
    setSaveState('saved')
    void (async () => {
      try {
        const { getImage } = await import('../services/artImages')
        const blob = await getImage(artwork.id)
        const src = blob ? URL.createObjectURL(blob) : artwork.imageUrl
        if (!src) return
        const image = new Image()
        image.onload = () => {
          const canvas = canvasRef.current
          const ctx = canvas?.getContext('2d')
          if (!canvas || !ctx) return
          const base = emptyDocument('cream')
          renderDocument(canvas, base, { pixelRatio: dpr })
          ctx.save()
          ctx.setTransform(canvas.width / CANVAS_W, 0, 0, canvas.height / CANVAS_H, 0, 0)
          ctx.drawImage(image, 0, 0, CANVAS_W, CANVAS_H)
          ctx.restore()
          if (blob) URL.revokeObjectURL(src)
        }
        image.src = src
      } catch { /* keep the current canvas */ }
    })()
  }, [data.artworks, dpr, persistDraft])

  const openedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!initialArtworkId || openedRef.current === initialArtworkId) return
    openedRef.current = initialArtworkId
    openArtwork(initialArtworkId)
  }, [initialArtworkId, openArtwork])

  /* ---------------- full screen / focus mode ---------------- */

  /**
   * Focus mode expands the workspace in place. The canvas element is never
   * unmounted or re-created, so the document, stroke history and undo stack are
   * untouched; only layout changes. Native fullscreen is requested as an
   * enhancement, and the in-page overlay is the guaranteed fallback.
   */
  const [focusMode, setFocusMode] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const enterFocus = useCallback(async () => {
    setFocusMode(true)
    try {
      if (rootRef.current?.requestFullscreen) await rootRef.current.requestFullscreen()
    } catch { /* the overlay alone is enough */ }
    window.setTimeout(() => paint(null), 60)
  }, [paint])

  const exitFocus = useCallback(async () => {
    setFocusMode(false)
    try {
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen()
    } catch { /* ignore */ }
    window.setTimeout(() => paint(null), 60)
  }, [paint])

  // Keep focus mode in sync with the browser's own fullscreen state (Esc).
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setFocusMode(false) }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  /* ---------------- gallery list ---------------- */

  const recent = useMemo(
    () => data.artworks.filter((artwork) => (artwork.source ?? 'drawn') === 'drawn').slice(-8).reverse(),
    [data.artworks],
  )

  const statusLabel = saveState === 'saving' ? t('sketchSaving') : saveState === 'error' ? t('sketchSaveFailed') : saveState === 'dirty' ? t('sketchUnsaved') : t('sketchSaved')
  const studioLayers = useMemo(() => {
    const base = doc.layers?.length
      ? doc.layers
      : [{ id: DEFAULT_LAYER_ID, name: t('sketchLayerNumber', { count: 1 }), visible: true }]
    return base.map((layer) => (lockedLayers.has(layer.id) ? { ...layer, locked: true } : layer))
  }, [doc.layers, lockedLayers, t])
  const activeLayerId = studioLayers.some((layer) => layer.id === doc.activeLayerId)
    ? doc.activeLayerId
    : studioLayers[0].id

  return (
    <div className="page-stack sketch-studio" ref={rootRef}>
      <StudioShell
        title={title}
        onTitle={(value) => { setTitle(value); markDirty() }}
        saveState={saveState}
        statusLabel={statusLabel}
        onSave={() => { void saveRef.current() }}
        onExport={exportPng}
        onUndo={undo}
        onRedo={redoAction}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onClear={() => setConfirmClear(true)}
        canClear={doc.strokes.length > 0 || (doc.shapes?.length ?? 0) > 0 || (doc.texts?.length ?? 0) > 0}
        focusMode={focusMode}
        onToggleFocus={() => { void (focusMode ? exitFocus() : enterFocus()) }}
        doc={doc}
        layers={studioLayers}
        activeLayerId={activeLayerId ?? studioLayers[0].id}
        onSelectLayer={selectLayer}
        onAddLayer={addLayer}
        onDeleteLayer={(id) => setLayerToDelete(id)}
        onMoveLayer={moveLayer}
        onToggleLayerVisible={toggleLayerVisibility}
        onToggleLayerLocked={toggleLayerLocked}
        onRenameLayer={renameLayer}
        onOpenNavigator={() => setSheet((current) => (current === 'layers' ? null : 'layers'))}
        tool={tool}
        onTool={(next) => setTool(next)}
        brushId={brushId}
        onBrush={chooseBrush}
        brushSettings={activeSettings}
        onBrushSettings={patchBrush}
        color={color}
        onColor={(hex) => { setColor(hex); if (tool !== 'eraser') setTool('pencil') }}
        onColorCommit={rememberColor}
        recentColors={recentColors}
        savedColors={savedColors}
        onSaveColor={() => {
          const hex = color.toLowerCase()
          setSavedColors((current) => {
            const next = [hex, ...current.filter((value) => value !== hex)].slice(0, 24)
            try { localStorage.setItem('alhelm.v1.savedColors', JSON.stringify(next)) } catch { /* storage unavailable */ }
            return next
          })
        }}
        onRemoveSavedColor={(hex) => {
          setSavedColors((current) => {
            const next = current.filter((value) => value !== hex)
            try { localStorage.setItem('alhelm.v1.savedColors', JSON.stringify(next)) } catch { /* storage unavailable */ }
            return next
          })
        }}
        zoom={viewport.scale}
        onZoom={(factor) => setViewport((v) => zoomAt(v, centerOfCanvas(), factor, docRef.current.width, docRef.current.height))}
        onResetView={() => { setViewport(DEFAULT_VIEWPORT); setSelected(null) }}
        sheet={sheet}
        onSheet={setSheet}
        saveError={saveError}
        lockedNotice={lockedNotice}
        canvas={(
          <div className="studio-canvas-wrap">
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              className="sketch-canvas"
              data-drawing={drawing ? 'true' : 'false'}
              aria-label={t('canvasTab')}
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={cancelGesture}
              onPointerLeave={(event) => { if (event.pointerType === 'mouse' && event.buttons === 0) end(event) }}
              onContextMenu={(event) => event.preventDefault()}
            />
          </div>
        )}
      >
        {/* Settings that are not brushes/colour: paper and the active tool. */}
        <section className="studio-block">
          <h3 className="studio-block__title">{t('sketchBackground')}</h3>
          <div className="sketch-papers" role="radiogroup" aria-label={t('sketchBackground')}>
            {(['white', 'cream', 'grid'] as PaperKind[]).map((paper) => (
              <button
                key={paper}
                type="button"
                role="radio"
                aria-checked={doc.paper === paper}
                aria-label={paper === 'white' ? t('sketchBgWhite') : paper === 'cream' ? t('sketchBgCream') : t('sketchBgGrid')}
                title={paper === 'white' ? t('sketchBgWhite') : paper === 'cream' ? t('sketchBgCream') : t('sketchBgGrid')}
                className={`sketch-paper ${doc.paper === paper ? 'sketch-paper--active' : ''} ${paper === 'grid' ? 'sketch-paper--grid' : ''}`}
                style={{ '--paper-swatch': PAPER_SWATCH[paper] } as React.CSSProperties}
                onClick={() => changePaper(paper)}
              />
            ))}
          </div>
        </section>
      </StudioShell>
      {/* The studio no longer needs a reserved placeholder: it is a normal flex
          child of a viewport-locked page. */}

      {recent.length > 0 && (
        <Card>
          <h2 className="section-head__title">{t('sketchRecentDrawings')}</h2>
          <div className="sketch-recent">
            {recent.map((artwork) => (
              <button
                key={artwork.id}
                type="button"
                className={`sketch-thumb ${savedId === artwork.id ? 'sketch-thumb--active' : ''}`}
                onClick={() => openArtwork(artwork.id)}
                title={artwork.title}
              >
                <ArtworkThumb id={artwork.id} fallback={artwork.imageUrl} alt={artwork.title} />
                <span>{artwork.title}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirmClear}
        title={t('clearCanvas')}
        message={t('clearCanvasConfirm')}
        confirmLabel={t('clearCanvas')}
        cancelLabel={t('cancel')}
        destructive
        onConfirm={clear}
        onCancel={() => setConfirmClear(false)}
      />
      <ConfirmDialog
        open={layerToDelete !== null}
        title={t('sketchDeleteLayer')}
        message={t('sketchDeleteLayerConfirm')}
        confirmLabel={t('sketchDeleteLayer')}
        cancelLabel={t('cancel')}
        destructive
        onConfirm={deleteLayer}
        onCancel={() => setLayerToDelete(null)}
      />
    </div>
  )
}

/** Thumbnail that prefers the durable IndexedDB blob over the metadata URL. */
function ArtworkThumb({ id, fallback, alt }: { id: string; fallback: string; alt: string }) {
  const [url, setUrl] = useState(fallback)
  useEffect(() => {
    let revoked = ''
    let cancelled = false
    void (async () => {
      try {
        const { getImage } = await import('../services/artImages')
        const blob = await getImage(id)
        if (cancelled || !blob) return
        revoked = URL.createObjectURL(blob)
        setUrl(revoked)
      } catch { /* keep fallback */ }
    })()
    return () => { cancelled = true; if (revoked) URL.revokeObjectURL(revoked) }
  }, [id])
  if (!url) return <span className="sketch-thumb__empty" aria-hidden="true" />
  return <img src={url} alt={alt} loading="lazy" />
}
