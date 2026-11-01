import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  ADMIN_PREFERENCE_KEY,
  DEFAULT_ADMIN_PREFERENCES,
  parseAdminPreferences,
  writeAdminPreferences,
} from './adminSettings'

/**
 * Owner console preferences.
 *
 * Two separate concerns are pinned here:
 *
 *  1. Stored JSON is untrusted input — a corrupted or hand-edited value must
 *     fall back field by field, never crash the console and never be trusted.
 *  2. Preferences must be incapable of granting authority. The type has no
 *     "isOwner"-shaped field, and nothing in this module is read by an
 *     authorization decision; that is asserted statically below.
 */

beforeEach(() => {
  localStorage.clear()
})

describe('parsing stored preferences', () => {
  it('accepts a complete, valid object', () => {
    expect(parseAdminPreferences({
      language: 'ar',
      reducedMotion: true,
      pageSize: 50,
      confirmBeforeSend: false,
      utcTimestamps: true,
    })).toEqual({
      language: 'ar',
      reducedMotion: true,
      pageSize: 50,
      confirmBeforeSend: false,
      utcTimestamps: true,
    })
  })

  it('falls back per field, keeping the valid neighbours', () => {
    const parsed = parseAdminPreferences({ language: 'ar', pageSize: 7, confirmBeforeSend: false })
    expect(parsed.language).toBe('ar')
    // An unsupported page size must not reach the server as `perPage`.
    expect(parsed.pageSize).toBe(DEFAULT_ADMIN_PREFERENCES.pageSize)
    expect(parsed.confirmBeforeSend).toBe(false)
  })

  it('treats only literal true as enabling a boolean', () => {
    // "true", 1 and a non-empty string are NOT consent.
    const parsed = parseAdminPreferences({ reducedMotion: 'true', utcTimestamps: 1 })
    expect(parsed.reducedMotion).toBe(false)
    expect(parsed.utcTimestamps).toBe(false)
  })

  it('survives a non-object payload', () => {
    expect(parseAdminPreferences(null)).toEqual(DEFAULT_ADMIN_PREFERENCES)
    expect(parseAdminPreferences('garbage')).toEqual(DEFAULT_ADMIN_PREFERENCES)
    expect(parseAdminPreferences([])).toEqual(DEFAULT_ADMIN_PREFERENCES)
  })

  it('defaults confirmation to ON when unspecified', () => {
    // Sending an announcement cannot be recalled, so the safe default wins.
    expect(parseAdminPreferences({}).confirmBeforeSend).toBe(true)
  })
})

describe('storage', () => {
  it('round-trips through localStorage under a namespaced key', () => {
    const value = { ...DEFAULT_ADMIN_PREFERENCES, pageSize: 10 as const, language: 'ar' as const }
    expect(writeAdminPreferences(value)).toBe(true)
    expect(JSON.parse(localStorage.getItem(ADMIN_PREFERENCE_KEY) as string)).toMatchObject({ pageSize: 10, language: 'ar' })
  })

  it('namespaces the key so it cannot collide with app data', () => {
    expect(ADMIN_PREFERENCE_KEY.startsWith('alhelm:')).toBe(true)
  })
})

describe('preferences cannot grant authority', () => {
  const source = readFileSync('src/services/edge/adminSettings.ts', 'utf8')

  it('has no permission-shaped FIELD (prose mentions are fine, fields are not)', () => {
    // Check the declared interface, not the comments: the prose here explains
    // the absence of an owner flag and would otherwise match its own rule.
    const interfaceBody = source.slice(
      source.indexOf('export interface AdminPreferences'),
      source.indexOf('}', source.indexOf('export interface AdminPreferences')),
    )
    expect(interfaceBody.length).toBeGreaterThan(0)
    expect(interfaceBody).not.toMatch(/isAdmin|isOwner|canAccess|role\s*[?:]\s*(string|boolean)/i)
    // Every declared field is a display/behaviour preference.
    const fields = [...interfaceBody.matchAll(/^\s{2}(\w+)\??:/gm)].map((match) => match[1])
    expect(fields.sort()).toEqual(['confirmBeforeSend', 'language', 'pageSize', 'reducedMotion', 'utcTimestamps'])
  })

  it('is not imported by the authorization gate', () => {
    const gate = readFileSync('src/services/edge/adminGate.ts', 'utf8')
    expect(gate).not.toContain('adminSettings')
  })

  it('is not read by the admin transport', () => {
    const transport = readFileSync('src/services/edge/admin.ts', 'utf8')
    expect(transport).not.toContain('adminSettings')
  })
})
