import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppData } from '../types'
import { GoalPage } from '../pages/GoalPage'
import { GoalsPage } from '../pages/GoalsPage'
import { HabitsPage } from '../pages/HabitsPage'
import { ReviewPage } from '../pages/ReviewPage'
import { AppShell } from './AppShell'
import { GoalForm } from './GoalForm'

const data: AppData = {
  areas: [],
  goals: [{ id: 'goal-1', user_id: 'user-a', area_id: null, title: 'Цель', description: '', why: '', kind: 'goal', status: 'active', progress: 0, target_date: null, completed_at: null, created_at: '2026-08-24T08:00:00.000Z', updated_at: '2026-08-24T08:00:00.000Z' }],
  actions: [], habits: [], checkins: [], reviews: [],
}

const mocks = vi.hoisted(() => ({
  addGoal: vi.fn(),
  addAction: vi.fn(),
  updateGoal: vi.fn(),
  addHabit: vi.fn(),
  toggleHabitToday: vi.fn(),
  setHabitActive: vi.fn(),
  saveReview: vi.fn(),
  goalAdding: false,
}))

vi.mock('../context/DataContext', () => ({
  useData: () => ({
    data,
    addGoal: mocks.addGoal,
    addAction: mocks.addAction,
    updateGoal: mocks.updateGoal,
    addHabit: mocks.addHabit,
    toggleHabitToday: mocks.toggleHabitToday,
    setHabitActive: mocks.setHabitActive,
    saveReview: mocks.saveReview,
    isMutating: (scope: string) => scope === 'goal-add' && mocks.goalAdding,
    pending: 0,
    failedSync: 0,
    quarantinedSync: 0,
    legacySyncQuarantine: false,
    syncing: false,
    online: true,
    error: null,
    mutationError: null,
    clearMutationError: vi.fn(),
    retrySync: vi.fn(),
  }),
}))

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-a' } }) }))
vi.mock('../context/OnboardingContext', () => ({ useOnboarding: () => ({ status: 'completed', skip: vi.fn() }) }))

