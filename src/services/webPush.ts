import { getPushConfiguration, registerPushSubscription, removePushSubscription } from './edge/push'
import { supabase } from './persistence/supabase'
import { registerServiceWorker } from './pwa/registerServiceWorker'

export type WebPushErrorCode =
  | 'unsupported'
  | 'not_configured'
  | 'sign_in_required'
  | 'permission_denied'
  | 'service_worker'

export class WebPushError extends Error {
  readonly code: WebPushErrorCode

  constructor(code: WebPushErrorCode) {
    super(code)
    this.name = 'WebPushError'
    this.code = code
  }
}

export interface WebPushStatus {
  supported: boolean
  configured: boolean
  authenticated: boolean
  permission: NotificationPermission | 'unsupported'
  subscribed: boolean
}

const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim() ?? ''

function isSupported(): boolean {
  return typeof navigator !== 'undefined'
    && typeof window !== 'undefined'
    && window.isSecureContext
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
}

export async function getWebPushStatus(): Promise<WebPushStatus> {
  const supported = isSupported()
  const base: WebPushStatus = {
    supported,
    configured: Boolean(publicKey),
    authenticated: false,
    permission: supported ? Notification.permission : 'unsupported',
    subscribed: false,
  }
  if (!supported || !supabase) return base

  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!data.user) return base

  const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
  const subscription = await registration?.pushManager.getSubscription()
  const server = await getPushConfiguration(subscription?.endpoint)
  return {
    ...base,
    configured: base.configured && server.configured,
    authenticated: true,
    subscribed: server.subscribed,
  }
}

function decodeApplicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function requireSignedInUser(): Promise<void> {
  if (!supabase) throw new WebPushError('sign_in_required')
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!data.user) throw new WebPushError('sign_in_required')
}

export async function enableWebPush(): Promise<void> {
  if (!isSupported()) throw new WebPushError('unsupported')
  if (!publicKey) throw new WebPushError('not_configured')
  await requireSignedInUser()

  const permission = Notification.permission === 'default'
    ? await Notification.requestPermission()
    : Notification.permission
  if (permission !== 'granted') throw new WebPushError('permission_denied')

  const worker = await registerServiceWorker()
  if (!worker.registered) throw new WebPushError('service_worker')
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
    ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeApplicationServerKey(publicKey),
    })
  await registerPushSubscription(subscription.toJSON())
}

export async function disableWebPush(): Promise<void> {
  if (!isSupported()) throw new WebPushError('unsupported')
  await requireSignedInUser()

  const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return

  await removePushSubscription(subscription.endpoint)
  await subscription.unsubscribe()
}
