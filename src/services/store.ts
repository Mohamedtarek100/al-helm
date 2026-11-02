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
  ReminderPreference,
  ReminderTone,
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
import { toValidDate } from './date'
import { endGuestSession, isGuestSession } from './guestMode'
import { createInitialData, hydrateData } from './domain'
import { markSynced, markSyncFailed, markSyncing, reconcileWithStore } from './syncStatus'
import { cleanSubjectName, findSubjectIncludingArchived, SubjectDuplicateError, subjectNameKey } from './subjects'
import { isTaskPriority, normalizeTaskPriority } from './taskPriority'
import { dismissAnnouncements, getAnnouncementFeed, markAnnouncementRead, type AnnouncementFeedRow } from './edge/admin'

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
/**
 * Non-null while the device copy is AHEAD of the account copy because the last
 * cloud write failed. Cleared only by a cloud write the server confirmed.
 */
let pendingCloudError: string | null = null
let pendingAnnouncementDismissalError: string | null = null
/**
 * Incremented whenever the active account changes. A save captures the value
 * when it starts and refuses to record a result if it moved underneath it, so
 * a slow request from account A can never be reported against account B.
 */
let accountGeneration = 0
const persistence = new PersistenceCoordinator(dataAdapter, cloudAdapter())

/**
 * What a write operation reports to its caller.
 *
 * The `'local-only'` case is the important one: the change IS applied and IS
 * persisted on this device, but the account copy is behind. Callers must show a
 * warning ("saved here, not yet in your account") rather than an error, because
 * an error invites a retry — and a retry of a create would duplicate the item.
 */
export type SaveOutcome = 'cloud' | 'local'
export type WriteResult = 'cloud' | 'local-only'

/** Serialises full-snapshot writes so two saves can never interleave. */
let writeChain: Promise<unknown> = Promise.resolve()
function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task)
  writeChain = run.catch(() => undefined)
  return run
}

function localCopyOf(data: AppData): AppData {
  return { ...data, settings: { ...data.settings, storage: 'local' } }
}
/**
 * Persists one snapshot.
 *
 * In cloud mode the local copy is written FIRST, so a failed/expired cloud
 * request can never discard the user's edit. After that the cloud write is
 * attempted and any failure is surfaced — it is never swallowed into a
 * reported success.
 *
 * Returns which store actually holds the change, so callers (forms) can tell
 * the user the truth instead of a generic "saved".
 */
async function persistCloudSnapshot(snapshot: AppData): Promise<SaveOutcome> {
  return enqueueWrite(async () => {
    const generation = accountGeneration
    const cloudActive = persistence.snapshot().mode === 'cloud'
    if (isGuestSession()) {
      if (cloudActive) throw new Error('Guest mode cannot write to an authenticated cloud account.')
      const localSnapshot = localCopyOf(snapshot)
      await dataAdapter.save(localSnapshot)
      await persistence.refreshLocalSnapshot(localSnapshot)
      persistenceError = null
      emit()
      return 'local'
    }
    if (cloudActive) markSyncing()
    let localSaved = false
    try {
      if (cloudActive) {
        // Keep the coordinator's snapshot aligned before persisting: persist()
        // aborts (and logs the user out) when the two disagree, which would be
        // a false "session expired" for a healthy session.
        //
        // The account is re-checked immediately before that refresh. If it
        // changed while this write was queued, refreshing would write account
        // A's data into account B's coordinator — cross-account leakage — so
        // we abort instead and keep the edit on this device only.
        if (generation !== accountGeneration) {
          throw new Error('The signed-in account changed before this save started. The change was kept on this device.')
        }
        await dataAdapter.save(localCopyOf(snapshot))
        localSaved = true
        await persistence.refreshCloudSnapshot(snapshot)
      }
      await persistence.persist(snapshot)
      // The write completed, but if the account changed while it was in flight
      // the result is not trustworthy for the store's current owner: the cloud
      // copy it updated belongs to the previous account. Report a failure so
      // nothing marks this as synced.
      if (generation !== accountGeneration) {
        throw new Error('The signed-in account changed while saving. The change was kept on this device.')
      }
      if (!cloudActive) localSaved = true
      persistenceError = null
      cloudSaveError = null
      pendingCloudError = null
      if (cloudActive) { markSynced(); reconcileWithStore() }
      return cloudActive ? 'cloud' : 'local'
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Persistence failed.'
      // Read the mode AFTER the attempt: the coordinator may have downgraded to
      // local (expired session) while the write was in flight.
      const mode = persistence.snapshot().mode
      // A failed LOCAL write is always a real failure, even while a cloud
      // account is active — this branch used to run first and claim
      // "saved on this device" for a write that never reached the device.
      // In cloud mode the device copy is written before the cloud copy, so
      // `localSaved` proves the change survives a reload here.
      if (localSaved && cloudActive && generation === accountGeneration) {
        cloudSaveError = message
        pendingCloudError = message
        markSyncFailed(message)
        emit()
        return 'local'
      } else if (!localSaved && (cloudActive || mode === 'cloud')) {
        cloudSaveError = message
        pendingCloudError = message
        markSyncFailed(message)
      } else {
        persistenceError = message
      }
      emit()
      throw error
    }
  })
}
export function getPersistenceError(): string | null { return cloudSaveError ?? persistenceError }
/**
 * The unresolved cloud-write error, or null when the account copy is current.
 *
 * Non-null means this device holds changes the account does not. The sync
 * indicator must never claim "synced" while this is set.
 */
