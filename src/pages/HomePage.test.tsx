import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionItem, AppData } from '../types'
import { localDate, startOfWeek } from '../lib/date'
import { weeklyMetrics } from '../lib/progress'
import { HomePage } from './HomePage'

const empty: AppData = { areas: [], goals: [], actions: [], habits: [], checkins: [], reviews: [] }
const goal = { id: 'goal-1', user_id: 'user-a', area_id: null, title: 'Первая цель', description: '', why: '', kind: 'goal' as const, status: 'active' as const, progress: 0, target_date: null, completed_at: null, created_at: 'now', updated_at: 'now' }
const makeAction = (id: string, extras: Partial<ActionItem> = {}): ActionItem => ({ id, user_id: 'user-a', goal_id: 'goal-1', title: `Действие ${id}`, status: 'todo', due_date: null, focus_date: null, focus_position: null, result_note: '', completed_at: null, created_at: 'now', updated_at: 'now', ...extras })

const mocks = vi.hoisted(() => ({
  user: { id: 'user-a', email: 'user@example.com', user_metadata: {} as { display_name?: string } },
  data: null as AppData | null,
  loading: false,
  toggleFocus: vi.fn(),
  toggleHabitToday: vi.fn(),
}))

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('../context/DataContext', () => ({ useData: () => ({
  data: mocks.data ?? empty,
  loading: mocks.loading,
  toggleFocus: mocks.toggleFocus,
  toggleHabitToday: mocks.toggleHabitToday,
  toggleAction: vi.fn(),
  deleteAction: vi.fn(),
  isMutating: () => false,
  addGoal: vi.fn(),
}) }))

describe('Home Focus 3', () => {
  beforeEach(() => {
    mocks.user = { id: 'user-a', email: 'user@example.com', user_metadata: {} }
    mocks.data = empty
    mocks.loading = false
    mocks.toggleFocus.mockReset().mockResolvedValue(undefined)
    mocks.toggleHabitToday.mockReset().mockResolvedValue(undefined)
  })

  afterEach(cleanup)

  it('uses the editable nickname and explains the three-action limit', () => {
    mocks.user = { id: 'user-a', email: 'user@example.com', user_metadata: { display_name: 'Ришат' } }
    render(<MemoryRouter><HomePage /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'Сегодня, Ришат' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Три главных действия' })).toBeInTheDocument()
    expect(screen.getByText(/максимум три приоритетных действия/)).toHaveTextContent('«Фокус 3»')
  })

  it('always renders an empty focus counter as 0/3 with an actionable CTA', () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>)
    expect(screen.getByLabelText('Выполнено 0 из 3')).toHaveTextContent('0/3')
    expect(screen.getByRole('button', { name: 'Создать первую цель' })).toBeInTheDocument()
  })

  it('keeps the denominator at three for one unfinished and one completed action', () => {
    const today = localDate()
    mocks.data = { ...empty, goals: [goal], actions: [makeAction('one', { focus_date: today, focus_position: 1 })] }
    const view = render(<MemoryRouter><HomePage /></MemoryRouter>)
    expect(screen.getByLabelText('Выполнено 0 из 3')).toHaveTextContent('0/3')

    mocks.data = { ...empty, goals: [goal], actions: [makeAction('one', { status: 'done', focus_date: today, focus_position: 1, completed_at: `${today}T10:00:00.000Z` })] }
    view.rerender(<MemoryRouter><HomePage /></MemoryRouter>)
    expect(screen.getByLabelText('Выполнено 1 из 3')).toHaveTextContent('1/3')
  })

  it('does not offer a fourth action after one of three focused actions is completed', () => {
    const today = localDate()
    mocks.data = { ...empty, goals: [goal], actions: [
      makeAction('one', { status: 'done', focus_date: today, focus_position: 1, completed_at: `${today}T10:00:00.000Z` }),
      makeAction('two', { focus_date: today, focus_position: 2 }),
      makeAction('three', { focus_date: today, focus_position: 3 }),
      makeAction('four'),
    ] }
    render(<MemoryRouter><HomePage /></MemoryRouter>)
    expect(screen.getByLabelText('Выполнено 1 из 3')).toBeInTheDocument()
    expect(screen.queryByText('Действие four')).not.toBeInTheDocument()
    expect(screen.queryByText(/Свободно мест/)).not.toBeInTheDocument()
  })

  it('renders no false empty focus state while loading', () => {
    mocks.loading = true
    render(<MemoryRouter><HomePage /></MemoryRouter>)
    expect(screen.queryByText('Выберите до трёх действий')).not.toBeInTheDocument()
    expect(document.querySelector('.skeleton-card')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Загружаем действия дня')
  })

  it('opens a searchable chooser with every available action instead of only the first suggestion', async () => {
    mocks.data = { ...empty, goals: [goal], actions: [
      makeAction('late', { title: 'Заказать материалы', due_date: '2026-09-10' }),
      makeAction('early', { title: 'Позвонить мастеру', due_date: '2026-09-01' }),
      makeAction('third', { title: 'Проверить смету' }),
      makeAction('cancelled', { title: 'Отменённое дело', status: 'cancelled' }),
    ] }
    const user = userEvent.setup()
    render(<MemoryRouter><HomePage /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: 'Выбрать действия' }))
    expect(screen.getByRole('heading', { name: 'Выберите главное на сегодня' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Действие|Позвонить|Проверить|Заказать/ })).toHaveLength(3)
    expect(screen.queryByText('Отменённое дело')).not.toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: 'Поиск доступных действий' }), 'смет')
    expect(screen.getByText('Проверить смету')).toBeInTheDocument()
    expect(screen.queryByText('Позвонить мастеру')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Проверить смету/ }))
    expect(mocks.toggleFocus).toHaveBeenCalledWith('third')
  })

  it('shows no false zero for an empty user and the canonical perfect-to-date score', () => {
    const view = render(<MemoryRouter><HomePage /></MemoryRouter>)
    expect(screen.getByText('Недостаточно данных')).toBeInTheDocument()
    expect(screen.getByLabelText('Индекс дисциплины: недостаточно данных')).toBeInTheDocument()

    const today = localDate()
    const next = { ...empty, goals: [goal], actions: Array.from({ length: 5 }, (_, index) => makeAction(String(index + 1), {
      status: 'done', focus_date: index === 0 ? today : null, focus_position: index === 0 ? 1 : null, completed_at: `${today}T${10 + index}:00:00.000Z`,
    })) }
    expect(weeklyMetrics(next.actions, [], [], startOfWeek(), today, 'user-a').score).toBe(100)
    mocks.data = next
    view.rerender(<MemoryRouter><HomePage /></MemoryRouter>)
    expect(screen.getByText('100')).toBeInTheDocument()
  })

  it('announces the object and pressed state of quick habit controls', () => {
    const today = localDate()
    mocks.data = { ...empty, habits: [{
      id: 'habit-1', user_id: 'user-a', area_id: null, title: 'Чтение', target_per_week: 4,
      active: true, activity_periods: [{ started_on: today, ended_on: null }],
      created_at: `${today}T08:00:00Z`, updated_at: `${today}T08:00:00Z`,
    }], checkins: [{
      id: 'checkin-1', user_id: 'user-a', habit_id: 'habit-1', checked_on: today, note: '', created_at: `${today}T09:00:00Z`,
    }] }
    render(<MemoryRouter><HomePage /></MemoryRouter>)

    expect(screen.getByRole('button', { name: 'Снять сегодняшнюю отметку привычки «Чтение»' })).toHaveAttribute('aria-pressed', 'true')
  })
})
