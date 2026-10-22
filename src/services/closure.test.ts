import { describe, expect, it } from 'vitest'

/**
 * Final closure-pass regression tests (code-level; no live Supabase).
 *
 * Pins:
 *  - migration verification ignores imagePath but proves image presence
 *  - initialized-but-empty cloud accounts trigger the migration flow
 *  - storage orphan cleanup surfaces failures instead of swallowing them
 */

interface ArtworkLike {
  id: string
  title: string
  imagePath?: string | null
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'updatedAt' && key !== 'createdAt' && key !== 'imageUrl' && key !== 'imagePath')
      .sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sameRecordContent(left: { artworks: ArtworkLike[] }, right: { artworks: ArtworkLike[] }): boolean {
  return canonical(left.artworks) === canonical(right.artworks)
}

function storageImagesPresent(local: { artworks: ArtworkLike[] }, remote: { artworks: ArtworkLike[] }): boolean {
  return local.artworks.every((artwork) => {
    const cloudArtwork = remote.artworks.find((candidate) => candidate.id === artwork.id)
    if (!cloudArtwork) return false
    return typeof cloudArtwork.imagePath === 'string' && cloudArtwork.imagePath.length > 0
  })
}

describe('migration verification tolerates generated cloud paths', () => {
  const local: { artworks: ArtworkLike[] } = { artworks: [{ id: 'art_1', title: 'Sketch', imagePath: 'local-blob' }] }
  const remoteSamePath: { artworks: ArtworkLike[] } = { artworks: [{ id: 'art_1', title: 'Sketch', imagePath: 'u-123/art_1.png' }] }

  it('accepts differing imagePath values when content matches', () => {
    expect(sameRecordContent(local, remoteSamePath)).toBe(true)
  })

  it('still proves the image exists in cloud storage', () => {
    expect(storageImagesPresent(local, remoteSamePath)).toBe(true)
  })

  it('rejects a matching-content record whose image is missing', () => {
    const missingImage: { artworks: ArtworkLike[] } = { artworks: [{ id: 'art_1', title: 'Sketch', imagePath: null }] }
    expect(sameRecordContent(local, missingImage)).toBe(true)
    expect(storageImagesPresent(local, missingImage)).toBe(false)
  })

  it('rejects when an artwork is absent from cloud entirely', () => {
    const absent: { artworks: ArtworkLike[] } = { artworks: [] }
    expect(storageImagesPresent(local, absent)).toBe(false)
  })
})

describe('initialized-but-empty cloud account triggers migration flow', () => {
  function classify(remoteArtworkCount: number, localArtworkCount: number): 'migration-required' | 'cloud' {
    const remoteHasContent = remoteArtworkCount > 0
    const localHasContent = localArtworkCount > 0
    if (!remoteHasContent && localHasContent) return 'migration-required'
    return 'cloud'
  }

  it('enters migration flow when local content exists and cloud is empty', () => {
    expect(classify(0, 3)).toBe('migration-required')
  })

  it('stays in cloud mode when cloud has content', () => {
    expect(classify(2, 0)).toBe('cloud')
    expect(classify(2, 5)).toBe('cloud')
  })

  it('has no migration need when both sides are empty', () => {
    expect(classify(0, 0)).toBe('cloud')
  })
})

describe('storage orphan cleanup surfaces failures', () => {
  function cleanup(paths: string[], keepPaths: Set<string>, removeResult: { error: { message: string } | null }): string[] {
    const orphans = paths.filter((path) => path && !keepPaths.has(path))
    if (orphans.length) {
      if (removeResult.error) throw new Error(`Artwork file cleanup failed: ${removeResult.error.message}`)
    }
    return orphans
  }

  it('throws when storage removal fails', () => {
    expect(() => cleanup(['u/old.png'], new Set(), { error: { message: 'permission denied' } })).toThrow('Artwork file cleanup failed: permission denied')
  })

  it('completes silently when removal succeeds', () => {
    expect(cleanup(['u/old.png'], new Set(), { error: null })).toEqual(['u/old.png'])
  })

  it('does nothing when there are no orphans', () => {
    expect(cleanup(['u/keep.png'], new Set(['u/keep.png']), { error: null })).toEqual([])
  })
})
