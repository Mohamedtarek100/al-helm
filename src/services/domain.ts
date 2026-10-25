/**
 * Seed state for a brand-new student.
 *
 * Important: this is *only* the empty starting state plus the student's own
 * preference defaults. No fabricated study statistics, completed tasks or
 * achievements are ever seeded — progress sections derive from real activity.
 */

import type {
  AppData,
  DrawingChallenge,
  Settings,
  SubjectColorKey,
} from '../types'
import { nowIso } from './persistence/repository'

export const SUBJECT_COLOR_KEYS: SubjectColorKey[] = [
  'terracotta',
  'sage',
  'blush',
  'dustyBlue',
  'beige',
  'charcoal',
  'amber',
  'plum',
]

export const SUBJECT_COLOR_HEX: Record<SubjectColorKey, string> = {
  terracotta: '#B66B52',
  sage: '#89977B',
  blush: '#E7C9C0',
  dustyBlue: '#AABBC8',
  beige: '#D8C8AA',
  charcoal: '#34312F',
  amber: '#C99A4E',
  plum: '#8C6A82',
}

export const SUBJECT_COLOR_LABELS: Record<SubjectColorKey, string> = {
  terracotta: 'طيني',
  sage: 'مريمي',
  blush: 'وردي فاتح',
  dustyBlue: 'أزرق مغبر',
  beige: 'بيج',
  charcoal: 'فحمي',
  amber: 'عنبري',
  plum: 'برقوقي',
}

export const SESSION_TYPE_LABELS = {
  study: 'مذاكرة',
  lesson: 'درس',
  revision: 'مراجعة',
  homework: 'واجب',
  exam: 'امتحان',
} as const

export const TASK_CATEGORY_LABELS = {
  study: 'مذاكرة',
  homework: 'واجب',
  revision: 'مراجعة',
  practice: 'تدريب',
  art: 'رسم',
  other: 'أخرى',
} as const

export const TASK_PRIORITY_LABELS = {
  urgent: 'عاجلة',
  high: 'عالية',
  medium: 'متوسطة',
  low: 'منخفضة',
} as const
/** Highest first — used for sorting and for the priority picker order. */
export const TASK_PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low'] as const

export const CHALLENGE_TRACK_LABELS = {
  sketch: 'اسكتش وتخطيط',
  lightShadow: 'ضوء وظل',
  colorPalette: 'بالِت ألوان',
  creative: 'تمرين إبداعي',
} as const

export const WEEKDAY_LABELS = [
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
] as const

export const WEEKDAY_SHORT = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'] as const

/* ------------------------------------------------------------------ */
/* Defaults                                                            */
/* ------------------------------------------------------------------ */

export const defaultSettings: Settings = {
  theme: 'light',
  language: 'en',
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  soundEnabled: true,
  customMotivation: '',
  reminders: [
    { id: 'rem_morning', label: 'Morning study — start with one page', time: '07:30', enabled: false },
    { id: 'rem_afternoon', label: 'Afternoon study — a short session', time: '14:00', enabled: false },
    { id: 'rem_evening', label: 'Evening task review', time: '20:00', enabled: false },
    { id: 'rem_studio', label: 'Studio time — 20-minute drawing', time: '21:30', enabled: false },
    { id: 'rem_break', label: 'Break between focus sessions', time: '17:00', enabled: false },
  ],
  notificationsOptIn: false,
  storage: 'local',
}

/** Starter drawing challenges — editable and deletable by the student. */
export const starterChallenges: Omit<DrawingChallenge, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    title: 'اسكتش سريع من الحياة',
    brief: 'ارسمي أي حاجة قصادك في ١٥ دقيقة بدون ممحاية. الهدف مش الكمال، الهدف إن إيدك تتعوّد على الخط.',
    track: 'sketch',
    suggestedMinutes: 15,
    completed: false,
    completedAt: null,
  },
  {
    title: 'ضوء وظل على تفاحة',
    brief: 'حطي تفاحة تحت لمبة واحدة، وحددي مكان النور والظل ومنطقة الظل الذاتي. اشتغلي بالرصاص ٤B.',
    track: 'lightShadow',
    suggestedMinutes: 40,
    completed: false,
    completedAt: null,
  },
  {
    title: 'بالِت من صورة واحدة',
    brief: 'اختاري صورة عجبتك، وطلّعي منها ٥ ألوان أساسية واخلطيهم بالمية لحد ما توصلي لنفس الدرجة.',
    track: 'colorPalette',
    suggestedMinutes: 30,
    completed: false,
    completedAt: null,
  },
  {
    title: 'تمرين العين المقفولة',
    brief: 'اقفلي عينك وارسمي خط واحد متصل من غير ما تشيلي القلم من الورقة. كرريها ٥ مرات.',
    track: 'creative',
    suggestedMinutes: 20,
    completed: false,
    completedAt: null,
  },
]

export function createInitialData(): AppData {
  const stamp = nowIso()
  return {
    profile: {
      displayName: 'Artist',
      motto: '',
      journeyStart: stamp.slice(0, 10),
      avatarSeed: 'alhelm',
    },
    settings: { ...defaultSettings, reminders: defaultSettings.reminders.map((r) => ({ ...r })) },
    subjects: [],
    sessions: [],
    tasks: [],
    focusSessions: [],
    journal: [],
    goals: [],
    artworks: [],
    challenges: starterChallenges.map((challenge, index) => ({
      ...challenge,
      id: `chal_seed_${index}`,
      createdAt: stamp,
      updatedAt: stamp,
    })),
    letters: [],
    notifications: [],
    exams: [],
  }
}

