import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { supabase } from './persistence/supabase'
import { getFcmRegistration, registerFcmToken, removeFcmRegistration } from './edge/push'

const DEVICE_ID_KEY = 'alhelm:android-push-device-id'
const TOKEN_TIMEOUT_MS = 20_000
const ANNOUNCEMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type AndroidPushErrorCode =
  | 'unsupported'
  | 'sign_in_required'
  | 'permission_denied'
  | 'registration_failed'
  | 'registration_timeout'

export class AndroidPushError extends Error {
  readonly code: AndroidPushErrorCode

  constructor(code: AndroidPushErrorCode) {
    super(code)
    this.name = 'AndroidPushError'
    this.code = code
  }
}

export interface AndroidPushStatus {
  supported: boolean
  authenticated: boolean
  permission: 'granted' | 'denied' | 'prompt' | 'unsupported'
  configured: boolean
  registered: boolean
}

function isAndroid(): boolean {
  return Capacitor.getPlatform() === 'android'
}

function stableDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY)
  if (existing && /^[A-Za-z0-9_-]{1,128}$/.test(existing)) return existing
  const id = crypto.randomUUID().replace(/-/g, '')
  localStorage.setItem(DEVICE_ID_KEY, id)
  return id
}

function storedDeviceId(): string | null {
  const value = localStorage.getItem(DEVICE_ID_KEY)
  return value && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null
}

async function requireSignedInUser(): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!data.user) throw new AndroidPushError('sign_in_required')
}

function permission(value: string): AndroidPushStatus['permission'] {
  return value === 'granted' || value === 'denied' || value === 'prompt' ? value : 'unsupported'
}

export async function getAndroidPushStatus(): Promise<AndroidPushStatus> {
  const supported = isAndroid()
  const base: AndroidPushStatus = {
    supported,
    authenticated: false,
    permission: supported ? 'prompt' : 'unsupported',
    configured: false,
    registered: false,
  }
  if (!supported || !supabase) return base

  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!data.user) return base

  const [permissions, server] = await Promise.all([
    PushNotifications.checkPermissions(),
    getFcmRegistration(stableDeviceId()),
  ])
  return {
    ...base,
    authenticated: true,
    permission: permission(permissions.receive),
    configured: server.configured,
    registered: server.registered,
  }
}

export async function enableAndroidPush(): Promise<{ configured: boolean }> {
  if (!isAndroid()) throw new AndroidPushError('unsupported')
  await requireSignedInUser()

  let current = await PushNotifications.checkPermissions()
  if (current.receive !== 'granted') current = await PushNotifications.requestPermissions()
  if (current.receive !== 'granted') throw new AndroidPushError('permission_denied')

  let resolveToken!: (token: string) => void
  let rejectToken!: (error: Error) => void
  const tokenResult = new Promise<string>((resolve, reject) => {
    resolveToken = resolve
    rejectToken = reject
  })
  const registration = await PushNotifications.addListener('registration', ({ value }) => resolveToken(value))
  const registrationError = await PushNotifications.addListener('registrationError', () => {
    rejectToken(new AndroidPushError('registration_failed'))
  })
  const timeout = setTimeout(() => rejectToken(new AndroidPushError('registration_timeout')), TOKEN_TIMEOUT_MS)

  try {
    await PushNotifications.register()
    const token = await tokenResult
    const saved = await registerFcmToken(token, stableDeviceId())
    return { configured: saved.configured }
  } finally {
    clearTimeout(timeout)
    await Promise.all([registration.remove(), registrationError.remove()])
  }
}

export async function disableAndroidPush(): Promise<void> {
  if (!isAndroid()) throw new AndroidPushError('unsupported')
  await requireSignedInUser()
  const deviceId = storedDeviceId()
  if (deviceId) await removeFcmRegistration(deviceId)
  await PushNotifications.unregister()
}

/** Revoke the server registration before signing the current account out. */
export async function clearAndroidPushBeforeSignOut(): Promise<void> {
  if (!isAndroid() || !supabase) return
  const deviceId = storedDeviceId()
  if (!deviceId) return
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!data.user) return
  const status = await getFcmRegistration(deviceId)
  if (status.registered) await removeFcmRegistration(deviceId)
  await PushNotifications.unregister()
}

function reportRotationError(error: unknown): void {
  console.error('Android push token refresh failed.', error)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('alhelm:android-push-error'))
  }
}

/** Installs app-wide tap routing and refreshes an opted-in token on app launch. */
export async function initializeAndroidPush(): Promise<() => void> {
  if (!isAndroid()) return () => undefined

  const actionListener = await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const announcementId = notification.data?.announcementId
    if (typeof announcementId !== 'string' || !ANNOUNCEMENT_ID.test(announcementId)) return
    window.location.hash = `/notifications?announcementId=${encodeURIComponent(announcementId)}`
  })

  let tokenListener: PluginListenerHandle | null = null
  let registrationErrorListener: PluginListenerHandle | null = null
  try {
    if (supabase) {
      const { data, error } = await supabase.auth.getUser()
      if (error) throw error
      const deviceId = storedDeviceId()
      if (data.user && deviceId) {
        const [status, permissions] = await Promise.all([
          getFcmRegistration(deviceId),
          PushNotifications.checkPermissions(),
        ])
        if (status.registered && permissions.receive === 'granted') {
          tokenListener = await PushNotifications.addListener('registration', ({ value }) => {
            void registerFcmToken(value, deviceId).catch(reportRotationError)
          })
          registrationErrorListener = await PushNotifications.addListener('registrationError', reportRotationError)
          await PushNotifications.register()
        }
      }
    }
  } catch (error) {
    await Promise.all([tokenListener?.remove(), registrationErrorListener?.remove()])
    tokenListener = null
    registrationErrorListener = null
    reportRotationError(error)
  }

  return () => {
    void Promise.all([
      actionListener.remove(),
      tokenListener?.remove(),
      registrationErrorListener?.remove(),
    ])
  }
}
