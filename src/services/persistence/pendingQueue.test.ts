import { beforeEach, describe, expect, it } from 'vitest'
import { applyPendingToSnapshot, pendingQueue, MAX_PENDING_OPS } from './pendingQueue'

/**
 * Durable pending-sync queue.
 *
 * Replaces the previous 7-day age heuristic, which lost a real customer's work in
 * four concrete ways (see the module header). These tests are the contract:
 * offline changes survive ANY length of absence, deletions cannot be resurrected,
 * replay is idempotent, and pending work never crosses accounts.
 */

const COLLECTIONS = ['tasks'] as const
const USER = 'user-qa'

const task = (id: string, title: string, updatedAt: string) => ({ id, title, updatedAt })

beforeEach(() => {
  localStorage.clear()
})

describe('recording intent', () => {
  it('records an upsert durably (survives a new queue instance)', () => {
    pendingQueue(USER).recordUpsert('tasks', 'tsk_1', '2026-11-02T10:00:00.000Z')
    // A fresh instance reads device storage, as it would after a restart.
    expect(pendingQueue(USER).upserts('tasks')).toEqual([{ id: 'tsk_1', updatedAt: '2026-11-02T10:00:00.000Z' }])
    expect(localStorage.getItem(`alhelm.v1.pendingOps.${USER}`)).toBeTruthy()
  })

  it('records a deletion as a tombstone', () => {
    pendingQueue(USER).recordDelete('tasks', 'tsk_2')
    expect([...pendingQueue(USER).tombstones('tasks')]).toEqual(['tsk_2'])
  })

  it('a later upsert cancels an earlier tombstone for the same id', () => {
    const q = pendingQueue(USER)
    q.recordDelete('tasks', 'tsk_3')
    q.recordUpsert('tasks', 'tsk_3', '2026-11-02T11:00:00.000Z')
    expect(q.tombstones('tasks').size).toBe(0)
    expect(q.upserts('tasks').map((op) => op.id)).toEqual(['tsk_3'])
  })

  it('a later delete cancels an earlier upsert for the same id', () => {
    const q = pendingQueue(USER)
    q.recordUpsert('tasks', 'tsk_4', '2026-11-02T10:00:00.000Z')
    q.recordDelete('tasks', 'tsk_4')
    expect(q.upserts('tasks')).toEqual([])
    expect([...q.tombstones('tasks')]).toEqual(['tsk_4'])
  })

  it('is bounded by COUNT, never by age', () => {
    const q = pendingQueue(USER)
    for (let index = 0; index < MAX_PENDING_OPS + 25; index += 1) {
      q.recordUpsert('tasks', `tsk_${index}`, '2026-11-02T10:00:00.000Z')
    }
    expect(q.size()).toBe(MAX_PENDING_OPS)
    // The NEWEST work is kept, not the oldest.
    expect(q.upserts('tasks').at(-1)?.id).toBe(`tsk_${MAX_PENDING_OPS + 24}`)
  })
})

describe('replay is idempotent and clears only confirmed work', () => {
  it('confirming removes exactly the confirmed operations', () => {
    const q = pendingQueue(USER)
    q.recordUpsert('tasks', 'a', '2026-11-02T10:00:00.000Z')
    q.recordUpsert('tasks', 'b', '2026-11-02T10:00:00.000Z')
    q.recordDelete('tasks', 'c')

    q.confirm([{ collection: 'tasks', id: 'a', kind: 'upsert' }])
    expect(q.upserts('tasks').map((op) => op.id)).toEqual(['b'])
    expect([...q.tombstones('tasks')]).toEqual(['c'])
  })

  it('the same upsert recorded twice yields ONE operation', () => {
    const q = pendingQueue(USER)
    q.recordUpsert('tasks', 'a', '2026-11-02T10:00:00.000Z')
    q.recordUpsert('tasks', 'a', '2026-11-02T10:00:00.000Z')
    expect(q.upserts('tasks')).toHaveLength(1)
  })

  it('clearing empties the queue and removes the storage key', () => {
    const q = pendingQueue(USER)
    q.recordUpsert('tasks', 'a', '2026-11-02T10:00:00.000Z')
    q.clear()
    expect(q.size()).toBe(0)
    expect(localStorage.getItem(`alhelm.v1.pendingOps.${USER}`)).toBeNull()
  })
})

