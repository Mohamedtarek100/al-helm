/**
 * Persistence abstraction — the seam that Phase 2 replaces with Supabase.
 *
 * Every component talks to `dataClient` (and, through the store, to these
 * interfaces). No component ever touches localStorage directly. Swapping in a
 * Supabase-backed implementation means writing one new adapter and changing
 * the factory at the bottom of this file.
 */

import type { AppData, CollectionKey } from '../../types'

export interface DataAdapter {
  /** Human-readable name, surfaced in the UI so nothing pretends to be cloud. */
  readonly label: string
  /** 'local' today, 'cloud' once Supabase is attached in Phase 2. */
  readonly kind: 'local' | 'cloud'
  /** Read the full snapshot. Returns null when nothing has been stored yet. */
  load(): Promise<AppData | null>
  /** Write the full snapshot. */
  save(data: AppData): Promise<void>
  /** Remove all stored data for this adapter. */
  clear(): Promise<void>
}

/* ------------------------------------------------------------------ */
/* Small helpers shared by adapters                                    */
/* ------------------------------------------------------------------ */

export function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function isStorageAvailable(): boolean {
  try {
    const probe = '__alhelm_probe__'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* localStorage adapter (Phase 1 development persistence)              */
/* ------------------------------------------------------------------ */

const STORAGE_PREFIX = 'alhelm.v1.'

export function storageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`
}

/**
 * Reads and writes each top-level slice of `AppData` under its own key. This
 * keeps the local payload inspectable and mirrors the eventual table split.
 */
export class LocalStorageAdapter implements DataAdapter {
  readonly label = 'التخزين المحلي على هذا الجهاز'
  readonly kind = 'local' as const

  private available = isStorageAvailable()

  async load(): Promise<AppData | null> {
    if (!this.available) return null
    const keys: (keyof AppData & string)[] = [
      'profile',
      'settings',
      'subjects',
      'sessions',
      'tasks',
      'focusSessions',
      'journal',
      'goals',
      'artworks',
      'challenges',
      'letters',
      'notifications',
    ]
    const out: Partial<AppData> = {}
    let found = false
    for (const key of keys) {
      const value = safeParse<unknown>(window.localStorage.getItem(storageKey(key)))
      if (value !== null && value !== undefined) {
        found = true
        // Each slice is read as its own JSON value; the guard above proves the
        // value exists, and the key list is constrained to real AppData keys.
        ;(out as Record<string, unknown>)[key] = value
      }
    }
    return found ? (out as AppData) : null
  }

  async save(data: AppData): Promise<void> {
    if (!this.available) return
    for (const key of Object.keys(data) as (keyof AppData & string)[]) {
      window.localStorage.setItem(storageKey(key), JSON.stringify(data[key]))
    }
  }

  async clear(): Promise<void> {
    if (!this.available) return
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(STORAGE_PREFIX)) window.localStorage.removeItem(key)
    }
  }
}

/* ------------------------------------------------------------------ */
/* In-memory adapter (used for tests and as a fallback)                */
/* ------------------------------------------------------------------ */

export class MemoryAdapter implements DataAdapter {
  readonly label = 'ذاكرة مؤقتة (لا يتم حفظ البيانات)'
  readonly kind = 'local' as const
  private snapshot: AppData | null = null

  async load(): Promise<AppData | null> {
    return this.snapshot ? structuredClone(this.snapshot) : null
  }

  async save(data: AppData): Promise<void> {
    this.snapshot = structuredClone(data)
  }

  async clear(): Promise<void> {
    this.snapshot = null
  }
}

/* ------------------------------------------------------------------ */
/* Factory                                                             */
/* ------------------------------------------------------------------ */

/**
 * Phase 2 note: return a `SupabaseAdapter` here when
 * `import.meta.env.VITE_SUPABASE_URL` is present. Nothing else changes.
 */
export function createDataAdapter(): DataAdapter {
  if (typeof window === 'undefined') return new MemoryAdapter()
  if (!isStorageAvailable()) return new MemoryAdapter()
  return new LocalStorageAdapter()
}

/** Convenience export used by repositories and the store. */
export const dataAdapter: DataAdapter = createDataAdapter()

/** Re-exported so repositories can build their own keys consistently. */
export type { CollectionKey }
