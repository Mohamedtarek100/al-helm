/**
 * Application store.
 *
 * A tiny, dependency-free external store built on React's `useSyncExternalStore`.
 * It is the only module that talks to the persistence adapter; components read
 * state and dispatch actions through the hooks at the bottom of this file.
 *
 * Persistence is layered: a local adapter (localStorage/IndexedDB) always
 * writes through, and an optional cloud adapter (Supabase) is coordinated by
 * PersistenceCoordinator. The action signatures below stay stable, so no UI
 * changes are needed when the persistence backend changes.
 */

import { useCallback, useSyncExternalStore } from 'react'
import type {
  AppData,
  AppNotification,
  AppNotificationKind,
  ArtisticGoal,
  Artwork,
  CollectionKey,
  DrawingChallenge,
  FocusSession,
  FutureLetter,
  ExamDate,
  JournalEntry,
  Profile,
  Settings,
  StudySession,
  Subject,
  Task,
  Timestamped,
} from '../types'
import { dataAdapter } from './persistence/adapter'
import { cloudAdapter, supabase } from './persistence/supabase'
import { PersistenceCoordinator } from './persistence/coordinator'
import { createId, nowIso } from './persistence/repository'
import { createInitialData, hydrateData } from './domain'
import { syncReminders } from './reminders'
import { getAnnouncementFeed, markAnnouncementRead, type AnnouncementFeedRow } from './edge/admin'

export type CollectionItem<K extends CollectionKey> = AppData[K][number]

/* ------------------------------------------------------------------ */
/* Store core                                                          */
/* ------------------------------------------------------------------ */

type Listener = () => void

let state: AppData = createInitialData()
let hydrated = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): AppData {
  return state
}

let persistenceError: string | null = null
let cloudSaveError: string | null = null
const persistence = new PersistenceCoordinator(dataAdapter, cloudAdapter())
async function persistCloudSnapshot(snapshot: AppData): Promise<void> {
  try {
    await persistence.persist(snapshot)
    persistenceError = null
    cloudSaveError = null
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Persistence failed.'
    if (persistence.snapshot().mode === 'cloud') cloudSaveError = message
    else persistenceError = message
    if (persistence.snapshot().mode === 'local') void persistence.refreshLocalSnapshot(state).catch(() => undefined)
    emit()
    throw error
  }
}
export function getPersistenceError(): string | null { return cloudSaveError ?? persistenceError }
export async function retryPersistence(): Promise<void> {
  await persistence.retry()
  persistenceError = null
  cloudSaveError = null
  emit()
}

/** Debounced write-through so rapid edits do not thrash localStorage. */
function schedulePersist(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    const snapshot = state
    void persistCloudSnapshot(snapshot).catch(() => undefined)
  }, 220)
}
function commit(next:AppData):void{state=next;emit();schedulePersist()}
async function commitAndPersist(next: AppData): Promise<void> {
  const previous=state
  if(saveTimer){clearTimeout(saveTimer);saveTimer=null}
  state=next
  emit()
  try {
    if(persistence.snapshot().mode==='local') await persistCloudSnapshot(next)
    else {
      await persistence.refreshCloudSnapshot(next)
      await dataAdapter.save({...next,settings:{...next.settings,storage:'local'}})
      await persistCloudSnapshot(next)
    }
    schedulePersist()
  } catch(error){state=previous;if(persistence.snapshot().mode==='local')await persistence.refreshLocalSnapshot(previous).catch(()=>undefined);else await persistence.refreshCloudSnapshot(previous).catch(()=>undefined);emit();throw error}
}

export async function initStore(force = false): Promise<void> {
  if (hydrated && !force) return
  hydrated = true
  try {
    const restored = await persistence.initialize()
    state = hydrateData(restored.data)
    state.settings.storage = 'local'
    // One-time legacy cleanup: move base64 data URLs out of the metadata
    // snapshot into IndexedDB blobs. The original record is untouched on
    // failure so no image is lost.
    try {
      const { migrateLegacyArtworkImages } = await import('./artImages')
      const migrated = await migrateLegacyArtworkImages(state.artworks as unknown as Array<{ id: string; imageUrl?: string }>)
      if (migrated > 0) {
        const trimmed = { ...state, artworks: state.artworks.map((a) => (a.imageUrl.startsWith('data:image/') ? { ...a, imageUrl: '' } : a)) }
        state = trimmed
        await dataAdapter.save({ ...trimmed, settings: { ...trimmed.settings, storage: 'local' } })
      }
    } catch { /* legacy records keep working via the URL fallback */ }
    const cloud = cloudAdapter()
    if (cloud && await cloud.hasSession().catch(() => false)) {
      const { data: { user }, error } = await supabase!.auth.getUser()
      if (!error && user) await authenticateCloudUser(user.id)
    }
  } catch (error) {
    persistenceError=error instanceof Error?error.message:'Unable to initialize local storage.'
    state=hydrateData(null)
    state.settings.storage='local'
  }
  applyTheme(state.settings.theme)
  emit()
}

