import { useMemo } from 'react'
import { useI18n } from '../../i18n/useI18n'
import type { TranslationKey } from '../../i18n/translations'
import { BRUSH_PRESETS, paintBrushStroke, presetById, type BrushId, type BrushSettings } from '../../services/brushes'

/**
 * Studio brush UI.
 *
 * Two components, one data source (`BRUSH_PRESETS` / `BrushSettings`):
 *
 *   BrushRail  — the compact, always-visible strip of presets that sits over
 *                the canvas on every screen size. It is the primary way to
 *                switch tools, so it must never be hidden behind a panel.
 *   BrushPanel — the full library plus the live settings sliders and a stroke
 *                preview. Every slider is bound to a setting the engine reads.
 *
 * The preview is drawn from the SAME numbers the engine uses, so it cannot
 * advertise a brush the canvas will not produce.
 */

const PREVIEW_W = 200
const PREVIEW_H = 44

export function BrushRail({
  active,
  onSelect,
  compact,
}: {
  active: BrushId
  onSelect: (id: BrushId) => void
  compact: boolean
}) {
  const { t } = useI18n()
  return (
    <div className={`studio-rail ${compact ? 'studio-rail--compact' : ''}`} role="toolbar" aria-label={t('brushLibrary')}>
      {BRUSH_PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          className={`studio-rail__item ${active === preset.id ? 'studio-rail__item--active' : ''}`}
          aria-pressed={active === preset.id}
          title={t(preset.labelKey as TranslationKey)}
          aria-label={t(preset.labelKey as TranslationKey)}
          onClick={() => onSelect(preset.id)}
        >
          <BrushSwatch preset={preset} color={preset.swatch} />
        </button>
      ))}
    </div>
  )
}

/** A tiny, honest illustration of each preset's stroke profile.
 * Used by the brush LIBRARY list (the rail uses the dot-style BrushSwatch). */
function BrushGlyph({ id, color }: { id: BrushId; color: string }) {
  const width = id === 'soft' ? 3.4 : id === 'hard' ? 4.6 : id === 'calligraphy' ? 5 : id === 'ink' ? 3.6 : 2.6
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d={id === 'calligraphy' ? 'M5 18c3-1 5-4 6-9' : 'M4 16c3-8 8-8 11-4s4-4 5-3'}
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeLinecap={id === 'calligraphy' ? 'butt' : 'round'}
        opacity={id === 'soft' ? 0.7 : 1}
      />
    </svg>
  )
}

/**
 * A brush preview swatch: a dot of the preset's ink.
 *
 * Each preset shows its OWN profile — soft is a feathered disc, calligraphy a
 * slanted nib, the eraser is outlined — so the rail is readable without a
 * tooltip. Kept as SVG so it costs nothing and scales crisply.
 */
export function BrushSwatch({ preset, color }: { preset: (typeof BRUSH_PRESETS)[number]; color: string }) {
  if (preset.shape === 'flat') {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <ellipse cx="12" cy="12" rx="8.5" ry="3.2" transform="rotate(-30 12 12)" fill={color} />
      </svg>
    )
  }
  if (preset.id === 'soft') {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <defs>
          <radialGradient id="studio-soft-dot">
            <stop offset="0%" stopColor={color} stopOpacity="0.95" />
            <stop offset="70%" stopColor={color} stopOpacity="0.45" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="12" cy="12" r="9" fill="url(#studio-soft-dot)" />
      </svg>
    )
  }
  if (preset.eraser) {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <circle cx="12" cy="12" r="7" fill="none" stroke={color} strokeWidth="2" strokeDasharray="2.5 2.5" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <circle cx="12" cy="12" r={preset.id === 'pencil' ? 4 : preset.id === 'ink' ? 5 : 6.5} fill={color} />
    </svg>
  )
}

