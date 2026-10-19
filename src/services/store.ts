/**
 * Application store.
 *
 * A tiny, dependency-free external store built on React's `useSyncExternalStore`.
 * It is the only module that talks to the persistence adapter; components read
 * state and dispatch actions through the hooks at the bottom of this file.
 *
 * Phase 2: replace `persist()` with debounced repository writes against
 * Supabase. The action signatures below stay identical, so no UI changes.
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
  JournalEntry,
  Profile,
  Settings,
  StudySession,
  Subject,
  Task,
  Timestamped,
} from '../types'
import { dataAdapter } from './persistence/adapter'
import { createId, nowIso } from './persistence/repository'
import { createInitialData, hydrateData } from './domain'

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

/** Debounced write-through so rapid edits do not thrash localStorage. */
function schedulePersist(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void dataAdapter.save(state)
  }, 220)
}

function commit(next: AppData): void {
  state = next
  emit()
  schedulePersist()
}

/** Loads the stored snapshot exactly once, before the first render settles. */
export async function initStore(): Promise<void> {
  if (hydrated) return
  hydrated = true
  try {
    const stored = await dataAdapter.load()
    state = hydrateData(stored)
  } catch {
    state = createInitialData()
  }
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

/** Used by "استعادة النسخة" in settings and by tests. */
export function replaceState(next: AppData): void {
  commit(next)
}

export async function resetAllData(): Promise<void> {
  await dataAdapter.clear()
  commit(createInitialData())
}

/* ------------------------------------------------------------------ */
/* Generic collection actions                                          */
/* ------------------------------------------------------------------ */

function withCollection<K extends CollectionKey>(
  key: K,
  updater: (items: AppData[K][number][]) => AppData[K][number][],
): void {
  const items = state[key] as AppData[K][number][]
  commit({ ...state, [key]: updater([...items]) } as AppData)
}

function addItem<K extends CollectionKey>(
  key: K,
  input: Omit<AppData[K][number], 'id' | 'createdAt' | 'updatedAt'>,
  idPrefix: string,
): AppData[K][number] {
  const stamp = nowIso()
  const item = {
    ...(input as object),
    id: createId(idPrefix),
    createdAt: stamp,
    updatedAt: stamp,
  } as AppData[K][number]
  withCollection<K>(key, (items) => [...items, item])
  return item
}

function updateItem<K extends CollectionKey>(
  key: K,
  id: string,
  patch: Partial<AppData[K][number]>,
): void {
  withCollection<K>(key, (items) =>
    items.map((item) =>
      (item as { id: string }).id === id
        ? ({ ...item, ...(patch as object), updatedAt: nowIso() } as AppData[K][number])
        : item,
    ),
  )
}

function removeItem<K extends CollectionKey>(key: K, id: string): void {
  withCollection<K>(key, (items) =>
    items.filter((item) => (item as { id: string }).id !== id),
  )
}

/* ------------------------------------------------------------------ */
/* Profile & settings                                                  */
/* ------------------------------------------------------------------ */

export function updateProfile(patch: Partial<Profile>): void {
  commit({ ...state, profile: { ...state.profile, ...patch } })
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

export function updateSettings(patch: Partial<Settings>): void {
  const next = { ...state.settings, ...patch }
  applyTheme(next.theme)
  commit({ ...state, settings: next })
}

/* ------------------------------------------------------------------ */
/* Subjects                                                            */
/* ------------------------------------------------------------------ */

export type NewSubject = Omit<Subject, keyof Timestamped | 'id'>

export function createSubject(input: NewSubject): Subject {
  return addItem('subjects', input, 'sub') as Subject
}

export function updateSubject(id: string, patch: Partial<Subject>): void {
  updateItem('subjects', id, patch)
}

/** Removing a subject also detaches it from sessions and tasks (no orphans). */
export function deleteSubject(id: string): void {
  commit({
    ...state,
    subjects: state.subjects.filter((subject) => subject.id !== id),
    sessions: state.sessions.map((session) =>
      session.subjectId === id ? { ...session, subjectId: null } : session,
    ),
    tasks: state.tasks.map((task) =>
      task.subjectId === id ? { ...task, subjectId: null } : task,
    ),
    focusSessions: state.focusSessions.map((entry) =>
      entry.subjectId === id ? { ...entry, subjectId: null } : entry,
    ),
  })
}

/* ------------------------------------------------------------------ */
/* Study sessions                                                      */
/* ------------------------------------------------------------------ */

export type NewStudySession = Omit<StudySession, keyof Timestamped | 'id'>

export function createSession(input: NewStudySession): StudySession {
  return addItem('sessions', input, 'ses') as StudySession
}

export function updateSession(id: string, patch: Partial<StudySession>): void {
  updateItem('sessions', id, patch)
}

export function deleteSession(id: string): void {
  removeItem('sessions', id)
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

export type NewTask = Omit<Task, keyof Timestamped | 'id' | 'completedAt' | 'completed'>

export function createTask(input: NewTask): Task {
  return addItem('tasks', { ...input, completed: false, completedAt: null }, 'tsk') as Task
}

export function updateTask(id: string, patch: Partial<Task>): void {
  updateItem('tasks', id, patch)
}

export function setTaskCompleted(id: string, completed: boolean): void {
  updateItem('tasks', id, { completed, completedAt: completed ? nowIso() : null })
}

export function deleteTask(id: string): void {
  removeItem('tasks', id)
}

/** Pushes a task's due date forward — used by "أجّليها لبكرة". */
export function rescheduleTask(id: string, dueDate: string): void {
  updateItem('tasks', id, { dueDate })
}

/* ------------------------------------------------------------------ */
/* Focus sessions                                                      */
/* ------------------------------------------------------------------ */

export type NewFocusSession = Omit<FocusSession, keyof Timestamped | 'id'>

export function recordFocusSession(input: NewFocusSession): FocusSession {
  return addItem('focusSessions', input, 'fcs') as FocusSession
}

export function deleteFocusSession(id: string): void {
  removeItem('focusSessions', id)
}

/* ------------------------------------------------------------------ */
/* Journal                                                             */
/* ------------------------------------------------------------------ */

export type NewJournalEntry = Omit<JournalEntry, keyof Timestamped | 'id'>

export function createJournalEntry(input: NewJournalEntry): JournalEntry {
  return addItem('journal', input, 'jrn') as JournalEntry
}

export function updateJournalEntry(id: string, patch: Partial<JournalEntry>): void {
  updateItem('journal', id, patch)
}

export function deleteJournalEntry(id: string): void {
  removeItem('journal', id)
}

/* ------------------------------------------------------------------ */
/* Artistic goals                                                      */
/* ------------------------------------------------------------------ */

export type NewArtisticGoal = Omit<ArtisticGoal, keyof Timestamped | 'id' | 'completed' | 'completedAt'>

export function createGoal(input: NewArtisticGoal): ArtisticGoal {
  return addItem('goals', { ...input, completed: false, completedAt: null }, 'goal') as ArtisticGoal
}

export function updateGoal(id: string, patch: Partial<ArtisticGoal>): void {
  updateItem('goals', id, patch)
}

export function setGoalCompleted(id: string, completed: boolean): void {
  updateItem('goals', id, { completed, completedAt: completed ? nowIso() : null })
}

export function deleteGoal(id: string): void {
  removeItem('goals', id)
}

/* ------------------------------------------------------------------ */
/* Artworks                                                            */
/* ------------------------------------------------------------------ */

export type NewArtwork = Omit<Artwork, keyof Timestamped | 'id'>

export function createArtwork(input: NewArtwork): Artwork {
  return addItem('artworks', input, 'art') as Artwork
}

export function updateArtwork(id: string, patch: Partial<Artwork>): void {
  updateItem('artworks', id, patch)
}

export function deleteArtwork(id: string): void {
  removeItem('artworks', id)
}

/* ------------------------------------------------------------------ */
/* Drawing challenges                                                  */
/* ------------------------------------------------------------------ */

export type NewDrawingChallenge = Omit<DrawingChallenge, keyof Timestamped | 'id' | 'completed' | 'completedAt'>

export function createChallenge(input: NewDrawingChallenge): DrawingChallenge {
  return addItem('challenges', { ...input, completed: false, completedAt: null }, 'chal') as DrawingChallenge
}

export function updateChallenge(id: string, patch: Partial<DrawingChallenge>): void {
  updateItem('challenges', id, patch)
}

export function setChallengeCompleted(id: string, completed: boolean): void {
  updateItem('challenges', id, { completed, completedAt: completed ? nowIso() : null })
}

export function deleteChallenge(id: string): void {
  removeItem('challenges', id)
}

/* ------------------------------------------------------------------ */
/* Future letters                                                      */
/* ------------------------------------------------------------------ */

export type NewFutureLetter = Omit<FutureLetter, keyof Timestamped | 'id'>

export function createLetter(input: NewFutureLetter): FutureLetter {
  return addItem('letters', input, 'ltr') as FutureLetter
}

export function updateLetter(id: string, patch: Partial<FutureLetter>): void {
  updateItem('letters', id, patch)
}

export function deleteLetter(id: string): void {
  removeItem('letters', id)
}

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
  return addItem(
    'notifications',
    {
      kind: input.kind,
      title: input.title,
      body: input.body,
      at: input.at ?? nowIso(),
      read: input.read ?? false,
    },
    'ntf',
  ) as AppNotification
}

export function markNotificationRead(id: string, read: boolean): void {
  updateItem('notifications', id, { read })
}

export function markAllNotificationsRead(): void {
  withCollection('notifications', (items) =>
    items.map((item) => (item.read ? item : { ...item, read: true, updatedAt: nowIso() })),
  )
}

export function deleteNotification(id: string): void {
  removeItem('notifications', id)
}

export function clearNotifications(): void {
  withCollection('notifications', () => [])
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
