import { describe, expect, it, vi } from 'vitest'
import { PersistenceCoordinator, type CloudPersistence } from './persistence/coordinator'
import type { DataAdapter } from './persistence/adapter'
import type { AppData, Task } from '../types'

/**
 * Regression: staleness must be detected from the RAW stored snapshot.
 *
 * `initialize()` returns a hydrated snapshot, so any check performed on the
 * returned state sees already-repaired tasks and never fires the write-back.
 * The coordinator therefore captures staleness at load time. This test would
 * have failed against the first implementation of the fix.
 */

const legacyTask = {
  id: 'tsk_legacy',
  title: 'Legacy',
  description: '',
  subjectId: null,
  dueDate: '2026-10-01',
  dueTime: '',
  category: 'study',
  estimatedMinutes: 30,
  completed: false,
  completedAt: null,
  createdAt: 'x',
  updatedAt: 'x',
} // no priority

const memoryLocal = (stored: Partial<AppData> | null): DataAdapter & { saved: AppData[] } => {
  const saved: AppData[] = []
  return {
    label: 'test',
    kind: 'local',
    load: vi.fn(async () => (stored ? (structuredClone(stored) as AppData) : null)),
    save: vi.fn(async (data: AppData) => { saved.push(structuredClone(data)) }),
    clear: vi.fn(async () => undefined),
    saved,
  }
}

const noCloud: CloudPersistence | null = null

describe('PersistenceCoordinator: raw-snapshot staleness detection', () => {
  it('reports that a legacy snapshot needs normalising', async () => {
    const local = memoryLocal({ tasks: [legacyTask as unknown as Task] })
    const coordinator = new PersistenceCoordinator(local, noCloud)
    const state = await coordinator.initialize()

    expect(coordinator.needsNormalization()).toBe(true)
    // …even though the returned state is already repaired.
    expect(state.data.tasks[0].priority).toBe('medium')
  })

  it('does not request a write when the stored snapshot is already normalised', async () => {
    const local = memoryLocal({ tasks: [{ ...legacyTask, priority: 'high' } as unknown as Task] })
    const coordinator = new PersistenceCoordinator(local, noCloud)
    await coordinator.initialize()
    expect(coordinator.needsNormalization()).toBe(false)
  })

  it('does not request a write for a brand-new account with no stored snapshot', async () => {
    const local = memoryLocal(null)
    const coordinator = new PersistenceCoordinator(local, noCloud)
    await coordinator.initialize()
    expect(coordinator.needsNormalization()).toBe(false)
  })

  it('can be cleared after the store persists the repair', async () => {
    const local = memoryLocal({ tasks: [legacyTask as unknown as Task] })
    const coordinator = new PersistenceCoordinator(local, noCloud)
    await coordinator.initialize()
    coordinator.clearPendingNormalization()
    expect(coordinator.needsNormalization()).toBe(false)
  })
})
