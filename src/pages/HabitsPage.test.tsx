import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppData } from '../types'
import { HabitsPage } from './HabitsPage'

const mocks = vi.hoisted(() => ({
  data: null as AppData | null,
  setHabitActive: vi.fn(),
  toggleHabitToday: vi.fn(),
}))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-a' } }) }))
vi.mock('../context/DataContext', () => ({ useData: () => ({
  data: mocks.data,
  addHabit: vi.fn(),
  setHabitActive: mocks.setHabitActive,
  toggleHabitToday: mocks.toggleHabitToday,
  isMutating: () => false,
}) }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-27T12:00:00+03:00'))
  mocks.setHabitActive.mockReset().mockResolvedValue(undefined)
  mocks.toggleHabitToday.mockReset().mockResolvedValue(undefined)
  mocks.data = {
    areas: [], goals: [], actions: [], reviews: [],
    habits: [{ id: 'habit-1', user_id: 'user-a', area_id: null, title: 'Читать', target_per_week: 7, active: true, activity_periods: [{ started_on: '2026-08-24', ended_on: null }], created_at: '2026-08-24T08:00:00Z', updated_at: '2026-08-24T08:00:00Z' }],
    checkins: [
      { id: 'one', user_id: 'user-a', habit_id: 'habit-1', checked_on: '2026-08-26', note: '', created_at: '2026-08-26T08:00:00Z' },
      { id: 'two', user_id: 'user-a', habit_id: 'habit-1', checked_on: '2026-08-27', note: '', created_at: '2026-08-27T08:00:00Z' },
      { id: 'duplicate', user_id: 'user-a', habit_id: 'habit-1', checked_on: '2026-08-27', note: '', created_at: '2026-08-27T09:00:00Z' },
      { id: 'foreign', user_id: 'user-b', habit_id: 'habit-1', checked_on: '2026-08-25', note: '', created_at: '2026-08-25T08:00:00Z' },
    ],
  }
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('honest habit presentation', () => {
  it('shows unique progress to today, an explicit daily streak unit, and future days', () => {
    render(<MemoryRouter><HabitsPage /></MemoryRouter>)
    expect(screen.getByText('2/4')).toBeInTheDocument()
    expect(screen.getByText((_text, node) => node?.tagName === 'SPAN' && node.textContent?.trim() === '2 дней подряд')).toBeInTheDocument()
    expect(screen.getByText('Пт').parentElement).toHaveClass('future')
    expect(screen.getByText('Сб').parentElement).toHaveClass('future')
    expect(screen.getByText('Вс').parentElement).toHaveClass('future')
    expect(screen.getByRole('listitem', { name: /среда, 26 августа 2026 г\.: выполнено/i })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: /понедельник, 24 августа 2026 г\.: не выполнено/i })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: /пятница, 28 августа 2026 г\.: день ещё не наступил/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Снять сегодняшнюю отметку привычки «Читать»' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('persists pause through the mutation contract', () => {
    render(<MemoryRouter><HabitsPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Поставить привычку «Читать» на паузу' }))
    expect(mocks.setHabitActive).toHaveBeenCalledWith('habit-1', false)
  })

  it('keeps training navigation out of the habit list', () => {
    render(<MemoryRouter><HabitsPage /></MemoryRouter>)

    expect(screen.queryByRole('link', { name: /Тренировки/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Читать' })).toBeInTheDocument()
  })
})
