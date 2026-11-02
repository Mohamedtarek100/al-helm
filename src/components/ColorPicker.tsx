import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useI18n } from '../i18n/useI18n'
import type { TranslationKey } from '../i18n/translations'
import {
  STUDIO_PALETTE,
  clientToWheelPoint,
  hexToHsv,
  hsvToHex,
  hsvToPoint,
  pointToHsv,
  pointToPercent,
} from '../services/colorWheel'

/**
 * Professional colour picker for the drawing studio.
 *
 * Three ways to choose a colour, because fixed swatches alone are inadequate
 * for artwork and a wheel alone cannot express brightness:
 *
 *   1. A curated palette (neutrals with explicit black/white + a spectrum).
 *   2. A circular hue/saturation wheel — drag anywhere, or use the keyboard
 *      arrows on the wheel button for an equivalent non-pointer path.
 *   3. A brightness slider, which is what makes a wheel able to reach black.
 *
 * Accessibility: the wheel is a real `<button>` per the pointer surface rather
 * than a bare div, and it is focusable with arrow-key control so a keyboard
 * user can select any colour without a mouse. A live `aria-live` readout
 * announces the selected hex.
 */

const WHEEL_MIME = 'conic-gradient(from 90deg, #ff0000, #ff00ff, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000)'

export function ColorPicker({
  value,
  onChange,
  compact = false,
  onCommit,
}: {
  value: string
  onChange: (hex: string) => void
  /** Renders the wheel at a smaller size (mobile toolbar). */
  compact?: boolean
  /** Called once per completed interaction, for recent-colour history. */
  onCommit?: (hex: string) => void
}) {
  const { t } = useI18n()
  const wheelRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const gestureStartRef = useRef<{ h: number; s: number; v: number } | null>(null)
  const hexInputRef = useRef<HTMLInputElement>(null)
  const [hsv, setHsv] = useState(() => hexToHsv(value) ?? { h: 0, s: 0, v: 0 })
  const hsvRef = useRef(hsv)
  const [hexError, setHexError] = useState(false)

  const current = hexToHsv(value) ?? hsv

  useEffect(() => {
    const parsed = hexToHsv(value)
    if (parsed) hsvRef.current = parsed
    if (hexInputRef.current && document.activeElement !== hexInputRef.current) {
      hexInputRef.current.value = value
    }
  }, [value])

  const apply = useCallback((next: { h: number; s: number; v: number }, commit: boolean) => {
    const hex = hsvToHex(next)
    hsvRef.current = next
    setHsv(next)
    onChange(hex)
    if (commit) onCommit?.(hex)
  }, [onChange, onCommit])

  const pickAt = useCallback((clientX: number, clientY: number, commit: boolean) => {
    const element = wheelRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const point = clientToWheelPoint(clientX, clientY, rect)
    const next = pointToHsv(point, hsvRef.current.v)
    apply(next, commit)
  }, [apply])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    draggingRef.current = true
    gestureStartRef.current = hsvRef.current
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* older webviews */ }
    pickAt(event.clientX, event.clientY, false)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    event.preventDefault()
    pickAt(event.clientX, event.clientY, false)
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    gestureStartRef.current = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* already released */ }
    // Commit once per gesture, so "recent colours" records what was chosen
    // rather than every pixel the pointer crossed.
    onCommit?.(hsvToHex(hsvRef.current))
  }

  const cancelDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    const origin = gestureStartRef.current
    gestureStartRef.current = null
    if (origin) apply(origin, false)
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* already released */ }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 15 : 5
    let next: { h: number; s: number; v: number } | null = null
    if (event.key === 'ArrowLeft') next = { ...current, h: current.h - step }
    else if (event.key === 'ArrowRight') next = { ...current, h: current.h + step }
    else if (event.key === 'ArrowUp') next = { ...current, s: Math.min(1, current.s + 0.05) }
    else if (event.key === 'ArrowDown') next = { ...current, s: Math.max(0, current.s - 0.05) }
    if (!next) return
    event.preventDefault()
    apply(next, true)
  }

  const rgb = {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  }
  const changeRgb = (channel: keyof typeof rgb, channelValue: number) => {
    const next = { ...rgb, [channel]: channelValue }
    const hex = `#${[next.r, next.g, next.b].map((value) => value.toString(16).padStart(2, '0')).join('')}`
    const parsed = hexToHsv(hex)
    if (parsed) {
      hsvRef.current = parsed
      setHsv(parsed)
    }
    onChange(hex)
    onCommit?.(hex)
  }

  const handle = pointToPercent(hsvToPoint(current))
  const size = compact ? 132 : 176

  return (
    <div className={`color-picker ${compact ? 'color-picker--compact' : ''}`}>
      <div className="color-picker__wheel-wrap">
        <div
          ref={wheelRef}
          className="color-picker__wheel"
          style={{ width: size, height: size }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={cancelDrag}
        >
          {/* Hue ring (conic) + saturation falloff (radial) underneath a real
              saturation disc, so the visible colour matches what is picked. */}
          <span className="color-picker__ring" style={{ background: WHEEL_MIME }} aria-hidden="true" />
          <span className="color-picker__disc" aria-hidden="true" />
          <span
            className="color-picker__handle"
            style={{ left: handle.left, top: handle.top, background: value }}
            aria-hidden="true"
          />
          {/* Keyboard-operable equivalent of the pointer surface. */}
          <button
            type="button"
            className="color-picker__surface"
            aria-label={t('sketchColorWheel')}
            aria-valuetext={value}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="color-picker__current">
          <span className="color-picker__chip" style={{ background: value }} aria-hidden="true" />
          <code className="color-picker__hex">{value.toUpperCase()}</code>
          <span className="sr-only" role="status" aria-live="polite">{value}</span>
        </div>
      </div>

      {/* Brightness: the axis a wheel cannot express (black lives here). */}
      <label className="color-picker__value">
        <span className="color-picker__label">{t('sketchBrightness')}</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(current.v * 100)}
          onChange={(event) => apply({ ...current, v: Number(event.target.value) / 100 }, true)}
          aria-label={t('sketchBrightness')}
        />
      </label>

      <div className="color-picker__palette">
        {STUDIO_PALETTE.map((group) => (
          <div key={group.labelKey} className="color-picker__group">
            <span className="color-picker__label">{t(group.labelKey as TranslationKey)}</span>
            <div className="color-picker__swatches" role="group" aria-label={t(group.labelKey as TranslationKey)}>
              {group.colors.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`color-swatch ${color.toLowerCase() === value.toLowerCase() ? 'color-swatch--active' : ''}`}
                  style={{ background: color }}
                  title={color.toUpperCase()}
                  aria-label={color.toUpperCase()}
                  aria-pressed={color.toLowerCase() === value.toLowerCase()}
                  onClick={() => { onChange(color); onCommit?.(color) }}
                />
              ))}
            </div>
          </div>
        ))}
        <label className="color-picker__group color-picker__custom">
          <span className="color-picker__label">{t('sketchCustomColor')}</span>
          <div className="color-picker__custom-controls">
            <input
              type="color"
              value={value}
              aria-label={t('sketchCustomColor')}
              onChange={(event) => { onChange(event.target.value); onCommit?.(event.target.value) }}
            />
            <input
              ref={hexInputRef}
              className="input color-picker__hex-input"
              type="text"
              defaultValue={value}
              placeholder="#RRGGBB"
              maxLength={7}
              aria-label={t('sketchHexColor')}
              aria-invalid={hexError}
              onChange={(event) => {
                const next = event.currentTarget.value
                setHexError(false)
                if (/^#?[0-9a-f]{6}$/i.test(next.trim())) {
                  const normalized = `#${next.trim().replace(/^#/, '').toLowerCase()}`
                  onChange(normalized)
                  onCommit?.(normalized)
                }
              }}
              onBlur={(event) => {
                if (/^#?[0-9a-f]{6}$/i.test(event.currentTarget.value.trim())) return
                setHexError(true)
              }}
            />
          </div>
          {hexError && <span className="color-picker__hex-error" role="alert">{t('sketchInvalidHex')}</span>}
        </label>
        <details className="color-picker__rgb">
          <summary className="color-picker__label">{t('sketchRgbValues')}</summary>
          {([
            ['r', 'sketchRed'],
            ['g', 'sketchGreen'],
            ['b', 'sketchBlue'],
          ] as const).map(([channel, labelKey]) => (
            <label className="color-picker__rgb-row" key={channel}>
              <span>{t(labelKey)}</span>
              <input
                type="range"
                min={0}
                max={255}
                value={rgb[channel]}
                aria-label={t(labelKey)}
                onChange={(event) => changeRgb(channel, Number(event.target.value))}
              />
              <output>{rgb[channel]}</output>
            </label>
          ))}
        </details>
      </div>
    </div>
  )
}
