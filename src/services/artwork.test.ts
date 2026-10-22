import { describe, expect, it } from 'vitest'
import { createId, nowIso } from './persistence/repository'
import { hydrateData } from './domain'
import type { Artwork } from '../types'

/**
 * Regression tests for the artwork metadata pipeline.
 *
 * The cloud adapter maps camelCase Artwork fields to snake_case database
 * columns; these tests lock in the shapes so image references, source, and
 * library metadata survive a save/load round trip.
 */

describe('artwork metadata model', () => {
  it('assigns stable ids and timestamps to new artwork', () => {
    const id = createId('art')
    const created = nowIso()
    expect(id).toMatch(/^art_/)
    expect(new Date(created).getTime()).toBeGreaterThan(0)
  })

  it('hydrates legacy artwork records missing library metadata', () => {
    const snapshot = hydrateData({
      artworks: [
        { id: 'art_legacy', title: 'Old sketch', description: '', medium: '', date: '2026-01-01', imageUrl: '', imagePath: null, createdAt: nowIso(), updatedAt: nowIso() },
      ],
    })
    const art = snapshot.artworks[0] as Artwork
    expect(art.source).toBeUndefined()
    expect(art.category).toBeUndefined()
    expect(art.tags).toBeUndefined()
    expect(art.favorite).toBeUndefined()
    expect(art.title).toBe('Old sketch')
  })

  it('keeps library metadata on hydrated artwork records', () => {
    const snapshot = hydrateData({
      artworks: [
        { id: 'art_new', title: 'Rose study', description: 'Charcoal', medium: '', date: '2026-02-02', imageUrl: '', imagePath: 'user-1/art_new.png', createdAt: nowIso(), updatedAt: nowIso(), source: 'photo', category: 'portraits', tags: ['rose', 'charcoal'], favorite: true },
      ],
    })
    const art = snapshot.artworks[0] as Artwork
    expect(art.source).toBe('photo')
    expect(art.category).toBe('portraits')
    expect(art.tags).toEqual(['rose', 'charcoal'])
    expect(art.favorite).toBe(true)
    expect(art.imagePath).toBe('user-1/art_new.png')
  })

  it('preserves tags as an array across hydration', () => {
    const snapshot = hydrateData({
      artworks: [
        { id: 'art_tags', title: 'Study', description: '', medium: '', date: '2026-03-03', imageUrl: '', imagePath: null, createdAt: nowIso(), updatedAt: nowIso(), tags: ['a', 'b', 'c'] },
      ],
    })
    expect(snapshot.artworks[0].tags).toEqual(['a', 'b', 'c'])
  })
})
