import { useEffect, useRef } from 'react'
import { useI18n } from '../../i18n/useI18n'
import type { TranslationKey } from '../../i18n/translations'
import { ColorPicker } from '../ColorPicker'
import { BrushPanel, BrushRail } from './StudioBrushes'
import { LayersPanel } from './StudioLayers'
import type { BrushId, BrushSettings } from '../../services/brushes'
import type { DrawingDocument, DrawingLayer } from '../../services/drawing'

/**
 * Dream Studio workspace shell.
 *
 * WHY A SEPARATE COMPONENT
 *   The old studio put a tall wrapping toolbar ABOVE the canvas and the layer
 *   panel BESIDE it, so on an Android phone the first half of the screen was
 *   chrome and the canvas was a small card under it. That layout cannot be
 *   fixed by tweaking paddings; the ARCHITECTURE has to change:
 *
 *     desktop   ┌──────────────────────────────────────────────┐
 *               │ top bar: title · save state · undo/redo · …  │
 *               ├────────┬────────────────────────┬────────────┤
 *               │ layers │        CANVAS          │ rail+color │
 *               │        │                        │            │
 *               ├────────┴────────────────────────┴────────────┤
 *               │ brush dock (settings + library)              │
 *               └──────────────────────────────────────────────┘
 *
 *     mobile    ┌──────────────────────────────────────────────┐
 *               │ compact top bar                              │
 *               │                                              │
 *               │                CANVAS  (flex:1)              │
 *               │                                    ┌──────┐  │
 *               │                                    │ rail │  │
 *               ├────────────────────────────────────┴──────┴──┤
 *               │ bottom sheet: Color | Brush | Layers          │
 *               └──────────────────────────────────────────────┘
 *
 *   The canvas is a flex child that takes ALL remaining height, so no panel can
 *   push it below the fold and no scroll is needed to draw. Only the active
 *   sheet scrolls.
 */

export type StudioSheet = 'color' | 'brush' | 'layers' | 'settings'

export interface StudioShellProps {
  title: string
  onTitle: (value: string) => void
  saveState: 'saved' | 'dirty' | 'saving' | 'error'
  statusLabel: string
  onSave: () => void
  onExport: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onClear: () => void
  canClear: boolean
  focusMode: boolean
  onToggleFocus: () => void
  doc: DrawingDocument
  layers: DrawingLayer[]
  activeLayerId: string
  onSelectLayer: (id: string) => void
  onAddLayer: () => void
  onDeleteLayer: (id: string) => void
  onMoveLayer: (id: string, direction: 1 | -1) => void
  onToggleLayerVisible: (id: string) => void
  onToggleLayerLocked: (id: string) => void
  onRenameLayer: (id: string, name: string) => void
  onOpenNavigator: () => void
  tool: string
  onTool: (tool: 'pencil' | 'eraser' | 'shape' | 'text' | 'select' | 'pan') => void
  brushId: BrushId
  onBrush: (id: BrushId) => void
  brushSettings: BrushSettings
  onBrushSettings: (patch: Partial<BrushSettings>) => void
  color: string
  onColor: (hex: string) => void
  onColorCommit: (hex: string) => void
  recentColors: string[]
  savedColors: string[]
  onSaveColor: () => void
  onRemoveSavedColor: (hex: string) => void
  zoom: number
  onZoom: (factor: number, anchor?: 'in' | 'out') => void
  onResetView: () => void
  sheet: StudioSheet | null
  onSheet: (sheet: StudioSheet | null) => void
  canvas: React.ReactNode
  saveError: string | null
  lockedNotice: string | null
  children?: React.ReactNode
}

/**
 * Short labels for the compact toolbar.
 *
 * The full words (الفرش / الألوان / الطبقات / الإعدادات) do not fit four buttons
 * beside six brush presets on a 390px phone, and a horizontally clipped row is
 * how the panel tabs previously became invisible. These one-glyph labels are
 * paired with the accessible name from the full label.
 */
function sheetTabLabel(id: StudioSheet): string {
  if (id === 'color') return '◐'
  if (id === 'brush') return '✎'
  if (id === 'layers') return '▤'
  return '⚙'
}

const TOOLS: { id: 'pencil' | 'eraser' | 'shape' | 'text' | 'select' | 'pan'; label: TranslationKey; glyph: string }[] = [
  { id: 'pencil', label: 'studioToolPencil', glyph: '✎' },
  { id: 'eraser', label: 'studioToolEraser', glyph: '⌫' },
  { id: 'shape', label: 'studioToolShape', glyph: '▭' },
  { id: 'text', label: 'studioToolText', glyph: 'T' },
  { id: 'select', label: 'studioToolSelect', glyph: '⬚' },
  { id: 'pan', label: 'studioToolPan', glyph: '✥' },
]

