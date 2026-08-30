import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReadinessCheck } from '../src/components/ReadinessCheck'

describe('readiness check', () => {
  it('switches to a reduced workout on high stress', () => {
    const onComplete = vi.fn()
    render(<ReadinessCheck onComplete={onComplete} />)
    fireEvent.change(screen.getByLabelText('Стресс'), { target: { value: '5' } })
    expect(screen.getByText('Облегчённый режим')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Начать тренировку' }))
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ stress: 5, mode: 'reduced' }))
  })
})