export async function authenticateCloudUser(userId: string): Promise<void> {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  const next = await persistence.authenticate(userId)
  if(next.error) cloudSaveError=next.error
  if (next.mode === 'cloud') {
    state = hydrateData(next.data)
    state.settings.storage = 'cloud'
  } else {
    state = hydrateData(next.data)
    state.settings.storage = 'local'
    if (next.migrationRequired) persistenceError = 'Local data is still only on this device. Review and explicitly migrate it before syncing.'
  }
  applyTheme(state.settings.theme)
  emit()
}

export async function logoutCloudUser(): Promise<void> {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  const activeUser=persistence.snapshot().userId
  if(activeUser){
    try { await persistence.persist(state) }
    catch(error) { persistenceError=error instanceof Error?error.message:'Cloud save failed before logout.' }
  }
  const next = persistence.logout()
  state = hydrateData(next.data)
  state.settings.storage = 'local'
  cloudSaveError = null
  persistenceError = null
  applyTheme(state.settings.theme)
  emit()
}

export function isHydrated(): boolean {
  return hydrated
}

/** Snapshot access for non-React callers (export, tests). */
export function getState(): AppData {
  return state
}
export function getActivePersistenceCoordinator(): PersistenceCoordinator { return persistence }

/** Used by "استعادة النسخة" in settings and by tests. */
export async function replaceState(next: AppData): Promise<void> {
  const previous = state
  state = next
  emit()
  try {
    if(persistence.snapshot().mode==='local') await persistCloudSnapshot(next)
    else {
      await persistence.refreshCloudSnapshot(next)
      await dataAdapter.save({...next,settings:{...next.settings,storage:'local'}})
      await persistCloudSnapshot(next)
    }
    schedulePersist()
  } catch (error) {
    state = previous
    if(persistence.snapshot().mode==='local') await persistence.refreshLocalSnapshot(previous).catch(()=>undefined)
    else await persistence.refreshCloudSnapshot(previous).catch(()=>undefined)
    emit()
    throw error
  }
}

export async function resetAllData(): Promise<void> {
  if (persistence.snapshot().mode === 'cloud') throw new Error('Cloud data cannot be cleared by the local reset action.')
  const next = createInitialData()
  await replaceState(next)
  await dataAdapter.clear()
}

/* ------------------------------------------------------------------ */
/* Generic collection actions                                          */
/* ------------------------------------------------------------------ */

async function withCollectionPersist<K extends CollectionKey>(key:K,updater:(items:AppData[K][number][])=>AppData[K][number][]):Promise<void>{
  await commitAndPersist({...state,[key]:updater([...(state[key] as AppData[K][number][])])} as AppData)
}

export async function persistCurrent(): Promise<void> { await commitAndPersist(structuredClone(state)) }
export function activePersistenceMode(): 'local'|'cloud' { return persistence.snapshot().mode }


/* ------------------------------------------------------------------ */
/* Profile & settings                                                  */
/* ------------------------------------------------------------------ */

export async function updateProfile(patch: Partial<Profile>): Promise<void> {
  await commitAndPersist({ ...state, profile:{...state.profile,...patch} })
}

let systemThemeQuery: MediaQueryList | null = null
function applyTheme(theme: Settings['theme']): void {
  if (typeof document === 'undefined') return
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = (dark: boolean) => {
    if (dark) document.documentElement.dataset.theme = 'dark'
    else delete document.documentElement.dataset.theme
  }
  if (systemThemeQuery) {
    systemThemeQuery.removeEventListener('change', onSystemThemeChange)
    systemThemeQuery = null
  }
  if (theme === 'system') {
    systemThemeQuery = query
    systemThemeQuery.addEventListener('change', onSystemThemeChange)
    apply(query.matches)
  } else {
    apply(theme === 'dark')
  }
}

function onSystemThemeChange(event: MediaQueryListEvent): void {
  if (state.settings.theme !== 'system' || typeof document === 'undefined') return
  if (event.matches) document.documentElement.dataset.theme = 'dark'
  else delete document.documentElement.dataset.theme
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const next = { ...state.settings, ...patch }
  await commitAndPersist({ ...state, settings:next })
  applyTheme(next.theme)
  if (patch.reminders) void syncReminders(next.reminders).then((r) => { if (r.error) console.warn('Reminder scheduling issue:', r.error) })
}

