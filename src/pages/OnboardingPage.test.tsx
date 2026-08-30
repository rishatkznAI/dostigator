import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionItem, AppData } from '../types'
import { localDate } from '../lib/date'
import { OnboardingPage } from './OnboardingPage'

const empty: AppData = { areas: [], goals: [], actions: [], habits: [], checkins: [], reviews: [] }
const goal = { id: 'goal-1', user_id: 'user-a', area_id: null, title: 'Закончить ремонт', description: '', why: '', kind: 'goal' as const, status: 'active' as const, progress: 0, target_date: null, completed_at: null, created_at: 'now', updated_at: 'now' }
const action: ActionItem = { id: 'action-1', user_id: 'user-a', goal_id: 'goal-1', title: 'Позвонить мастеру', status: 'todo', due_date: null, focus_date: null, focus_position: null, result_note: '', completed_at: null, created_at: 'now', updated_at: 'now' }

const mocks = vi.hoisted(() => ({
  data: null as AppData | null,
  addAction: vi.fn(),
  toggleFocus: vi.fn(),
  complete: vi.fn(),
  skip: vi.fn(),
}))

vi.mock('../context/DataContext', () => ({ useData: () => ({
  data: mocks.data ?? empty,
  addAction: mocks.addAction,
  toggleFocus: mocks.toggleFocus,
  isMutating: () => false,
  addGoal: vi.fn(),
}) }))
vi.mock('../context/OnboardingContext', () => ({ useOnboarding: () => ({ complete: mocks.complete, skip: mocks.skip, status: 'active' }) }))

describe('guided onboarding flow', () => {
  beforeEach(() => {
    mocks.data = empty
    mocks.addAction.mockReset().mockResolvedValue(undefined)
    mocks.toggleFocus.mockReset().mockResolvedValue(undefined)
    mocks.complete.mockReset()
    mocks.skip.mockReset()
  })

  afterEach(cleanup)

  it('explains Focus 3 and gives a direct first-goal CTA to an empty owner', () => {
    render(<MemoryRouter><OnboardingPage /></MemoryRouter>)
    expect(screen.getByText('Как работает «Фокус 3»')).toBeInTheDocument()
    expect(screen.getByText(/Выполненное дело остаётся занятым слотом до завтра/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Создать цель' })).toBeInTheDocument()
  })

  it('keeps the action step and input after a non-durable rollback', async () => {
    mocks.data = { ...empty, goals: [goal] }
    mocks.addAction.mockRejectedValueOnce(new Error('Действие не сохранено. Изменение отменено — попробуйте ещё раз.'))
    render(<MemoryRouter><OnboardingPage /></MemoryRouter>)
    const input = screen.getByRole('textbox', { name: 'Первое действие' })
    await userEvent.type(input, 'Позвонить мастеру')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить действие' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Изменение отменено')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(input).toHaveValue('Позвонить мастеру')
    expect(screen.getByText('2 из 3')).toBeInTheDocument()
  })

  it('does not show completion or allow skip before focus becomes durable', async () => {
    mocks.data = { ...empty, goals: [goal], actions: [action] }
    let release: (() => void) | undefined
    mocks.toggleFocus.mockImplementation(() => {
      mocks.data = { ...mocks.data!, actions: [{ ...action, focus_date: localDate(), focus_position: 1 }] }
      return new Promise<void>((resolve) => { release = resolve })
    })
    render(<MemoryRouter><OnboardingPage /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: /Позвонить мастеру.*Выбрать/ }))

    expect(screen.queryByText('Первый фокус собран')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Сохраняем/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Пропустить/ })).toBeDisabled()
    expect(mocks.complete).not.toHaveBeenCalled()

    await act(async () => { release?.() })
    expect(await screen.findByText('Первый фокус собран')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Перейти к сегодняшнему дню' }))
    expect(mocks.complete).toHaveBeenCalledTimes(1)
  })

  it('returns to focus selection after a failed optimistic focus', async () => {
    mocks.data = { ...empty, goals: [goal], actions: [action] }
    mocks.toggleFocus.mockImplementation(async () => {
      mocks.data = { ...mocks.data!, actions: [{ ...action, focus_date: localDate(), focus_position: 1 }] }
      await Promise.resolve()
      mocks.data = { ...mocks.data!, actions: [action] }
      throw new Error('rolled back')
    })
    render(<MemoryRouter><OnboardingPage /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: /Позвонить мастеру.*Выбрать/ }))
    expect(await screen.findByText('Поставьте действие в фокус')).toBeInTheDocument()
    expect(screen.queryByText('Первый фокус собран')).not.toBeInTheDocument()
    expect(mocks.complete).not.toHaveBeenCalled()
  })
})
