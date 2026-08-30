import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useState, type ReactNode } from 'react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '../components/AppShell'
import type { HistoryNotice } from '../context/DataContext'
import type { HistoryEvent, PendingOperation } from '../types'
import { HistoryPage } from './HistoryPage'

const mocks = vi.hoisted(() => ({
  user: { id: 'user-a' },
  loadHistoryPage: vi.fn(),
  readQueue: vi.fn(),
  undoHistoryMutation: vi.fn(),
  clearMutationError: vi.fn(),
  queuedUndoBlockReason: vi.fn(),
  online: true,
  pending: 0,
  failedSync: 0,
  quarantinedSync: 0,
  legacySyncQuarantine: false,
  syncing: false,
  error: null as string | null,
  mutationError: null as string | null,
  historyNotice: null as HistoryNotice | null,
  retrySync: vi.fn(),
  dismissHistoryNotice: vi.fn(),
  undoLastMutation: vi.fn(),
}))

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('../context/OnboardingContext', () => ({ useOnboarding: () => ({ status: 'completed', skip: vi.fn() }) }))
vi.mock('../context/DataContext', () => ({
  useData: () => ({
    online: mocks.online,
    pending: mocks.pending,
    failedSync: mocks.failedSync,
    quarantinedSync: mocks.quarantinedSync,
    legacySyncQuarantine: mocks.legacySyncQuarantine,
    syncing: mocks.syncing,
    error: mocks.error,
    mutationError: mocks.mutationError,
    historyNotice: mocks.historyNotice,
    retrySync: mocks.retrySync,
    dismissHistoryNotice: mocks.dismissHistoryNotice,
    undoLastMutation: mocks.undoLastMutation,
    undoHistoryMutation: mocks.undoHistoryMutation,
    clearMutationError: mocks.clearMutationError,
    data: {
      areas: [{ id: 'area-1', name: 'Здоровье' }],
      goals: [{ id: 'goal-1', title: 'Книга', revision: 2 }],
      habits: [{ id: 'habit-1', title: 'Читать' }],
      actions: [], checkins: [], reviews: [],
    },
  }),
}))
vi.mock('../lib/repository', () => ({ loadHistoryPage: mocks.loadHistoryPage }))
vi.mock('../lib/offline', () => ({ readQueue: mocks.readQueue, queuedUndoBlockReason: mocks.queuedUndoBlockReason }))

function event(overrides: Partial<HistoryEvent> = {}): HistoryEvent {
  return {
    id: 'event-1',
    user_id: 'user-a',
    mutation_id: 'mutation-1',
    entity_type: 'goal',
    entity_id: 'goal-1',
    operation: 'goal_edit',
    label: 'Изменена цель «Книга»',
    before_data: { id: 'goal-1', title: 'Прочитать' },
    after_data: { id: 'goal-1', title: 'Прочитать полностью' },
    base_revision: 1,
    result_revision: 2,
    source: 'ui',
    reverts_event_id: null,
    created_at: '2026-08-28T09:30:00.000Z',
    ...overrides,
  }
}

let setGlobalError: ((message: string | null) => void) | null = null
function ErrorChannels({ children }: { children: ReactNode }) {
  const [globalError, setError] = useState<string | null>(null)
  useEffect(() => {
    setGlobalError = setError
    return () => { setGlobalError = null }
  }, [])
  return <>{globalError && <p data-testid="global-mutation-error" role="alert">{globalError}</p>}{children}</>
}