/* ------------------------------------------------------------------ */
/* Subjects                                                            */
/* ------------------------------------------------------------------ */

export type NewSubject = Omit<Subject, keyof Timestamped | 'id'>

export async function createSubject(input: NewSubject): Promise<Subject> {
  const item={...(input as object),id:createId('sub'),createdAt:nowIso(),updatedAt:nowIso()} as Subject
  await withCollectionPersist('subjects',items=>[...items,item])
  return item
}

export async function updateSubject(id: string, patch: Partial<Subject>): Promise<void> {
  await withCollectionPersist('subjects',items=>items.map(item=>item.id===id?{...item,...patch,updatedAt:nowIso()}:item))
}

/** Removing a subject also detaches it from sessions and tasks (no orphans). */
export async function deleteSubject(id: string): Promise<void> {
  await commitAndPersist({
    ...state,
    subjects:state.subjects.filter(subject=>subject.id!==id),
    sessions:state.sessions.map(session=>session.subjectId===id?{...session,subjectId:null}:session),
    tasks:state.tasks.map(task=>task.subjectId===id?{...task,subjectId:null}:task),
    focusSessions:state.focusSessions.map(entry=>entry.subjectId===id?{...entry,subjectId:null}:entry),
  })
}

/* ------------------------------------------------------------------ */
/* Study sessions                                                      */
/* ------------------------------------------------------------------ */

export type NewStudySession = Omit<StudySession, keyof Timestamped | 'id'>

export async function createSession(input: NewStudySession): Promise<StudySession> {
  const stamp=nowIso(),item={...(input as object),id:createId('ses'),createdAt:stamp,updatedAt:stamp} as StudySession
  await withCollectionPersist('sessions',items=>[...items,item])
  return item
}

export async function updateSession(id: string, patch: Partial<StudySession>): Promise<void> {
  await withCollectionPersist('sessions',items=>items.map(item=>item.id===id?{...item,...patch,updatedAt:nowIso()}:item))
}

export async function deleteSession(id: string): Promise<void> { await withCollectionPersist('sessions',items=>items.filter(item=>item.id!==id)) }

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

export type NewTask = Omit<Task, keyof Timestamped | 'id' | 'completedAt' | 'completed'>

export async function createTask(input: NewTask): Promise<Task> {
  const stamp=nowIso(),item={...(input as object),completed:false,completedAt:null,id:createId('tsk'),createdAt:stamp,updatedAt:stamp} as Task
  await withCollectionPersist('tasks',items=>[...items,item])
  return item
}

export async function updateTask(id: string, patch: Partial<Task>): Promise<void> {
  await withCollectionPersist('tasks',items=>items.map(item=>item.id===id?{...item,...patch,updatedAt:nowIso()}:item))
}

export async function setTaskCompleted(id: string, completed: boolean): Promise<void> {
  const completedAt=completed?nowIso():null
  await withCollectionPersist('tasks',items=>items.map(item=>item.id===id?{...item,completed,completedAt,updatedAt:nowIso()}:item))
}

export async function deleteTask(id: string): Promise<void> { await withCollectionPersist('tasks',items=>items.filter(item=>item.id!==id)) }

/** Pushes a task's due date forward — used by "أجّليها لبكرة". */
export async function rescheduleTask(id: string, dueDate: string): Promise<void> { await updateTask(id,{dueDate}) }

/* ------------------------------------------------------------------ */
/* Focus sessions                                                      */
/* ------------------------------------------------------------------ */

export type NewFocusSession = Omit<FocusSession, keyof Timestamped | 'id'>

export async function recordFocusSession(input: NewFocusSession): Promise<FocusSession> {
  const stamp=nowIso(),item={...(input as object),id:createId('fcs'),createdAt:stamp,updatedAt:stamp} as FocusSession
  await withCollectionPersist('focusSessions',items=>[...items,item])
  return item
}

export async function deleteFocusSession(id: string): Promise<void> { await withCollectionPersist('focusSessions',items=>items.filter(item=>item.id!==id)) }

/* ------------------------------------------------------------------ */
/* Journal                                                             */
/* ------------------------------------------------------------------ */

export type NewJournalEntry = Omit<JournalEntry, keyof Timestamped | 'id'>

export async function createJournalEntry(input: NewJournalEntry): Promise<JournalEntry> { const stamp=nowIso(),item={...(input as object),id:createId('jrn'),createdAt:stamp,updatedAt:stamp} as JournalEntry; await withCollectionPersist('journal',items=>[...items,item]); return item }

