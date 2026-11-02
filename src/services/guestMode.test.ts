import { beforeEach, describe, expect, it } from 'vitest'
import { __resetGuestSessionForTests, endGuestSession, isGuestSession, startGuestSession } from './guestMode'

/**
 * Guest session isolation.
 *
 * Guest data is durable on this device, never synced without authentication,
 * and remains available after a reload.
 */

beforeEach(() => {
  localStorage.clear()
  __resetGuestSessionForTests()
})

describe('guest flag lifecycle', () => {
  it('is off before a guest chooses it', () => {
    expect(isGuestSession()).toBe(false)
  })

  it('turns on when a guest session starts', () => {
    startGuestSession()
    expect(isGuestSession()).toBe(true)
  })

  it('turns off when an account session is established', () => {
    startGuestSession()
    endGuestSession()
    expect(isGuestSession()).toBe(false)
  })

  it('is NOT persisted, so a reload starts outside guest mode', () => {
    startGuestSession()
    // A reload replaces module state; nothing was written to storage.
    expect(localStorage.getItem('alhelm.guest')).toBeNull()
    __resetGuestSessionForTests()
    expect(isGuestSession()).toBe(false)
  })
})

describe('guest data persistence', () => {
  it('saves guest edits locally and restores them after a reload', async () => {
    const { initStore, createTask, getState, activePersistenceMode } = await import('./store')
    await initStore(true)
    startGuestSession()

    const task = await createTask({
      title: 'Guest task',
      description: '',
      subjectId: null,
      dueDate: '2026-12-01',
      dueTime: '',
      priority: 'high',
      category: 'study',
      estimatedMinutes: 30,
    })

    expect(getState().tasks.map((t) => t.title)).toContain('Guest task')
    expect(task.writeResult).toBe('local-only')
    expect(activePersistenceMode()).toBe('local')
    expect(JSON.parse(localStorage.getItem('alhelm.v1.tasks') || '[]')).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: 'Guest task' })]),
    )

    // Simulate a fresh app process and the launch gate restoring guest mode.
    __resetGuestSessionForTests()
    await initStore(true)
    startGuestSession()
    expect(getState().tasks.map((t) => t.title)).toContain('Guest task')
  })

  it('a non-guest local session still persists', async () => {
    const { initStore, createTask } = await import('./store')
    await initStore(true)
    endGuestSession()
    await createTask({
      title: 'Real task',
      description: '',
      subjectId: null,
      dueDate: '2026-12-01',
      dueTime: '',
      priority: 'medium',
      category: 'study',
      estimatedMinutes: 30,
    })
    const stored = JSON.parse(localStorage.getItem('alhelm.v1.tasks') || '[]')
    expect(stored.map((t: { title: string }) => t.title)).toContain('Real task')
  })
})