describe('HistoryPage', () => {
  beforeEach(() => {
    mocks.online = true
    mocks.pending = 0
    mocks.failedSync = 0
    mocks.quarantinedSync = 0
    mocks.legacySyncQuarantine = false
    mocks.syncing = false
    mocks.error = null
    mocks.mutationError = null
    mocks.historyNotice = null
    mocks.loadHistoryPage.mockReset().mockResolvedValue([event()])
    mocks.readQueue.mockReset().mockReturnValue([])
    mocks.undoHistoryMutation.mockReset().mockResolvedValue(undefined)
    mocks.clearMutationError.mockReset()
    mocks.queuedUndoBlockReason.mockReset().mockReturnValue(null)
  })
  afterEach(cleanup)

  it('shows readable server diffs and owner-scoped pending/failed state', async () => {
    const queued: PendingOperation = {
      id: 'queue-1',
      ownerId: 'user-a',
      type: 'mutation',
      table: 'dostigator_goals',
      payload: { id: 'goal-2', title: 'После' },
      mutation: {
        mutationId: 'pending-mutation',
        entityType: 'goal',
        entityId: 'goal-2',
        operation: 'goal_edit',
        label: 'Локально изменена цель',
        baseRevision: 4,
        before: { id: 'goal-2', title: 'До' },
      },
      mutationId: 'pending-mutation',
      label: 'Локально изменена цель',
      createdAt: '2026-08-28T10:00:00.000Z',
      state: 'failed',
      attempts: 1,
      lastError: 'revision conflict',
    }
    mocks.readQueue.mockReturnValue([queued])
    render(<HistoryPage />)

    expect(await screen.findByText('Изменена цель «Книга»')).toBeInTheDocument()
    expect(screen.getAllByText('Название').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Прочитать полностью')).toBeInTheDocument()
    expect(screen.getByText('Локально изменена цель')).toBeInTheDocument()
    expect(screen.getByText('Ошибка')).toBeInTheDocument()
    expect(screen.getByText('Причина: revision conflict')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(2)
  })

  it('runs Undo for a synced event and reloads authoritative history', async () => {
    mocks.loadHistoryPage
      .mockResolvedValueOnce([event()])
      .mockResolvedValueOnce([event({ id: 'undo-event', mutation_id: 'undo-1', operation: 'undo', label: 'Отмена: Изменена цель', reverts_event_id: 'event-1' })])
    render(<HistoryPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(mocks.undoHistoryMutation).toHaveBeenCalledWith(expect.objectContaining({ mutation_id: 'mutation-1' })))
    expect(await screen.findByText('Отмена: Изменена цель')).toBeInTheDocument()
  })

  it('does not offer a server Undo after a newer entity revision', async () => {
    mocks.loadHistoryPage.mockResolvedValue([event({ result_revision: 1, base_revision: 0 })])
    render(<HistoryPage />)

    expect(await screen.findByText('Есть более свежее изменение')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('keeps Undo available when the original operation intentionally removed the row', async () => {
    mocks.loadHistoryPage.mockResolvedValue([event({
      entity_type: 'habit_checkin', entity_id: 'checkin-removed', operation: 'habit_uncheck',
      before_data: { id: 'checkin-removed', habit_id: 'habit-1', checked_on: '2026-08-28', note: '' },
      after_data: null,
    })])
    render(<HistoryPage />)

    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  it('reveals every changed field instead of silently truncating the diff', async () => {
    mocks.loadHistoryPage.mockResolvedValue([event({
      before_data: { title: 'До', description: 'A', why: 'B', kind: 'goal', area_id: null, target_date: null, progress: 10 },
      after_data: { title: 'После', description: 'C', why: 'D', kind: 'project', area_id: 'area-1', target_date: '2026-09-10', progress: 20 },
    })])
    render(<HistoryPage />)

    const reveal = await screen.findByRole('button', { name: 'Показать ещё 2' })
    expect(screen.queryByText('Прогресс')).not.toBeInTheDocument()
    await userEvent.click(reveal)
    expect(screen.getByText('Прогресс')).toBeInTheDocument()
    expect(reveal).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows a failed Undo in one local alert and clears the global mutation channel', async () => {
    mocks.undoHistoryMutation.mockImplementationOnce(async () => {
      setGlobalError?.('Глобально: Undo отклонён')
      throw new Error('Undo отклонён')
    })
    mocks.clearMutationError.mockImplementation(() => { setGlobalError?.(null) })
    render(<ErrorChannels><HistoryPage /></ErrorChannels>)
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Undo отклонён')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.queryByTestId('global-mutation-error')).not.toBeInTheDocument()
    expect(mocks.clearMutationError).toHaveBeenCalledTimes(1)
  })

  it('keeps one assertive alert in the real AppShell and History failure composition', async () => {
    mocks.failedSync = 1
    mocks.historyNotice = {
      ownerId: 'user-a', mutationId: 'undo-failed', label: 'Undo не синхронизирован',
      status: 'failed', undoing: false, canUndo: false,
    }
    mocks.undoHistoryMutation.mockRejectedValueOnce(new Error('Undo отклонён из-за новой ревизии'))
    render(<MemoryRouter initialEntries={['/history']}><Routes>
      <Route element={<AppShell />}><Route path="history" element={<HistoryPage />} /></Route>
    </Routes></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))

    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent('Undo не синхронизирован')
    expect(screen.getByText('Undo отклонён из-за новой ревизии')).toHaveAttribute('role', 'status')
    expect(screen.getByText('Не синхронизировано: 1. Локальные изменения сохранены.')).toBeVisible()
    expect(screen.getByText('Сохранено локально, сервер отклонил синхронизацию')).toBeVisible()
  })

  it('does not offer Undo for an older queued revision', async () => {
    const queued: PendingOperation = {
      id: 'queue-older', ownerId: 'user-a', type: 'mutation', table: 'dostigator_goals',
      payload: { id: 'goal-1', title: 'A' }, mutation: {
        mutationId: 'older', entityType: 'goal', entityId: 'goal-1', operation: 'goal_edit',
        label: 'Версия A', baseRevision: 4, before: { id: 'goal-1', title: 'До' },
      }, mutationId: 'older', label: 'Версия A', createdAt: '2026-08-28T10:00:00.000Z',
      state: 'pending', attempts: 0, lastError: null,
    }
    mocks.readQueue.mockReturnValue([queued])
    mocks.queuedUndoBlockReason.mockImplementation((_owner: string, mutationId: string) => mutationId === 'older'
      ? 'Сначала отмените более новое локальное изменение этого объекта' : null)
    render(<HistoryPage />)

    expect(await screen.findByText('Сначала отмените более новое локальное изменение этого объекта')).toBeInTheDocument()
    expect(screen.getByText('Сначала синхронизируйте или разрешите более новые локальные изменения')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('resolves relations and enums without exposing raw UUIDs or technical fields', async () => {
    mocks.loadHistoryPage.mockResolvedValue([event({
      entity_type: 'action',
      before_data: { id: 'action-1', goal_id: null, status: 'todo', last_mutation_id: '00000000-0000-4000-8000-000000000001' },
      after_data: { id: 'action-1', goal_id: 'goal-1', status: 'done', last_mutation_id: '00000000-0000-4000-8000-000000000002' },
    })])
    render(<HistoryPage />)

    expect(await screen.findByText('В работе')).toBeInTheDocument()
    expect(screen.getByText('Выполнено')).toBeInTheDocument()
    expect(screen.getByText('Книга')).toBeInTheDocument()
    expect(screen.queryByText(/00000000-0000-4000/)).not.toBeInTheDocument()
    expect(screen.queryByText('last_mutation_id')).not.toBeInTheDocument()
  })

  it('uses a stable two-part cursor and never requests an unbounded page', async () => {
    const first = Array.from({ length: 30 }, (_, index) => event({
      id: `event-${String(index).padStart(2, '0')}`,
      mutation_id: `mutation-${index}`,
      label: `Событие ${index}`,
      created_at: `2026-08-28T09:${String(59 - index).padStart(2, '0')}:00.000Z`,
    }))
    mocks.loadHistoryPage.mockResolvedValueOnce(first).mockResolvedValueOnce([event({ id: 'older', label: 'Старое событие' })])
    render(<HistoryPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Показать ещё' }))
    expect(mocks.loadHistoryPage).toHaveBeenNthCalledWith(2, {
      createdAt: first[29].created_at,
      id: first[29].id,
    }, 30)
    expect(await screen.findByText('Старое событие')).toBeInTheDocument()
  })

  it('explains why Undo is unavailable without a network connection', async () => {
    mocks.online = false
    render(<HistoryPage />)
    expect(await screen.findByText('Для Undo нужна сеть')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('reloads server history when a queued operation becomes synced', async () => {
    const pending = {
      id: 'queue-1', ownerId: 'user-a', type: 'mutation', table: 'dostigator_goals',
      payload: { id: 'goal-1', title: 'После' }, mutation: {
        mutationId: 'queued-mutation', entityType: 'goal', entityId: 'goal-1', operation: 'goal_edit',
        label: 'Очередь', baseRevision: 1, before: { id: 'goal-1', title: 'До' },
      }, mutationId: 'queued-mutation', label: 'Очередь', createdAt: '2026-08-28T10:00:00.000Z',
      state: 'pending', attempts: 0, lastError: null,
    } satisfies PendingOperation
    mocks.readQueue.mockReturnValue([pending])
    mocks.loadHistoryPage.mockResolvedValueOnce([]).mockResolvedValueOnce([event({ mutation_id: 'queued-mutation', label: 'Подтверждено' })])
    render(<HistoryPage />)
    expect(await screen.findByText('Очередь')).toBeInTheDocument()

    mocks.readQueue.mockReturnValue([])
    window.dispatchEvent(new Event('dostigator:queue'))

    expect(await screen.findByText('Подтверждено')).toBeInTheDocument()
    expect(screen.queryByText('Очередь')).not.toBeInTheDocument()
  })

  it('ignores an older silent reload that resolves after a newer one', async () => {
    mocks.loadHistoryPage.mockResolvedValueOnce([event({ label: 'Начальное' })])
    render(<HistoryPage />)
    expect(await screen.findByText('Начальное')).toBeInTheDocument()
    let resolveOlder!: (value: HistoryEvent[]) => void
    let resolveNewer!: (value: HistoryEvent[]) => void
    mocks.loadHistoryPage
      .mockReturnValueOnce(new Promise((resolve) => { resolveOlder = resolve }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveNewer = resolve }))

    act(() => {
      window.dispatchEvent(new Event('dostigator:queue'))
      window.dispatchEvent(new Event('dostigator:queue'))
    })
    await act(async () => { resolveNewer([event({ id: 'a', label: 'A' }), event({ id: 'b', label: 'B' })]) })
    expect(await screen.findByText('B')).toBeInTheDocument()
    await act(async () => { resolveOlder([event({ id: 'a', label: 'A' })]) })

    expect(screen.getByText('B')).toBeInTheDocument()
  })
})
