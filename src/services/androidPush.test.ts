import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  platform: 'android',
  getUser: vi.fn(),
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
  addListener: vi.fn(),
  getRegistration: vi.fn(),
  registerToken: vi.fn(),
  removeRegistration: vi.fn(),
  listeners: new Map<string, (value: any) => void>(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => mocks.platform },
}))

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    checkPermissions: mocks.checkPermissions,
    requestPermissions: mocks.requestPermissions,
    register: mocks.register,
    unregister: mocks.unregister,
    addListener: mocks.addListener,
  },
}))

vi.mock('./persistence/supabase', () => ({
  supabase: { auth: { getUser: mocks.getUser } },
}))

vi.mock('./edge/push', () => ({
  getFcmRegistration: mocks.getRegistration,
  registerFcmToken: mocks.registerToken,
  removeFcmRegistration: mocks.removeRegistration,
}))

describe('Android FCM registration', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    localStorage.setItem('alhelm:android-push-device-id', 'device-01')
    mocks.platform = 'android'
    mocks.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mocks.checkPermissions.mockReset().mockResolvedValue({ receive: 'granted' })
    mocks.requestPermissions.mockReset().mockResolvedValue({ receive: 'granted' })
    mocks.register.mockReset().mockImplementation(async () => {
      mocks.listeners.get('registration')?.({ value: 'long-fcm-token-for-test-123456789' })
    })
    mocks.unregister.mockReset().mockResolvedValue(undefined)
    mocks.listeners.clear()
    mocks.addListener.mockReset().mockImplementation(async (name: string, callback: (value: any) => void) => {
      mocks.listeners.set(name, callback)
      return { remove: vi.fn().mockResolvedValue(undefined) }
    })
    mocks.getRegistration.mockReset().mockResolvedValue({ configured: true, registered: false })
    mocks.registerToken.mockReset().mockResolvedValue({ ok: true, configured: true })
    mocks.removeRegistration.mockReset().mockResolvedValue({ ok: true })
  })

  it('reports server configuration, account registration and Android permission separately', async () => {
    mocks.getRegistration.mockResolvedValue({ configured: true, registered: true })
    const { getAndroidPushStatus } = await import('./androidPush')

    await expect(getAndroidPushStatus()).resolves.toEqual({
      supported: true,
      authenticated: true,
      permission: 'granted',
      configured: true,
      registered: true,
    })
    expect(mocks.getRegistration).toHaveBeenCalledWith('device-01')
  })

  it('requests permission explicitly and persists the FCM token for this device', async () => {
    mocks.checkPermissions.mockResolvedValue({ receive: 'prompt' })
    const { enableAndroidPush } = await import('./androidPush')

    await expect(enableAndroidPush()).resolves.toEqual({ configured: true })
    expect(mocks.requestPermissions).toHaveBeenCalledOnce()
    expect(mocks.register).toHaveBeenCalledOnce()
    expect(mocks.registerToken).toHaveBeenCalledWith('long-fcm-token-for-test-123456789', 'device-01')
  })

  it('does not register or persist a token when Android permission is denied', async () => {
    mocks.checkPermissions.mockResolvedValue({ receive: 'denied' })
    mocks.requestPermissions.mockResolvedValue({ receive: 'denied' })
    const { enableAndroidPush } = await import('./androidPush')

    await expect(enableAndroidPush()).rejects.toMatchObject({ code: 'permission_denied' })
    expect(mocks.register).not.toHaveBeenCalled()
    expect(mocks.registerToken).not.toHaveBeenCalled()
  })

  it('requires an authenticated account before requesting notification permission', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    const { enableAndroidPush } = await import('./androidPush')

    await expect(enableAndroidPush()).rejects.toMatchObject({ code: 'sign_in_required' })
    expect(mocks.requestPermissions).not.toHaveBeenCalled()
  })

  it('removes the server registration before unregistering the native device', async () => {
    const { disableAndroidPush } = await import('./androidPush')
    await disableAndroidPush()

    expect(mocks.removeRegistration).toHaveBeenCalledWith('device-01')
    expect(mocks.removeRegistration.mock.invocationCallOrder[0]).toBeLessThan(mocks.unregister.mock.invocationCallOrder[0])
  })

  it('routes a tapped announcement and refreshes an existing opted-in token', async () => {
    mocks.getRegistration.mockResolvedValue({ configured: true, registered: true })
    const { initializeAndroidPush } = await import('./androidPush')
    const cleanup = await initializeAndroidPush()

    expect(mocks.register).toHaveBeenCalledOnce()
    await Promise.resolve()
    expect(mocks.registerToken).toHaveBeenCalledWith('long-fcm-token-for-test-123456789', 'device-01')

    const id = '11111111-2222-4333-8444-555555555555'
    mocks.listeners.get('pushNotificationActionPerformed')?.({ notification: { data: { announcementId: id } } })
    expect(window.location.hash).toBe(`#/notifications?announcementId=${id}`)
    cleanup()
  })

  it('does not expose Android registration controls on web', async () => {
    mocks.platform = 'web'
    const { getAndroidPushStatus, enableAndroidPush } = await import('./androidPush')

    await expect(getAndroidPushStatus()).resolves.toMatchObject({ supported: false, permission: 'unsupported' })
    await expect(enableAndroidPush()).rejects.toMatchObject({ code: 'unsupported' })
    expect(mocks.requestPermissions).not.toHaveBeenCalled()
  })
})
