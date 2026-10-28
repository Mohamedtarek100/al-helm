import { useToast } from './toastContext'
import { useI18n } from '../i18n/useI18n'
import { TASK_PRIORITY_ORDER } from '../services/taskPriority'
import type { TaskPriority } from '../types'

/** Priority is sorted urgent → high → medium → low everywhere (one source list). */
export const PRIORITY_ORDER = TASK_PRIORITY_ORDER
export type PriorityKind = TaskPriority

const LABEL_KEY = {
  urgent: 'priorityLabelUrgent',
  high: 'priorityLabelHigh',
  medium: 'priorityLabelMedium',
  low: 'priorityLabelLow',
} as const

/** Always render the text label next to the colour so colour is never the only cue. */
export function PriorityBadge({ priority, size = 'md' }: { priority: PriorityKind; size?: 'sm' | 'md' }) {
  const { t } = useI18n()
  return (
    <span className={`priority-badge priority-badge--${priority} priority-badge--${size}`}>
      <i className="priority-badge__dot" aria-hidden="true" />
      {t(LABEL_KEY[priority])}
    </span>
  )
}

/** Four-way priority picker (radiogroup) used by the task form. */
export function PriorityPicker({ value, onChange }: { value: PriorityKind; onChange: (next: PriorityKind) => void }) {
  const { t } = useI18n()
  return (
    <div className="priority-picker" role="radiogroup" aria-label={t('taskPriority')}>
      {PRIORITY_ORDER.map((priority) => (
        <button
          key={priority}
          type="button"
          role="radio"
          aria-checked={value === priority}
          className={`priority-picker__item priority-picker__item--${priority} ${value === priority ? 'priority-picker__item--active' : ''}`}
          onClick={() => onChange(priority)}
        >
          <i className="priority-badge__dot" aria-hidden="true" />
          {t(LABEL_KEY[priority])}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Save-state helpers                                                  */
/* ------------------------------------------------------------------ */

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Wraps an async persistence action and turns it into a truthful save state.
 * On failure the error is surfaced through the toast AND the returned state,
 * so no screen can show a success badge that the backend did not confirm.
 */
export function useSaveAction() {
  const { notify } = useToast()
  const { t } = useI18n()
  return async function run(action: () => Promise<unknown>, successMessage?: string): Promise<boolean> {
    try {
      await action()
      if (successMessage) notify(successMessage, 'success')
      return true
    } catch (error) {
      notify(error instanceof Error ? error.message : t('retry'), 'danger')
      return false
    }
  }
}
