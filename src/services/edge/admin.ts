import { supabase } from '../persistence/supabase'

/**
 * Thin client for the `admin` Supabase Edge Function.
 *
 * Every request carries the signed-in user's access token; the function
 * re-verifies it and checks the ADMIN_EMAILS allowlist server-side before
 * doing anything privileged. This module never sees or sends any
 * service-role key — Supabase injects that only inside the function.
 */

export interface AdminMetrics {
  totalRegistered: number
  newUsers7d: number
  newUsers30d: number
  active7: number
  active30: number
  pushOptIns: number
}

export interface AdminUserRow {
  id: string
  email: string | null
  displayName: string | null
  createdAt: string
  lastSeenAt: string | null
  pushOptIn: boolean
}

export interface AdminGate {
  isAdmin: boolean
  email: string | null
  error?: string
}

export interface AdminUsersPage {
  users: AdminUserRow[]
  page: number
  hasMore: boolean
}

export interface AnnouncementHistoryRow {
  id: string
  title: string
  audience: string
  createdAt: string
  recipientCount: number
}

export interface SendResult {
  ok: boolean
  announcementId: string
  recipientCount: number
}

function endpoint(action: string): string {
  const base = import.meta.env.VITE_SUPABASE_URL
  if (!base) throw new Error('Supabase is not configured.')
  return `${base}/functions/v1/admin/${action}`
}

async function accessToken(): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  const token = data.session?.access_token
  if (!token) throw new Error('Sign in is required.')
  return token
}

export async function adminFetch<T>(action: string, body?: Record<string, unknown>): Promise<T> {
  const token = await accessToken()
  const response = await fetch(endpoint(action), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, ...(body ?? {}) }),
  })
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`)
  return payload
}

/** One-shot access check used by the page to decide access. */
export function getAdminGate(): Promise<AdminGate> {
  return adminFetch<AdminGate>('gate')
}

export function getAdminMetrics(): Promise<AdminMetrics> {
  return adminFetch<AdminMetrics>('metrics')
}

export function getAdminUsers(page: number, search = ''): Promise<AdminUsersPage> {
  return adminFetch<AdminUsersPage>('users', { page, search })
}

export function sendAnnouncement(
  title: string,
  message: string,
  audience: 'all' | 'opted_in',
): Promise<SendResult> {
  return adminFetch<SendResult>('send', { title, message, audience })
}

export function getAdminHistory(): Promise<{ history: AnnouncementHistoryRow[] }> {
  return adminFetch<{ history: AnnouncementHistoryRow[] }>('history')
}

/** Throttled activity heartbeat — callable by any signed-in user. */
export function heartbeat(): Promise<{ ok: true }> {
  return adminFetch<{ ok: true }>('heartbeat')
}
