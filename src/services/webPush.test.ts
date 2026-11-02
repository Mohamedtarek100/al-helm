import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  registerSubscription: vi.fn(),
  removeSubscription: vi.fn(),
  pushStatus: vi.fn(),
  registerServiceWorker: vi.fn(),
}))

vi.mock('./persistence/supabase', () => ({
  supabase: { auth: { getUser: mocks.getUser } },
}))
vi.mock('./edge/push', () => ({
  registerPushSubscription: mocks.registerSubscription,
  removePushSubscription: mocks.removeSubscription,
  getPushConfiguration: mocks.pushStatus,
}))
vi.mock('./pwa/registerServiceWorker', () => ({
  registerServiceWorker: mocks.registerServiceWorker,
}))

class FakeNotification {
  static permission: NotificationPermission = 'default'
  static requestPermission = vi.fn(async () => 'granted' as NotificationPermission)
}

describe('browser Web Push registration', () => {
  let subscription: {
    endpoint: string
    toJSON: () => PushSubscriptionJSON
    unsubscribe: ReturnType<typeof vi.fn>
  }
  let pushManager: {
    getSubscription: ReturnType<typeof vi.fn>
    subscribe: ReturnType<typeof vi.fn>
  }
  let registration: { pushManager: typeof pushManager }

  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'AQIDBA')
    FakeNotification.permission = 'default'
    FakeNotification.requestPermission.mockReset().mockResolvedValue('granted')
    mocks.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mocks.registerSubscription.mockReset().mockResolvedValue({ ok: true })
    mocks.removeSubscription.mockReset().mockResolvedValue({ ok: true })
    mocks.pushStatus.mockReset().mockResolvedValue({ configured: true, subscribed: false })
    mocks.registerServiceWorker.mockReset().mockResolvedValue({ supported: true, registered: true, error: null })

    subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-token',
      toJSON: () => ({
        endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-token',
        keys: { p256dh: 'public-key', auth: 'auth-secret' },
      }),
      unsubscribe: vi.fn().mockResolvedValue(true),
    }
    pushManager = {
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn().mockResolvedValue(subscription),
    }
    registration = { pushManager }
    const serviceWorker = {
      ready: Promise.resolve(registration),
      getRegistration: vi.fn().mockResolvedValue(registration),
    }
    vi.stubGlobal('Notification', FakeNotification)
    vi.stubGlobal('PushManager', class {})
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true })
    Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true })
    Object.defineProperty(navigator, 'serviceWorker', { value: serviceWorker, configurable: true })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('requests permission from the explicit enable action and persists the browser subscription', async () => {
    const { enableWebPush } = await import('./webPush')
    await enableWebPush()

    expect(FakeNotification.requestPermission).toHaveBeenCalledOnce()
    expect(pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    })
    expect(mocks.registerSubscription).toHaveBeenCalledWith(subscription.toJSON())
  })

  it('reports the server configuration and account registration separately from browser support', async () => {
    mocks.pushStatus.mockResolvedValue({ configured: false, subscribed: false })
    const { getWebPushStatus } = await import('./webPush')
    const status = await getWebPushStatus()

    expect(status).toMatchObject({
      supported: true,
      configured: false,
      authenticated: true,
      subscribed: false,
    })
  })

  it('does not request a subscription when notification permission is denied', async () => {
    FakeNotification.permission = 'denied'
    const { enableWebPush } = await import('./webPush')

    await expect(enableWebPush()).rejects.toMatchObject({ code: 'permission_denied' })
    expect(pushManager.subscribe).not.toHaveBeenCalled()
    expect(mocks.registerSubscription).not.toHaveBeenCalled()
  })

  it('requires an authenticated account before creating a browser subscription', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    const { enableWebPush } = await import('./webPush')

    await expect(enableWebPush()).rejects.toMatchObject({ code: 'sign_in_required' })
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled()
    expect(pushManager.subscribe).not.toHaveBeenCalled()
  })

  it('removes the server registration before unsubscribing this browser', async () => {
    pushManager.getSubscription.mockResolvedValue(subscription)
    const { disableWebPush } = await import('./webPush')
    await disableWebPush()

    expect(mocks.removeSubscription).toHaveBeenCalledWith(subscription.endpoint)
    expect(subscription.unsubscribe).toHaveBeenCalledOnce()
  })
})
