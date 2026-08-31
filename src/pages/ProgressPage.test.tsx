import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppData } from '../types'
import { ProgressPage } from './ProgressPage'

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
  mocks.data = {
    areas: [], actions: [], reviews: [], checkins: [],
    goals: [{ id: 'goal-1', user_id: 'user-a', area_id: null, title: 'Пробежать 5 км', description: '', why: '', kind: 'goal', status: 'active', progress: 0, target_date: null, completed_at: null, created_at: 'now', updated_at: 'now' }],
    habits: [{ id: 'habit-1', user_id: 'user-a', area_id: null, title: 'Бегать трижды в неделю', target_per_week: 3, active: true, activity_periods: [{ started_on: '2026-08-24', ended_on: null }], created_at: 'now', updated_at: 'now' }],
  }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('combined progress page', () => {
  it('keeps goals and habits in one section without duplicating training navigation', () => {
    render(<MemoryRouter initialEntries={['/progress']}><ProgressPage /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'Прогресс' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Пробежать 5 км' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Тренировки/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Привычки · 1' }))
    expect(screen.getByRole('heading', { name: 'Бегать трижды в неделю' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Добавить привычку' })).toBeInTheDocument()
  })
})