/* ------------------------------------------------------------------ */
/* Snapshot merging (forward-compatible with Phase 2 payloads)         */
/* ------------------------------------------------------------------ */

/**
 * Keeps the reminder list aligned with the known reminder ids: user-edited
 * times/enabled flags are preserved, unknown ids are dropped, and reminders
 * added by a newer app version are appended (disabled, so nothing fires
 * without the user's choice). Never enabled-by-default on an upgrade.
 */
export function hydrateReminders(stored: Settings['reminders'] | undefined | null): Settings['reminders'] {
  if (!Array.isArray(stored) || stored.length === 0) return defaultSettings.reminders.map((r) => ({ ...r }))
  const known = new Set(defaultSettings.reminders.map((r) => r.id))
  const byId = new Map(stored.filter((r) => r && typeof r.id === 'string' && known.has(r.id)).map((r) => [r.id, r]))
  return defaultSettings.reminders.map((template) => {
    const saved = byId.get(template.id)
    if (!saved) return { ...template }
    return {
      id: template.id,
      // Localised labels live in i18n; the stored label is only a fallback.
      label: typeof saved.label === 'string' && saved.label ? saved.label : template.label,
      time: /^\d{1,2}:\d{2}$/.test(String(saved.time)) ? saved.time : template.time,
      enabled: saved.enabled === true,
    }
  })
}

/** Defaults for a task field that older records (or partial cloud rows) lack. */
export function hydrateTask<T extends { priority?: unknown; category?: unknown; estimatedMinutes?: unknown; dueTime?: unknown }>(task: T): T {
  // A null/garbage entry from a corrupted snapshot must never crash startup:
  // `{ ...null }` is legal but reading fields off it is not.
  if (!task || typeof task !== 'object') return task
  const priority = task.priority === 'urgent' || task.priority === 'high' || task.priority === 'medium' || task.priority === 'low' ? task.priority : 'medium'
  return {
    ...task,
    priority,
    category: typeof task.category === 'string' && task.category ? task.category : 'study',
    estimatedMinutes: Number.isFinite(Number(task.estimatedMinutes)) ? Number(task.estimatedMinutes) : 30,
    dueTime: typeof task.dueTime === 'string' ? task.dueTime : '',
  } as T
}

/**
 * True when at least one stored task still needs normalising.
 *
 * Hydration runs on every load and produces correct in-memory data, but unless
 * the upgraded record is written back, the *persisted* snapshot keeps the
 * legacy shape forever — so backup/export (which serialises the stored
 * snapshot) could omit a priority, and every launch would re-normalise from
 * scratch. This predicate lets the store write back exactly once, only when
 * something is genuinely stale, so a fully-normalised snapshot is never
 * rewritten (no needless writes, no churn on newer data).
 *
 * It is deliberately conservative: it reports `true` for a malformed entry so
 * the caller re-saves the hydrated (repaired) form.
 */
export function needsTaskNormalization(stored: Partial<AppData> | null | undefined): boolean {
  const tasks = stored?.tasks
  if (!Array.isArray(tasks)) return false // nothing stored yet: nothing to migrate
  return tasks.some((task) => {
    if (!task || typeof task !== 'object') return true
    const t = task as { priority?: unknown; category?: unknown; estimatedMinutes?: unknown; dueTime?: unknown }
    const priorityOk = t.priority === 'urgent' || t.priority === 'high' || t.priority === 'medium' || t.priority === 'low'
    const categoryOk = typeof t.category === 'string' && t.category.length > 0
    const minutesOk = Number.isFinite(Number(t.estimatedMinutes))
    const dueTimeOk = typeof t.dueTime === 'string'
    return !(priorityOk && categoryOk && minutesOk && dueTimeOk)
  })
}

/** Fills missing slices of a stored snapshot so older local data still loads. */
export function hydrateData(stored: Partial<AppData> | null): AppData {
  const base = createInitialData()
  if (!stored) return base
  return {
    profile: { ...base.profile, ...(stored.profile ?? {}) },
    settings: {
      ...base.settings,
      ...(stored.settings ?? {}),
      storage: stored.settings?.storage === 'cloud' ? 'cloud' : 'local',
      language: stored.settings?.language === 'ar' ? 'ar' : 'en',
      theme: stored.settings?.theme === 'dark' || stored.settings?.theme === 'system' ? stored.settings.theme : 'light',
      notificationsOptIn: stored.settings?.notificationsOptIn === true,
      reminders: hydrateReminders(stored.settings?.reminders),
    },
    subjects: stored.subjects ?? base.subjects,
    sessions: stored.sessions ?? base.sessions,
    tasks: (stored.tasks ?? base.tasks).map(hydrateTask),
    focusSessions: stored.focusSessions ?? base.focusSessions,
    journal: stored.journal ?? base.journal,
    goals: stored.goals ?? base.goals,
    artworks: stored.artworks ?? base.artworks,
    challenges: stored.challenges ?? base.challenges,
    letters: stored.letters ?? base.letters,
    notifications: stored.notifications ?? base.notifications,
    exams: stored.exams ?? base.exams,
  }
}
