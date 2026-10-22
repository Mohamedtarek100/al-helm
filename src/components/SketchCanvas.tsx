import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, IconButton } from './Button'
import { Card } from './Card'
import { ConfirmDialog } from './Modal'
import { EraserIcon, PencilIcon, RedoIcon, TrashIcon, UndoIcon, DownloadIcon, SaveIcon } from './icons'
import { createArtwork, updateArtwork, useAppData } from '../services/store'
import { todayKey } from '../services/date'
import { useI18n } from '../i18n/useI18n'

const PALETTE = ['#34312f', '#b66b52', '#89977b', '#aabbc8', '#c99a4e', '#8c6a82', '#b5523f', '#f7f0e5']
const CANVAS_W = 900
const CANVAS_H = 620

type Tool = 'pencil' | 'eraser'

interface Stroke {
  points: Array<{ x: number; y: number }>
  color: string
  size: number
  eraser: boolean
}

export function SketchCanvas() {
  const { t, language } = useI18n()
  const data = useAppData()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tool, setTool] = useState<Tool>('pencil')
  const [color, setColor] = useState(PALETTE[0])
  const [size, setSize] = useState(3)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [redoStack, setRedoStack] = useState<Stroke[]>([])
  const [drawing, setDrawing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [bg, setBg] = useState<'white' | 'cream' | 'grid'>('cream')

  const bgCss = bg === 'white' ? '#ffffff' : bg === 'cream' ? '#fdf8ef' : '#fdf8ef'

  /* Render all committed strokes + in-progress stroke onto the canvas. */
  const render = useCallback(
    (inProgress: Stroke | null) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
      ctx.fillStyle = bgCss
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
      if (bg === 'grid') {
        ctx.strokeStyle = 'rgba(52,49,47,0.08)'
        ctx.lineWidth = 1
        for (let x = 0; x <= CANVAS_W; x += 30) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_H); ctx.stroke()
        }
        for (let y = 0; y <= CANVAS_H; y += 30) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke()
        }
      }
      const all = inProgress ? [...strokes, inProgress] : strokes
      for (const s of all) {
        if (!s || !Array.isArray(s.points) || s.points.length === 0) continue
        ctx.globalCompositeOperation = s.eraser ? 'destination-out' : 'source-over'
        ctx.strokeStyle = s.eraser ? 'rgba(0,0,0,1)' : s.color
        ctx.lineWidth = s.size
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(s.points[0].x, s.points[0].y)
        for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y)
        if (s.points.length === 1) ctx.lineTo(s.points[0].x + 0.1, s.points[0].y)
        ctx.stroke()
      }
      ctx.globalCompositeOperation = 'source-over'
    },
    [strokes, bg, bgCss],
  )

  useEffect(() => { render(null) }, [render])

  const pos = (e: PointerEvent | React.PointerEvent): { x: number; y: number } => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_H,
    }
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrawing(true)
    setRedoStack([])
    currentRef.current = { points: [pos(e)], color, size, eraser: tool === 'eraser' }
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing || !currentRef.current) return
    currentRef.current.points.push(pos(e))
    render(currentRef.current)
  }

  const end = () => {
    if (!drawing) return
    setDrawing(false)
    if (currentRef.current) {
      setStrokes((prev) => [...prev, currentRef.current!])
      setDirty(true)
    }
    currentRef.current = null
  }

  const currentRef = useRef<Stroke | null>(null)

  const undo = () => {
    setStrokes((prev) => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      setRedoStack((r) => [...r, last])
      setDirty(true)
      return prev.slice(0, -1)
    })
  }

  const redo = () => {
    setRedoStack((r) => {
      if (r.length === 0) return r
      const last = r[r.length - 1]
      setStrokes((prev) => [...prev, last])
      setDirty(true)
      return r.slice(0, -1)
    })
  }

  const clear = () => { setStrokes([]); setRedoStack([]); setDirty(true); setSavedId(null); setConfirmClear(false) }

  const exportPng = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${title || 'al-helm-sketch'}.png`
      a.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }

  const save = async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const name = title.trim() || (language === 'en' ? 'Untitled sketch' : 'اسكتش بدون عنوان')
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      let created: { id: string } | null = null
      if (savedId) {
        await updateArtwork(savedId, { title: name, imageUrl: '', imagePath: null, date: todayKey(), medium: language === 'en' ? 'Digital sketch' : 'رسم رقمي', source: 'drawn' })
      } else {
        created = await createArtwork({ title: name, description: '', medium: language === 'en' ? 'Digital sketch' : 'رسم رقمي', date: todayKey(), imageUrl: '', imagePath: null, source: 'drawn', category: '', tags: [], favorite: false })
        setSavedId(created.id)
      }
      const id = created?.id ?? savedId
      if (blob && id) {
        const { putImage } = await import('../services/artImages')
        await putImage(id, blob)
      }
      setDirty(false)
    } catch {
      /* save failure surfaced by persistence layer */
    }
  }

  const openSaved = (id: string) => {
    const art = data.artworks.find((a) => a.id === id)
    if (!art) return
    const loadInto = (src: string) => {
      const img = new Image()
      img.onload = () => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
        ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H)
      }
      img.onerror = () => {
        // Recovery: image data is gone but metadata remains; keep the drawing usable.
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
        ctx.fillStyle = bgCss
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
      }
      img.src = src
    }
    ;(async () => {
      try {
        const { getImage } = await import('../services/artImages')
        const blob = await getImage(id)
        if (blob) {
          loadInto(URL.createObjectURL(blob))
          return
        }
      } catch { /* fall back to stored URL */ }
      if (art.imageUrl) loadInto(art.imageUrl)
    })()
    setTitle(art.title)
    setSavedId(art.id)
    setStrokes([])
    setRedoStack([])
    setDirty(false)
  }

  const savedArtworks = data.artworks.slice(-6).reverse()

  return (
    <div className="page-stack">
      <Card padded={false} className="sketch-card">
        <div className="sketch-toolbar">
          <div className="row">
            <IconButton label={t('sketchPencil')} variant={tool === 'pencil' ? 'primary' : 'secondary'} onClick={() => setTool('pencil')}><PencilIcon size={17} /></IconButton>
            <IconButton label={t('sketchEraser')} variant={tool === 'eraser' ? 'primary' : 'secondary'} onClick={() => setTool('eraser')}><EraserIcon size={17} /></IconButton>
          </div>
          <div className="row" role="group" aria-label={t('sketchColor')}>
            {PALETTE.map((c) => (
              <button key={c} type="button" className={`sketch-swatch ${color === c ? 'sketch-swatch--active' : ''}`} style={{ background: c }} aria-label={c} onClick={() => { setColor(c); setTool('pencil') }} />
            ))}
          </div>
          <label className="sketch-size">
            <span className="t-xs t-muted">{t('sketchSize')}</span>
            <input type="range" min={1} max={30} value={size} onChange={(e) => setSize(Number(e.target.value))} />
          </label>
          <div className="row">
            <IconButton label={t('undo')} size="sm" onClick={undo} disabled={strokes.length === 0}><UndoIcon size={16} /></IconButton>
            <IconButton label={t('redo')} size="sm" onClick={redo} disabled={redoStack.length === 0}><RedoIcon size={16} /></IconButton>
            <IconButton label={t('clearCanvas')} size="sm" variant="danger" onClick={() => setConfirmClear(true)} disabled={strokes.length === 0}><TrashIcon size={16} /></IconButton>
          </div>
          <div className="row">
            <select className="sketch-bg" value={bg} onChange={(e) => setBg(e.target.value as 'white' | 'cream' | 'grid')} aria-label={t('sketchBackground')}>
              <option value="white">{t('sketchBgWhite')}</option>
              <option value="cream">{t('sketchBgCream')}</option>
              <option value="grid">{t('sketchBgGrid')}</option>
            </select>
          </div>
        </div>
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="sketch-canvas"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          style={{ touchAction: 'none' }}
        />
        <div className="sketch-footer">
          <input
            className="sketch-title-input"
            value={title}
            placeholder={t('sketchTitlePlaceholder')}
            onChange={(e) => setTitle(e.target.value)}
            aria-label={t('artTitle')}
          />
          <span className={`sketch-save-state ${dirty ? 'sketch-save-state--dirty' : ''}`}>
            {dirty ? t('sketchUnsaved') : t('sketchSaved')}
          </span>
          <div className="row">
            <Button size="sm" variant="secondary" leadingIcon={<DownloadIcon size={15} />} onClick={exportPng}>{t('sketchExport')}</Button>
            <Button size="sm" variant="primary" leadingIcon={<SaveIcon size={15} />} onClick={() => { void save() }}>{t('save')}</Button>
          </div>
        </div>
      </Card>

      {savedArtworks.length > 0 && (
        <Card>
          <h2 className="section-head__title">{t('sketchRecentDrawings')}</h2>
          <div className="sketch-recent">
            {savedArtworks.map((a) => (
              <button key={a.id} type="button" className="sketch-thumb" onClick={() => openSaved(a.id)} title={a.title}>
                <img src={a.imageUrl} alt={a.title} />
                <span>{a.title}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirmClear}
        title={t('clearCanvas')}
        message={t('clearCanvasConfirm')}
        destructive
        onConfirm={clear}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  )
}
