import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkoutTimer } from '../src/components/WorkoutTimer'
import type { WorkoutDraft } from '../src/types/training'

const runningDraft: WorkoutDraft = {
  schemaVersion: 3,
  id: 'session',
  userId: 'user',
  templateCode: 'A',
  title: 'Тренировка A',
  startedAt: '2026-08-25T10:00:00Z',
  finishedAt: null,
  timerPausedAt: null,
  timerPausedDurationMs: 0,
  readiness: null,
  activeRest: null,
  deletedSetIds: [],
  updatedAt: '2026-08-25T10:00:00Z',
  syncState: 'pending',
  exercises: [],
}

describe('workout timer controls', () => {
  it('offers a pause action while the timer is running', () => {
    const onToggle = vi.fn()
    render(<WorkoutTimer draft={runningDraft} now={new Date('2026-08-25T10:05:12Z').getTime()} onToggle={onToggle} />)

    expect(screen.getByText('00:05:12')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Остановить таймер тренировки' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('keeps a paused clock frozen and offers resume', () => {
    render(<WorkoutTimer
      draft={{ ...runningDraft, timerPausedAt: '2026-08-25T10:03:00Z' }}
      now={new Date('2026-08-25T11:00:00Z').getTime()}
      onToggle={vi.fn()}
    />)

    expect(screen.getByText('00:03:00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Продолжить таймер тренировки' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Время остановлено')
  })
})
