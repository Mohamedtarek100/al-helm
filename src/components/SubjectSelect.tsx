import { useEffect, useId, useRef, useState } from 'react'
import { SUBJECT_COLOR_HEX } from '../services/domain'
import { cleanSubjectName, findSubjectByName, nextSubjectColor, searchSubjects, type SubjectOption } from '../services/subjects'
import { createSubject, useAppData } from '../services/store'
import { useI18n } from '../i18n/useI18n'
import { cn } from '../utils/cn'

/**
 * Searchable subject combobox with inline creation.
 *
 * Why a custom control instead of <select>: a native select cannot be typed
 * into, so a user with no subjects could only ever pick "No subject" — the
 * exact bug reported in the session form. This combobox:
 *  - lists every existing subject (archived ones excluded),
 *  - filters as you type,
 *  - offers "Create “…”" for a genuinely new name,
 *  - reuses an existing subject when the typed name normalises to the same
 *    name (no duplicates from case/whitespace),
 *  - is fully keyboard operable (↑ ↓ Enter Esc) and announces the highlighted
 *    option to screen readers.
 */
export interface SubjectSelectProps {
  value: string | null
  onChange: (subjectId: string | null) => void
  /** Whether "No subject" is offered. Default true. */
  allowNone?: boolean
  label?: string
  id?: string
  disabled?: boolean
  className?: string
  placeholder?: string
  /** Called after a subject is created inline (e.g. to show a hint). */
  onCreated?: (subject: SubjectOption) => void
  onError?: (message: string) => void
}

type Row = { kind: 'none' } | { kind: 'subject'; option: SubjectOption } | { kind: 'create'; name: string }

export function SubjectSelect({
  value, onChange, allowNone = true, label, id, disabled, className, placeholder, onCreated, onError,
}: SubjectSelectProps) {
  const { t } = useI18n()
  const subjects = useAppData().subjects
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [creating, setCreating] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const reactId = useId()
  const listId = `${id ?? reactId}-list`
  const labelId = `${id ?? reactId}-label`

  const selected = subjects.find((subject) => subject.id === value) ?? null
  const result = searchSubjects(subjects, query)

  const rows: Row[] = []
  if (allowNone && !query.trim()) rows.push({ kind: 'none' })
  for (const option of result.matches) rows.push({ kind: 'subject', option })
  if (result.createName) rows.push({ kind: 'create', name: result.createName })

  useEffect(() => { setHighlight(0) }, [query, open])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) { setOpen(false); setQuery('') }
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)
    node?.scrollIntoView?.({ block: 'nearest' })
  }, [highlight, open, rows.length])

  const commit = async (row: Row) => {
    if (creating) return
    if (row.kind === 'none') { onChange(null); setOpen(false); setQuery(''); return }
    if (row.kind === 'subject') { onChange(row.option.id); setOpen(false); setQuery(''); return }
    // Create: reuse an existing normalised match instead of duplicating.
    const existing = findSubjectByName(subjects, row.name)
    if (existing) { onChange(existing.id); setOpen(false); setQuery(''); return }
    const name = cleanSubjectName(row.name)
    if (!name) return
    setCreating(true)
    try {
      const created = await createSubject({ name, color: nextSubjectColor(subjects), notes: '', weeklyTargetMinutes: 0, archived: false })
      onChange(created.id)
      onCreated?.({ id: created.id, name: created.name, color: created.color, archived: created.archived })
      setOpen(false)
      setQuery('')
    } catch (error) {
      onError?.(error instanceof Error ? error.message : t('subjectCreateFailed'))
    } finally {
      setCreating(false)
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) { setOpen(true); return }
      setHighlight((prev) => {
        if (rows.length === 0) return 0
        const next = event.key === 'ArrowDown' ? prev + 1 : prev - 1
        return (next + rows.length) % rows.length
      })
      return
    }
    if (event.key === 'Enter') {
      if (!open) { setOpen(true); return }
      event.preventDefault()
      const row = rows[highlight]
      if (row) void commit(row)
      return
    }
    if (event.key === 'Escape') {
      if (open) { event.stopPropagation(); setOpen(false); setQuery('') }
      return
    }
    if (event.key === 'Tab') setOpen(false)
  }

  const displayValue = open ? query : selected?.name ?? ''

  return (
    <div className={cn('combobox', className)} ref={rootRef}>
      {label && <span className="field__label" id={labelId}>{label}</span>}
      <div className={cn('combobox__control', open && 'combobox__control--open', disabled && 'combobox__control--disabled')}>
        {selected && !open && <span className="combobox__dot" style={{ background: SUBJECT_COLOR_HEX[selected.color] }} aria-hidden="true" />}
        <input
          id={id}
          className="combobox__input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-labelledby={label ? labelId : undefined}
          aria-label={label ? undefined : t('subjectLabel')}
          aria-activedescendant={open && rows[highlight] ? `${listId}-${highlight}` : undefined}
          autoComplete="off"
          disabled={disabled || creating}
          value={displayValue}
          placeholder={placeholder ?? t('subjectSearch')}
          onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {selected && (
          <button
            type="button"
            className="combobox__clear"
            aria-label={t('subjectNone')}
            tabIndex={-1}
            onClick={(event) => { event.stopPropagation(); onChange(null); setQuery(''); setOpen(false) }}
          >
            ×
          </button>
        )}
        <span className="combobox__caret" aria-hidden="true">▾</span>
      </div>

      {open && (
        <ul className="combobox__list" id={listId} role="listbox" aria-labelledby={label ? labelId : undefined} ref={listRef}>
          {rows.length === 0 && <li className="combobox__empty">{t('subjectEmpty')}</li>}
          {rows.map((row, index) => {
            const active = index === highlight
            const key = row.kind === 'none' ? 'none' : row.kind === 'subject' ? row.option.id : `create-${row.name}`
            return (
              <li
                key={key}
                role="option"
                id={`${listId}-${index}`}
                data-index={index}
                aria-selected={active}
                className={cn('combobox__option', active && 'combobox__option--active', row.kind === 'create' && 'combobox__option--create')}
                onMouseDown={(event) => { event.preventDefault(); void commit(row) }}
                onMouseEnter={() => setHighlight(index)}
              >
                {row.kind === 'none' && <span className="combobox__none">{t('subjectNone')}</span>}
                {row.kind === 'subject' && (
                  <>
                    <span className="combobox__dot" style={{ background: SUBJECT_COLOR_HEX[row.option.color] }} aria-hidden="true" />
                    <span className="combobox__name">{row.option.name}</span>
                    {row.option.id === value && <span className="combobox__check" aria-hidden="true">✓</span>}
                  </>
                )}
                {row.kind === 'create' && (
                  <>
                    <span className="combobox__plus" aria-hidden="true">+</span>
                    <span>{t('subjectCreate', { name: row.name })}</span>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