export function getPendingCloudError(): string | null { return pendingCloudError }
export function getPendingAnnouncementDismissalError(): string | null { return pendingAnnouncementDismissalError }

/**
 * Retries the failed cloud write, and reports success only once it is stored.
 *
 * Re-enters cloud mode first when the previous failure downgraded us to local
 * (an expired session does that), so retrying after signing back in targets the
 * account rather than silently saving locally. Never attaches to a different
 * account than the one that failed.
 */
export async function retryPersistence(): Promise<SaveOutcome> {
  const pendingUserId = persistence.snapshot().userId
  const current = await currentSessionUserId()
  if (!current) throw new Error('Sign in again to send the unsynced changes to your account.')
  if (pendingUserId && current !== pendingUserId) throw new Error('A different account is signed in; sign in as the original account to sync these changes.')
  if (persistence.snapshot().mode !== 'cloud') {
    await authenticateCloudUser(current)
  }
  const outcome = await persistCloudSnapshot(state)
  if (outcome === 'local') throw new Error('Cloud sync is not active, so the changes are saved on this device only.')
  return outcome
}

async function currentSessionUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase.auth.getSession()
  if (error) return null
  return data.session?.user.id ?? null
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

/**
 * Applies an edit and writes it through.
 *
 * On a LOCAL failure the in-memory state is rolled back so the UI agrees with
 * what is stored. On a CLOUD failure the edit is kept: it is already on this
 * device, and discarding it would lose the user's work over a network problem.
 * `pendingCloudError` records that the account copy is behind.
 *
 * No follow-up debounce is scheduled: this write is already complete, and a
 * second full-snapshot write would only duplicate cloud traffic.
 */
async function commitAndPersist(next: AppData): Promise<WriteResult> {
  const previous=state
  const generation=accountGeneration
  if(saveTimer){clearTimeout(saveTimer);saveTimer=null}
  state=next
  emit()
  try {
    const outcome = await persistCloudSnapshot(next)
    return outcome === 'cloud' ? 'cloud' : 'local-only'
  } catch(error){
    if (generation === accountGeneration) {
      state=previous
      if(persistence.snapshot().mode==='local') await persistence.refreshLocalSnapshot(previous).catch(()=>undefined)
      else await persistence.refreshCloudSnapshot(previous).catch(()=>undefined)
    }
    emit()
    throw error
  }
}

