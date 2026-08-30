import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryNotice } from '../context/DataContext'
import { AppShell } from './AppShell'

const mocks = vi.hoisted(() => ({
  retrySync: vi.fn(),
  clearMutationError: vi.fn(),
  dismissHistoryNotice: vi.fn(),
  undoLastMutation: vi.fn(),
  skipOnboarding: vi.fn(),
  onboardingStatus: 'completed' as 'active' | 'completed' | 'skipped',
  state: {
    pending: 0,
    failedSync: 0,
    quarantinedSync: 0,
    legacySyncQuarantine: false,
    syncing: false,
    online: true,
    error: null as string | null,
    mutationError: null as string | null,
    historyNotice: null as HistoryNotice | null,
  },
}))

vi.mock('../context/DataContext', () => ({
  useData: () => ({
    ...mocks.state,
    retrySync: mocks.retrySync,
    clearMutationError: mocks.clearMutationError,
    dismissHistoryNotice: mocks.dismissHistoryNotice,
    undoLastMutation: mocks.undoLastMutation,
  }),
}))
vi.mock('../context/OnboardingContext', () => ({
  useOnboarding: () => ({ status: mocks.onboardingStatus, skip: mocks.skipOnboarding }),
}))

function renderShell() {
  return render(<MemoryRouter><Routes><Route element={<AppShell />}><Route index element={<p>Контент</p>} /></Route></Routes></MemoryRouter>)
}

describe('sync status', () => {
  afterEach(cleanup)

  beforeEach(() => {
    mocks.retrySync.mockReset()
    mocks.clearMutationError.mockReset()
    mocks.dismissHistoryNotice.mockReset()
    mocks.undoLastMutation.mockReset()
    mocks.skipOnboarding.mockReset()
    mocks.onboardingStatus = 'completed'
    Object.assign(mocks.state, { pending: 0, failedSync: 0, quarantinedSync: 0, legacySyncQuarantine: false, syncing: false, online: true, error: null, mutationError: null, historyNotice: null })
  })

  it('announces failed operations and offers an explicit retry', async () => {
    Object.assign(mocks.state, { failedSync: 2 })
    renderShell()
    expect(screen.getByRole('alert')).toHaveTextContent('Не синхронизировано: 2')
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(mocks.retrySync).toHaveBeenCalledTimes(1)
  })

  it('disables retry while synchronization is running', () => {
    Object.assign(mocks.state, { failedSync: 1, syncing: true })
    renderShell()
    expect(screen.getByRole('button', { name: 'Повторяем…' })).toBeDisabled()
  })

  it('reports pending operations without claiming they are saved', () => {
    Object.assign(mocks.state, { pending: 3 })
    renderShell()
    expect(screen.getByRole('status')).toHaveTextContent('Ожидают синхронизации: 3')
    expect(screen.queryByText('Все изменения сохранены')).not.toBeInTheDocument()
  })

  it('links quarantined data to the recovery controls', () => {
    Object.assign(mocks.state, { quarantinedSync: 2 })
    renderShell()
    expect(screen.getByRole('alert')).toHaveTextContent('Требуют восстановления: 2')
    expect(screen.getByRole('link', { name: 'Открыть' })).toHaveAttribute('href', '/settings')
  })

  it('offers retry for online pending operations', async () => {
    Object.assign(mocks.state, { pending: 1, online: true })
    renderShell()
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(mocks.retrySync).toHaveBeenCalledTimes(1)
  })

  it('does not expose unattributed legacy payload and routes to the explanation', () => {
    Object.assign(mocks.state, { legacySyncQuarantine: true })
    renderShell()
    expect(screen.getByRole('alert')).toHaveTextContent('без подтверждённого владельца')
    expect(screen.getByRole('link', { name: 'Открыть' })).toHaveAttribute('href', '/settings')
  })

  it('announces a rolled-back mutation in a dismissible accessible alert', async () => {
    Object.assign(mocks.state, { mutationError: 'Действие не сохранено. Изменение отменено — попробуйте ещё раз.' })
    renderShell()
    expect(screen.getByRole('alert')).toHaveTextContent('Изменение отменено')
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть сообщение об ошибке' }))
    expect(mocks.clearMutationError).toHaveBeenCalledTimes(1)
  })

  it('uses one assertive channel when mutation, history and sync failures coexist', () => {
    Object.assign(mocks.state, {
      mutationError: 'Изменение отклонено',
      failedSync: 2,
      historyNotice: {
        ownerId: 'user-a', mutationId: 'mutation-a', label: 'Undo отклонён',
        status: 'failed', undoing: false, canUndo: false,
      },
    })
    renderShell()

    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent('Изменение отклонено')
    expect(screen.getByText('Не синхронизировано: 2. Локальные изменения сохранены.')).toBeVisible()
    expect(screen.getByText('Сохранено локально, сервер отклонил синхронизацию')).toBeVisible()
  })

  it('keeps simultaneous visual notices in one measurable flow stack before main content', () => {
    Object.assign(mocks.state, {
      mutationError: 'Изменение отклонено',
      pending: 3,
      historyNotice: {
        ownerId: 'user-a', mutationId: 'mutation-a', label: 'Цель обновлена',
        status: 'pending', undoing: false, canUndo: true,
      },
    })
    renderShell()

    const stack = screen.getByRole('region', { name: 'Уведомления приложения' })
    expect(within(stack).getByText('Изменение отклонено')).toBeVisible()
    expect(within(stack).getByText('Цель обновлена')).toBeVisible()
    expect(within(stack).getByText('Ожидают синхронизации: 3')).toBeVisible()
    expect(stack.nextElementSibling?.tagName).toBe('MAIN')
  })

  it('provides a named primary navigation with readable link labels', () => {
    renderShell()
    const navigation = screen.getByRole('navigation', { name: 'Основная навигация' })
    for (const label of ['Сегодня', 'Цели', 'Привычки', 'Обзор', 'Профиль']) {
      expect(within(navigation).getByRole('link', { name: label })).toBeVisible()
    }
  })

  it('lets navigation leave an unfinished onboarding flow instead of redirecting back', async () => {
    mocks.onboardingStatus = 'active'
    render(<MemoryRouter initialEntries={['/onboarding']}><Routes><Route element={<AppShell />}><Route path="onboarding" element={<p>Знакомство</p>} /><Route path="training" element={<p>Тренировки открыты</p>} /></Route></Routes></MemoryRouter>)

    await userEvent.click(screen.getByRole('link', { name: 'Тренировки' }))

    expect(mocks.skipOnboarding).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Тренировки открыты')).toBeInTheDocument()
  })
})
