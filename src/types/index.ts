/**
 * الحُلم — shared domain contracts.
 *
 * These types are the single source of truth for both the Phase 1 local
 * persistence adapter and the Phase 2 Supabase tables. Keep field names
 * aligned with the eventual database columns (camelCase in TS, snake_case in
 * SQL — the mapping lives in the repositories, never in components).
 */

/* ------------------------------------------------------------------ */
/* Identifiers                                                         */
/* ------------------------------------------------------------------ */

export type Id = string

export interface Timestamped {
  createdAt: string
  updatedAt: string
}

export type Entity<T> = T & { id: Id } & Timestamped

/* ------------------------------------------------------------------ */
/* Profile & preferences                                               */
/* ------------------------------------------------------------------ */

export type ThemePreference = 'light' | 'dark' | 'system'
export type LanguagePreference = 'en' | 'ar'

export interface Profile {
  displayName: string
  /** Optional short self-description shown on the dream board. */
  motto: string
  /** ISO date the student started preparing, used for streak copy. */
  journeyStart: string
  avatarSeed: string
}

export interface ReminderPreference {
  id: Id
  label: string
  /** HH:mm in 24h format, Egypt local time. */
  time: string
  enabled: boolean
}

export interface Settings {
  theme: ThemePreference
  language: LanguagePreference
  /** Focus block length in minutes. */
  focusMinutes: number
  /** Short break length in minutes. */
  shortBreakMinutes: number
  /** Long break length in minutes. */
  longBreakMinutes: number
  /** How many focus blocks before a long break. */
  longBreakEvery: number
  soundEnabled: boolean
  customMotivation: string
  reminders: ReminderPreference[]
  /**
   * Where these preferences currently live. Phase 2 flips this to 'cloud'
   * once Supabase is wired up.
   */
  storage: 'local' | 'cloud'
}

/* ------------------------------------------------------------------ */
/* Subjects                                                            */
/* ------------------------------------------------------------------ */

export interface Subject extends Timestamped {
  id: Id
  name: string
  /** Design-token colour key, resolved through `subjectColors`. */
  color: SubjectColorKey
  notes: string
  /** Weekly study target in minutes. 0 means "no target". */
  weeklyTargetMinutes: number
  archived: boolean
}

export type SubjectColorKey =
  | 'terracotta'
  | 'sage'
  | 'blush'
  | 'dustyBlue'
  | 'beige'
  | 'charcoal'
  | 'amber'
  | 'plum'

/* ------------------------------------------------------------------ */
/* Study sessions                                                      */
/* ------------------------------------------------------------------ */

export type SessionType = 'study' | 'lesson' | 'revision' | 'homework' | 'exam'

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6 // Sunday-first, Egypt convention

export interface StudySession extends Timestamped {
  id: Id
  title: string
  subjectId: Id | null
  /** 'weekly' repeats every `weekday`; 'once' happens on `date`. */
  recurrence: 'weekly' | 'once'
  weekday: Weekday
  /** yyyy-mm-dd, only meaningful when recurrence is 'once'. */
  date: string
  /** HH:mm */
  startTime: string
  /** HH:mm, must be strictly after startTime. */
  endTime: string
  type: SessionType
  notes: string
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

export type TaskPriority = 'low' | 'medium' | 'high'

export type TaskCategory =
  | 'study'
  | 'homework'
  | 'revision'
  | 'practice'
  | 'art'
  | 'other'

export interface Task extends Timestamped {
  id: Id
  title: string
  description: string
  subjectId: Id | null
  /** yyyy-mm-dd */
  dueDate: string
  /** HH:mm or '' when no specific time. */
  dueTime: string
  priority: TaskPriority
  category: TaskCategory
  /** Estimated effort in minutes. */
  estimatedMinutes: number
  completed: boolean
  completedAt: string | null
}

/* ------------------------------------------------------------------ */
/* Focus sessions                                                      */
/* ------------------------------------------------------------------ */

export type FocusSessionKind = 'focus' | 'shortBreak' | 'longBreak'

export interface FocusSession extends Timestamped {
  id: Id
  subjectId: Id | null
  taskId: Id | null
  kind: FocusSessionKind
  /** Planned length in minutes. */
  plannedMinutes: number
  /** Actually elapsed minutes. Only ever written when a block completes. */
  actualMinutes: number
  /** yyyy-mm-dd */
  date: string
  completedAt: string
}

/* ------------------------------------------------------------------ */
/* Journal                                                             */
/* ------------------------------------------------------------------ */

export interface JournalEntry extends Timestamped {
  id: Id
  title: string
  body: string
  /** Free-form mood tag chosen by the student. */
  mood: string
  /** yyyy-mm-dd */
  date: string
  pinned: boolean
}

/* ------------------------------------------------------------------ */
/* Dream studio                                                        */
/* ------------------------------------------------------------------ */

export interface ArtisticGoal extends Timestamped {
  id: Id
  title: string
  description: string
  /** yyyy-mm-dd or '' when the goal is open-ended. */
  targetDate: string
  completed: boolean
  completedAt: string | null
}

export interface Artwork extends Timestamped {
  id: Id
  title: string
  description: string
  medium: string
  /** yyyy-mm-dd */
  date: string
  /**
   * Phase 1 stores an object URL / data URL produced by the upload service.
   * Phase 2 replaces it with a Supabase Storage public URL — the shape of the
   * field stays identical so no UI code has to change.
   */
  imageUrl: string
  imagePath: string | null
  /** Local image bytes persisted in IndexedDB so drawings survive reloads. */
  imageData?: string
  /** Where the artwork came from: drawn in-app, camera photo, or imported file. */
  source?: 'drawn' | 'photo' | 'imported'
  /** Category key (see ART_CATEGORIES). Empty string = uncategorised. */
  category?: string
  /** Multiple free-form tags. */
  tags?: string[]
  favorite?: boolean
}

export type DrawingChallengeTrack =
  | 'sketch'
  | 'lightShadow'
  | 'colorPalette'
  | 'creative'

export interface DrawingChallenge extends Timestamped {
  id: Id
  title: string
  brief: string
  track: DrawingChallengeTrack
  /** Minutes suggested for the exercise. */
  suggestedMinutes: number
  completed: boolean
  completedAt: string | null
}

export interface FutureLetter extends Timestamped {
  id: Id
  title: string
  body: string
  /** yyyy-mm-dd the letter should be revisited. */
  openOn: string
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export type AppNotificationKind =
  | 'session'
  | 'task'
  | 'focus'
  | 'goal'
  | 'system'
  | 'dream'

export interface AppNotification extends Timestamped {
  id: Id
  kind: AppNotificationKind
  title: string
  body: string
  /** ISO datetime the notification was raised. */
  at: string
  read: boolean
}

export interface ExamDate extends Timestamped {
  id: Id
  title: string
  subjectId: Id | null
  examAt: string
  timezone: string
  notes: string
}

/* ------------------------------------------------------------------ */
/* Whole-state snapshot (used by the persistence adapter)              */
/* ------------------------------------------------------------------ */

export interface AppData {
  profile: Profile
  settings: Settings
  subjects: Subject[]
  sessions: StudySession[]
  tasks: Task[]
  focusSessions: FocusSession[]
  journal: JournalEntry[]
  goals: ArtisticGoal[]
  artworks: Artwork[]
  challenges: DrawingChallenge[]
  letters: FutureLetter[]
  notifications: AppNotification[]
  exams: ExamDate[]
}

export type CollectionKey = Exclude<keyof AppData, 'profile' | 'settings'>