export async function initStore(force = false): Promise<void> {
  if (hydrated && !force) return
  hydrated = true
  pendingAnnouncementDismissalError = null
  // A pending debounced write from the PREVIOUS session must not fire after
  // this restore: it would serialise the old in-memory snapshot over the data
  // we are about to load. Cancelling it here is what makes a reload actually
  // observe what was last stored (this was the cause of "read/unread does not
  // survive a restart" and of deletes reappearing).
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
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
    // One-time write-back of normalised task fields (e.g. legacy records with
    // no priority). Hydration fixes the in-memory copy; without this the stored
    // snapshot — and therefore every export — keeps the legacy shape forever.
    // Only written when something is genuinely stale, and only while the store
    // is still in local mode, so a cloud restore that follows can never be
    // overwritten by this snapshot.
    try {
      // The coordinator captured staleness from the RAW snapshot, because
      // initialize() returns an already-hydrated copy where nothing looks stale.
      if (persistence.needsNormalization()) {
        await dataAdapter.save({ ...state, settings: { ...state.settings, storage: 'local' }})
        persistence.clearPendingNormalization()
      }
    } catch { /* storage unavailable: keep the hydrated in-memory state */ }
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
  // A real account session ends any guest session, so guest state can never be
  // carried into (or mistaken for) account data.
  endGuestSession()
  // Any in-flight save belongs to the previous account and must not record its
  // result against this one. Bumping the generation invalidates it.
  accountGeneration += 1
  pendingAnnouncementDismissalError = null
  // A pending deletion belongs to the account that made it. Entering a session
  // (including signing back in) retries it through the next sync, so the error
  // must not outlive this point — otherwise a failure from account A would be
  // rethrown into account B's feed and make B's inbox look broken.
  const next = await persistence.authenticate(userId)
  if(next.error) cloudSaveError=next.error
  else if (next.mode === 'cloud') cloudSaveError = null
  if (next.mode === 'cloud') {
    state = hydrateData(next.data)
    state.settings.storage = 'cloud'
  } else {
    state = hydrateData(next.data)
    state.settings.storage = 'local'
    if (next.migrationRequired) persistenceError = 'Local data is still only on this device. Review and explicitly migrate it before syncing.'
  }
  // CLEAR STALE SERVER ANNOUNCEMENTS FROM THE PREVIOUS ACCOUNT.
  //
  // The local recovery snapshot carries every announcement the signed-out (or
  // previous) account received. Restoring it would show this user another
  // account's inbox and count it in the header badge. Server announcements are
  // re-fetched for this account by syncServerAnnouncements(), so they are
  // dropped here on every authentication.
  state.notifications = state.notifications.filter((item) => item.kind !== 'announcement')
  // Entering or switching to a cloud account starts from a clean cloud state:
  // a pending error from a *different* account must never be shown here.
  if (next.mode === 'cloud') pendingCloudError = null
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
  accountGeneration += 1
  const next = persistence.logout()
  state = hydrateData(next.data)
  // SERVER ANNOUNCEMENTS BELONG TO THE ACCOUNT, NOT TO THE DEVICE.
  //
  // The logout snapshot is the device's local recovery copy, which still holds
  // every announcement the signed-out account received. Leaving them there means
  // the next person to sign in — or a guest — sees another account's inbox, and
  // the unread badge counts it. Announcements are re-fetched for whichever
  // account signs in next, so dropping them here loses nothing.
  state.notifications = state.notifications.filter((item) => item.kind !== 'announcement')
  state.settings.storage = 'local'
  cloudSaveError = null
  persistenceError = null
  // Nothing is pending against an account we are no longer signed in to.
  pendingCloudError = null
  pendingAnnouncementDismissalError = null
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
export async function replaceState(next: AppData): Promise<SaveOutcome> {
  const previous = state
  state = next
  emit()
  try {
    return await persistCloudSnapshot(next)
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

async function withCollectionPersist<K extends CollectionKey>(key:K,updater:(items:AppData[K][number][])=>AppData[K][number][]):Promise<WriteResult>{
  return commitAndPersist({...state,[key]:updater([...(state[key] as AppData[K][number][])])} as AppData)
}

/**
 * Reports where the change landed, in the caller-facing vocabulary.
 *
 * In cloud mode a write that only reached this device must be `'local'` (not
 * `'local-only'`): Settings renders "saved on this device" from that value, and
 * `'cloud'` is reserved for a write the server confirmed.
 */
export async function persistCurrent(): Promise<SaveOutcome> {
  const result = await commitAndPersist(structuredClone(state))
  return result === 'cloud' ? 'cloud' : 'local'
}
export function activePersistenceMode(): 'local'|'cloud' { return persistence.snapshot().mode }

/**
 * Outcome of the most recent mutation.
 *
 * Pages that must report accurately (task creation in particular) read this
 * immediately after their call returns, so a "saved on this device only" state
 * is reported as a warning instead of an error. It is a plain module value
 * rather than part of `AppData` because it is not user data and must never be
 * persisted or synced.
 */
let lastWriteResult: WriteResult = 'local-only'
export function getLastWriteResult(): WriteResult { return lastWriteResult }
/** Test-only reset so a previous case cannot influence the next. */
export function __resetWriteResult(): void { lastWriteResult = 'local-only' }


/* ------------------------------------------------------------------ */
/* Profile & settings                                                  */
/* ------------------------------------------------------------------ */

export async function updateProfile(patch: Partial<Profile>): Promise<void> {
  await commitAndPersist({ ...state, profile:{...state.profile,...patch} })
}

let systemThemeQuery: MediaQueryList | null = null
function applyTheme(theme: Settings['theme']): void {
  if (typeof document === 'undefined') return
  // Some webviews and test environments expose no matchMedia; without it the
  // 'system' preference simply has nothing to follow, so skip quietly rather
  // than throwing during startup.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    const isDark = theme === 'dark'
    if (isDark) document.documentElement.dataset.theme = 'dark'
    else delete document.documentElement.dataset.theme
    return
  }
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
  // THEME IS APPLIED FIRST, SYNCHRONOUSLY.
  //
  // The previous order was `await commitAndPersist(...)` then `applyTheme(...)`,
  // which meant the colour change waited for a localStorage write and, in cloud
  // mode, for a network round-trip — the app sat unchanged for hundreds of
  // milliseconds after the toggle was pressed. Theme is a pure CSS-variable
  // swap on `document.documentElement`, so it costs nothing and must lead.
  // The write still happens; it simply no longer gates the repaint.
  if (patch.theme !== undefined) applyTheme(next.theme)
  await commitAndPersist({ ...state, settings:next })
  if (patch.theme === undefined) applyTheme(next.theme)
}

/* ------------------------------------------------------------------ */
/* Alarms (reminders) — CRUD                                           */
/* ------------------------------------------------------------------ */

export interface NewAlarm {
  label: string
  time: string
  /** `YYYY-MM-DD` for a one-off alarm; null/absent for a daily alarm. */
  date?: string | null
  tone?: ReminderTone | null
  enabled?: boolean
}

/**
 * Adds an alarm.
 *
 * Alarms live in `settings.reminders`, which is already persisted and synced
 * per account — so no new table, no migration and no risk to existing data.
 * A new alarm is appended, never replacing the seeded ones.
 */
export async function createAlarm(input: NewAlarm): Promise<ReminderPreference> {
  const label = input.label.trim().slice(0, 40)
  if (!label) throw new Error('An alarm needs a name.')
  // Validate the RANGE, not just the shape: "25:99" matches the pattern but is
  // not a time, and would otherwise be stored and then silently fail to
  // schedule. This mirrors `parseTime` in the reminder scheduler.
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(input.time.trim())
  const hours = timeMatch ? Number(timeMatch[1]) : -1
  const minutes = timeMatch ? Number(timeMatch[2]) : -1
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) throw new Error('An alarm needs a valid time.')
  const time = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  const alarm: ReminderPreference = {
    id: createId('alm'),
    label,
    time,
    enabled: input.enabled ?? true,
    tone: input.tone ?? 'default',
    date: input.date ?? null,
  }
  const reminders = [...state.settings.reminders, alarm]
  await commitAndPersist({ ...state, settings: { ...state.settings, reminders, notificationsOptIn: true } })
  return alarm
}

/** Edits an alarm in place; unknown ids are a no-op rather than an error. */
export async function updateAlarm(id: string, patch: Partial<NewAlarm> & { enabled?: boolean }): Promise<void> {
  const current = state.settings.reminders.find((reminder) => reminder.id === id)
  if (!current) return
  const next: ReminderPreference = {
    ...current,
    ...(patch.label !== undefined ? { label: patch.label.trim().slice(0, 40) || current.label } : {}),
    ...(patch.time !== undefined ? { time: patch.time } : {}),
    ...(patch.date !== undefined ? { date: patch.date } : {}),
    ...(patch.tone !== undefined ? { tone: patch.tone } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
  }
  const reminders = state.settings.reminders.map((reminder) => reminder.id === id ? next : reminder)
  await commitAndPersist({ ...state, settings: { ...state.settings, reminders, notificationsOptIn: reminders.some((r) => r.enabled) } })
}

/** Deletes an alarm. The native schedule is cancelled by the following sync. */
export async function deleteAlarm(id: string): Promise<void> {
  const reminders = state.settings.reminders.filter((reminder) => reminder.id !== id)
  if (reminders.length === state.settings.reminders.length) return
  await commitAndPersist({ ...state, settings: { ...state.settings, reminders, notificationsOptIn: reminders.some((r) => r.enabled) } })
}

/* ------------------------------------------------------------------ */
/* Subjects                                                            */
/* ------------------------------------------------------------------ */

export type NewSubject = Omit<Subject, keyof Timestamped | 'id'>

export async function createSubject(input: NewSubject): Promise<Subject> {
  // Reuse an existing subject with the same normalised name (including an
  // archived one) instead of creating a near-duplicate. This mirrors the
  // database's user-scoped unique index, so a second device — or a snapshot
  // merged from another device — converges on one record rather than two.
  const existing = findSubjectIncludingArchived(state.subjects, input.name)
  if (existing) return existing
  const item = { ...(input as object), name: cleanSubjectName(input.name), id: createId('sub'), createdAt: nowIso(), updatedAt: nowIso() } as Subject
  await withCollectionPersist('subjects', items => [...items, item])
  return item
}

export async function updateSubject(id: string, patch: Partial<Subject>): Promise<void> {
  if (patch.name) {
    const clash = state.subjects.find((subject) => subject.id !== id && subjectNameKey(subject.name) === subjectNameKey(patch.name as string))
    if (clash) throw new SubjectDuplicateError(clash.id)
  }
  const next = patch.name ? { ...patch, name: cleanSubjectName(patch.name) } : patch
  await withCollectionPersist('subjects', items => items.map(item => item.id === id ? { ...item, ...next, updatedAt: nowIso() } : item))
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

/**
 * Whether the deployed database accepts `urgent` in `tasks.priority`.
 *
 * Origin: migration 001 created the CHECK with only low/medium/high, so this
 * flag let the client fail loudly instead of downgrading urgent to high (which
 * would silently destroy the student's choice).
 *
 * STATE AS OF THIS RELEASE: migration 005 is APPLIED on production and the
 * live constraint is `priority = ANY (ARRAY['urgent','high','medium','low'])`,
 * verified read-only against warepmhybetvjzgvpuqf. The flag is therefore true.
 *
 * The guard below is intentionally retained: it still catches an unsupported
 * value (rather than letting a whole snapshot upsert fail with an opaque 400),
 * and it remains the single switch to flip back if this code is ever pointed at
 * a database that has not had 005 applied.
 */
export const URGENT_PRIORITY_SUPPORTED = true
/**
 * Rejects a task write whose priority the server cannot store.
 *
 * The database CHECK allows urgent/high/medium/low once 005 is applied. This
 * validation runs on every write path (not only the form) so no code path can
 * enqueue a value the server will refuse, and it names the exact problem
 * instead of failing the whole snapshot with an opaque 400.
 */
function assertWritableTask(task: { priority?: unknown; title?: unknown }): void {
  if (!isTaskPriority(task.priority)) {
    throw new Error(`Unsupported task priority: ${String(task.priority)}. Use urgent, high, medium or low.`)
  }
  if (task.priority === 'urgent' && !URGENT_PRIORITY_SUPPORTED) {
    throw new Error('Urgent priority is not enabled on the server yet. Choose High for now, or ask the owner to apply migration 005.')
  }
  if (typeof task.title !== 'string' || !task.title.trim()) throw new Error('A task needs a title.')
}

/** Every task write normalises its payload to the values the database accepts. */
function withWritableTasks(tasks: Task[]): Task[] {
  return tasks.map((task) => ({ ...task, priority: normalizeTaskPriority(task.priority) }))
}

  /**
 * Creates a task.
 *
 * Returns the created task AND how the write landed. The second value is what
 * lets a caller distinguish "on this device only" from a hard failure without
 * re-deriving it from two separate error globals.
 */
export async function createTask(input: NewTask): Promise<Task & { writeResult: WriteResult }> {
  assertWritableTask(input)
  if (!input.dueDate) throw new Error('A task needs a due date.')
  const stamp=nowIso(),item={...(input as object),completed:false,completedAt:null,id:createId('tsk'),createdAt:stamp,updatedAt:stamp} as Task
  // Copy the caller's object so the form's draft is never mutated by a save.
  // The write outcome travels WITH the returned task so the caller can say
  // "saved on this device" instead of erroring for a task that is on screen.
  const outcome = await withCollectionPersist('tasks',items=>withWritableTasks([...items,item]))
  lastWriteResult = outcome
  return { ...item, writeResult: outcome }
}

export async function updateTask(id: string, patch: Partial<Task>): Promise<WriteResult> {
  if ('priority' in patch) assertWritableTask({ priority: patch.priority, title: patch.title ?? 'unchanged' })
  lastWriteResult = await withCollectionPersist('tasks',items=>withWritableTasks(items.map(item=>item.id===id?{...item,...patch,updatedAt:nowIso()}:item)))
  return lastWriteResult
}

export async function setTaskCompleted(id: string, completed: boolean): Promise<WriteResult> {
  const completedAt=completed?nowIso():null
  lastWriteResult = await withCollectionPersist('tasks',items=>withWritableTasks(items.map(item=>item.id===id?{...item,completed,completedAt,updatedAt:nowIso()}:item)))
  return lastWriteResult
}

export async function deleteTask(id: string): Promise<WriteResult> {
  lastWriteResult = await withCollectionPersist('tasks',items=>items.filter(item=>item.id!==id))
  return lastWriteResult
}

/** Pushes a task's due date forward — used by "أجّليها لبكرة". */
export async function rescheduleTask(id: string, dueDate: string): Promise<WriteResult> { return updateTask(id,{dueDate}) }

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

/**
 * Rejects an exam whose timestamp the database would not store as a moment.
 *
 * `exam_dates.exam_at` is `timestamptz not null`; an empty or unparsable
 * string is rejected server-side with a constraint error that is useless to a
 * student. Validating here turns it into a precise message, and guarantees no
 * invalid Date ever reaches the UI through persisted state.
 */
function assertWritableExam(exam: { title?: unknown; examAt?: unknown }): void {
  if (typeof exam.title !== 'string' || !exam.title.trim()) throw new Error('An exam needs a title.')
  const when = typeof exam.examAt === 'string' ? toValidDate(exam.examAt) : null
  if (!when) throw new Error('An exam needs a valid date and time.')
}

export async function createExam(input: NewExamDate): Promise<ExamDate> { assertWritableExam(input); const stamp=nowIso(),item={...(input as object),timezone:'Africa/Cairo',id:createId('exam'),createdAt:stamp,updatedAt:stamp} as ExamDate; await withCollectionPersist('exams',items=>[...items,item]); return item }
export async function updateExam(id: string, patch: Partial<ExamDate>): Promise<void> {
  const current = state.exams.find((exam) => exam.id === id)
  const merged = { title: patch.title ?? current?.title, examAt: patch.examAt ?? current?.examAt }
  assertWritableExam(merged)
  await withCollectionPersist('exams',items=>items.map(item=>item.id===id?{...item,...patch,updatedAt:nowIso()}:item))
}
export async function deleteExam(id: string): Promise<void> { await withCollectionPersist('exams',items=>items.filter(item=>item.id!==id)) }

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

/**
 * NOTIFICATION MODEL — behaviour notes.
 *
 * The existing model (`AppNotification` in types/index.ts) already carries a
 * stable id, title, body, kind, `at` timestamp and read state, and it is owned
 * per-user: local mode writes to this device's snapshot and cloud mode writes
 * through RLS-scoped tables. No new table is needed for it, so none was added.
 *
 * The three reported defects had one shared cause: every mutation went through
 * the debounced snapshot write, so (a) a delete looked applied but a later
 * snapshot could resurrect it, and (b) marking read could be overwritten by a
 * stale snapshot arriving from the server. Mutations now:
 *   - apply to memory IMMEDIATELY so the UI reacts on the same frame,
 *   - write through `commitAndPersist` (awaited), and
 *   - ROLL BACK on a genuine failure so the item returns instead of vanishing,
 *     and report the result to the caller so no toast is shown before the
 *     server has confirmed it.
 */

export type NewNotification = {
  kind: AppNotificationKind
  title: string
  body: string
  at?: string
  read?: boolean
  /** Optional destination the notification refers to, for "open" actions. */
  href?: string
}

export type NotificationWriteResult = WriteResult | 'local-pending'

function announcementDismissalKey(userId: string): string {
  return `alhelm.v1.announcementDismissals.${userId}`
}

function getQueuedAnnouncementDismissals(userId: string): string[] {
  const raw = window.localStorage.getItem(announcementDismissalKey(userId))
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Pending announcement deletions could not be read from this device.')
  }
  if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string')) {
    throw new Error('Pending announcement deletions on this device are invalid.')
  }
  return [...new Set(parsed as string[])]
}

function queueAnnouncementDismissals(userId: string, ids: string[]): void {
  const pending = new Set(getQueuedAnnouncementDismissals(userId))
  for (const id of ids) pending.add(id)
  window.localStorage.setItem(announcementDismissalKey(userId), JSON.stringify([...pending]))
}

function removeQueuedAnnouncementDismissals(userId: string, ids: string[]): void {
  const removed = new Set(ids)
  const pending = getQueuedAnnouncementDismissals(userId).filter((id) => !removed.has(id))
  if (pending.length) window.localStorage.setItem(announcementDismissalKey(userId), JSON.stringify(pending))
  else window.localStorage.removeItem(announcementDismissalKey(userId))
}

async function flushQueuedAnnouncementDismissals(userId: string): Promise<boolean> {
  const pending = getQueuedAnnouncementDismissals(userId)
  let lastError: unknown = null
  for (let offset = 0; offset < pending.length; offset += 100) {
    const batch = pending.slice(offset, offset + 100)
    try {
      await dismissAnnouncements(batch)
      removeQueuedAnnouncementDismissals(userId, batch)
    } catch (error) {
      lastError = error
    }
  }
  pendingAnnouncementDismissalError = lastError instanceof Error
    ? lastError.message
    : lastError ? 'Announcement deletion could not be synced.' : null
  return lastError === null
}

/**
 * Adds an in-app notification.
 *
 * Fire-and-forget on purpose: notifications are generated by user actions
 * (completing a task, saving a drawing) that must not fail because the notice
 * could not be stored. The item is in memory immediately, so the badge updates
 * without waiting for a write.
 */
export function pushNotification(input: NewNotification): AppNotification {
  const stamp=nowIso(),item={id:createId('ntf'),kind:input.kind,title:input.title,body:input.body,at:input.at??stamp,read:input.read??false,createdAt:stamp,updatedAt:stamp} as AppNotification
  commit({...state,notifications:[...state.notifications,item]})
  return item
}

/**
 * Adds an in-app notification and keeps the returned promise.
 *
 * Use this when the caller needs the notification to be DURABLE before doing
 * anything else (e.g. a flow that immediately reloads). `pushNotification`
 * stays fire-and-forget for the common case, where the item is already in
 * memory and the debounced write is enough.
 *
 * The item is in memory immediately in both variants, so the badge never waits
 * on the network.
 */
export async function addNotification(input: NewNotification): Promise<AppNotification> {
  const stamp=nowIso(),item={id:createId('ntf'),kind:input.kind,title:input.title,body:input.body,at:input.at??stamp,read:input.read??false,createdAt:stamp,updatedAt:stamp} as AppNotification
  await commitAndPersist({ ...state, notifications: [...state.notifications, item] })
  return item
}

/**
 * Marks one notification read/unread.
 *
 * Resolves only after the change is persisted, so a caller can tell the user the
 * truth and so a restart cannot lose it. Rolls back on failure.
 */
export async function markNotificationRead(id: string, read: boolean): Promise<WriteResult> {
  const previous = state.notifications
  const next = previous.map((item) => item.id === id ? { ...item, read, updatedAt: nowIso() } : item)
  if (next.every((item, index) => item === previous[index])) return 'local-only'
  try {
    return await commitAndPersist({ ...state, notifications: next })
  } catch (error) {
    // Nothing was stored: restore the previous read state so the UI does not
    // show something a restart would contradict.
    state = { ...state, notifications: previous }
    emit()
    if (persistence.snapshot().mode === 'local') throw error
    return 'local-only'
  }
}

export async function markAllNotificationsRead(): Promise<WriteResult> {
  const previous = state.notifications
  if (previous.every((item) => item.read)) return 'local-only'
  return commitAndPersist({ ...state, notifications: previous.map((item) => item.read ? item : { ...item, read: true, updatedAt: nowIso() }) })
}

/**
 * Deletes one notification.
 *
 * The item disappears immediately and is RESTORED when the write did not reach
 * the server — a failed delete must not look successful, and must not leave the
 * list showing fewer items than the server holds.
 *
 * WHY THE RESTORE KEYS OFF THE RESULT, NOT AN EXCEPTION: `commitAndPersist`
 * deliberately does not throw on a cloud failure (it keeps the edit and returns
 * `'local-only'`). For an edit that is right; for a delete it would leave the
 * item removed from memory while the server still has it. So a plain deletion
 * is re-applied from the previous list whenever the outcome is not a confirmed
 * cloud write and we are not in local mode (in local mode a failure throws and
 * the caller gets a real error).
 */
export async function deleteNotification(id: string): Promise<NotificationWriteResult> {
  const previous = state.notifications
  const next = previous.filter((item) => item.id !== id)
  if (next.length === previous.length) return 'local-only'
  const item = previous.find((notification) => notification.id === id)
  const isAnnouncement = item?.kind === 'announcement' && item.id.startsWith('ann-')
  let dismissalPending = false
  if (isAnnouncement) {
    const userId = persistence.snapshot().userId
    if (!userId) throw new Error('Sign in to delete this account announcement.')
    queueAnnouncementDismissals(userId, [item.id.slice(4)])
    dismissalPending = !(await flushQueuedAnnouncementDismissals(userId))
  }
  try {
    const outcome = await commitAndPersist({ ...state, notifications: next })
    // A QUEUED dismissal is a real, durable deletion: it is recorded per account
    // in device storage and retried on the next sync. Restoring the item just
    // because the local write was not a cloud write is what made a deleted
    // announcement reappear — and the queue already prevents re-insertion.
    // Only a non-announcement that the server refused to forget is put back.
    if (!isAnnouncement && outcome !== 'cloud' && persistence.snapshot().mode !== 'local') {
      state = { ...state, notifications: previous }
      emit()
    }
    return dismissalPending ? 'local-pending' : outcome
  } catch (error) {
    state = { ...state, notifications: previous }
    emit()
    throw error
  }
}

/**
 * Removes every in-app notification.
 *
 * Server announcements are NOT deleted here: the delivery row belongs to the
 * account and clearing the in-app list must not erase the record that the
 * announcement was received. Locally-mirrored announcement entries are cleared
 * from the list like any other item.
 */
export async function clearNotifications(): Promise<NotificationWriteResult> {
  const announcementIds = state.notifications
    .filter((item) => item.kind === 'announcement' && item.id.startsWith('ann-'))
    .map((item) => item.id.slice(4))
  let dismissalPending = false
  if (announcementIds.length) {
    const userId = persistence.snapshot().userId
    if (!userId) throw new Error('Sign in to clear account announcements.')
    queueAnnouncementDismissals(userId, announcementIds)
    dismissalPending = !(await flushQueuedAnnouncementDismissals(userId))
  }
  const outcome = await commitAndPersist({ ...state, notifications: [] })
  return dismissalPending ? 'local-pending' : outcome
}

/* ------------------------------------------------------------------ */
/* Server announcements                                                */
/* ------------------------------------------------------------------ */

/**
 * Pull the signed-in user's server announcements into the local notifications
 * collection. Adds any announcement not yet mirrored locally (matched by id
 * prefix 'ann-<announcementId>'), and marks them read both locally and on the
 * server when the user marks them read. Safe to call repeatedly; no-ops when
 * the backend isn't configured or the user isn't signed in.
 *
 * READ STATE IS MONOTONIC — THE BUG THIS FIXES
 *   The previous version only ever APPENDED missing rows. For an announcement
 *   already mirrored locally it did nothing, so:
 *     - a locally-confirmed "read" was kept (fine), but
 *     - a read performed on ANOTHER device was never picked up (stale),
 *   and the obvious "fix" of trusting the server would overwrite a read the
 *   user had just made here, because the read request is fire-and-forget and
 *   the refresh can land first.
 *
 *   Reading is now a one-way latch: `read` can be turned ON by either side and
 *   is never turned OFF by a sync. That is the only rule that is correct for
 *   both cases without a per-row version column — the server cannot tell us
 *   "the user un-read this", because that action does not exist.
 */
export async function syncServerAnnouncements(): Promise<number> {
  if (!supabase || isGuestSession()) return 0
  const userId = persistence.snapshot().userId
  // Announcements belong to a VERIFIED account. A coordinator that never
  // authenticated anyone (userId is null) must not read a feed; one that
  // authenticated and then downgraded still has a verified userId and its
  // dismissal queue is scoped to that account, so it syncs normally.
  if (!userId) return 0
  await flushQueuedAnnouncementDismissals(userId)
  const response = await getAnnouncementFeed()
  const feed: AnnouncementFeedRow[] = response.feed
  const dismissedIds = new Set([
    ...(response.dismissedIds ?? []),
    ...getQueuedAnnouncementDismissals(userId),
  ])

  const kept = state.notifications.filter((item) => (
    item.kind !== 'announcement'
    || !item.id.startsWith('ann-')
    || !dismissedIds.has(item.id.slice(4))
  ))
  const removed = state.notifications.length - kept.length
  const byId = new Map(kept.map((item) => [item.id, item]))
  const added: AppNotification[] = []
  const readUpdates = new Set<string>()

  for (const row of feed) {
    // A row this account has already deleted must NEVER be re-inserted, even
    // while the deletion is still queued because the server did not confirm it.
    // The queue is the local source of truth for "deleted here"; skipping it
    // here is what stops a deleted announcement from coming back on the next
    // sync (the reported "deleted notifications return" defect).
    if (dismissedIds.has(row.id)) continue
    const localId = `ann-${row.id}`
    const existing = byId.get(localId)
    const serverRead = row.readAt !== null
    if (!existing) {
      const stamp = nowIso()
      added.push({
        id: localId,
        kind: 'announcement',
        title: row.title,
        body: row.body,
        at: row.deliveredAt || row.createdAt,
        read: serverRead,
        createdAt: stamp,
        updatedAt: stamp,
      })
      continue
    }
    // Already mirrored: adopt the server's read state ONLY when it is true, so
    // a read made on another device propagates but a read made here is never
    // undone by a racing refresh.
    if (serverRead && !existing.read) readUpdates.add(localId)
  }

  if (added.length === 0 && readUpdates.size === 0 && removed === 0) {
    return 0
  }

  const next = kept.map((item) => (
    readUpdates.has(item.id) ? { ...item, read: true, updatedAt: nowIso() } : item
  ))
  // The local list changes and the REST of the inbox stays usable; the pending
  // deletion is reported separately. Throwing here would make a successful
  // refresh look like a failed one and would abort the caller's follow-up work
  // (such as routing a tapped announcement), which is what made an offline
  // delete look like a broken inbox.
  await commitAndPersist({ ...state, notifications: [...next, ...added] })
  return added.length + readUpdates.size + removed
}

/** Mark an announcement read in both local state and on the server. */
export async function markAnnouncementReadEverywhere(announcementId: string): Promise<void> {
  const localId = `ann-${announcementId}`
  // Local first so the badge updates on this frame; the server call is awaited
  // afterwards so a failure is surfaced rather than reported as success.
  await withCollectionPersist('notifications', (items) => items.map((item) => (item.id === localId ? { ...item, read: true, updatedAt: nowIso() } : item)))
  const result = await markAnnouncementRead(announcementId)
  if (!result.ok) throw new Error('The announcement could not be marked as read on the server.')
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
