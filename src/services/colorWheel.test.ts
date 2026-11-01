import { describe, expect, it } from 'vitest'
import {
  STUDIO_PALETTE_FLAT,
  clientToWheelPoint,
  hexToHsv,
  hsvToHex,
  hsvToPoint,
  pointToHsv,
  pointToPercent,
  readStoredColor,
} from './colorWheel'

/**
 * Colour-wheel geometry.
 *
 * These are the numbers the picker renders from, so testing them proves the
 * wheel actually selects the colour under the pointer — a component test could
 * only prove that a handler ran.
 */

describe('HSV ⇄ hex round trip', () => {
  it('produces the expected primaries', () => {
    expect(hsvToHex({ h: 0, s: 1, v: 1 })).toBe('#ff0000')
    expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe('#00ff00')
    expect(hsvToHex({ h: 240, s: 1, v: 1 })).toBe('#0000ff')
  })

  it('reaches black and white, which a wheel alone cannot express', () => {
    // Value 0 is black at any hue; saturation 0 at value 1 is white.
    expect(hsvToHex({ h: 200, s: 1, v: 0 })).toBe('#000000')
    expect(hsvToHex({ h: 200, s: 0, v: 1 })).toBe('#ffffff')
  })

  it('wraps hue and clamps saturation/value', () => {
    expect(hsvToHex({ h: 360, s: 1, v: 1 })).toBe('#ff0000')
    // -120° wraps to 240°, which is BLUE. (An earlier assertion expected green
    // here; the implementation was right and the assertion was wrong.)
    expect(hsvToHex({ h: -120, s: 1, v: 1 })).toBe('#0000ff')
    // 480° == 120° is green, confirming the wrap is modular in both directions.
    expect(hsvToHex({ h: 480, s: 1, v: 1 })).toBe('#00ff00')
    expect(hsvToHex({ h: 0, s: 5, v: 5 })).toBe('#ff0000')
  })

  it('round-trips a representative colour', () => {
    const hsv = hexToHsv('#b66b52')
    expect(hsv).not.toBeNull()
    expect(hsvToHex(hsv as { h: number; s: number; v: number })).toBe('#b66b52')
  })

  it('returns null for anything that is not a colour', () => {
    expect(hexToHsv('red')).toBeNull()
    expect(hexToHsv('#abc')).toBeNull()
    expect(hexToHsv('')).toBeNull()
  })
})

describe('wheel position → colour', () => {
  it('maps the centre to white (no saturation)', () => {
    expect(pointToHsv({ x: 0, y: 0 })).toEqual({ h: 0, s: 0, v: 1 })
    // Hue must be +0, never -0: atan2(-0, -1) yields -PI, which normalises to
    // -0. That is numerically equal to 0 but fails a deep-equality check and
    // serialises as "0" in places that expect "0". This assertion is the
    // regression guard for that normalisation.
    expect(Object.is(pointToHsv({ x: -1, y: 0 }).h, -0)).toBe(false)
  })

  it('maps the rim to full saturation', () => {
    expect(pointToHsv({ x: 1, y: 0 }).s).toBeCloseTo(1, 5)
    expect(pointToHsv({ x: 1, y: 0 }).h).toBeCloseTo(0, 5) // red at 3 o'clock
    expect(pointToHsv({ x: 0, y: -1 }).h).toBeCloseTo(90, 5) // up = 90°
  })

  it('clamps a pointer dragged past the rim instead of going out of range', () => {
    const beyond = pointToHsv({ x: 3, y: 4 })
    expect(beyond.s).toBeCloseTo(1, 5)
    // Direction is preserved, so dragging outside keeps tracking the hue.
    expect(beyond.h).toBeCloseTo(pointToHsv({ x: 3 / 5, y: 4 / 5 }).h, 5)
  })

  it('honours the brightness passed in', () => {
    expect(pointToHsv({ x: 1, y: 0 }, 0.5).v).toBe(0.5)
    expect(hsvToHex(pointToHsv({ x: 1, y: 0 }, 0.5))).toBe('#800000')
  })

  it('round-trips through the handle position', () => {
    const hsv = { h: 210, s: 0.6, v: 1 }
    const point = hsvToPoint(hsv)
    const back = pointToHsv(point)
    expect(back.h).toBeCloseTo(hsv.h, 4)
    expect(back.s).toBeCloseTo(hsv.s, 4)
  })

  it('positions the handle as a percentage for CSS', () => {
    expect(pointToPercent({ x: 0, y: 0 })).toEqual({ left: '50%', top: '50%' })
    expect(pointToPercent({ x: -1, y: 1 })).toEqual({ left: '0%', top: '100%' })
  })
})

describe('client pixel → wheel point', () => {
  it('maps the element centre to the origin', () => {
    const rect = { left: 100, top: 50, width: 200, height: 200 }
    expect(clientToWheelPoint(200, 150, rect)).toEqual({ x: 0, y: 0 })
  })

  it('maps the corners to the bounding square', () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 }
    expect(clientToWheelPoint(0, 0, rect)).toEqual({ x: -1, y: -1 })
    expect(clientToWheelPoint(100, 100, rect)).toEqual({ x: 1, y: 1 })
  })

  it('uses the real width and height, so a non-square box is not skewed', () => {
    const rect = { left: 0, top: 0, width: 400, height: 200 }
    // Full width and full height both map to the same radius.
    expect(clientToWheelPoint(400, 100, rect).x).toBe(1)
    expect(clientToWheelPoint(200, 200, rect).y).toBe(1)
  })

  it('degrades safely on a zero-size element', () => {
    expect(clientToWheelPoint(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 })
  })
})

describe('palette', () => {
  it('includes explicit black and white', () => {
    expect(STUDIO_PALETTE_FLAT).toContain('#000000')
    expect(STUDIO_PALETTE_FLAT).toContain('#ffffff')
  })

  it('contains only valid hex colours, without duplicates', () => {
    for (const color of STUDIO_PALETTE_FLAT) expect(color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(new Set(STUDIO_PALETTE_FLAT).size).toBe(STUDIO_PALETTE_FLAT.length)
  })

  it('reads a stored custom colour defensively', () => {
    expect(readStoredColor('#AABBCC')).toBe('#aabbcc')
    expect(readStoredColor('not-a-colour')).toBeNull()
    expect(readStoredColor(null)).toBeNull()
    expect(readStoredColor(123)).toBeNull()
  })
})
