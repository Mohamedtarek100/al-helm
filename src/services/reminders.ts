import { Capacitor } from '@capacitor/core'
import {
  LocalNotifications,
  type Channel,
} from '@capacitor/local-notifications'
import type { ReminderPreference } from '../types'

/**
 * Android local scheduled notifications for study reminders.
 *
 * Web builds fall back to a no-op (reminders stay in-app preferences only);
 * native Android uses the official @capacitor/local-notifications plugin.
 * Schedules are idempotent: every sync cancels previous Al-Helm reminders
 * first, then reschedules exactly the enabled ones. No duplicates.
 */

const REMINDER_CHANNEL_ID = '4ulife-reminders'
const REMINDER_CHANNEL_NAME = 'Study reminders'
const TEST_NOTIFICATION_ID = 1_999_999_999

/** Registry of pending scheduled ids, persisted locally for cancellation. */
const SCHEDULE_KEY = 'alhelm:reminder-schedule'

interface StoredSchedule {
  /** Reminder id -> next occurrence ISO date we scheduled for it. */
  [reminderId: string]: string
}

export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

/** Whether this platform can schedule OS-level notifications at all. */
export function canScheduleReminders(): boolean {
  return isNative()
}

function readStored(): StoredSchedule {
  try {
    const raw = localStorage.getItem(SCHEDULE_KEY)
    return raw ? (JSON.parse(raw) as StoredSchedule) : {}
  } catch {
    return {}
  }
}

function writeStored(next: StoredSchedule): void {
  try {
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable; scheduling still works, just not deduped */
  }
}

/** HH:mm -> {hours, minutes} parsed from a 24h time string. */
function parseTime(time: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return { hours, minutes }
}

/** Next occurrence of HH:mm today or tomorrow. */
function nextOccurrence(time: string, from = new Date()): Date | null {
  const parts = parseTime(time)
  if (!parts) return null
  const candidate = new Date(from)
  candidate.setHours(parts.hours, parts.minutes, 0, 0)
  if (candidate.getTime() <= from.getTime()) {
    candidate.setDate(candidate.getDate() + 1)
  }
  return candidate
}

function ensureChannel(): Promise<void> {
  const channel: Channel = {
    id: REMINDER_CHANNEL_ID,
    name: REMINDER_CHANNEL_NAME,
    description: 'Study and studio reminders from 4uLife',
    importance: 5,
    visibility: 1,
    vibration: true,
    sound: 'default',
  }
  // createChannel is idempotent on Android; a failure here is not fatal because
  // the schedule call reports the real outcome to the UI.
  return LocalNotifications.createChannel(channel).then(
    () => undefined,
    () => undefined,
  )
}

export interface ReminderSyncResult {
  /** Number of native schedules now active. */
  scheduled: number
  /** Whether notification permission is granted on this device. */
  permissionGranted: boolean
  /** True when running in a web browser (no native scheduling available). */
  webUnsupported: boolean
  /** Human-readable error when scheduling failed despite permission. */
  error: string | null
}

export async function requestReminderPermission(): Promise<boolean> {
  if (!isNative()) return false
  try {
    const current = await LocalNotifications.checkPermissions()
    if (current.display === 'granted') return true
    const result = await LocalNotifications.requestPermissions()
    return result.display === 'granted'
  } catch {
    return false
  }
}

/**
 * Sync native schedules to the given preference list. Cancels stale
 * schedules (removed/disabled reminders) and schedules the next occurrence
 * for each enabled reminder. Never swallows scheduling failures — the
 * caller reports them to the user so the UI never claims success falsely.
 */
export async function syncReminders(
  reminders: ReminderPreference[],
): Promise<ReminderSyncResult> {
  if (!isNative()) {
    return { scheduled: 0, permissionGranted: false, webUnsupported: true, error: null }
  }
  const enabled = reminders.filter((reminder) => reminder.enabled)
  const storedBefore = readStored()
  // A user who disabled every reminder should not even be prompted.
  if (enabled.length === 0) {
    await cancelNativeIds(Object.keys(storedBefore).map(hashId))
    writeStored({})
    return { scheduled: 0, permissionGranted: false, webUnsupported: false, error: null }
  }
  const granted = await requestReminderPermission()
  if (!granted) {
    return { scheduled: 0, permissionGranted: false, webUnsupported: false, error: 'permission_denied' }
  }
  await ensureChannel()

  const stored = readStored()
  const next: StoredSchedule = {}
  let scheduled = 0
  let failure: string | null = null

  for (const reminder of enabled) {
    const when = nextOccurrence(reminder.time)
    if (!when) {
      failure = failure ?? `invalid time: ${reminder.time}`
      continue
    }

    // Skip if we already scheduled this exact occurrence for this reminder.
    if (stored[reminder.id] === when.toISOString()) {
      next[reminder.id] = when.toISOString()
      scheduled += 1
      continue
    }

    // Cancel any stale native schedule for this reminder id before
    // rescheduling so a time change never leaves two pending alarms.
    if (stored[reminder.id]) await cancelNativeIds([hashId(reminder.id)])

    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: hashId(reminder.id),
            schedule: { at: when, allowWhileIdle: true },
            title: reminder.label,
            body: reminder.label,
            channelId: REMINDER_CHANNEL_ID,
          },
        ],
      })
      next[reminder.id] = when.toISOString()
      scheduled += 1
    } catch (e) {
      failure = failure ?? (e instanceof Error ? e.message : String(e))
    }
  }

  // Cancel schedules for reminders that were removed entirely.
  const enabledIds = new Set(enabled.map((r) => r.id))
  await cancelNativeIds(Object.keys(stored).filter((id) => !enabledIds.has(id)).map(hashId))

  writeStored(next)
  return { scheduled, permissionGranted: true, webUnsupported: false, error: failure }
}

/**
 * Immediate test notification so the user can verify delivery, sound and
 * vibration without waiting for the next scheduled reminder. Reports the
 * real outcome instead of assuming success.
 */
export async function sendTestNotification(): Promise<{ ok: boolean; error: string | null }> {
  if (!isNative()) return { ok: false, error: 'web_unsupported' }
  const granted = await requestReminderPermission()
  if (!granted) return { ok: false, error: 'permission_denied' }
  await ensureChannel()
  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: TEST_NOTIFICATION_ID,
          title: '4uLife',
          body: 'Test notification — reminders are working.',
          channelId: REMINDER_CHANNEL_ID,
        },
      ],
    })
    return { ok: true, error: null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function cancelNativeIds(ids: number[]): Promise<void> {
  if (!isNative() || ids.length === 0) return
  try {
    await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) })
    } catch {
      /* nothing pending */
    }
  }

  /** Cancel every native reminder (used on clear/reset). */
export async function cancelAllReminders(): Promise<void> {
  if (!isNative()) return
  const stored = readStored()
  await cancelNativeIds(Object.keys(stored).map(hashId))
  writeStored({})
}

/**
 * Deterministic 31-bit id from a reminder id string. Android notification
 * ids are int32; this keeps them stable across syncs to avoid duplicates.
 */
function hashId(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash << 5) - hash + id.charCodeAt(i)
    hash |= 0 // force int32
  }
  return (Math.abs(hash) % 2_000_000_000) + 1
}

/* ------------------------------------------------------------------ */
/* Pure helpers (exported for unit testing)                            */
/* ------------------------------------------------------------------ */

export const __internals = {
  parseTime,
  nextOccurrence,
  hashId,
}
