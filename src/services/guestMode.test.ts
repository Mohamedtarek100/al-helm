import { beforeEach, describe, expect, it } from 'vitest'
import { __resetGuestSessionForTests, endGuestSession, isGuestSession, startGuestSession } from './guestMode'

/**
 * Guest session isolation.
 *
 * Requirement: guest data must never reach durable storage or the cloud. The
 * store consults `isGuestSession()` before ANY write, so these tests pin the
 * flag contract that makes that guarantee enforceable.
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

describe('no guest data reaches storage', () => {
  it('writing during a guest session leaves localStorage untouched', async () => {
    const { initStore, createTask, getState } = await import('./store')
    await initStore(true)
    startGuestSession()

    await createTask({
      title: 'Guest task',
      description: '',
      subjectId: null,
      dueDate: '2026-12-01',
      dueTime: '',
      priority: 'high',
      category: 'study',
      estimatedMinutes: 30,
    })

    // Held in memory for this session only…
    expect(getState().tasks.map((t) => t.title)).toContain('Guest task')
    // …and never written anywhere durable.
    expect(localStorage.getItem('alhelm.v1.tasks')).toBeNull()
  })

  it('a normal (non-guest) session still persists', async () => {
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
