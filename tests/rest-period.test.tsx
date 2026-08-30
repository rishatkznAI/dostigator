import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RestTimer } from '../src/components/RestTimer'
import { formatRestDuration, getRestDurationSeconds } from '../src/lib/rest-period'

afterEach(() => {
  vi.useRealTimers()
})

describe('exercise-specific rest periods', () => {
  it('assigns 3, 2 and 1.5 minute rests by exercise type', () => {
    expect(getRestDurationSeconds('leg_press')).toBe(180)
    expect(getRestDurationSeconds('rdl')).toBe(180)
    expect(getRestDurationSeconds('chest_press')).toBe(120)
    expect(getRestDurationSeconds('lat_pulldown')).toBe(120)
    expect(getRestDurationSeconds('lateral_raise')).toBe(90)
    expect(getRestDurationSeconds('unknown_exercise')).toBe(90)
  })

  it('formats the recommendations for exercise cards', () => {
    expect(formatRestDuration(180)).toBe('3 мин')
    expect(formatRestDuration(120)).toBe('2 мин')
    expect(formatRestDuration(90)).toBe('1 мин 30 сек')
  })

  it('shows the exercise and keeps manual timer controls', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-27T10:00:00Z'))
    const onChange = vi.fn()
    const onSkip = vi.fn()

    render(
      <RestTimer
        until={Date.now() + 180_000}
        exerciseName="Жим ногами"
        plannedSeconds={180}
        onChange={onChange}
        onSkip={onSkip}
      />,
    )

    expect(screen.getByText('03:00')).toBeInTheDocument()
    expect(screen.getByText('После: Жим ногами')).toBeInTheDocument()
    expect(screen.getByText('план 3 мин')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /30 сек/ }))
    expect(onChange).toHaveBeenCalledWith(Date.now() + 210_000)
    fireEvent.click(screen.getByRole('button', { name: 'Пропустить отдых' }))
    expect(onSkip).toHaveBeenCalledOnce()
  })
})
