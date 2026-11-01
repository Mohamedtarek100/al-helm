/**
 * Pure pagination logic shared between the admin edge function and tests.
 *
 * listUsers page N is the Nth slice of ALL users, so matching users must be
 * accumulated across the full directory server-side, not just filtered within
 * one requested page. This module owns that behavior so it can be unit-tested
 * without a live Supabase instance.
 */

export interface DirectoryUser {
  id: string
  email: string | null
  displayName: string
  createdAt: string
}

export interface AdminRow {
  id: string
  email: string | null
  displayName: string
  createdAt: string
  lastSeenAt: string | null
  pushOptIn: boolean
}

/**
 * Extract the slice of matches for `requestedPage` (1-based) from the
 * accumulated match stream, tracking whether more matches remain.
 */
export class UsersPager {
  private matched = 0
  private collected: AdminRow[] = []
  constructor(
    private readonly requestedPage: number,
    private readonly perPage: number,
    private readonly search: string,
  ) { }

  get query(): string {
    return this.search.trim().toLowerCase()
  }

  /** Feed one directory user; returns true if it was collected for this page. */
  add(user: DirectoryUser, pushOptIn: boolean): boolean {
    const email = (user.email ?? '').toLowerCase()
    const name = user.displayName.toLowerCase()
    if (this.query && !email.includes(this.query) && !name.includes(this.query)) return false
    const index = this.matched
    this.matched += 1
    const startIndex = (this.requestedPage - 1) * this.perPage
    if (index < startIndex) return false
    if (this.collected.length >= this.perPage) return false
    this.collected.push({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt,
      lastSeenAt: null,
      pushOptIn,
    })
    return true
  }

  /** Whether any page after requestedPage still holds matches. */
  hasMore(): boolean {
    return this.matched > this.requestedPage * this.perPage
  }

  rows(): AdminRow[] {
    return this.collected
  }
}

/**
 * Collect the full recipient list for the 'all' audience: every registered
 * account, not only users with a heartbeat row. The caller pages through
 * `listUsers` and feeds each user here.
 */
export class AllRecipients {
  private readonly ids: string[] = []
  add(user: DirectoryUser): void {
    this.ids.push(user.id)
  }
  list(): string[] {
    return [...new Set(this.ids)]
  }
  count(): number {
    return this.list().length
  }
}