export async function updateJournalEntry(id: string, patch: Partial<JournalEntry>): Promise<void> { await withCollectionPersist('journal',items=>items.map(item=>item.id===id?{...item,...patch,updatedAt:nowIso()}:item)) }

export async function deleteJournalEntry(id: string): Promise<void> { await withCollectionPersist('journal',items=>items.filter(item=>item.id!==id)) }

/* ------------------------------------------------------------------ */
/* Artistic goals                                                      */
/* ------------------------------------------------------------------ */

export type NewArtisticGoal = Omit<ArtisticGoal, keyof Timestamped | 'id' | 'completed' | 'completedAt'>

export async function createGoal(input: NewArtisticGoal): Promise<ArtisticGoal> { const stamp=nowIso(),item={...(input as object),completed:false,completedAt:null,id:createId('goal'),createdAt:stamp,updatedAt:stamp} as ArtisticGoal; await withCollectionPersist('goals',items=>[...items,item]); return item }

export async function updateGoal(id: string, patch: Partial<ArtisticGoal>): Promise<void> { await withCollectionPersist('goals',items=>items.map(item=>item.id===id?{...item,...patch,updatedAt:nowIso()}:item)) }

export async function setGoalCompleted(id: string, completed: boolean): Promise<void> { const completedAt=completed?nowIso():null; await withCollectionPersist('goals',items=>items.map(item=>item.id===id?{...item,completed,completedAt,updatedAt:nowIso()}:item)) }

export async function deleteGoal(id: string): Promise<void> { await withCollectionPersist('goals',items=>items.filter(item=>item.id!==id)) }

/* ------------------------------------------------------------------ */
/* Artworks                                                            */
/* ------------------------------------------------------------------ */

export type NewArtwork = Omit<Artwork, keyof Timestamped | 'id'>

export async function createArtwork(input: NewArtwork): Promise<Artwork> { const stamp=nowIso(),item={...(input as object),id:createId('art'),createdAt:stamp,updatedAt:stamp} as Artwork; await withCollectionPersist('artworks',items=>[...items,item]); return item }

export async function updateArtwork(id: string, patch: Partial<Artwork>): Promise<void> { await withCollectionPersist('artworks',items=>items.map(item=>item.id===id?{...item,...patch,updatedAt:nowIso()}:item)) }

export async function deleteArtwork(id: string): Promise<void> { await withCollectionPersist('artworks',items=>items.filter(item=>item.id!==id)) }

/* ------------------------------------------------------------------ */
/* Drawing challenges                                                  */
/* ------------------------------------------------------------------ */

export type NewDrawingChallenge = Omit<DrawingChallenge, keyof Timestamped | 'id' | 'completed' | 'completedAt'>

export async function createChallenge(input: NewDrawingChallenge): Promise<DrawingChallenge> { const stamp=nowIso(),item={...(input as object),completed:false,completedAt:null,id:createId('chal'),createdAt:stamp,updatedAt:stamp} as DrawingChallenge; await withCollectionPersist('challenges',items=>[...items,item]); return item }

export async function updateChallenge(id: string, patch: Partial<DrawingChallenge>): Promise<void> { await withCollectionPersist('challenges',items=>items.map(item=>item.id===id?{...item,...patch,updatedAt:nowIso()}:item)) }

export async function setChallengeCompleted(id: string, completed: boolean): Promise<void> { const completedAt=completed?nowIso():null; await withCollectionPersist('challenges',items=>items.map(item=>item.id===id?{...item,completed,completedAt,updatedAt:nowIso()}:item)) }

export async function deleteChallenge(id: string): Promise<void> { await withCollectionPersist('challenges',items=>items.filter(item=>item.id!==id)) }

/* ------------------------------------------------------------------ */
/* Future letters                                                      */
/* ------------------------------------------------------------------ */

export type NewFutureLetter = Omit<FutureLetter, keyof Timestamped | 'id'>

export async function createLetter(input: NewFutureLetter): Promise<FutureLetter> { const stamp=nowIso(),item={...(input as object),id:createId('ltr'),createdAt:stamp,updatedAt:stamp} as FutureLetter; await withCollectionPersist('letters',items=>[...items,item]); return item }

export async function updateLetter(id: string, patch: Partial<FutureLetter>): Promise<void> { await withCollectionPersist('letters',items=>items.map(item=>item.id===id?{...item,...patch,updatedAt:nowIso()}:item)) }

