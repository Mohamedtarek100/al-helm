import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DurationStepper } from './Field'

describe('DurationStepper', () => {
  it('renders the current value and stays within bounds', () => {
    const onChange = vi.fn()
    render(<DurationStepper label="Focus" value={25} min={1} max={120} onChange={onChange} />)
    expect(screen.getByText(/25/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Focus −'))
    expect(onChange).toHaveBeenCalledWith(24)
    fireEvent.click(screen.getByLabelText('Focus +'))
    expect(onChange).toHaveBeenCalledWith(26)
  })

  it('disables plus at the max limit and minus at the min limit', () => {
    const onChange = vi.fn()
    const { rerender } = render(<DurationStepper label="Break" value={60} min={1} max={60} onChange={onChange} />)
    expect((screen.getByLabelText('Break +') as HTMLButtonElement).disabled).toBe(true)
    rerender(<DurationStepper label="Break" value={1} min={1} max={60} onChange={onChange} />)
    expect((screen.getByLabelText('Break −') as HTMLButtonElement).disabled).toBe(true)
  })

  it('clamps out-of-range values', () => {
    const onChange = vi.fn()
    render(<DurationStepper label="Focus" value={119} min={1} max={120} onChange={onChange} step={5} />)
    fireEvent.click(screen.getByLabelText('Focus +'))
    expect(onChange).toHaveBeenCalledWith(120)
  })
})
