import { describe, expect, it } from 'vitest'
import { parseDocument, serializeDocument, emptyDocument, isEmptyDocument, elementCount, DRAWING_MODEL_VERSION } from './drawing'
import {
  PALETTE,
  PALETTE_GROUPS,
  MAX_RECENT_COLORS,
  isHexColor,
  normalizeHex,
  pushRecentColor,
  parseRecentColors,
  contrastTextFor,
} from './drawingPalette'

/**
 * Dream Studio v3: palette + shapes/text model, with backward compatibility.
 *
 * The critical guarantee is that a v2 document (strokes only) still opens
 * unchanged, and that a v3 document round-trips without losing anything.
 */

const v2Doc = {
  version: 2,
  width: 900,
  height: 620,
  paper: 'cream',
  strokes: [{ points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], color: '#34312f', size: 3, eraser: false }],
}

describe('palette', () => {
  it('exposes a flat list derived from the groups', () => {
    expect(PALETTE.length).toBe(PALETTE_GROUPS.flatMap((g) => g.colors).length)
    expect(PALETTE.every(isHexColor)).toBe(true)
  })

  it('accepts only 6-digit hex', () => {
    expect(isHexColor('#B66B52')).toBe(true)
    expect(isHexColor('#fff')).toBe(false)
    expect(isHexColor('red')).toBe(false)
    expect(isHexColor(null)).toBe(false)
  })

  it('normalises case', () => {
    expect(normalizeHex('#B66B52')).toBe('#b66b52')
    expect(normalizeHex('nope')).toBeNull()
  })

  it('picks readable text for light and dark swatches', () => {
    expect(contrastTextFor('#ffffff')).toBe('#000000')
    expect(contrastTextFor('#34312f')).toBe('#ffffff')
  })
})

describe('recent colours', () => {
  it('adds to the front', () => {
    expect(pushRecentColor(['#111111'], '#222222')).toEqual(['#222222', '#111111'])
  })

  it('moves a repeat to the front without duplicating', () => {
    expect(pushRecentColor(['#111111', '#222222'], '#222222')).toEqual(['#222222', '#111111'])
  })

  it('is case-insensitive when de-duplicating', () => {
    expect(pushRecentColor(['#aaaaaa'], '#AAAAAA')).toEqual(['#aaaaaa'])
  })

  it('ignores invalid values and keeps the list intact', () => {
    expect(pushRecentColor(['#111111'], 'not-a-color')).toEqual(['#111111'])
  })

  it('caps the list', () => {
    let recent: string[] = []
    for (let i = 0; i < 10; i += 1) recent = pushRecentColor(recent, `#00000${i}`)
    expect(recent).toHaveLength(MAX_RECENT_COLORS)
  })

  it('parses a stored list defensively', () => {
    expect(parseRecentColors(['#ABCDEF', 'bad', 42, '#abcdef', '#123456'])).toEqual(['#abcdef', '#123456'])
    expect(parseRecentColors('nope')).toEqual([])
    expect(parseRecentColors(null)).toEqual([])
  })
})

describe('v2 backward compatibility', () => {
  it('parses an older document without shapes or texts', () => {
    const doc = parseDocument(JSON.stringify(v2Doc))
    expect(doc).not.toBeNull()
    expect(doc!.strokes).toHaveLength(1)
    expect(doc!.shapes).toEqual([])
    expect(doc!.texts).toEqual([])
    expect(doc!.paper).toBe('cream')
  })

  it('does not treat an old drawing as empty', () => {
    expect(isEmptyDocument(parseDocument(JSON.stringify(v2Doc))!)).toBe(false)
  })

  it('stamps the current version on write', () => {
    const doc = parseDocument(JSON.stringify(v2Doc))!
    expect(JSON.parse(serializeDocument(doc)).version).toBe(DRAWING_MODEL_VERSION)
  })
})

describe('v3 shapes and text', () => {
  const withElements = {
    ...v2Doc,
    shapes: [
      { id: 's1', kind: 'rect', from: { x: 10, y: 10 }, to: { x: 60, y: 40 }, color: '#b66b52', size: 4 },
      { id: 's2', kind: 'ellipse', from: { x: 0, y: 0 }, to: { x: 20, y: 20 }, color: '#89977b', size: 2 },
      { id: 's3', kind: 'line', from: { x: 0, y: 0 }, to: { x: 100, y: 100 }, color: '#34312f', size: 2 },
    ],
    texts: [{ id: 't1', x: 40, y: 50, text: 'Hello', color: '#34312f', size: 28 }],
  }

  it('round-trips shapes and text', () => {
    const doc = parseDocument(JSON.stringify(withElements))!
    expect(doc.shapes).toHaveLength(3)
    expect(doc.texts).toHaveLength(1)
    expect(elementCount(doc)).toBe(5)
    const again = parseDocument(serializeDocument(doc))!
    expect(again.shapes).toEqual(doc.shapes)
    expect(again.texts).toEqual(doc.texts)
  })

  it('counts shapes and text as content', () => {
    const doc = parseDocument(JSON.stringify({ ...v2Doc, strokes: [], shapes: withElements.shapes }))!
    expect(isEmptyDocument(doc)).toBe(false)
  })

  it('an eraser-only drawing with no shapes is still empty', () => {
    const doc = parseDocument(JSON.stringify({
      ...v2Doc,
      strokes: [{ points: [{ x: 0, y: 0 }], color: '#000', size: 3, eraser: true }],
      shapes: [],
      texts: [],
    }))!
    expect(isEmptyDocument(doc)).toBe(true)
  })

  it('drops malformed shapes without losing the rest', () => {
    const doc = parseDocument(JSON.stringify({
      ...v2Doc,
      shapes: [{ kind: 'nope' }, null, { kind: 'line', from: {}, to: {} }, withElements.shapes[0]],
    }))!
    expect(doc.shapes).toHaveLength(1)
    expect(doc.shapes![0].kind).toBe('rect')
    // Strokes survived too.
    expect(doc.strokes).toHaveLength(1)
  })

  it('drops empty text but keeps valid text', () => {
    const doc = parseDocument(JSON.stringify({
      ...v2Doc,
      texts: [{ id: 'a', x: 1, y: 2, text: '   ' }, { id: 'b', x: 1, y: 2, text: 'ok' }],
    }))!
    expect(doc.texts).toHaveLength(1)
    expect(doc.texts![0].text).toBe('ok')
  })

  it('clamps absurd sizes rather than rejecting the document', () => {
    const doc = parseDocument(JSON.stringify({
      ...v2Doc,
      shapes: [{ id: 'x', kind: 'line', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, color: '#000', size: 9999 }],
      texts: [{ id: 'y', x: 0, y: 0, text: 'big', size: 9999 }],
    }))!
    expect(doc.shapes![0].size).toBe(60)
    expect(doc.texts![0].size).toBe(160)
  })

  it('generates ids for elements that lack one', () => {
    const doc = parseDocument(JSON.stringify({
      ...v2Doc,
      shapes: [{ kind: 'line', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, color: '#000', size: 2 }],
    }))!
    expect(doc.shapes![0].id).toMatch(/^shp_/)
  })
})

describe('empty document', () => {
  it('starts with empty shape and text collections', () => {
    const doc = emptyDocument()
    expect(doc.shapes).toEqual([])
    expect(doc.texts).toEqual([])
    expect(isEmptyDocument(doc)).toBe(true)
  })
})