describe('merging into a freshly loaded snapshot', () => {
  const remote = { tasks: [task('s1', 'Server task', '2026-11-01T09:00:00.000Z')] }
  const local = { tasks: [task('s1', 'Older local title', '2026-11-01T08:00:00.000Z'), task('p1', 'Offline task', '2026-11-02T10:00:00.000Z')] }

  it('re-adds a pending upsert the server does not have — no matter how old it is', () => {
    const q = pendingQueue(USER)
    // Deliberately ancient: this is the case the 7-day bound used to lose.
    q.recordUpsert('tasks', 'p1', '2024-01-01T00:00:00.000Z')
    const { snapshot, pendingCount } = applyPendingToSnapshot(remote, q, COLLECTIONS, local)
    expect((snapshot.tasks as { id: string }[]).map((row) => row.id).sort()).toEqual(['p1', 's1'])
    expect(pendingCount).toBe(1)
  })

  it('the SERVER wins for a record held on both sides (no stale overwrite)', () => {
    const q = pendingQueue(USER)
    q.recordUpsert('tasks', 's1', '2024-01-01T00:00:00.000Z')
    const { snapshot } = applyPendingToSnapshot(remote, q, COLLECTIONS, local)
    const shared = (snapshot.tasks as { id: string; title: string }[]).find((row) => row.id === 's1')
    expect(shared?.title).toBe('Server task')
    expect((snapshot.tasks as { id: string }[]).filter((row) => row.id === 's1')).toHaveLength(1)
  })

  it('a tombstone removes a record the server still has (no resurrection)', () => {
    const q = pendingQueue(USER)
    q.recordDelete('tasks', 's1')
    const { snapshot } = applyPendingToSnapshot(remote, q, COLLECTIONS, local)
    expect((snapshot.tasks as { id: string }[]).map((row) => row.id)).not.toContain('s1')
  })

  it('never duplicates an id that is both pending and present', () => {
    const q = pendingQueue(USER)
    q.recordUpsert('tasks', 's1', '2026-11-02T10:00:00.000Z')
    const { snapshot } = applyPendingToSnapshot(remote, q, COLLECTIONS, local)
    const ids = (snapshot.tasks as { id: string }[]).map((row) => row.id)
    expect(ids).toEqual([...new Set(ids)])
  })

  it('is deterministic across repeated merges', () => {
    const q = pendingQueue(USER)
    q.recordUpsert('tasks', 'p1', '2026-11-02T10:00:00.000Z')
    const first = applyPendingToSnapshot(remote, q, COLLECTIONS, local).snapshot
    const second = applyPendingToSnapshot(remote, q, COLLECTIONS, local).snapshot
    expect(second).toEqual(first)
  })

  it('does not mutate its inputs', () => {
    const q = pendingQueue(USER)
    q.recordDelete('tasks', 's1')
    const before = JSON.stringify(remote)
    applyPendingToSnapshot(remote, q, COLLECTIONS, local)
    expect(JSON.stringify(remote)).toBe(before)
  })
})

describe('account isolation', () => {
  it('each account has its own queue; pending work never crosses accounts', () => {
    pendingQueue('user-a').recordUpsert('tasks', 'a-only', '2026-11-02T10:00:00.000Z')
    expect(pendingQueue('user-b').size()).toBe(0)
    expect(pendingQueue('user-b').upserts('tasks')).toEqual([])

    const remoteB = { tasks: [] }
    const { snapshot } = applyPendingToSnapshot(remoteB, pendingQueue('user-b'), COLLECTIONS, {})
    expect((snapshot.tasks as unknown[]).length).toBe(0)

    // A's queue is untouched.
    expect(pendingQueue('user-a').upserts('tasks')).toHaveLength(1)
  })
})
