import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter, Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localDate, shiftDate, startOfWeek } from '../lib/date'
import type { AppData, WeeklyMetrics } from '../types'
import { ReviewPage } from './ReviewPage'

const currentWeek = startOfWeek()
const previousWeek = shiftDate(currentWeek, -7)
const snapshot: WeeklyMetrics = {
  score: 42,
  focus: { done: 1, committed: 2, rate: .5 },
  habits: { done: 1, expected: 3, rate: 1 / 3 },
  actions: { done: 1, target: 5, rate: .2 },
  period: { weekStart: previousWeek, asOf: shiftDate(previousWeek, 6) },
}

const emptyData = (): AppData => ({ areas: [], goals: [], actions: [], habits: [], checkins: [], reviews: [] })
const mocks = vi.hoisted(() => ({
  data: null as AppData | null,
  saveReview: vi.fn(),
  busyWeek: null as string | null,
}))

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-a' } }) }))
vi.mock('../context/DataContext', () => ({ useData: () => ({
  data: mocks.data,
  saveReview: mocks.saveReview,
  isMutating: (scope: string, id?: string) => scope === 'review' && id === mocks.busyWeek,
}) }))

function previousReview() {
  return {
    id: 'review-a', user_id: 'user-a', week_start: previousWeek, wins: 'Сохранённая победа', blockers: 'Старый барьер', next_focus: 'Старый фокус', self_score: 8,
    metrics_snapshot: snapshot, created_at: `${previousWeek}T08:00:00Z`, updated_at: `${previousWeek}T08:00:00Z`,
  }
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  mocks.data = emptyData()
  mocks.saveReview.mockReset().mockResolvedValue(undefined)
  mocks.busyWeek = null
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('weekly review history', () => {
  it('starts a new week without a preselected self-score', () => {
    render(<MemoryRouter><ReviewPage /></MemoryRouter>)
    expect(screen.getByText('Оценка не выбрана — это необязательно')).toBeInTheDocument()
    expect(screen.getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked)).toBe(true)
    expect(screen.getByText('Недостаточно данных')).toBeInTheDocument()
    expect(screen.getByText('Не выбирался')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить обзор' })).toBeDisabled()
  })

  it('enables save only for a meaningful dirty draft', async () => {
    render(<MemoryRouter><ReviewPage /></MemoryRouter>)
    const save = screen.getByRole('button', { name: 'Сохранить обзор' })
    const wins = screen.getByPlaceholderText('Главные победы и завершённые дела')
    await userEvent.type(wins, '   ')
    expect(save).toBeDisabled()
    await userEvent.type(wins, 'Факт')
    expect(save).toBeEnabled()
    await userEvent.clear(wins)
    expect(save).toBeDisabled()
  })

  it('guards dirty review fields on internal router navigation and keeps them after cancel', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<MemoryRouter initialEntries={['/review']}><Link to="/settings">Профиль</Link><Routes><Route path="/review" element={<ReviewPage />} /><Route path="/settings" element={<h1>Настройки</h1>} /></Routes></MemoryRouter>)
    const wins = screen.getByPlaceholderText('Главные победы и завершённые дела')
    await userEvent.type(wins, 'Несохранённый факт')

    await userEvent.click(screen.getByRole('link', { name: 'Профиль' }))
    expect(confirm).toHaveBeenLastCalledWith('Уйти со страницы без сохранения изменений обзора?')
    expect(wins).toHaveValue('Несохранённый факт')
    expect(screen.queryByRole('heading', { name: 'Настройки' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('link', { name: 'Профиль' }))
    expect(screen.getByRole('heading', { name: 'Настройки' })).toBeInTheDocument()
  })

  it('registers a beforeunload warning only while the review is dirty', async () => {
    render(<MemoryRouter><ReviewPage /></MemoryRouter>)
    const cleanEvent = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(cleanEvent)
    expect(cleanEvent.defaultPrevented).toBe(false)

    await userEvent.type(screen.getByPlaceholderText('Главные победы и завершённые дела'), 'Черновик')
    const dirtyEvent = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirtyEvent)
    expect(dirtyEvent.defaultPrevented).toBe(true)
  })

  it('guards browser Back with a same-route sentinel and preserves the draft after cancel', async () => {
    window.history.replaceState(null, '', '/settings')
    window.history.pushState(null, '', '/review')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<BrowserRouter><Routes><Route path="/review" element={<ReviewPage />} /><Route path="/settings" element={<h1>Настройки</h1>} /></Routes></BrowserRouter>)
    const wins = screen.getByPlaceholderText('Главные победы и завершённые дела')
    await userEvent.type(wins, 'Черновик для Back')

    act(() => window.history.back())
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(window.location.pathname).toBe('/review')
    expect(wins).toHaveValue('Черновик для Back')

    act(() => window.history.back())
    expect(await screen.findByRole('heading', { name: 'Настройки' })).toBeInTheDocument()
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('removes the same-route sentinel before confirmed internal navigation', async () => {
    window.history.replaceState(null, '', '/before-review')
    window.history.pushState(null, '', '/review')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<BrowserRouter><Link to="/settings">Профиль</Link><Routes><Route path="/before-review" element={<h1>До обзора</h1>} /><Route path="/review" element={<ReviewPage />} /><Route path="/settings" element={<h1>Настройки</h1>} /></Routes></BrowserRouter>)
    await userEvent.type(screen.getByPlaceholderText('Главные победы и завершённые дела'), 'Черновик для ссылки')

    await userEvent.click(screen.getByRole('link', { name: 'Профиль' }))
    expect(await screen.findByRole('heading', { name: 'Настройки' })).toBeInTheDocument()
    expect(confirm).toHaveBeenCalledTimes(1)

    act(() => window.history.back())
    expect(await screen.findByRole('heading', { name: 'Обзор недели' })).toBeInTheDocument()
    act(() => window.history.back())
    expect(await screen.findByRole('heading', { name: 'До обзора' })).toBeInTheDocument()
  })

  it('shows the same canonical perfect-to-date score as Home', () => {
    const today = localDate()
    const completed = (id: string, hour: number) => ({
      id, user_id: 'user-a', goal_id: 'goal-1', title: id, status: 'done' as const, due_date: null, focus_date: id === 'today' ? today : null, focus_position: id === 'today' ? 1 : null,
      result_note: '', completed_at: `${today}T${hour}:00:00.000Z`, created_at: `${today}T08:00:00.000Z`, updated_at: `${today}T${hour}:00:00.000Z`,
    })
    mocks.data = { ...emptyData(), actions: [completed('today', 10), completed('second', 11), completed('third', 12), completed('fourth', 13), completed('fifth', 14)] }
    render(<MemoryRouter><ReviewPage /></MemoryRouter>)
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('1/1')).toBeInTheDocument()
  })

  it('opens a saved previous review and uses its immutable snapshot', async () => {
    mocks.data = { ...emptyData(), reviews: [previousReview()], actions: [{
      id: 'late', user_id: 'user-a', goal_id: 'goal-1', title: 'Позднее', status: 'done', due_date: null, focus_date: previousWeek, focus_position: 1,
      result_note: '', completed_at: `${previousWeek}T12:00:00Z`, created_at: `${previousWeek}T08:00:00Z`, updated_at: `${previousWeek}T12:00:00Z`,
    }] }
    render(<MemoryRouter><ReviewPage /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Предыдущая неделя' }))
    expect(screen.getByDisplayValue('Сохранённая победа')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('1/2')).toBeInTheDocument()
  })

  it('keeps a dirty draft on cancelled navigation and hydrates the accepted week', async () => {
    mocks.data = { ...emptyData(), reviews: [previousReview()] }
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<MemoryRouter><ReviewPage /></MemoryRouter>)
    const wins = screen.getByPlaceholderText('Главные победы и завершённые дела')
    await userEvent.type(wins, 'Черновик B')
    await userEvent.click(screen.getByRole('button', { name: 'Предыдущая неделя' }))

    expect(confirm).toHaveBeenLastCalledWith('Перейти к другой неделе без сохранения изменений?')
    expect(screen.getByText('Текущая неделя')).toBeInTheDocument()
    expect(wins).toHaveValue('Черновик B')

    await userEvent.click(screen.getByRole('button', { name: 'Предыдущая неделя' }))
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(screen.getByDisplayValue('Сохранённая победа')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '8' })).toBeChecked()

    await userEvent.click(screen.getByRole('button', { name: 'Следующая неделя' }))
    expect(screen.getByPlaceholderText('Главные победы и завершённые дела')).toHaveValue('')
    expect(screen.getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked)).toBe(true)
  })

  it('saves the selected week and keeps text after a durable failure', async () => {
    mocks.data = { ...emptyData(), reviews: [previousReview()] }
    mocks.saveReview.mockRejectedValueOnce(new Error('Обзор не сохранён. Изменение отменено'))
    render(<MemoryRouter><ReviewPage /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Предыдущая неделя' }))
    const wins = screen.getByPlaceholderText('Главные победы и завершённые дела')
    await userEvent.clear(wins)
    await userEvent.type(wins, 'Новый текст A')
    await userEvent.click(screen.getByRole('radio', { name: '9' }))
    await userEvent.click(screen.getByRole('button', { name: 'Обновить обзор' }))
    expect(mocks.saveReview).toHaveBeenCalledWith(previousWeek, expect.objectContaining({ wins: 'Новый текст A', self_score: 9 }), expect.objectContaining({ period: expect.objectContaining({ weekStart: previousWeek }) }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Изменение отменено')
    expect(wins).toHaveValue('Новый текст A')
  })

  it('freezes fields and week navigation until a controlled save promise settles', async () => {
    mocks.data = { ...emptyData(), reviews: [previousReview()] }
    let release: (() => void) | undefined
    mocks.saveReview.mockReturnValueOnce(new Promise<void>((resolve) => { release = resolve }))
    render(<MemoryRouter><ReviewPage /></MemoryRouter>)
    const wins = screen.getByPlaceholderText('Главные победы и завершённые дела')
    const submittedText = `Неделя ${localDate()}`
    await userEvent.type(wins, submittedText)
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить обзор' }))

    expect(wins).toBeDisabled()
    expect(screen.getAllByRole('textbox').every((field) => (field as HTMLTextAreaElement).disabled)).toBe(true)
    expect(screen.getAllByRole('radio').every((radio) => (radio as HTMLInputElement).disabled)).toBe(true)
    expect(screen.getByRole('button', { name: 'Предыдущая неделя' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Следующая неделя' })).toBeDisabled()
    fireEvent.change(wins, { target: { value: 'Поздний ввод' } })
    fireEvent.click(screen.getByRole('button', { name: 'Предыдущая неделя' }))
    expect(wins).toHaveValue(submittedText)
    expect(screen.getByText('Текущая неделя')).toBeInTheDocument()

    await act(async () => { release?.() })
    expect(mocks.saveReview).toHaveBeenCalledWith(currentWeek, expect.objectContaining({ wins: submittedText }), expect.anything())
    expect(screen.getByText('Обзор недели сохранён')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Предыдущая неделя' }))
    expect(screen.getByDisplayValue('Сохранённая победа')).toBeInTheDocument()
  })
})
