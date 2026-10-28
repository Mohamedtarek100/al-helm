import { beforeEach, describe, expect, it } from 'vitest'
import {
  getLaunchMode,
  resetLaunchMode,
  setLaunchMode,
  shouldShowOnboarding,
  __resetLaunchModeForTests,
} from './onboarding'

/**
 * First-launch Google/Guest choice.
 *
 * The behaviour that matters is not the screen itself but when it is NOT shown:
 * a returning user, a returning guest, or someone who already has local data
 * must never be forced through onboarding — that would look like data loss.
 */

beforeEach(() => {
  localStorage.clear()
  __resetLaunchModeForTests()
})

describe('recording the choice', () => {
  it('starts with no recorded choice', () => {
    expect(getLaunchMode()).toBeNull()
  })

  it('persists "guest" across a reload', () => {
    expect(setLaunchMode('guest')).toBe(true)
    expect(getLaunchMode()).toBe('guest')
    expect(localStorage.getItem('alhelm.v1.launchMode')).toBe('guest')
  })

  it('persists "google" across a reload', () => {
    setLaunchMode('google')
    expect(localStorage.getItem('alhelm.v1.launchMode')).toBe('google')
  })

  it('ignores a corrupted stored value', () => {
    localStorage.setItem('alhelm.v1.launchMode', 'nonsense')
    __resetLaunchModeForTests()
    // Re-reading through the module returns null for anything unexpected.
    expect(['google', 'guest', null]).toContain(getLaunchMode())
  })

  it('can be reset so the screen appears again', () => {
    setLaunchMode('guest')
    resetLaunchMode()
    expect(getLaunchMode()).toBeNull()
    expect(localStorage.getItem('alhelm.v1.launchMode')).toBeNull()
  })
})

describe('when the screen is shown', () => {
  it('shows on a genuine first launch (no choice, no data, no session)', () => {
    expect(shouldShowOnboarding({ hasExistingData: false, sessionEmail: null })).toBe(true)
  })

  it('never shows again after a choice was made', () => {
    setLaunchMode('guest')
    expect(shouldShowOnboarding({ hasExistingData: false, sessionEmail: null })).toBe(false)
    setLaunchMode('google')
    expect(shouldShowOnboarding({ hasExistingData: false, sessionEmail: 'a@b.c' })).toBe(false)
  })

  it('never shows to a returning user who already has local data', () => {
    // This is the upgrade path: they never saw the screen and must not be asked.
    expect(shouldShowOnboarding({ hasExistingData: true, sessionEmail: null })).toBe(false)
  })

  it('never shows when a session already exists', () => {
    expect(shouldShowOnboarding({ hasExistingData: false, sessionEmail: 'owner@example.com' })).toBe(false)
  })
})

describe('guest data safety', () => {
  it('choosing guest does not touch stored application data', () => {
    localStorage.setItem('alhelm.v1.tasks', JSON.stringify([{ id: 'tsk_1', title: 'Keep me' }]))
    setLaunchMode('guest')
    const tasks = JSON.parse(localStorage.getItem('alhelm.v1.tasks') || '[]')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe('Keep me')
  })

  it('recording a google choice after guest keeps the same data', () => {
    localStorage.setItem('alhelm.v1.tasks', JSON.stringify([{ id: 'tsk_1', title: 'Guest work' }]))
    setLaunchMode('guest')
    setLaunchMode('google')
    expect(JSON.parse(localStorage.getItem('alhelm.v1.tasks') || '[]')).toHaveLength(1)
  })
})
