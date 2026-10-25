import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, IconButton } from './Button'
import { Card } from './Card'
import { ConfirmDialog } from './Modal'
import { EraserIcon, PencilIcon, RedoIcon, TrashIcon, UndoIcon, DownloadIcon, SaveIcon } from './icons'
import { createArtwork, updateArtwork, useAppData } from '../services/store'
import { todayKey } from '../services/date'
import { useI18n } from '../i18n/useI18n'
import {
  CANVAS_H, CANVAS_W, PAPER_SWATCH, appendPoint, clearDraft, emptyDocument,
  loadDraft, parseDocument, pointFromClient, redoStroke, renderDocument, saveDraft, undoStroke,
  type DrawingDocument, type PaperKind, type Point, type Stroke, type Tool,
} from '../services/drawing'

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

const PALETTE = ['#34312f', '#b66b52', '#89977b', '#5c7f8c', '#c99a4e', '#8c6a82', '#b5523f', '#f7f0e5']
const DRAFT_DEBOUNCE_MS = 900
const AUTOSAVE_DEBOUNCE_MS = 2600

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
  const [color, setColor] = useState(PALETTE[0])
  const [size, setSize] = useState(3)
  const [redo, setRedo] = useState<Stroke[]>([])
  const [drawing, setDrawing] = useState(false)
  const [title, setTitle] = useState(() => loadDraft(null)?.title ?? '')
  const [savedId, setSavedId] = useState<string | null>(() => loadDraft(null)?.artworkId ?? null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
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

  /* ---------------- rendering ---------------- */

  const paint = useCallback((live?: Stroke | null) => {
    renderDocument(canvasRef.current, docRef.current, { live: live ?? null, pixelRatio: dpr })
  }, [dpr])

  // Repaint whenever the document, DPR or paper changes. Never clears state.
  useEffect(() => { paint(null) }, [doc, paint])

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

  const updateDoc = useCallback((next: DrawingDocument) => {
    docRef.current = next
    setDoc(next)
    markDirty()
  }, [markDirty])

  /* ---------------- pointer input ---------------- */

  const toPoint = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return pointFromClient(event.clientX, event.clientY, rect, docRef.current)
  }

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* older webviews */ }
    currentRef.current = { points: [toPoint(event)], color, size, eraser: tool === 'eraser' }
    setDrawing(true)
    setRedo([])
    paint(currentRef.current)
  }

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
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

  const end = (event?: React.PointerEvent<HTMLCanvasElement>) => {
    const live = currentRef.current
    if (!live) return
    currentRef.current = null
    setDrawing(false)
    if (event) {
      try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* not captured */ }
    }
    updateDoc({ ...docRef.current, strokes: [...docRef.current.strokes, live] })
    setRedo([])
    paint(null)
  }

  /* ---------------- history & tools ---------------- */

  const undo = () => {
    if (docRef.current.strokes.length === 0) return
    const history = undoStroke({ strokes: docRef.current.strokes, redo })
    updateDoc({ ...docRef.current, strokes: history.strokes })
    setRedo(history.redo)
  }

  const redoAction = () => {
    if (redo.length === 0) return
    const history = redoStroke({ strokes: docRef.current.strokes, redo })
    updateDoc({ ...docRef.current, strokes: history.strokes })
    setRedo(history.redo)
  }

  const changePaper = (paper: PaperKind) => updateDoc({ ...docRef.current, paper })

  const clear = () => {
    setConfirmClear(false)
    updateDoc({ ...docRef.current, strokes: [] })
    setRedo([])
    // Clearing is an explicit action; the saved artwork is only replaced on Save.
    persistDraft({ ...docRef.current, strokes: [] }, savedIdRef.current, titleRef.current)
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

  const save = useCallback(async (silent = false) => {
    if (autosaveTimer.current) { clearTimeout(autosaveTimer.current); autosaveTimer.current = null }
    setSaveError(null)
    if (!silent) setSaveState('saving')
    const snapshot = docRef.current
    const name = titleRef.current.trim() || (language === 'en' ? 'Untitled sketch' : 'اسكتش بدون عنوان')
    try {
      // 1. Capture the PNG BEFORE touching any metadata.
      const blob = await capture()
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
      setRedo([])
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
    // blank page so new strokes can be added over it.
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

  /* ---------------- gallery list ---------------- */

  const recent = useMemo(
    () => data.artworks.filter((artwork) => (artwork.source ?? 'drawn') === 'drawn').slice(-8).reverse(),
    [data.artworks],
  )

  const statusLabel = saveState === 'saving' ? t('sketchSaving') : saveState === 'error' ? t('sketchSaveFailed') : saveState === 'dirty' ? t('sketchUnsaved') : t('sketchSaved')

  return (
    <div className="page-stack sketch-studio">
      <Card padded={false} className="sketch-card">
        <div className="sketch-toolbar" role="toolbar" aria-label={t('canvasTab')}>
          <div className="sketch-toolbar__group">
            <IconButton label={t('sketchPencil')} variant={tool === 'pencil' ? 'primary' : 'secondary'} onClick={() => setTool('pencil')}><PencilIcon size={17} /></IconButton>
            <IconButton label={t('sketchEraser')} variant={tool === 'eraser' ? 'primary' : 'secondary'} onClick={() => setTool('eraser')}><EraserIcon size={17} /></IconButton>
          </div>
          <div className="sketch-toolbar__group sketch-palette" role="group" aria-label={t('sketchColor')}>
            {PALETTE.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={`sketch-swatch ${color === swatch && tool === 'pencil' ? 'sketch-swatch--active' : ''}`}
                style={{ background: swatch }}
                aria-label={swatch}
                aria-pressed={color === swatch && tool === 'pencil'}
                onClick={() => { setColor(swatch); setTool('pencil') }}
              />
            ))}
          </div>
          <label className="sketch-size">
            <span className="t-xs t-muted">{t('sketchSize')}</span>
            <input type="range" min={1} max={30} value={size} aria-label={t('sketchSize')} onChange={(event) => setSize(Number(event.target.value))} />
            <span className="sketch-size__value">{size}</span>
          </label>
          <div className="sketch-toolbar__group">
            <IconButton label={t('undo')} size="sm" onClick={undo} disabled={doc.strokes.length === 0}><UndoIcon size={16} /></IconButton>
            <IconButton label={t('redo')} size="sm" onClick={redoAction} disabled={redo.length === 0}><RedoIcon size={16} /></IconButton>
            <IconButton label={t('clearCanvas')} size="sm" variant="danger" onClick={() => setConfirmClear(true)} disabled={doc.strokes.length === 0}><TrashIcon size={16} /></IconButton>
          </div>
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
        </div>

        <div className="sketch-surface">
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
            onPointerCancel={end}
            onPointerLeave={(event) => { if (event.pointerType === 'mouse' && event.buttons === 0) end(event) }}
            onContextMenu={(event) => event.preventDefault()}
          />
        </div>

        <div className="sketch-footer">
          <input
            className="input sketch-title-input"
            value={title}
            placeholder={t('sketchTitlePlaceholder')}
            onChange={(event) => { setTitle(event.target.value); markDirty() }}
            aria-label={t('artTitle')}
            maxLength={80}
          />
          <span className={`save-state save-state--${saveState}`} role="status" aria-live="polite">
            <i aria-hidden="true" />
            {statusLabel}
          </span>
          <div className="sketch-footer__actions">
            <Button size="sm" variant="secondary" leadingIcon={<DownloadIcon size={15} />} onClick={exportPng}>{t('sketchExport')}</Button>
            <Button size="sm" variant="primary" leadingIcon={<SaveIcon size={15} />} loading={saveState === 'saving'} onClick={() => { void saveRef.current() }}>{t('save')}</Button>
          </div>
        </div>
        {saveError && <p className="alert alert--danger sketch-save-error" role="alert">{saveError} <span className="t-xs">{t('sketchSaveRetained')}</span></p>}
      </Card>

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
