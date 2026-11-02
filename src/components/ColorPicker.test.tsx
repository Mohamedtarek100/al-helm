import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ColorPicker } from './ColorPicker'
import { I18nContext } from '../i18n/useI18n'
import { messages, type TranslationKey } from '../i18n/translations'

const i18n = {
  language: 'en' as const,
  dir: 'ltr' as const,
  locale: 'en-US' as const,
  t: (key: TranslationKey) => messages.en[key],
  formatDate: (date: Date | string) => String(date),
  formatNumber: (value: number) => String(value),
  setLanguage: () => undefined,
}

function renderPicker(onChange = vi.fn(), onCommit = vi.fn()) {
  return {
    onChange,
    onCommit,
    ...render(
      <I18nContext.Provider value={i18n}>
        <ColorPicker value="#ff0000" onChange={onChange} onCommit={onCommit} />
      </I18nContext.Provider>,
    ),
  }
}

describe('ColorPicker', () => {
  it('uses the latest pointer position when committing a drag', () => {
    const { container, onChange, onCommit } = renderPicker()
    const wheel = container.querySelector('.color-picker__wheel') as HTMLDivElement
    vi.spyOn(wheel, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}),
    })

    fireEvent.pointerDown(wheel, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 50 })
    fireEvent.pointerMove(wheel, { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 0 })
    fireEvent.pointerUp(wheel, { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 0 })

    expect(onChange).toHaveBeenLastCalledWith('#80ff00')
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('#80ff00')
  })

  it('does not record a cancelled pointer gesture as a recent color', () => {
    const { container, onChange, onCommit } = renderPicker()
    const wheel = container.querySelector('.color-picker__wheel') as HTMLDivElement
    vi.spyOn(wheel, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}),
    })
    fireEvent.pointerDown(wheel, { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 0 })
    fireEvent.pointerCancel(wheel, { pointerId: 1, pointerType: 'touch' })
    expect(onChange).toHaveBeenLastCalledWith('#ff0000')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('accepts a custom six-digit hex value', () => {
    const { onChange, onCommit } = renderPicker()
    fireEvent.change(screen.getByRole('textbox', { name: 'Hex color' }), { target: { value: '#123456' } })
    expect(onChange).toHaveBeenCalledWith('#123456')
    expect(onCommit).toHaveBeenCalledWith('#123456')
  })

  it('reports an invalid custom hex value on blur', () => {
    renderPicker()
    const input = screen.getByRole('textbox', { name: 'Hex color' })
    fireEvent.change(input, { target: { value: '#123' } })
    fireEvent.blur(input)
    expect(screen.getByRole('alert').textContent).toBe('Enter a 6-digit hex color.')
  })
})
