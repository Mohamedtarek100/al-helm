import { beforeEach, describe, expect, it } from 'vitest'
import { createSubject, getState, initStore, updateSubject } from './store'
import { subjectNameKey } from './subjects'

/**
 * Store-level subject de-duplication.
 *
 * The combobox already refuses to *offer* creation for a known name, but the
 * store is the last line of defence: a second device, a merged snapshot, or a
 * programmatic caller must not be able to add a twin. `createSubject` reuses
 * the existing record instead.
 */

const qaPick = (state: { subjects: Array<{ name: string }> }) => state.subjects.filter((s) => s.name.startsWith('QASUB'))

beforeEach(async () => {
  localStorage.clear()
  await initStore(true)
})

describe('createSubject: reuse instead of duplicate', () => {
  it('returns the existing subject for an identical name', async () => {
    const first = await createSubject({ name: 'QASUB Mathematics', color: 'terracotta', notes: '', weeklyTargetMinutes: 0, archived: false })
    const second = await createSubject({ name: 'QASUB Mathematics', color: 'sage', notes: '', weeklyTargetMinutes: 0, archived: false })
    expect(second.id).toBe(first.id)
    expect(qaPick(getState())).toHaveLength(1)
  })

  it('reuses for a different case / surrounding whitespace', async () => {
    const first = await createSubject({ name: 'QASUB Physics', color: 'terracotta', notes: '', weeklyTargetMinutes: 0, archived: false })
    const second = await createSubject({ name: '   qasub   PHYSICS  ', color: 'terracotta', notes: '', weeklyTargetMinutes: 0, archived: false })
    expect(second.id).toBe(first.id)
    expect(qaPick(getState())).toHaveLength(1)
  })

  it('reuses an ARCHIVED subject rather than resurrecting a duplicate name', async () => {
    const archived = await createSubject({ name: 'QASUB Biology', color: 'terracotta', notes: '', weeklyTargetMinutes: 0, archived: true })
    const again = await createSubject({ name: 'qasub biology', color: 'terracotta', notes: '', weeklyTargetMinutes: 0, archived: false })
    expect(again.id).toBe(archived.id)
    expect(qaPick(getState())).toHaveLength(1)
  })

  it('still creates a genuinely new subject', async () => {
    await createSubject({ name: 'QASUB Chemistry', color: 'terracotta', notes: '', weeklyTargetMinutes: 0, archived: false })
    const other = await createSubject({ name: 'QASUB Chemistry II', color: 'terracotta', notes: '', weeklyTargetMinutes: 0, archived: false })
    expect(other.name).toBe('QASUB Chemistry II')
    expect(qaPick(getState())).toHaveLength(2)
    expect(subjectNameKey(other.name)).not.toBe(subjectNameKey('QASUB Chemistry'))
  })

  it('trims the stored display name but never lower-cases it', async () => {
    const created = await createSubject({ name: '  QASUB Art  ', color: 'terracotta', notes: '', weeklyTargetMinutes: 0, archived: false })
    expect(created.name).toBe('QASUB Art')
  })
})

describe('updateSubject: renaming onto an existing name is rejected', () => {
  it('throws for a normalised collision with another subject', async () => {
    const a = await createSubject({ name: 'QASUB A', color: 'terracotta', notes: '', weeklyTargetMinutes: 0, archived: false })
    await createSubject({ name: 'QASUB B', color: 'sage', notes: '', weeklyTargetMinutes: 0, archived: false })
    await expect(updateSubject(a.id, { name: 'qasub b' })).rejects.toThrow(/already exists/i)
  })

  it('allows renaming a subject to a casing-only variant of its own name', async () => {
    const a = await createSubject({ name: 'QASUB C', color: 'terracotta', notes: '', weeklyTargetMinutes: 0, archived: false })
    await expect(updateSubject(a.id, { name: 'qasub c' })).resolves.toBeUndefined()
  })
})

