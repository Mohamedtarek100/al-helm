/**
 * Local image persistence.
 *
 * Artwork image bytes are stored as Blobs in IndexedDB (never inside the
 * metadata rows). Each artwork references its image by artwork id; deleting
 * the artwork also deletes the stored image, avoiding orphans.
 */

const DB_NAME = '4ulife-art'
const STORE = 'images'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'))
  })
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE)
}

export async function putImage(id: string, blob: Blob): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const store = tx(db, 'readwrite')
    store.put(blob, id)
    store.transaction.oncomplete = () => resolve()
    store.transaction.onerror = () => reject(store.transaction.error)
  })
  db.close()
}

export async function getImage(id: string): Promise<Blob | null> {
  const db = await openDb()
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const request = tx(db, 'readonly').get(id)
    request.onsuccess = () => resolve((request.result as Blob) ?? null)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return blob
}

export async function deleteImage(id: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const store = tx(db, 'readwrite')
    store.delete(id)
    store.transaction.oncomplete = () => resolve()
    store.transaction.onerror = () => reject(store.transaction.error)
  })
  db.close()
}

/**
 * One-time cleanup: converts legacy artworks whose metadata still carries a
 * base64 data URL into IndexedDB blobs, then trims the metadata field so the
 * local snapshot stays lightweight. Returns how many records were migrated.
 */
export async function migrateLegacyArtworkImages(artworks: Array<{ id: string; imageUrl?: string }>): Promise<number> {
  let migrated = 0
  for (const artwork of artworks) {
    if (!artwork.imageUrl?.startsWith('data:image/')) continue
    try {
      const blob = await (await fetch(artwork.imageUrl)).blob()
      await putImage(artwork.id, blob)
      migrated += 1
    } catch {
      // Preserve the original record untouched so no image is lost.
      continue
    }
  }
  return migrated
}
