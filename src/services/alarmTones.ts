import { Capacitor } from '@capacitor/core'
import type { ReminderTone } from '../types'

/**
 * Alarm tones.
 *
 * LICENSING: every tone references a sound that already ships with Android via
 * a `content://settings/system/...` URI. NOTHING is bundled, downloaded or
 * redistributed, so no copyrighted audio enters the repository or the APK, and
 * there is nothing to licence.
 *
 * HONESTY NOTE — these are NOT bundled audio assets, and they are NOT our own
 * recordings. They are references to the device's own system sounds. The exact
 * waveform therefore belongs to the device vendor and may differ between phones;
 * what is guaranteed is that the user hears a distinct system sound, not that a
 * particular melody plays. A ROM that omits one URI falls back to the system
 * default rather than failing silently.
 *
 * ANDROID MECHANICS: a notification channel's sound is fixed at creation and
 * cannot be changed afterwards — Android ignores later `sound` values for an
 * existing channel id. Each tone therefore gets its OWN channel id. Changing a
 * reminder's tone moves it to a different channel, which is the only mechanism
 * Android actually honours.
 *
 * Each tone now points at a DIFFERENT system sound. Previously `bell` and
 * `alarm` shared one URI and `chime` and `notification` shared another, which
 * meant four selectable options produced only two audible results.
 */

export interface ToneDefinition {
  id: ReminderTone
  /** Android channel id; one per tone because channel sound is immutable. */
  channelId: string
  /** System sound URI, or null for the device default. */
  soundUri: string | null
  /** Translation key for the display name. */
  labelKey: 'alarmToneDefault' | 'alarmToneChime' | 'alarmToneBell' | 'alarmToneAlarm' | 'alarmToneNotification'
}

export const REMINDER_TONES: ToneDefinition[] = [
  { id: 'default', channelId: '4ulife-reminders-default', soundUri: null, labelKey: 'alarmToneDefault' },
  { id: 'chime', channelId: '4ulife-reminders-chime', soundUri: 'content://settings/system/notification_sound', labelKey: 'alarmToneChime' },
  { id: 'bell', channelId: '4ulife-reminders-bell', soundUri: 'content://settings/system/alarm_alert', labelKey: 'alarmToneBell' },
  // Distinct from `bell`: a second, higher-priority alarm sound on most devices.
  { id: 'alarm', channelId: '4ulife-reminders-alarm', soundUri: 'content://settings/system/ringtone', labelKey: 'alarmToneAlarm' },
  // Distinct from `chime`: the effect-tick sound, which is short and different.
  { id: 'notification', channelId: '4ulife-reminders-notification', soundUri: 'content://settings/system/effect_tick', labelKey: 'alarmToneNotification' },
]

/** Falls back to `default` for an unknown or missing tone. */
export function toneById(tone: ReminderTone | null | undefined): ToneDefinition {
  return REMINDER_TONES.find((entry) => entry.id === tone) ?? REMINDER_TONES[0]
}

export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

/**
 * Plays a short audible preview of the selected tone.
 *
 * SCOPE NOTE (deduplication): there is deliberately only ONE preview entry
 * point for the user. On Android the real sound can only be heard through an
 * actual notification, so the caller uses the existing `sendTestNotification(tone)`
 * path inside `reminders.ts` rather than a second audio implementation here —
 * this function reports that explicitly instead of duplicating it.
 *
 * On the web a synthesised WebAudio beep is used. Browsers cannot play Android
 * system sound URIs, and bundling audio files would reintroduce the licensing
 * question. The outcome is returned so the UI can say "preview unavailable"
 * instead of pretending a sound played.
 */
export async function previewTone(tone: ReminderTone): Promise<{ ok: boolean; reason: string | null }> {
  if (isNativePlatform()) {
    // Not an error: the caller should use the test-notification path, which is
    // the single supported way to audition a tone on Android.
    return { ok: false, reason: 'native_preview_uses_test_notification' }
  }
  try {
    const AudioCtx = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return { ok: false, reason: 'audio_unavailable' }
    const context = new AudioCtx()
    // Each tone maps to a distinct pitch pattern so the choices are audibly
    // different rather than four identical beeps.
    const patterns: Record<ReminderTone, number[]> = {
      default: [880],
      chime: [880, 1174],
      bell: [1046, 1318, 1568],
      alarm: [660, 880, 660, 880],
      notification: [1174],
    }
    const frequencies = patterns[tone] ?? patterns.default
    const start = context.currentTime
    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, start + index * 0.16)
      gain.gain.exponentialRampToValueAtTime(0.18, start + index * 0.16 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + index * 0.16 + 0.14)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(start + index * 0.16)
      oscillator.stop(start + index * 0.16 + 0.15)
    })
    // Close the context once the last note has finished: an open AudioContext
    // holds an audio device on some mobile browsers.
    const total = frequencies.length * 0.16 + 0.1
    setTimeout(() => { void context.close().catch(() => undefined) }, total * 1000)
    return { ok: true, reason: null }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'audio_unavailable' }
  }
}