describe('mutation form durability feedback', () => {
  afterEach(cleanup)

  beforeEach(() => {
    mocks.goalAdding = false
    Object.values(mocks).forEach((mock) => {
      if (typeof mock === 'function' && 'mockReset' in mock) mock.mockReset().mockResolvedValue(undefined)
    })
  })

  it('keeps the goal sheet and entered values when persistence is not durable', async () => {
    mocks.addGoal.mockRejectedValueOnce(new Error('Цель не сохранена. Изменение отменено — попробуйте ещё раз.'))
    const onClose = vi.fn()
    const onCreated = vi.fn()
    render(<MemoryRouter><Routes><Route element={<AppShell />}><Route index element={<GoalForm onClose={onClose} onCreated={onCreated} />} /></Route></Routes></MemoryRouter>)
    const title = screen.getByLabelText('Название')
    await userEvent.type(title, 'Новая цель')
    await userEvent.click(screen.getByRole('button', { name: 'Создать и начать' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Изменение отменено')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(title).toHaveValue('Новая цель')
    expect(onClose).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('uses global goal busy state and prevents closing the active sheet', () => {
    mocks.goalAdding = true
    const onClose = vi.fn()
    render(<GoalForm onClose={onClose} />)

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Сохраняем…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeDisabled()
    fireEvent.mouseDown(screen.getByRole('presentation'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('uses the accessible dialog contract for creating a goal', async () => {
    function Host() {
      const [open, setOpen] = useState(false)
      return <main data-testid="goal-background"><button type="button" onClick={() => setOpen(true)}>Открыть создание</button>{open && <GoalForm onClose={() => setOpen(false)} />}</main>
    }
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<Host />)
    const opener = screen.getByRole('button', { name: 'Открыть создание' })
    await userEvent.click(opener)

    expect(screen.getByLabelText('Название')).toHaveFocus()
    expect(screen.getByTestId('goal-background').parentElement).toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('hidden')
    expect(screen.getByRole('button', { name: 'Цель' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Проект' })).toHaveAttribute('aria-pressed', 'false')

    await userEvent.type(screen.getByLabelText('Название'), 'Новая цель')
    await userEvent.keyboard('{Escape}')
    expect(confirm).toHaveBeenCalledWith('Закрыть без сохранения изменений?')
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    confirm.mockReturnValue(true)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    expect(opener).toHaveFocus()
  })

  it('keeps the sheet mounted until its own controlled save becomes durable', async () => {
    let release: ((goal: { id: string }) => void) | undefined
    mocks.addGoal.mockReturnValue(new Promise((resolve) => { release = resolve }))
    const onClose = vi.fn()
    const onCreated = vi.fn()
    render(<GoalForm onClose={onClose} onCreated={onCreated} />)
    await userEvent.type(screen.getByLabelText('Название'), 'Цель A')
    await userEvent.click(screen.getByRole('button', { name: 'Создать и начать' }))

    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeDisabled()
    fireEvent.mouseDown(screen.getByRole('presentation'))
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => { release?.({ id: 'goal-a' }) })
    expect(await screen.findByRole('button', { name: 'Создать и начать' })).toBeEnabled()
    expect(onCreated).toHaveBeenCalledWith('goal-a')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('prevents opening a second goal sheet while another add is globally active', () => {
    mocks.goalAdding = true
    render(<MemoryRouter><GoalsPage /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Создать цель' })).toBeDisabled()
  })

  it('exposes the active goal filter as a pressed segmented control', async () => {
    mocks.goalAdding = false
    render(<MemoryRouter><GoalsPage /></MemoryRouter>)
    const current = screen.getByRole('button', { name: 'В работе' })
    const completed = screen.getByRole('button', { name: 'Достигнуты' })
    expect(current).toHaveAttribute('aria-pressed', 'true')
    expect(completed).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(completed)
    expect(current).toHaveAttribute('aria-pressed', 'false')
    expect(completed).toHaveAttribute('aria-pressed', 'true')
  })

  it('clears a new action only after a durable result', async () => {
    mocks.addAction.mockRejectedValueOnce(new Error('Действие не сохранено. Изменение отменено — попробуйте ещё раз.'))
    render(<MemoryRouter initialEntries={['/goals/goal-1']}><Routes><Route path="/goals/:goalId" element={<GoalPage />} /></Routes></MemoryRouter>)
    const input = screen.getByRole('textbox', { name: 'Следующее действие' })
    await userEvent.type(input, 'Позвонить')
    await userEvent.click(screen.getByRole('button', { name: 'Добавить шаг' }))
    expect(await screen.findByText(/Действие не сохранено/)).toBeInTheDocument()
    expect(input).toHaveValue('Позвонить')

    mocks.addAction.mockResolvedValueOnce({ id: 'action-new' })
    await userEvent.click(screen.getByRole('button', { name: 'Добавить шаг' }))
    expect(input).toHaveValue('')
  })

  it('keeps the habit form open and populated after rollback', async () => {
    mocks.addHabit.mockRejectedValueOnce(new Error('Привычка не сохранена. Изменение отменено — попробуйте ещё раз.'))
    render(<MemoryRouter><HabitsPage /></MemoryRouter>)
    await userEvent.click(screen.getAllByRole('button', { name: 'Добавить привычку' }).at(-1)!)
    const input = screen.getByRole('textbox', { name: 'Действие' })
    await userEvent.type(input, 'Читать')
    await userEvent.click(screen.getAllByRole('button', { name: 'Добавить привычку' }).at(-1)!)

    expect(await screen.findByRole('alert')).toHaveTextContent('Изменение отменено')
    expect(input).toHaveValue('Читать')
    expect(screen.getByRole('heading', { name: 'Что хотите повторять?' })).toBeInTheDocument()
  })

  it('cannot hide a pending habit form and keeps its eventual error visible', async () => {
    let reject: ((reason: Error) => void) | undefined
    mocks.addHabit.mockReturnValue(new Promise((_resolve, rejectPromise) => { reject = rejectPromise }))
    render(<MemoryRouter><HabitsPage /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Добавить привычку' }))
    const input = screen.getByRole('textbox', { name: 'Действие' })
    await userEvent.type(input, 'Читать')
    await userEvent.click(screen.getAllByRole('button', { name: 'Добавить привычку' }).at(-1)!)

    const opener = screen.getByRole('button', { name: 'Добавить привычку' })
    expect(opener).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Добавляем…' })).toBeDisabled()
    await userEvent.click(opener)
    expect(screen.getByRole('heading', { name: 'Что хотите повторять?' })).toBeInTheDocument()

    await act(async () => { reject?.(new Error('Привычка не сохранена. Изменение отменено — попробуйте ещё раз.')) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Изменение отменено')
    expect(input).toHaveValue('Читать')
  })

  it('never shows review success or clears text after a rolled-back save', async () => {
    mocks.saveReview.mockRejectedValueOnce(new Error('Обзор не сохранён. Изменение отменено — попробуйте ещё раз.'))
    render(<ReviewPage />)
    const wins = screen.getByRole('textbox', { name: 'Что получилось?' })
    await userEvent.type(wins, 'Завершил важное дело')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить обзор' }))

    expect(await screen.findByText(/Обзор не сохранён/)).toBeInTheDocument()
    expect(screen.queryByText('Обзор недели сохранён')).not.toBeInTheDocument()
    expect(wins).toHaveValue('Завершил важное дело')
  })
})
