/**
 * Durable pending-operation queue.
 *
 * WHY THIS EXISTS (replacing the 7-day age bound)
 *   The previous recovery merged "device-only records younger than 7 days" back
 *   into the cloud snapshot. That is a heuristic, and it fails in exactly the
 *   cases that matter for a real customer:
 *
 *     - someone offline for two weeks lost their edits silently on reconnect;
 *     - a DELETION made offline had no representation at all, so an older device
 *       snapshot could resurrect the deleted record;
 *     - account switching could carry another account's pending records across.
 *
 *   The fix is not a longer timeout. It is to record INTENT: every write that the
 *   server has not accepted is stored as an explicit operation in a per-account
 *   queue, kept in device storage, and replayed in order until the server accepts
 *   it. Deletions are stored as tombstones so an old snapshot cannot bring a
 *   deleted record back.
 *
 * DESIGN
 *   - `upsert`  — this record must exist on the server with this content.
 *   - `delete`  — this record must NOT exist on the server (tombstone).
 *   - The queue is keyed per account, so pending work never crosses accounts.
 *   - Replay is idempotent: `upsert` is an idempotent write of the same id, and
 *     `delete` of an absent row is a no-op. Replaying twice cannot duplicate.
 *   - An operation is cleared only after the server confirms it.
 *   - The queue is bounded by COUNT, not by age: a customer may come back after
 *     any length of time, but thousands of stale operations are not useful.
 *
 * This module is pure bookkeeping. It never talks to Supabase itself.
 */

export type PendingOp =
  | { kind: 'upsert'; collection: string; id: string; at: number; updatedAt: string }
  | { kind: 'delete'; collection: string; id: string; at: number }

const QUEUE_PREFIX = 'alhelm.v1.pendingOps.'

/** Upper bound on stored operations. Oldest are dropped first, never newest. */
export const MAX_PENDING_OPS = 500

export function queueKey(userId: string): string {
  return `${QUEUE_PREFIX}${userId}`
}

function readRaw(userId: string): PendingOp[] {
  try {
    const raw = localStorage.getItem(queueKey(userId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is PendingOp => (
      Boolean(entry)
      && (entry.kind === 'upsert' || entry.kind === 'delete')
      && typeof entry.collection === 'string'
      && typeof entry.id === 'string'
      && typeof entry.at === 'number'
    ))
  } catch {
    return []
  }
}

function writeRaw(userId: string, ops: PendingOp[]): void {
  try {
    if (ops.length === 0) window.localStorage.removeItem(queueKey(userId))
    else window.localStorage.setItem(queueKey(userId), JSON.stringify(ops.slice(-MAX_PENDING_OPS)))
  } catch {
    // Storage full/unavailable: the local snapshot still holds the data, and the
    // queue is rebuilt from it on the next save.
  }
}

export interface PendingQueue {
  all(): PendingOp[]
  /** Pending upserts for one collection, newest last. */
  upserts(collection: string): { id: string; updatedAt: string }[]
  /** Ids deleted locally and not yet confirmed by the server. */
  tombstones(collection: string): Set<string>
  recordUpsert(collection: string, id: string, updatedAt: string): void
  recordDelete(collection: string, id: string): void
  /** Drops the operations the server has confirmed. */
  confirm(confirmed: { collection: string; id: string; kind: 'upsert' | 'delete' }[]): void
  clear(): void
  size(): number
}

/**
 * A queue view for one account.
 *
 * Recording an `upsert` cancels an earlier tombstone for the same id (the record
 * was recreated), and recording a `delete` removes any pending upsert (the final
 * intent is deletion). One record can therefore never be both.
 */
export function pendingQueue(userId: string): PendingQueue {
  const read = () => readRaw(userId)

  return {
    all: read,
    upserts(collection) {
      return read()
        .filter((op): op is Extract<PendingOp, { kind: 'upsert' }> => op.kind === 'upsert' && op.collection === collection)
        .map((op) => ({ id: op.id, updatedAt: op.updatedAt }))
    },
    tombstones(collection) {
      return new Set(read().filter((op) => op.kind === 'delete' && op.collection === collection).map((op) => op.id))
    },
    recordUpsert(collection, id, updatedAt) {
      const ops = read().filter((op) => !(op.collection === collection && op.id === id))
      ops.push({ kind: 'upsert', collection, id, at: Date.now(), updatedAt })
      writeRaw(userId, ops)
    },
    recordDelete(collection, id) {
      const ops = read().filter((op) => !(op.collection === collection && op.id === id))
      ops.push({ kind: 'delete', collection, id, at: Date.now() })
      writeRaw(userId, ops)
    },
    confirm(confirmed) {
      const done = new Set(confirmed.map((entry) => `${entry.kind}:${entry.collection}:${entry.id}`))
      writeRaw(userId, read().filter((op) => !done.has(`${op.kind}:${op.collection}:${op.id}`)))
    },
    clear() {
      try { window.localStorage.removeItem(queueKey(userId)) } catch { /* storage unavailable */ }
    },
    size: () => read().length,
  }
}

/**
 * Merges queued intent into a freshly loaded server snapshot.
 *
 * Returns a NEW `AppData`:
 *   - server rows are the base (server is authoritative for shared records);
 *   - a tombstoned id is REMOVED even though the server still has it;
 *   - a pending upsert whose id is absent from the server is RE-ADDED;
 *   - a pending upsert for an id the server also has keeps the SERVER value
 *     (a stale device copy never overwrites newer server data).
 *
 * `localRows` supplies the content for pending upserts; without it the record
 * cannot be reconstructed and only tombstones are applied.
 */
export function applyPendingToSnapshot<T extends Record<string, unknown>>(
  remote: T,
  queue: PendingQueue,
  collections: readonly string[],
  localRows: Record<string, { id: string }[]> = {},
): { snapshot: T; pendingCount: number } {
  const result = { ...remote } as T
  let pendingCount = 0

  for (const collection of collections) {
    const tombstones = queue.tombstones(collection)
    const serverRows = ((remote[collection] as unknown as { id: string }[] | undefined) ?? [])
    const local = localRows[collection] ?? []
    const byId = new Map(local.map((row) => [row.id, row]))

    // 1. Apply deletions.
    let rows = serverRows.filter((row) => !tombstones.has(row.id))

    // 2. Re-add pending upserts the server does not have.
    const serverIds = new Set(rows.map((row) => row.id))
    for (const pending of queue.upserts(collection)) {
      if (tombstones.has(pending.id)) continue
      if (serverIds.has(pending.id)) continue
      const localRow = byId.get(pending.id)
      if (!localRow) continue
      rows = [...rows, structuredClone(localRow)]
      serverIds.add(pending.id)
    }

    if (tombstones.size || rows.length !== serverRows.length) {
      ; (result as unknown as Record<string, unknown>)[collection] = rows
    }
    pendingCount += queue.upserts(collection).length + tombstones.size
  }

  return { snapshot: result, pendingCount }
}
