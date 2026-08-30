import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActionItem, AppData, Goal } from '../types'
import { GoalPage } from '../pages/GoalPage'
import { GoalCard } from './GoalCard'

const baseGoal: Goal = {
  id: 'goal-1', user_id: 'user-a', area_id: null, title: 'Запустить продукт', description: '', why: '', kind: 'goal', status: 'active', progress: 73,
  target_date: null, completed_at: null, created_at: '2026-08-01T08:00:00Z', updated_at: '2026-08-01T08:00:00Z',
}
const makeAction = (id: string, status: ActionItem['status']): ActionItem => ({
  id, user_id: 'user-a', goal_id: 'goal-1', title: id, status, due_date: null, focus_date: null, focus_position: null,
  result_note: '', completed_at: status === 'done' ? '2026-08-24T08:00:00Z' : null, created_at: '2026-08-01T08:00:00Z', updated_at: '2026-08-24T08:00:00Z',
})

const mocks = vi.hoisted(() => ({ data: null as AppData | null }))
vi.mock('../context/DataContext', () => ({ useData: () => ({
  data: mocks.data,
  addAction: vi.fn(),
  updateGoal: vi.fn(),
  isMutating: () => false,
}) }))

afterEach(cleanup)

describe('canonical goal progress semantics', () => {
  it('shows a completed result as complete even when steps are mixed', () => {
    const goal = { ...baseGoal, status: 'completed' as const, completed_at: '2026-08-25T08:00:00Z' }
    const actions = [makeAction('Сделано', 'done'), makeAction('Осталось', 'todo')]
    render(<MemoryRouter><GoalCard goal={goal} actions={actions} areas={[]} /></MemoryRouter>)
    expect(screen.getByText('Цель достигнута')).toBeInTheDocument()
    expect(screen.getByText('Результат подтверждён')).toBeInTheDocument()
    expect(screen.queryByText(/50%/)).not.toBeInTheDocument()
  })

  it('shows all completed steps without claiming that an active result is reached', () => {
    const actions = [makeAction('Первое', 'done'), makeAction('Второе', 'done')]
    render(<MemoryRouter><GoalCard goal={baseGoal} actions={actions} areas={[]} /></MemoryRouter>)
    expect(screen.getByText('2/2 шагов · 100%')).toBeInTheDocument()
    expect(screen.getByText('Все шаги сделаны — подтвердите результат')).toBeInTheDocument()
    expect(screen.queryByText('Результат подтверждён')).not.toBeInTheDocument()
  })

  it('uses the same completed-result semantics on the goal page', () => {
    const goal = { ...baseGoal, status: 'completed' as const, completed_at: '2026-08-25T08:00:00Z' }
    mocks.data = { areas: [], goals: [goal], actions: [makeAction('Сделано', 'done'), makeAction('Осталось', 'todo')], habits: [], checkins: [], reviews: [] }
    render(<MemoryRouter initialEntries={['/goals/goal-1']}><Routes><Route path="/goals/:goalId" element={<GoalPage />} /></Routes></MemoryRouter>)
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getAllByText('цель достигнута', { exact: false }).length).toBeGreaterThan(0)
    expect(screen.queryByText('50')).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Прогресс' })).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByRole('progressbar', { name: 'Прогресс' })).toHaveAttribute('aria-valuetext', '100 цель достигнута')
  })

  it('labels an active goal with no actions instead of showing stale manual progress', () => {
    render(<MemoryRouter><GoalCard goal={baseGoal} actions={[]} areas={[]} /></MemoryRouter>)
    expect(screen.getByText('Шаги ещё не добавлены')).toBeInTheDocument()
    expect(screen.queryByText('73%')).not.toBeInTheDocument()
  })

  it('labels a paused goal without dimming its content', () => {
    render(<MemoryRouter><GoalCard goal={{ ...baseGoal, status: 'paused' }} actions={[]} areas={[]} /></MemoryRouter>)
    expect(screen.getByText('На паузе')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Запустить продукт/ })).toHaveClass('paused')
  })
})
