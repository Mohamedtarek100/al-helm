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
  low: 'هادية',
  medium: 'متوسطة',
  high: 'مهمة',
} as const

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
    { id: 'rem_morning', label: 'تنبيه الصباح — ابدأي يومكِ بصفحة واحدة', time: '07:30', enabled: true },
    { id: 'rem_afternoon', label: 'تنبيه بعد الضهر — جلسة مذاكرة قصيرة', time: '14:00', enabled: true },
    { id: 'rem_evening', label: 'تنبيه المساء — راجعي مهام اليوم', time: '20:00', enabled: false },
    { id: 'rem_studio', label: 'وقت المرسم — تمرين رسم ٢٠ دقيقة', time: '21:30', enabled: false },
  ],
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
      reminders: stored.settings?.reminders ?? base.settings.reminders,
    },
    subjects: stored.subjects ?? base.subjects,
    sessions: stored.sessions ?? base.sessions,
    tasks: stored.tasks ?? base.tasks,
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