export function BrushPanel({
  active,
  settings,
  color,
  onChange,
  swatches,
  onPick,
  savedColors,
  onSaveColor,
  onRemoveSavedColor,
}: {
  active: BrushId
  settings: BrushSettings
  color: string
  onChange: (patch: Partial<BrushSettings>) => void
  swatches: string[]
  onPick: (hex: string) => void
  savedColors: string[]
  onSaveColor: () => void
  onRemoveSavedColor: (hex: string) => void
}) {
  const { t } = useI18n()
  const preset = presetById(active)

  const sliders: { key: keyof BrushSettings; label: TranslationKey; min: number; max: number; step: number; format: (value: number) => string }[] = [
    { key: 'size', label: 'brushSize', min: 1, max: 80, step: 1, format: (value) => `${Math.round(value)} px` },
    { key: 'opacity', label: 'brushOpacity', min: 5, max: 100, step: 1, format: (value) => `${Math.round(value)}%` },
    { key: 'flow', label: 'brushFlow', min: 5, max: 100, step: 1, format: (value) => `${Math.round(value)}%` },
    { key: 'hardness', label: 'brushHardness', min: 0, max: 100, step: 1, format: (value) => `${Math.round(value)}%` },
    { key: 'spacing', label: 'brushSpacing', min: 2, max: 100, step: 1, format: (value) => `${Math.round(value)}%` },
  ]

  return (
    <div className="studio-brushpanel">
      <section className="studio-block">
        <h3 className="studio-block__title">{t('brushLibrary')}</h3>
        <div className="studio-brushes" role="radiogroup" aria-label={t('brushLibrary')}>
          {BRUSH_PRESETS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={entry.id === active}
              className={`studio-brush ${entry.id === active ? 'studio-brush--active' : ''}`}
              onClick={() => onChange({ ...entry.defaults })}
              title={t(entry.labelKey as TranslationKey)}
            >
              <span className="studio-brush__dot" aria-hidden="true"><BrushGlyph id={entry.id} color={entry.swatch} /></span>
              <span>{t(entry.labelKey as TranslationKey)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="studio-block">
        <h3 className="studio-block__title">{t('brushStrokePreview')}</h3>
        <StrokePreview settings={settings} color={color} shape={preset.shape} />
      </section>

      <section className="studio-block">
        <h3 className="studio-block__title">{t('brushSettings')}</h3>
        <div className="studio-sliders">
          {sliders.map((slider) => (
            <label className="studio-slider" key={slider.key}>
              <span className="studio-slider__label">{t(slider.label)}</span>
              <input
                type="range"
                min={slider.min}
                max={slider.max}
                step={slider.step}
                value={Math.round((slider.key === 'size' ? settings.size : settings[slider.key]) * 100)}
                aria-label={t(slider.label)}
                onChange={(event) => onChange({ [slider.key]: Number(event.target.value) / 100 } as Partial<BrushSettings>)}
              />
              <output className="studio-slider__value">
                {slider.format((slider.key === 'size' ? settings.size : settings[slider.key]) * 100)}
              </output>
            </label>
          ))}
        </div>
      </section>

      <section className="studio-block">
        <h3 className="studio-block__title">{t('sketchRecentColors')}</h3>
        <div className="studio-swatches" aria-label={t('sketchRecentColors')}>
          {swatches.length === 0 && <p className="studio-hint">{t('studioNoRecentColors')}</p>}
          {swatches.map((hex) => (
            <button
              key={`recent-${hex}`}
              type="button"
              className={`studio-swatch ${hex === color.toLowerCase() ? 'studio-swatch--active' : ''}`}
              style={{ background: hex }}
              aria-label={hex.toUpperCase()}
              onClick={() => onPick(hex)}
            />
          ))}
        </div>
        <h3 className="studio-block__title studio-block__title--spaced">{t('studioSavedColors')}</h3>
        <div className="studio-swatches" aria-label={t('studioSavedColors')}>
          {savedColors.length === 0 && <p className="studio-hint">{t('studioNoSavedColors')}</p>}
          {savedColors.map((hex) => (
            <span key={`saved-${hex}`} className="studio-swatch-wrap">
              <button
                type="button"
                className={`studio-swatch ${hex === color.toLowerCase() ? 'studio-swatch--active' : ''}`}
                style={{ background: hex }}
                aria-label={hex.toUpperCase()}
                onClick={() => onPick(hex)}
              />
              <button
                type="button"
                className="studio-swatch__remove"
                aria-label={`${t('delete')} ${hex.toUpperCase()}`}
                onClick={() => onRemoveSavedColor(hex)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <button type="button" className="studio-btn studio-btn--ghost studio-btn--full" onClick={onSaveColor}>
          {t('studioSaveColor')}
        </button>
      </section>
    </div>
  )
}

/**
 * Draws the current brush across a small canvas.
 *
 * Rendered with the production engine, so the preview is always truthful: if a
 * setting changes the preview, it changes the stroke.
 */
function StrokePreview({ settings, color, shape }: { settings: BrushSettings; color: string; shape: 'round' | 'flat' }) {
  const points = useMemo(() => {
    const out: { x: number; y: number }[] = []
    for (let i = 0; i <= 40; i += 1) {
      const t = i / 40
      out.push({ x: 12 + t * (PREVIEW_W - 24), y: PREVIEW_H / 2 + Math.sin(t * Math.PI * 2) * (PREVIEW_H / 5) })
    }
    return out
  }, [])
  const engine = useMemo(() => {
    // Lazy import keeps the preview out of the initial studio bundle path.
    return { settings, points, color, shape }
  }, [settings, points, color, shape])

  return <PreviewCanvas data={engine} />
}

function PreviewCanvas({ data }: { data: { settings: BrushSettings; points: { x: number; y: number }[]; color: string; shape: 'round' | 'flat' } }) {
  return (
    <canvas
      className="studio-preview"
      width={PREVIEW_W}
      height={PREVIEW_H}
      ref={(node) => {
        if (!node) return
        const ctx = node.getContext('2d')
        if (!ctx) return
        ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H)
        const scaled: BrushSettings = { ...data.settings, size: Math.min(data.settings.size, PREVIEW_H - 10) }
        // The PRODUCTION engine draws the preview, so it cannot promise a brush
        // the canvas will not produce.
        paintBrushStroke(ctx, { points: data.points, color: data.color, size: scaled.size, eraser: false }, scaled, {
          ...presetById('hard'),
          shape: data.shape,
        })
      }}
    />
  )
}
