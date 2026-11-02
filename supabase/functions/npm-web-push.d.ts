declare module 'npm:web-push@3.6.7' {
  interface WebPushResponse {
    statusCode: number
  }

  interface WebPushError extends Error {
    statusCode?: number
    code?: string | number
  }

  interface WebPushClient {
    setVapidDetails(subject: string, publicKey: string, privateKey: string): void
    sendNotification(
      subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
      payload: string,
      options?: { TTL?: string; urgency?: 'very-low' | 'low' | 'normal' | 'high' },
    ): Promise<WebPushResponse>
  }

  const webPush: WebPushClient
  export default webPush
}