export function StudioShell(props: StudioShellProps) {
  const { t } = useI18n()
  const { sheet, onSheet } = props
  const rootRef = useRef<HTMLDivElement>(null)

  /**
   * Measures how much of the viewport the studio's own top offset costs, and
   * publishes it as `--studio-offset`.
   *
   * The studio is the one screen that must never need scrolling: the canvas has
   * to be fully visible the moment the page opens. Everything above it (app
   * header, page title, workspace tabs) varies by breakpoint and language, so a
   * hard-coded height is always wrong on some device.
   *
   * WHY IT IS MEASURED ONCE VIA ITS PARENT, NOT FROM THE FIXED ELEMENT ITSELF:
   * the studio is `position: fixed`, so its OWN top is whatever was last written
   * to the custom property — reading it back would feed the stale value into
   * itself and it would never converge. The PARENT (still in normal flow) is the
   * true position, and it is read on every layout change.
   */
  useEffect(() => {
    const measure = () => {
      const node = rootRef.current
      if (!node) return
      const flow = node.parentElement
      const top = Math.max(0, Math.round((flow ?? node).getBoundingClientRect().top))
      node.style.setProperty('--studio-offset', `${top}px`)
      const height = Math.max(0, window.innerHeight - top)
      node.style.setProperty('--studio-height', `${height}px`)
      const spacer = node.nextElementSibling instanceof HTMLElement ? node.nextElementSibling : null
      if (spacer) spacer.style.height = `${height}px`
      // The drawing STAGE's real box, in CSS pixels. The canvas sizes itself from
      // these (`--studio-stage-w/h`), because a percentage height cannot be used
      // on a flex item without a definite height.
      //
      // It is read AFTER the studio has its final size and re-read on every
      // layout change (ResizeObserver + two animation frames), so it can never
      // report a stale box — a stale 900px height was why the paper sat in a
      // thin band at the bottom of a very tall canvas.
      const stage = node.querySelector<HTMLElement>('.studio-stage')
      if (stage) {
        const rect = stage.getBoundingClientRect()
        const w = Math.max(0, Math.round(rect.width - 12))
        const h = Math.max(0, Math.round(rect.height - 12))
        if (w > 0 && h > 0) {
          node.style.setProperty('--studio-stage-w', `${w}px`)
          node.style.setProperty('--studio-stage-h', `${h}px`)
        }
      }
    }
    measure()
    // Two frames: layout after fonts/route transition can shift the element.
    const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(measure))
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    // Any later layout change (font load, tab wrap, language switch, keyboard)
    // re-measures, so the canvas is never sized by a stale number.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    if (observer && rootRef.current?.parentElement) observer.observe(rootRef.current.parentElement)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
      observer?.disconnect()
    }
  }, [])

  // A sheet is a bottom sheet on phones and a right dock on desktop; Escape
  // closes it so a hardware keyboard is never trapped.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && sheet) onSheet(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sheet, onSheet])

  const sheetTabs: { id: StudioSheet; label: TranslationKey }[] = [
    { id: 'color', label: 'studioColorTab' },
    { id: 'brush', label: 'studioBrushTab' },
    { id: 'layers', label: 'studioLayersTab' },
    { id: 'settings', label: 'studioSettingsTab' },
  ]

  return (
    <div className={`studio ${props.focusMode ? 'studio--focus' : ''}`} ref={rootRef}>
      <header className="studio-top">
        <div className="studio-top__brand">
          <span className="studio-top__mark" aria-hidden="true">✦</span>
          <input
            className="studio-top__title"
            value={props.title}
            placeholder={t('sketchTitlePlaceholder')}
            aria-label={t('artTitle')}
            maxLength={80}
            onChange={(event) => props.onTitle(event.target.value)}
          />
          <span className={`studio-save studio-save--${props.saveState}`} role="status" aria-live="polite">
            <i aria-hidden="true" />
            {props.statusLabel}
          </span>
        </div>
        <div className="studio-top__actions">
          <button type="button" className="studio-icon" aria-label={t('undo')} onClick={props.onUndo} disabled={!props.canUndo}>↶</button>
          <button type="button" className="studio-icon" aria-label={t('redo')} onClick={props.onRedo} disabled={!props.canRedo}>↷</button>
          <div className="studio-zoom" role="group" aria-label={t('sketchZoom')}>
            <button type="button" className="studio-icon" aria-label={t('sketchZoomOut')} onClick={() => props.onZoom(1 / 1.25, 'out')}>−</button>
            <button type="button" className="studio-zoom__value" onClick={props.onResetView} title={t('sketchResetView')}>
              {Math.round(props.zoom * 100)}%
            </button>
            <button type="button" className="studio-icon" aria-label={t('sketchZoomIn')} onClick={() => props.onZoom(1.25, 'in')}>+</button>
          </div>
          <button type="button" className="studio-icon studio-action--secondary" aria-label={t('clearCanvas')} onClick={props.onClear} disabled={!props.canClear}>🗑</button>
          <button type="button" className="studio-icon studio-action--secondary" aria-label={props.focusMode ? t('exitFullScreen') : t('fullScreen')} onClick={props.onToggleFocus}>⛶</button>
          <button type="button" className="studio-btn studio-btn--ghost" onClick={props.onExport}>{t('sketchExport')}</button>
          <button type="button" className="studio-btn studio-btn--primary" onClick={props.onSave}>{t('save')}</button>
        </div>
      </header>

      <div className="studio-body">
        {/* Desktop layer column. Hidden below 1100px, where layers live in the
            bottom sheet instead of squeezing the canvas. */}
        <aside className="studio-col studio-col--layers" aria-label={t('sketchLayers')}>
          <LayersPanel
            layers={props.layers}
            activeId={props.activeLayerId}
            doc={props.doc}
            onSelect={props.onSelectLayer}
            onAdd={props.onAddLayer}
            onDelete={props.onDeleteLayer}
            onMove={props.onMoveLayer}
            onToggleVisible={props.onToggleLayerVisible}
            onToggleLocked={props.onToggleLayerLocked}
            onRename={props.onRenameLayer}
            onOpenNavigator={props.onOpenNavigator}
            compact={false}
          />
        </aside>

        <main className="studio-stage">
          {props.canvas}
          {props.lockedNotice && <p className="studio-notice" role="alert">{props.lockedNotice}</p>}
        </main>

        {/* Desktop tool rail + colour dock. */}
        <aside className="studio-col studio-col--tools">
          <div className="studio-tools">
            {TOOLS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`studio-tool ${props.tool === entry.id ? 'studio-tool--active' : ''}`}
                aria-pressed={props.tool === entry.id}
                aria-label={t(entry.label)}
                title={t(entry.label)}
                onClick={() => props.onTool(entry.id)}
              >
                {entry.glyph}
              </button>
            ))}
          </div>
          <div className="studio-colors">
            <h3 className="studio-block__title">{t('sketchColor')}</h3>
            <div className="studio-colors__swatch" style={{ background: props.color }} aria-hidden="true" />
            <ColorPicker
              value={props.color}
              compact
              onChange={props.onColor}
              onCommit={props.onColorCommit}
            />
          </div>
        </aside>
      </div>

      {/* Compact rail: brushes on the left, panel tabs on the right. On a phone
          this is ONE row directly above the canvas, so the drawing area is never
          pushed up and no tool needs a scroll gesture to discover. */}
      <div className="studio-mobilebar">
        <BrushRail active={props.brushId} onSelect={props.onBrush} compact />
        <div className="studio-mobilebar__tabs" role="tablist" aria-label={t('studioOpenTools')}>
          {sheetTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={sheet === tab.id}
              aria-label={t(tab.label)}
              title={t(tab.label)}
              className={`studio-sheet-tab ${sheet === tab.id ? 'studio-sheet-tab--active' : ''}`}
              onClick={() => onSheet(sheet === tab.id ? null : tab.id)}
            >
              {sheetTabLabel(tab.id)}
            </button>
          ))}
        </div>
      </div>

      {sheet && (
        <section className="studio-sheet" aria-label={t('studioOpenTools')}>
          <header className="studio-sheet__head">
            <span>{t(sheetTabs.find((tab) => tab.id === sheet)?.label ?? 'studioBrushTab')}</span>
            <button type="button" className="studio-icon" aria-label={t('studioCloseTools')} onClick={() => onSheet(null)}>×</button>
          </header>
          <div className="studio-sheet__body">
            {sheet === 'color' && (
              <ColorPicker value={props.color} onChange={props.onColor} onCommit={props.onColorCommit} />
            )}
            {sheet === 'brush' && (
              <>
                <div className="studio-tools studio-tools--inline">
                  {TOOLS.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className={`studio-tool ${props.tool === entry.id ? 'studio-tool--active' : ''}`}
                      aria-pressed={props.tool === entry.id}
                      aria-label={t(entry.label)}
                      onClick={() => props.onTool(entry.id)}
                    >
                      {entry.glyph}
                    </button>
                  ))}
                </div>
                <BrushPanel
                  active={props.brushId}
                  settings={props.brushSettings}
                  color={props.color}
                  onChange={(patch) => {
                    // Choosing a preset in the library is signalled by passing
                    // every default at once; a slider passes a single key.
                    props.onBrushSettings(patch)
                  }}
                  swatches={props.recentColors}
                  onPick={props.onColor}
                  savedColors={props.savedColors}
                  onSaveColor={props.onSaveColor}
                  onRemoveSavedColor={props.onRemoveSavedColor}
                />
              </>
            )}
            {sheet === 'layers' && (
              <LayersPanel
                layers={props.layers}
                activeId={props.activeLayerId}
                doc={props.doc}
                onSelect={props.onSelectLayer}
                onAdd={props.onAddLayer}
                onDelete={props.onDeleteLayer}
                onMove={props.onMoveLayer}
                onToggleVisible={props.onToggleLayerVisible}
                onToggleLocked={props.onToggleLayerLocked}
                onRename={props.onRenameLayer}
                onOpenNavigator={props.onOpenNavigator}
                compact
              />
            )}
            {sheet === 'settings' && <div className="studio-sheet__settings">{props.children}</div>}
          </div>
        </section>
      )}

      {props.saveError && (
        <p className="studio-notice studio-notice--danger" role="alert">
          {props.saveError} <span>{t('sketchSaveRetained')}</span>
        </p>
      )}
    </div>
  )
}
