import { adminFetch } from './admin'

async function invokePushAction<T>(action: string, values: Record<string, unknown> = {}): Promise<T> {
  return adminFetch<T>(action, values)
}

export function registerPushSubscription(subscription: PushSubscriptionJSON): Promise<{ ok: true }> {
  return invokePushAction('push:register', { subscription })
}

export function removePushSubscription(endpoint: string): Promise<{ ok: true }> {
  return invokePushAction('push:delete', { endpoint })
}

export function getPushConfiguration(endpoint?: string): Promise<{ configured: boolean; subscribed: boolean }> {
  return invokePushAction('push:status', endpoint ? { endpoint } : {})
}

export function registerFcmToken(token: string, deviceId: string): Promise<{ ok: true; configured: boolean }> {
  return invokePushAction('fcm:register', { token, deviceId })
}

export function getFcmRegistration(deviceId: string): Promise<{ configured: boolean; registered: boolean }> {
  return invokePushAction('fcm:status', { deviceId })
}

export function removeFcmRegistration(deviceId: string): Promise<{ ok: true }> {
  return invokePushAction('fcm:delete', { deviceId })
}
