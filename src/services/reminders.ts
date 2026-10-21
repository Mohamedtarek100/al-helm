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

const REMINDER_CHANNEL_ID = 'al-helm-reminders'
const REMINDER_CHANNEL_NAME = 'Study reminders'

/** Registry of pending scheduled ids, persisted locally for cancellation. */
const SCHEDULE_KEY = 'alhelm:reminder-schedule'

interface StoredSchedule {
  /** Reminder id -> next occurrence ISO date we scheduled for it. */
  [reminderId: string]: string
}

function isNative(): boolean {
  return Capacitor.isNativePlatform()
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

function ensureChannel(): void {
  const channel: Channel = {
    id: REMINDER_CHANNEL_ID,
    name: REMINDER_CHANNEL_NAME,
    importance: 5,
    visibility: 1,
    vibration: true,
  }
  void LocalNotifications.createChannel(channel).catch(() => {
    /* channel may already exist */
  })
}

export async function requestReminderPermission(): Promise<boolean> {
  if (!isNative()) return false
  const current = await LocalNotifications.checkPermissions()
  if (current.display === 'granted') return true
  const result = await LocalNotifications.requestPermissions()
  return result.display === 'granted'
}

/**
 * Sync native schedules to the given preference list. Cancels stale
 * schedules (removed/disabled reminders) and schedules the next occurrence
 * for each enabled reminder. Returns the number of native schedules active.
 */
export async function syncReminders(
  reminders: ReminderPreference[],
): Promise<number> {
  if (!isNative()) return 0
  const granted = await requestReminderPermission()
  if (!granted) return 0
  ensureChannel()

  const stored = readStored()
  const next: StoredSchedule = {}
  let scheduled = 0

  for (const reminder of reminders) {
    if (!reminder.enabled) continue
    const when = nextOccurrence(reminder.time)
    if (!when) continue

    // Skip if we already scheduled this exact occurrence for this reminder.
    if (stored[reminder.id] === when.toISOString()) {
      next[reminder.id] = when.toISOString()
      scheduled += 1
      continue
    }

    // Cancel any stale native schedule for this reminder id.
    if (stored[reminder.id]) {
      try {
        await LocalNotifications.cancel({
          notifications: [{ id: hashId(reminder.id) }],
        })
      } catch {
        /* nothing pending */
      }
    }

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
    } catch {
      /* scheduling failed on this device; keep going with the rest */
    }
  }

  // Cancel schedules for reminders that were removed entirely.
  const enabledIds = new Set(reminders.filter((r) => r.enabled).map((r) => r.id))
  for (const id of Object.keys(stored)) {
    if (!enabledIds.has(id)) {
      try {
        await LocalNotifications.cancel({
          notifications: [{ id: hashId(id) }],
        })
      } catch {
        /* nothing pending */
      }
    }
  }

  writeStored(next)
  return scheduled
}

/** Cancel every Al-Helm native reminder (used on clear/reset). */
export async function cancelAllReminders(): Promise<void> {
  if (!isNative()) return
  const stored = readStored()
  const ids = Object.keys(stored).map((id) => ({ id: hashId(id) }))
  if (ids.length > 0) {
    try {
      await LocalNotifications.cancel({ notifications: ids })
    } catch {
      /* nothing pending */
    }
  }
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
  return Math.abs(hash)
}

/* ------------------------------------------------------------------ */
/* Pure helpers (exported for unit testing)                            */
/* ------------------------------------------------------------------ */

export const __internals = {
  parseTime,
  nextOccurrence,
  hashId,
}
