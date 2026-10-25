import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AppData } from '../../types'
import { hydrateData } from '../domain'
import type { CloudPersistence } from './coordinator'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
export const supabase: SupabaseClient | null = url && anonKey
  ? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null
const tableBySlice = {
  subjects: 'subjects', sessions: 'study_sessions', tasks: 'tasks', focusSessions: 'focus_sessions',
  journal: 'journal_entries', goals: 'artistic_goals', artworks: 'artwork_metadata', challenges: 'drawing_challenges',
  letters: 'future_letters', exams: 'exam_dates', notifications: null,
} as const
const toDb = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([key]) => !['imageUrl','imagePath','imageData'].includes(key)).map(([k,v]) => [
  // DB column overrides where the camelCase name is ambiguous.
  k === 'paper' ? 'paper' : k === 'drawing' ? 'drawing_model' : k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`),
  v,
]))
const fromDb = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'user_id').map(([k,v]) => [k.replace(/_([a-z])/g, (_,m:string) => m.toUpperCase()),v]))

/** Cloud persistence adapter. Requires a signed-in Supabase user; RLS remains authoritative. */
export class SupabaseAdapter implements CloudPersistence {
  readonly label = 'Supabase cloud'
  readonly kind = 'cloud' as const
  private readonly client: SupabaseClient
  constructor(client: SupabaseClient) { this.client = client }
  async userId(): Promise<string> {
    const { data, error } = await this.client.auth.getUser()
    if (error) throw error
    if (!data.user) throw new Error('Sign in is required for cloud data.')
    return data.user.id
  }
  async hasSession(): Promise<boolean> {
    const { data, error } = await this.client.auth.getSession()
    if (error) throw error
    return Boolean(data.session)
  }
  async isCloudEmpty(): Promise<boolean> {
    const userId = await this.userId()
    for (const table of [...Object.values(tableBySlice).filter((value) => value !== null) as string[], 'exam_dates']) {
      const { count, error: queryError } = await this.client.from(table).select('id', { count:'exact', head:true }).eq('user_id', userId)
      if (queryError) throw queryError
      if ((count ?? 0) > 0) return false
    }
    return true
  }

  async load(): Promise<AppData | null> {
    const userId = await this.userId()
    const { data: profile, error } = await this.client.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (error) throw error
    const result: Partial<AppData> = {}
    const defaults = hydrateData(null)
    if (profile) {
      result.profile = { displayName: profile.display_name, motto: profile.motto, journeyStart: profile.journey_start, avatarSeed: profile.avatar_seed }
      result.settings = { ...defaults.settings, theme: profile.theme, language: profile.language, storage: 'cloud' }
    }
    const { data: prefRow, error: prefError } = await this.client.from('user_preferences').select('preferences').eq('user_id', userId).maybeSingle()
    if (prefError) throw prefError
    if (prefRow?.preferences) {
      const prefs = prefRow.preferences as Partial<AppData['settings']>
      result.settings = { ...defaults.settings, ...(result.settings ?? {}), ...prefs, storage:'cloud' }
    }
    if (!result.profile) {
      const { data: authProfile, error: authError } = await this.client.auth.getUser()
      if (authError) throw authError
      result.profile = { displayName: String(authProfile.user?.user_metadata?.display_name ?? ''), motto:'', journeyStart:new Date().toISOString().slice(0,10), avatarSeed:'alhelm' }
    }
    if (!result.settings) result.settings = { ...defaults.settings, storage:'cloud' }
    const { data: exams, error: examsError } = await this.client.from('exam_dates').select('*').eq('user_id', userId)
    if (examsError) throw examsError
    result.exams = (exams ?? []).map(row => ({ id:row.id, title:row.title, subjectId:row.subject_id, examAt:row.exam_at, timezone:row.timezone, notes:row.notes, createdAt:row.created_at, updatedAt:row.updated_at }))
    for (const [slice, table] of Object.entries(tableBySlice) as [keyof typeof tableBySlice, string | null][]) {
      if (!table || slice === 'exams') continue
      const { data, error: sliceError } = await this.client.from(table).select('*').eq('user_id', userId)
      if (sliceError) throw sliceError
      ;(result as Record<string, unknown>)[slice] = await Promise.all((data ?? []).map(async (row) => {
        const mapped = fromDb(row as Record<string, unknown>)
        if (slice === 'sessions' || slice === 'focusSessions') mapped.date = mapped.sessionDate
        if (slice === 'journal') mapped.date = mapped.entryDate
        if (slice === 'artworks') {
          mapped.date = mapped.artworkDate
          mapped.imagePath = mapped.storagePath ?? null
          mapped.imageUrl = ''
          if (mapped.storagePath) {
            const { data:signed,error:signedError } = await this.client.storage.from('artworks').createSignedUrl(String(mapped.storagePath),3600)
            if (signedError) throw signedError
            mapped.imageUrl = signed.signedUrl
          }
        }
        if (slice === 'sessions' && mapped.recurrence === 'weekly') mapped.date = ''
        delete mapped.sessionDate; delete mapped.entryDate; delete mapped.artworkDate
        return mapped
      }))
    }
    return Object.keys(result).length ? result as AppData : null
  }

  /**
   * Uploads an artwork's image Blob to the private `artworks` bucket under the
   * authenticated user's folder. Skipped when the metadata row already points
   * at the same storage path (prevents re-uploads on debounced re-persists).
   */
  private async uploadArtworkImage(item: Record<string, unknown>, userId: string, id: string, existingPaths: Set<string>): Promise<string | null> {
    const existingPath = typeof item.imagePath === 'string' && item.imagePath ? item.imagePath : null
    if (existingPath && existingPaths.has(existingPath)) return existingPath
    if (existingPath && existingPath.startsWith(`${userId}/`)) return existingPath // already owned, trust it
    try {
      const { getImage } = await import('../artImages')
      const blob = await getImage(id)
      if (!blob) return existingPath // nothing new to upload; keep any legacy path
      const extension = blob.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'
      const path = `${userId}/${id}.${extension}`
      const { error } = await this.client.storage.from('artworks').upload(path, blob, { contentType: blob.type || 'image/png', upsert: true })
      if (error) throw error
      return path
    } catch (error) {
      // Preserve the local copy; surface the failure instead of a false success.
      throw new Error(`Artwork image upload failed for "${String(item.title ?? id)}": ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }

  async save(data: AppData): Promise<void> {
    const userId = await this.userId()
    const p = data.profile, s = data.settings
    const { error: profileError } = await this.client.from('profiles').upsert({ id:userId, display_name:p.displayName, motto:p.motto, journey_start:p.journeyStart, avatar_seed:p.avatarSeed, language:s.language, theme:s.theme, timezone:'Africa/Cairo' })
    if (profileError) throw profileError
    if(await this.userId()!==userId)throw new Error('Account changed during cloud save.')
    const { error: prefError } = await this.client.from('user_preferences').upsert({ user_id:userId, preferences:s, updated_at:new Date().toISOString() })
    if (prefError) throw prefError
    if(await this.userId()!==userId)throw new Error('Account changed during cloud save.')
    await this.saveSlice('exam_dates', data.exams.map(item => ({
      id:item.id, user_id:userId, title:item.title, subject_id:item.subjectId, exam_at:item.examAt,
      timezone:item.timezone, notes:item.notes, created_at:item.createdAt, updated_at:item.updatedAt,
    })), userId)
    if(await this.userId()!==userId)throw new Error('Account changed during cloud save.')
    for (const [slice, table] of Object.entries(tableBySlice) as [keyof typeof tableBySlice, string | null][]) {
      if (!table || slice === 'exams') continue
      if (slice === 'artworks') {
        // Read current storage paths first so unchanged images are not re-uploaded.
        const { data: existingRows, error: existingError } = await this.client.from(table).select('id,storage_path').eq('user_id', userId)
        if (existingError) throw existingError
        const existingPaths = new Set((existingRows ?? []).map((row) => String(row.storage_path ?? '')))
        const rows: Record<string, unknown>[] = []
        for (const item of data.artworks as unknown as Record<string, unknown>[]) {
          const mapped = toDb(item)
          mapped.artwork_date = item.date
          delete mapped.date; delete mapped.image_url
          const path = await this.uploadArtworkImage(item, userId, String(item.id), existingPaths)
          mapped.storage_path = path
          rows.push({ ...mapped, user_id: userId })
        }
        await this.saveSlice(table, rows, userId)
        if (await this.userId() !== userId) throw new Error('Account changed during cloud save.')
        // Clean up storage objects that no longer have a metadata row. A
        // removal failure is surfaced (not swallowed) so orphaned files are
        // never silently retained while the metadata claims deletion succeeded.
        const keepPaths = new Set(rows.map((row) => String(row.storage_path ?? '')).filter(Boolean))
        const orphans = [...existingPaths].filter((path) => path && !keepPaths.has(path))
        if (orphans.length) {
          const { error: removeError } = await this.client.storage.from('artworks').remove(orphans)
          if (removeError) throw new Error(`Artwork file cleanup failed: ${removeError.message}`)
        }
        continue
      }
      const rows: Record<string, unknown>[] = (data[slice] as unknown as Record<string, unknown>[]).map(item => {
        const mapped = toDb(item)
        if (slice === 'sessions') { mapped.session_date = item.date || new Date().toISOString().slice(0,10); delete mapped.date }
        if (slice === 'focusSessions') { mapped.session_date = item.date; delete mapped.date }
        if (slice === 'journal') { mapped.entry_date = item.date; delete mapped.date }
        return { ...mapped, user_id:userId }
      })
      await this.saveSlice(table, rows, userId)
      if(await this.userId()!==userId)throw new Error('Account changed during cloud save.')
    }
  }

  async saveSlice(table: string, rows: Record<string, unknown>[], userId: string): Promise<void> {
    const { data: existing, error: readError } = await this.client.from(table).select('id').eq('user_id',userId)
    if (readError) throw readError
    if (rows.length) {
      const { error } = await this.client.from(table).upsert(rows,{onConflict:'user_id,id'})
      if (error) throw error
    }
    const keepIds = new Set(rows.map(row=>String(row.id)))
    const staleIds = (existing??[]).map(row=>String(row.id)).filter(id=>!keepIds.has(id))
    if (staleIds.length) {
      const { error } = await this.client.from(table).delete().eq('user_id',userId).in('id',staleIds)
      if (error) throw error
    }
  }
  async clear(): Promise<void> {
    throw new Error('Cloud data cannot be cleared by local reset.')
  }
}

export function cloudAdapter(): SupabaseAdapter | null { return supabase ? new SupabaseAdapter(supabase) : null }