export async function deleteLetter(id: string): Promise<void> { await withCollectionPersist('letters',items=>items.filter(item=>item.id!==id)) }

export type NewExamDate = Omit<ExamDate, keyof Timestamped | 'id'>
export async function createExam(input: NewExamDate): Promise<ExamDate> { const stamp=nowIso(),item={...(input as object),id:createId('exam'),createdAt:stamp,updatedAt:stamp} as ExamDate; await withCollectionPersist('exams',items=>[...items,item]); return item }
export async function updateExam(id: string, patch: Partial<ExamDate>): Promise<void> { await withCollectionPersist('exams',items=>items.map(item=>item.id===id?{...item,...patch,updatedAt:nowIso()}:item)) }
export async function deleteExam(id: string): Promise<void> { await withCollectionPersist('exams',items=>items.filter(item=>item.id!==id)) }

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export type NewNotification = {
  kind: AppNotificationKind
  title: string
  body: string
  at?: string
  read?: boolean
}

export function pushNotification(input: NewNotification): AppNotification {
  const stamp=nowIso(),item={id:createId('ntf'),kind:input.kind,title:input.title,body:input.body,at:input.at??stamp,read:input.read??false,createdAt:stamp,updatedAt:stamp} as AppNotification
  commit({...state,notifications:[...state.notifications,item]})
  return item
}

export async function markNotificationRead(id: string, read: boolean): Promise<void> { await withCollectionPersist('notifications',items=>items.map(item=>item.id===id?{...item,read,updatedAt:nowIso()}:item)) }

export async function markAllNotificationsRead(): Promise<void> { await withCollectionPersist('notifications',items=>items.map(item=>item.read?item:{...item,read:true,updatedAt:nowIso()})) }

export async function deleteNotification(id: string): Promise<void> { await withCollectionPersist('notifications',items=>items.filter(item=>item.id!==id)) }

export async function clearNotifications(): Promise<void> { await withCollectionPersist('notifications',()=>[]) }

/* ------------------------------------------------------------------ */
/* Server announcements                                                */
/* ------------------------------------------------------------------ */

/**
 * Pull the signed-in user's server announcements into the local notifications
 * collection. Adds any announcement not yet mirrored locally (matched by id
 * prefix 'ann-<announcementId>'), and marks them read both locally and on the
 * server when the user marks them read. Safe to call repeatedly; no-ops when
 * the backend isn't configured or the user isn't signed in.
 */
export async function syncServerAnnouncements(): Promise<number> {
  if (!supabase) return 0
  let feed: AnnouncementFeedRow[]
  try {
    feed = (await getAnnouncementFeed()).feed
  } catch {
    return 0 // not signed in / backend unreachable — local data stays authoritative
  }
  if (feed.length === 0) return 0
  const existing = new Set(state.notifications.map((n) => n.id))
  const fresh = feed.filter((row) => !existing.has(`ann-${row.id}`))
  if (fresh.length === 0) return 0
  const items: AppNotification[] = fresh.map((row) => {
    const stamp = nowIso()
    return {
      id: `ann-${row.id}`,
      kind: 'announcement',
      title: row.title,
      body: row.body,
      at: row.deliveredAt || row.createdAt,
      read: row.readAt !== null,
      createdAt: stamp,
      updatedAt: stamp,
    }
  })
  await withCollectionPersist('notifications', (current) => [...current, ...items])
  return items.length
}

/** Mark an announcement read in both local state and on the server. */
export async function markAnnouncementReadEverywhere(announcementId: string): Promise<void> {
  const localId = `ann-${announcementId}`
  await withCollectionPersist('notifications', (items) => items.map((item) => (item.id === localId ? { ...item, read: true, updatedAt: nowIso() } : item)))
  await markAnnouncementRead(announcementId).catch(() => undefined)
}

/* ------------------------------------------------------------------ */
/* React binding                                                       */
/* ------------------------------------------------------------------ */

/** Subscribes to the whole snapshot. Components then narrow with selectors. */
export function useAppData(): AppData {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Subscribes to one slice so unrelated pages do not re-render. */
export function useCollection<K extends CollectionKey>(key: K): AppData[K][number][] {
  const read = useCallback(() => getSnapshot()[key] as AppData[K][number][], [key])
  return useSyncExternalStore(subscribe, read, read)
}

export function useProfile(): Profile {
  const read = useCallback(() => getSnapshot().profile, [])
  return useSyncExternalStore(subscribe, read, read)
}

export function useSettings(): Settings {
  const read = useCallback(() => getSnapshot().settings, [])
  return useSyncExternalStore(subscribe, read, read)
}
