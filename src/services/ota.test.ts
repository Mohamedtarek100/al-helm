import { describe, expect, it } from 'vitest'
import { compareVersions } from './ota'

describe('OTA version comparison', () => {
  it('orders semantic versions correctly', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0)
    expect(compareVersions('1.1.0', '1.0.9')).toBeGreaterThan(0)
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('0.9.0', '1.0.0')).toBeLessThan(0)
  })

  it('treats builtin as older than any real version', () => {
    expect(compareVersions('1.0.0', 'builtin')).toBeGreaterThan(0)
  })

  it('handles uneven segment counts', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.2', '1.1.5')).toBeGreaterThan(0)
  })
})
