/**
 * Repository factory.
 *
 * A repository is a thin, typed CRUD surface over one collection. It owns the
 * mapping between the domain type and whatever the persistence adapter does,
 * so a Phase 2 Supabase implementation only has to satisfy these interfaces.
 */

import type { AppData, CollectionKey } from '../../types'

export interface Repository<T> {
  /** Reads the collection from a full snapshot. */
  list(data: AppData): T[]
  create(data: AppData, input: Omit<T, 'id' | 'createdAt' | 'updatedAt'>): T
  update(data: AppData, id: string, patch: Partial<T>): T | null
  remove(data: AppData, id: string): boolean
}

export function createId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}_${Date.now().toString(36)}_${random}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Builds a generic collection repository. `key` points at the slice of
 * `AppData`; `idPrefix` keeps ids readable when debugging the local payload.
 */
export function createCollectionRepository<K extends CollectionKey>(
  key: K,
  idPrefix: string,
): Repository<AppData[K][number]> {
  type Item = AppData[K][number]

  return {
    list(data) {
      return (data[key] as Item[]) ?? []
    },
    create(data, input) {
      const stamp = nowIso()
      const item = { ...(input as object), id: createId(idPrefix), createdAt: stamp, updatedAt: stamp } as Item
        ; (data[key] as Item[]).push(item)
      return item
    },
    update(data, id, patch) {
      const items = data[key] as Item[]
      const index = items.findIndex((item) => (item as { id: string }).id === id)
      if (index === -1) return null
      const next = { ...items[index], ...(patch as object), updatedAt: nowIso() } as Item
      items[index] = next
      return next
    },
    remove(data, id) {
      const items = data[key] as Item[]
      const index = items.findIndex((item) => (item as { id: string }).id === id)
      if (index === -1) return false
      items.splice(index, 1)
      return true
    },
  }
}
