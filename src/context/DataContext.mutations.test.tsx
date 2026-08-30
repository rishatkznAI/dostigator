import { act, cleanup, render, waitFor } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localDate, shiftDate, startOfWeek } from '../lib/date'
import type { AppData, WeeklyMetrics } from '../types'
import { DataProvider, useData } from './DataContext'

const mocks = vi.hoisted(() => ({
  user: { id: 'user-a' } as { id: string } | null,
  cacheData: vi.fn(),
  loadAppData: vi.fn(),
  readCachedData: vi.fn(),
  persistOrQueue: vi.fn(),
  persistUndoOrQueue: vi.fn(),
  flushQueue: vi.fn(),
  queueStats: vi.fn(),
  readQueue: vi.fn(),
  discardRejectedMutation: vi.fn(),
  queuedUndoBlockReason: vi.fn(),
}))

vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('../lib/repository', () => ({
  cacheData: mocks.cacheData,
  loadAppData: mocks.loadAppData,
  readCachedData: mocks.readCachedData,
  stripOwnership: (row: Record<string, unknown>) => row,
}))
vi.mock('../lib/offline', () => ({
  queueStats: mocks.queueStats,
  flushQueue: mocks.flushQueue,
  retryFailed: vi.fn().mockResolvedValue({ completed: 0, pending: 0, failed: 0, quarantined: 0, legacyQuarantined: false }),
  persistOrQueue: mocks.persistOrQueue,
  persistUndoOrQueue: mocks.persistUndoOrQueue,
  readQueue: mocks.readQueue,
  discardRejectedMutation: mocks.discardRejectedMutation,
  quarantineFailedQueue: vi.fn().mockResolvedValue(0),
  queuedUndoBlockReason: mocks.queuedUndoBlockReason,
}))

const timestamp = '2026-08-24T08:00:00.000Z'
const metrics: WeeklyMetrics = { score: 50, focus: null, habits: null, actions: { done: 2, target: 5, rate: .4 }, period: { weekStart: startOfWeek(), asOf: localDate() } }

function appData(owner = 'user-a'): AppData {
  return {
    areas: [],
    goals: [{
      id: 'goal-1', user_id: owner, area_id: null, title: 'Исходная цель', description: 'Описание', why: 'Причина',
      kind: 'goal', status: 'active', progress: 25, target_date: '2026-12-01', completed_at: null,
      created_at: timestamp, updated_at: timestamp,
    }],
    actions: [
      { id: 'action-1', user_id: owner, goal_id: 'goal-1', title: 'Первое', status: 'todo', due_date: null, focus_date: null, focus_position: null, result_note: 'Старая заметка', completed_at: null, created_at: timestamp, updated_at: timestamp },
      { id: 'action-2', user_id: owner, goal_id: 'goal-1', title: 'Второе', status: 'todo', due_date: null, focus_date: null, focus_position: null, result_note: '', completed_at: null, created_at: timestamp, updated_at: timestamp },
    ],
    habits: [
      { id: 'habit-1', user_id: owner, area_id: null, title: 'Читать', target_per_week: 5, active: true, activity_periods: [{ started_on: '2026-08-24', ended_on: null }], created_at: timestamp, updated_at: timestamp },
      { id: 'habit-2', user_id: owner, area_id: null, title: 'Гулять', target_per_week: 3, active: true, activity_periods: [{ started_on: '2026-08-24', ended_on: null }], created_at: timestamp, updated_at: timestamp },
    ],
    checkins: [{ id: 'checkin-1', user_id: owner, habit_id: 'habit-1', checked_on: localDate(), note: 'Было', created_at: timestamp }],
    reviews: [{ id: 'review-1', user_id: owner, week_start: startOfWeek(), wins: 'Старые победы', blockers: 'Старые помехи', next_focus: 'Старый фокус', self_score: 6, metrics_snapshot: metrics, created_at: timestamp, updated_at: timestamp }],
    focusCommitments: [],
  }
}

let api: ReturnType<typeof useData>

function Probe() {
  const value = useData()
  useLayoutEffect(() => { api = value }, [value])
  return <output data-testid="state">{JSON.stringify(value.data)}</output>
}

function renderData(initial: AppData) {
  mocks.readCachedData.mockImplementation((owner: string) => owner === initial.goals[0]?.user_id || owner === initial.habits[0]?.user_id ? initial : appData(owner))
  return render(<DataProvider><Probe /></DataProvider>)
}

beforeEach(() => {
  mocks.user = { id: 'user-a' }
  mocks.cacheData.mockReset()
  mocks.loadAppData.mockReset().mockRejectedValue(new Error('offline'))
  mocks.persistOrQueue.mockReset().mockResolvedValue(undefined)
  mocks.persistUndoOrQueue.mockReset().mockResolvedValue({ status: 'synced', mutationId: 'undo', event: null })
  mocks.queueStats.mockReset().mockReturnValue({ pending: 0, failed: 0, quarantined: 0, legacyQuarantined: false })
  mocks.flushQueue.mockReset().mockResolvedValue({ completed: 0, pending: 0, failed: 0, quarantined: 0, legacyQuarantined: false })
  mocks.readQueue.mockReset().mockReturnValue([])
  mocks.discardRejectedMutation.mockReset().mockResolvedValue(undefined)
  mocks.queuedUndoBlockReason.mockReset().mockReturnValue(null)
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
})

afterEach(cleanup)

type RollbackCase = {
  name: string
  initial?: () => AppData
  persistence: 'upsert'
  globalError?: boolean
  run(): Promise<unknown>
}

const rollbackCases: RollbackCase[] = [
  { name: 'addGoal', persistence: 'upsert', run: () => api.addGoal({ title: 'Новая', kind: 'goal', areaId: null, targetDate: null, why: '' }) },
  { name: 'updateGoal', persistence: 'upsert', globalError: true, run: () => api.updateGoal('goal-1', { status: 'completed', progress: 100, title: 'Изменена' }) },
  { name: 'addAction', persistence: 'upsert', run: () => api.addAction('goal-1', 'Новое действие') },
  { name: 'toggleAction', persistence: 'upsert', globalError: true, run: () => api.toggleAction('action-1', 'Новый результат') },
  { name: 'deleteAction', persistence: 'upsert', globalError: true, run: () => api.deleteAction('action-1') },
  { name: 'toggleFocus', persistence: 'upsert', globalError: true, run: () => api.toggleFocus('action-1') },
  { name: 'addHabit', persistence: 'upsert', run: () => api.addHabit('Новая привычка', 4, null) },
  { name: 'toggleHabitToday create', persistence: 'upsert', globalError: true, run: () => api.toggleHabitToday('habit-2') },
  { name: 'toggleHabitToday delete', persistence: 'upsert', globalError: true, run: () => api.toggleHabitToday('habit-1') },
  { name: 'setHabitActive', persistence: 'upsert', globalError: true, run: () => api.setHabitActive('habit-1', false) },
  { name: 'saveReview update', persistence: 'upsert', run: () => api.saveReview(startOfWeek(), { wins: 'Новые', blockers: 'Новые', next_focus: 'Новый', self_score: 10 }, metrics) },
  { name: 'saveReview create', initial: () => ({ ...appData(), reviews: [] }), persistence: 'upsert', run: () => api.saveReview(startOfWeek(), { wins: 'Новые', blockers: '', next_focus: '', self_score: 8 }, metrics) },
]

describe('mutation rollback contract', () => {
  it.each(rollbackCases)('restores only the exact previous state for $name', async ({ initial: makeInitial, persistence, globalError = false, run }) => {
    const initial = makeInitial?.() ?? appData()
    renderData(initial)
    await waitFor(() => expect(api.data).toEqual(initial))
    const cacheCallsBefore = mocks.cacheData.mock.calls.length
    const failure = new DOMException('quota exceeded', 'QuotaExceededError')
    if (persistence === 'upsert') mocks.persistOrQueue.mockRejectedValueOnce(failure)

    await act(async () => { await expect(run()).rejects.toThrow('Изменение отменено') })

    expect(api.data).toEqual(initial)
    if (globalError) expect(api.mutationError).toContain('Изменение отменено')
    else expect(api.mutationError).toBeNull()
    await waitFor(() => expect(mocks.cacheData.mock.calls.length).toBeGreaterThan(cacheCallsBefore))
    expect(mocks.cacheData.mock.calls.at(-1)).toEqual(['user-a', initial])
  })

  it('keeps a durable queued/server-rejected optimistic change', async () => {
    const initial = appData()
    renderData(initial)
    mocks.persistOrQueue.mockResolvedValueOnce(undefined)

    await act(async () => { await api.toggleAction('action-1', 'Готово') })

    expect(api.data.actions[0]).toMatchObject({ status: 'done', result_note: 'Готово' })
    expect(api.mutationError).toBeNull()
  })

  it('applies immediate Undo locally and sends the exact original mutation id', async () => {
    const initial = appData()
    initial.actions[0] = { ...initial.actions[0], revision: 4, last_mutation_id: 'previous' }
    renderData(initial)
    mocks.persistOrQueue.mockResolvedValueOnce({ status: 'synced', mutationId: 'original', event: null })

    await act(async () => { await api.updateAction('action-1', { title: '  Новое название  ' }) })
    const descriptor = mocks.persistOrQueue.mock.calls[0][3]
    expect(api.data.actions[0].title).toBe('Новое название')
    expect(api.historyNotice).toMatchObject({ canUndo: true, status: 'synced' })

    await act(async () => { await api.undoLastMutation() })

    expect(api.data.actions[0].title).toBe('Первое')
    const undoMutationId = mocks.persistUndoOrQueue.mock.calls[0][2]
    expect(mocks.persistUndoOrQueue).toHaveBeenCalledWith('user-a', descriptor.mutationId, undoMutationId, expect.stringContaining('Отмена'), descriptor)
    expect(api.data.actions[0]).toMatchObject({ revision: 6, last_mutation_id: undoMutationId })
    expect(api.historyNotice).toMatchObject({ canUndo: false, label: 'Изменение отменено' })

    await act(async () => { await api.updateAction('action-1', { due_date: '2026-12-12' }) })
    expect(mocks.persistOrQueue.mock.calls[1][3]).toMatchObject({ baseRevision: 6 })
  })

  it('keeps a 240-character action title while reserving room for the server Undo label', async () => {
    const title = 'А'.repeat(240)
    renderData(appData())

    await act(async () => { await api.addAction('goal-1', title) })

    const descriptor = mocks.persistOrQueue.mock.calls[0][3]
    expect(api.data.actions.find((item) => item.title === title)).toBeTruthy()
    expect(Array.from(descriptor.label)).toHaveLength(172)
    expect(descriptor.label.endsWith('…')).toBe(true)
    await act(async () => { await api.undoLastMutation() })
    expect(mocks.persistUndoOrQueue.mock.calls[0][4]).toEqual(descriptor)
  })

  it('keeps a valid emoji action label within database code-point limits', async () => {
    const title = '😀'.repeat(120)
    renderData(appData())

    await act(async () => { await api.addAction('goal-1', title) })

    const descriptor = mocks.persistOrQueue.mock.calls[0][3]
    expect(api.data.actions.find((item) => item.title === title)).toBeTruthy()
    expect(Array.from(descriptor.label).length).toBeLessThanOrEqual(172)
    expect(descriptor.label.length).toBeGreaterThan(180)
  })

  it('bounds a reloaded queued Undo label even when the original label uses all 180 code points', async () => {
    renderData(appData())
    const queued = {
      id: 'queue-long-label', ownerId: 'user-a', type: 'mutation' as const, table: 'dostigator_goals' as const,
      payload: { id: 'goal-1', title: 'Локальная версия' },
      mutation: {
        mutationId: 'queued-long-label', entityType: 'goal' as const, entityId: 'goal-1',
        operation: 'goal_edit' as const, label: 'Я'.repeat(180), baseRevision: 0,
        before: { ...appData().goals[0] }, source: 'offline' as const,
      },
      mutationId: 'queued-long-label', label: 'Я'.repeat(180), createdAt: timestamp,
      state: 'pending' as const, attempts: 0, lastError: null,
    }
    mocks.readQueue.mockReturnValue([queued])
    const localEvent = {
      id: queued.id, user_id: 'user-a', mutation_id: queued.mutationId, entity_type: 'goal' as const,
      entity_id: 'goal-1', operation: 'goal_edit' as const, label: queued.label,
      before_data: queued.mutation.before, after_data: queued.payload, base_revision: 0, result_revision: 1,
      source: 'offline' as const, reverts_event_id: null, created_at: timestamp,
    }

    await act(async () => { await api.undoHistoryMutation(localEvent) })

    const inverseLabel = mocks.persistUndoOrQueue.mock.calls[0][3]
    expect(Array.from(inverseLabel)).toHaveLength(180)
    expect(inverseLabel.endsWith('…')).toBe(true)
  })

  it('reapplies the local change when revision-safe Undo is rejected', async () => {
    renderData(appData())
    await act(async () => { await api.updateGoal('goal-1', { title: 'Новая версия' }) })
    mocks.persistUndoOrQueue.mockResolvedValueOnce({ status: 'failed', mutationId: 'undo', event: null })

    await act(async () => { await expect(api.undoLastMutation()).rejects.toThrow('более свежие данные') })

    expect(api.data.goals[0].title).toBe('Новая версия')
    expect(api.historyNotice).toMatchObject({ canUndo: true, undoing: false })
  })

  it('does not persist or create history for a trimmed no-op edit', async () => {
    renderData(appData())
    await act(async () => { await api.updateGoal('goal-1', { title: '  Исходная цель  ', why: '  Причина  ' }) })
    expect(mocks.persistOrQueue).not.toHaveBeenCalled()
    expect(api.historyNotice).toBeNull()
  })

  it('edits action text without corrupting completion, status or focus semantics', async () => {
    const initial = appData()
    initial.actions[0] = { ...initial.actions[0], status: 'done', completed_at: timestamp, focus_date: localDate(), focus_position: 1 }
    renderData(initial)
    await act(async () => { await api.updateAction('action-1', { title: 'Уточнённый текст' }) })
    expect(api.data.actions[0]).toMatchObject({
      title: 'Уточнённый текст', status: 'done', completed_at: timestamp,
      focus_date: localDate(), focus_position: 1, result_note: 'Старая заметка',
    })
    expect(mocks.persistOrQueue.mock.calls[0][3]).toMatchObject({ operation: 'action_edit' })
  })

  it('edits a habit without rewriting its activity periods', async () => {
    const initial = appData()
    const periods = initial.habits[0].activity_periods
    renderData(initial)
    await act(async () => { await api.updateHabit('habit-1', { title: 'Читать ежедневно', target_per_week: 7 }) })
    expect(api.data.habits[0].activity_periods).toEqual(periods)
    expect(mocks.persistOrQueue.mock.calls[0][3]).toMatchObject({ operation: 'habit_edit' })
  })

  it('does not roll back a parallel successful record when another record fails', async () => {
    const initial = appData()
    renderData(initial)
    mocks.persistOrQueue.mockImplementation((_owner: string, _table: string, row: { id: string }) => row.id === 'action-1'
      ? Promise.reject(new DOMException('quota exceeded'))
      : Promise.resolve())

    const first = api.toggleAction('action-1')
    const second = api.toggleAction('action-2')
    await act(async () => { await Promise.allSettled([first, second]) })

    expect(api.data.actions.find((item) => item.id === 'action-1')?.status).toBe('todo')
    expect(api.data.actions.find((item) => item.id === 'action-2')?.status).toBe('done')
    await waitFor(() => {
      const cached = mocks.cacheData.mock.calls.at(-1)?.[1] as AppData
      expect(cached.actions.find((item) => item.id === 'action-1')?.status).toBe('todo')
      expect(cached.actions.find((item) => item.id === 'action-2')?.status).toBe('done')
    })
  })

  it('blocks Undo that would restore a fourth Focus-3 action', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    const initial = appData()
    const today = localDate()
    initial.actions = [
      { ...initial.actions[0], id: 'action-a', title: 'A', focus_date: today, focus_position: 1, revision: 1 },
      { ...initial.actions[1], id: 'action-b', title: 'B', focus_date: today, focus_position: 2, revision: 1 },
      { ...initial.actions[1], id: 'action-c', title: 'C', focus_date: today, focus_position: 3, revision: 1 },
      { ...initial.actions[1], id: 'action-d', title: 'D', focus_date: null, focus_position: null, revision: 1 },
    ]
    renderData(initial)
    await act(async () => { await api.toggleFocus('action-a') })
    const removedDescriptor = mocks.persistOrQueue.mock.calls[0][3]
    await act(async () => { await api.toggleFocus('action-d') })
    const event = {
      id: 'focus-event', user_id: 'user-a', mutation_id: removedDescriptor.mutationId,
      entity_type: 'action' as const, entity_id: 'action-a', operation: 'focus_remove' as const,
      label: removedDescriptor.label, before_data: removedDescriptor.before, after_data: null,
      base_revision: 1, result_revision: 2, source: 'ui' as const, reverts_event_id: null,
      created_at: timestamp,
    }

    await act(async () => { await expect(api.undoHistoryMutation(event)).rejects.toThrow('Фокусе 3') })

    expect(api.data.actions.filter((item) => item.focus_date === today)).toHaveLength(3)
    expect(mocks.persistUndoOrQueue).not.toHaveBeenCalled()
  })

  it('blocks server Undo ahead of a newer queued edit of the same entity', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    const initial = appData()
    initial.goals[0] = { ...initial.goals[0], revision: 2 }
    renderData(initial)
    mocks.readQueue.mockReturnValue([{
      id: 'queue-newer', ownerId: 'user-a', type: 'mutation', table: 'dostigator_goals',
      payload: { ...initial.goals[0], title: 'Локальная версия', revision: 3 },
      mutation: {
        mutationId: 'local-newer', entityType: 'goal', entityId: 'goal-1', operation: 'goal_edit',
        label: 'Локально изменена цель', baseRevision: 2, before: initial.goals[0], source: 'offline',
      }, mutationId: 'local-newer', label: 'Локально изменена цель', createdAt: timestamp,
      state: 'pending', attempts: 0, lastError: null,
    }])
    const serverEvent = {
      id: 'server-event', user_id: 'user-a', mutation_id: 'server-edit', entity_type: 'goal' as const,
      entity_id: 'goal-1', operation: 'goal_edit' as const, label: 'Изменена цель',
      before_data: { id: 'goal-1', title: 'До' }, after_data: { id: 'goal-1', title: 'Исходная цель' },
      base_revision: 1, result_revision: 2, source: 'ui' as const, reverts_event_id: null, created_at: timestamp,
    }

    await act(async () => { await expect(api.undoHistoryMutation(serverEvent)).rejects.toThrow('локальные изменения') })

    expect(mocks.persistUndoOrQueue).not.toHaveBeenCalled()
  })

  it('blocks server goal-create Undo ahead of a queued child create', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    const initial = appData()
    initial.goals[0] = { ...initial.goals[0], revision: 1 }
    initial.actions = []
    renderData(initial)
    mocks.readQueue.mockReturnValue([{
      id: 'queue-child', ownerId: 'user-a', type: 'mutation', table: 'dostigator_actions',
      payload: { id: 'action-new', goal_id: 'goal-1', title: 'Новый шаг' },
      mutation: {
        mutationId: 'child-create', entityType: 'action', entityId: 'action-new', operation: 'action_create',
        label: 'Создано действие', baseRevision: 0, before: null, source: 'offline',
      }, mutationId: 'child-create', label: 'Создано действие', createdAt: timestamp,
      state: 'pending', attempts: 0, lastError: null,
    }])
    const createEvent = {
      id: 'goal-create-event', user_id: 'user-a', mutation_id: 'server-goal-create', entity_type: 'goal' as const,
      entity_id: 'goal-1', operation: 'goal_create' as const, label: 'Создана цель',
      before_data: null, after_data: { id: 'goal-1', title: 'Исходная цель' }, base_revision: 0, result_revision: 1,
      source: 'ui' as const, reverts_event_id: null, created_at: timestamp,
    }

    await act(async () => { await expect(api.undoHistoryMutation(createEvent)).rejects.toThrow('локальные изменения') })

    expect(mocks.persistUndoOrQueue).not.toHaveBeenCalled()
  })

  it('serializes server goal-create Undo with an in-flight child create', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    const initial = appData()
    initial.goals[0] = { ...initial.goals[0], revision: 1 }
    initial.actions = []
    renderData(initial)
    let release: (() => void) | undefined
    mocks.persistOrQueue.mockReturnValueOnce(new Promise<void>((resolve) => { release = resolve }))
    const addChild = api.addAction('goal-1', 'Новый шаг')
    await waitFor(() => expect(mocks.persistOrQueue).toHaveBeenCalledTimes(1))
    const createEvent = {
      id: 'goal-create-event', user_id: 'user-a', mutation_id: 'server-goal-create', entity_type: 'goal' as const,
      entity_id: 'goal-1', operation: 'goal_create' as const, label: 'Создана цель',
      before_data: null, after_data: { id: 'goal-1', title: 'Исходная цель' }, base_revision: 0, result_revision: 1,
      source: 'ui' as const, reverts_event_id: null, created_at: timestamp,
    }

    await act(async () => { await expect(api.undoHistoryMutation(createEvent)).rejects.toThrow('предыдущего изменения') })
    expect(mocks.persistUndoOrQueue).not.toHaveBeenCalled()
    release?.()
    await act(async () => { await addChild })
  })

  it('reconstructs a queued check-in Undo lock with the habit id after reload', async () => {
    renderData(appData())
    const queued = {
      id: 'queue-checkin', ownerId: 'user-a', type: 'mutation' as const, table: 'dostigator_habit_checkins' as const,
      payload: { id: 'checkin-1', habit_id: 'habit-1', checked_on: localDate(), note: '' },
      mutation: {
        mutationId: 'queued-checkin', entityType: 'habit_checkin' as const, entityId: 'checkin-1',
        operation: 'habit_check' as const, label: 'Отмечена привычка', baseRevision: 0, before: null,
      },
      mutationId: 'queued-checkin', label: 'Отмечена привычка', createdAt: timestamp,
      state: 'pending' as const, attempts: 0, lastError: null,
    }
    mocks.readQueue.mockReturnValue([queued])
    let release: ((value: { status: 'pending'; mutationId: string; event: null }) => void) | undefined
    mocks.persistUndoOrQueue.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    const event = {
      id: queued.id, user_id: 'user-a', mutation_id: queued.mutationId, entity_type: 'habit_checkin' as const,
      entity_id: 'checkin-1', operation: 'habit_check' as const, label: queued.label,
      before_data: null, after_data: queued.payload, base_revision: 0, result_revision: 1,
      source: 'offline' as const, reverts_event_id: null, created_at: timestamp,
    }

    const undo = api.undoHistoryMutation(event)
    await waitFor(() => expect(mocks.persistUndoOrQueue).toHaveBeenCalledTimes(1))
    await act(async () => {
      await expect(api.toggleHabitToday('habit-1')).rejects.toThrow('предыдущего изменения')
    })
    release?.({ status: 'pending', mutationId: 'undo-checkin', event: null })
    await act(async () => { await undo })
  })
})

describe('mutation concurrency contract', () => {
  it.each([
    { name: 'goal', delta: 1, count: (data: AppData) => data.goals.length, run: () => api.addGoal({ title: 'Одна', kind: 'goal', areaId: null, targetDate: null, why: '' }) },
    { name: 'action', delta: 1, count: (data: AppData) => data.actions.length, run: () => api.addAction('goal-1', 'Одно') },
    { name: 'habit', delta: 1, count: (data: AppData) => data.habits.length, run: () => api.addHabit('Одна', 3, null) },
    { name: 'review', delta: 0, count: (data: AppData) => data.reviews.length, run: () => api.saveReview(startOfWeek(), { wins: 'Один', blockers: '', next_focus: '', self_score: 7 }, metrics) },
  ])('coalesces a double $name submit into one persistence operation', async ({ count, delta, run }) => {
    const initial = appData()
    renderData(initial)
    let release: (() => void) | undefined
    mocks.persistOrQueue.mockReturnValue(new Promise<void>((resolve) => { release = resolve }))

    const first = run()
    const second = run()
    await waitFor(() => expect(mocks.persistOrQueue).toHaveBeenCalledTimes(1))
    expect(count(api.data)).toBe(count(initial) + delta)
    release?.()
    await act(async () => { await Promise.all([first, second]) })
    expect(mocks.persistOrQueue).toHaveBeenCalledTimes(1)
  })

  it.each([
    { name: 'action', scope: 'action' as const, id: 'action-1', run: () => api.toggleAction('action-1') },
    { name: 'check-in', scope: 'habit' as const, id: 'habit-2', run: () => api.toggleHabitToday('habit-2') },
    { name: 'focus', scope: 'focus' as const, id: undefined, run: () => api.toggleFocus('action-1') },
  ])('coalesces a rapid double $name toggle and exposes busy state', async ({ scope, id, run }) => {
    renderData(appData())
    let release: (() => void) | undefined
    mocks.persistOrQueue.mockReturnValue(new Promise<void>((resolve) => { release = resolve }))
    const first = run()
    const second = run()
    await waitFor(() => expect(mocks.persistOrQueue).toHaveBeenCalledTimes(1))
    expect(api.isMutating(scope, id)).toBe(true)
    release?.()
    await act(async () => { await Promise.all([first, second]) })
    expect(mocks.persistOrQueue).toHaveBeenCalledTimes(1)
    expect(api.isMutating(scope, id)).toBe(false)
  })

  it('rejects a conflicting toggle/delete intent instead of reporting false success', async () => {
    renderData(appData())
    let release: (() => void) | undefined
    mocks.persistOrQueue.mockReturnValue(new Promise<void>((resolve) => { release = resolve }))

    const toggle = api.toggleAction('action-1')
    const remove = api.deleteAction('action-1')
    const removeResult = remove.catch((reason: unknown) => reason)
    await waitFor(() => expect(mocks.persistOrQueue).toHaveBeenCalledTimes(1))
    expect(mocks.persistOrQueue).toHaveBeenCalledTimes(1)
    expect(await removeResult).toMatchObject({ message: expect.stringContaining('Дождитесь завершения') })
    release?.()
    await act(async () => { await toggle })
    expect(api.data.actions.find((item) => item.id === 'action-1')?.status).toBe('done')
    expect(api.mutationError).toContain('Дождитесь завершения')
  })

  it('rejects a different goal intent while preserving both form inputs for retry', async () => {
    renderData(appData())
    let release: (() => void) | undefined
    mocks.persistOrQueue.mockReturnValue(new Promise<void>((resolve) => { release = resolve }))
    const first = api.addGoal({ title: 'Цель A', kind: 'goal', areaId: null, targetDate: null, why: '' })
    const second = api.addGoal({ title: 'Цель B', kind: 'goal', areaId: null, targetDate: null, why: '' })
    const secondResult = second.catch((reason: unknown) => reason)

    await waitFor(() => expect(mocks.persistOrQueue).toHaveBeenCalledTimes(1))
    expect(await secondResult).toMatchObject({ message: expect.stringContaining('Дождитесь завершения') })
    expect(api.data.goals.filter((goal) => goal.title === 'Цель A')).toHaveLength(1)
    expect(api.data.goals.filter((goal) => goal.title === 'Цель B')).toHaveLength(0)
    release?.()
    await act(async () => { await first })
  })

  it('releases a failed lock so a retry can succeed', async () => {
    renderData(appData())
    mocks.persistOrQueue.mockRejectedValueOnce(new DOMException('quota exceeded')).mockResolvedValueOnce(undefined)
    await act(async () => { await expect(api.toggleAction('action-1')).rejects.toThrow() })
    expect(api.isMutating('action', 'action-1')).toBe(false)

    await act(async () => { await api.toggleAction('action-1') })
    expect(api.data.actions[0].status).toBe('done')
    expect(mocks.persistOrQueue).toHaveBeenCalledTimes(2)
  })

  it('never creates a fourth focus slot under concurrent additions', async () => {
    const today = localDate()
    const initial = appData()
    initial.actions = [
      { ...initial.actions[0], focus_date: today, focus_position: 1 },
      { ...initial.actions[1], focus_date: today, focus_position: 2 },
      { ...initial.actions[0], id: 'action-3', title: 'Третье', result_note: '' },
      { ...initial.actions[0], id: 'action-4', title: 'Четвёртое', result_note: '' },
    ]
    renderData(initial)
    let release: (() => void) | undefined
    mocks.persistOrQueue.mockReturnValue(new Promise<void>((resolve) => { release = resolve }))

    const third = api.toggleFocus('action-3')
    const fourthResult = api.toggleFocus('action-4').catch((reason: unknown) => reason)
    await waitFor(() => expect(mocks.persistOrQueue).toHaveBeenCalledTimes(1))
    expect(await fourthResult).toMatchObject({ message: expect.stringContaining('Дождитесь завершения') })
    release?.()
    await act(async () => { await third })

    expect(api.data.actions.filter((item) => item.focus_date === today && item.status !== 'cancelled')).toHaveLength(3)
    expect(api.data.actions.find((item) => item.id === 'action-4')?.focus_date).toBeNull()
  })

  it('rejects a fourth slot even when one occupied slot is completed', async () => {
    const today = localDate()
    const initial = appData()
    initial.actions = [
      { ...initial.actions[0], status: 'done', focus_date: today, focus_position: 1, completed_at: `${today}T10:00:00.000Z` },
      { ...initial.actions[1], focus_date: today, focus_position: 2 },
      { ...initial.actions[0], id: 'action-3', title: 'Третье', focus_date: today, focus_position: 3 },
      { ...initial.actions[0], id: 'action-4', title: 'Четвёртое' },
    ]
    renderData(initial)

    await act(async () => { await expect(api.toggleFocus('action-4')).rejects.toThrow('уже выбраны три') })
    expect(mocks.persistOrQueue).not.toHaveBeenCalled()
    expect(api.data.actions.find((item) => item.id === 'action-4')?.focus_date).toBeNull()
  })

  it('preserves an earlier daily commitment when the same action is focused on a new day', async () => {
    const today = localDate()
    const yesterday = shiftDate(today, -1)
    const initial = appData()
    initial.actions[0] = { ...initial.actions[0], focus_date: yesterday, focus_position: 1 }
    renderData(initial)

    await act(async () => { await api.toggleFocus('action-1') })

    expect(api.data.focusCommitments?.map((item) => `${item.action_id}:${item.committed_on}`)).toEqual([
      `action-1:${yesterday}`,
      `action-1:${today}`,
    ])
  })

  it('removes only the current daily commitment when focus is cleared before completion', async () => {
    const today = localDate()
    const yesterday = shiftDate(today, -1)
    const initial = appData()
    initial.actions[0] = { ...initial.actions[0], focus_date: today, focus_position: 1 }
    initial.focusCommitments = [
      { id: 'focus-old', user_id: 'user-a', action_id: 'action-1', committed_on: yesterday, position: 1, source_mutation_id: null, created_at: timestamp },
      { id: 'focus-today', user_id: 'user-a', action_id: 'action-1', committed_on: today, position: 1, source_mutation_id: null, created_at: timestamp },
    ]
    renderData(initial)

    await act(async () => { await api.toggleFocus('action-1') })

    expect(api.data.actions[0].focus_date).toBeNull()
    expect(api.data.focusCommitments).toEqual([expect.objectContaining({ id: 'focus-old', committed_on: yesterday })])
  })

  it('turns a focused action into a tombstone, cancels today commitment and frees slot 1', async () => {
    const today = localDate()
    const yesterday = shiftDate(today, -1)
    const initial = appData()
    initial.actions[0] = { ...initial.actions[0], focus_date: today, focus_position: 1 }
    initial.focusCommitments = [
      { id: 'focus-past', user_id: 'user-a', action_id: 'action-1', committed_on: yesterday, position: 1, source_mutation_id: null, created_at: timestamp },
      { id: 'focus-today', user_id: 'user-a', action_id: 'action-1', committed_on: today, position: 1, source_mutation_id: null, created_at: timestamp },
    ]
    renderData(initial)

    await act(async () => { await api.deleteAction('action-1') })
    expect(api.data.actions.find((item) => item.id === 'action-1')).toMatchObject({
      status: 'cancelled', focus_date: null, focus_position: null,
    })
    expect(api.data.focusCommitments).toEqual([expect.objectContaining({ id: 'focus-past', committed_on: yesterday })])
    expect(mocks.persistOrQueue.mock.calls[0][2]).toMatchObject({ focus_delete_date: today })
    expect(api.data.actions.find((item) => item.id === 'action-1')).not.toHaveProperty('focus_delete_date')

    await act(async () => { await expect(api.toggleFocus('action-2')).resolves.toBeUndefined() })
    expect(api.data.actions.find((item) => item.id === 'action-2')).toMatchObject({ focus_date: today, focus_position: 1 })
    expect(api.mutationError).toBeNull()
  })

  it('keeps a past commitment on soft-delete and restores the action on Undo without duplication', async () => {
    const focusDate = shiftDate(localDate(), -1)
    const initial = appData()
    initial.actions[0] = { ...initial.actions[0], focus_date: focusDate, focus_position: 1 }
    initial.focusCommitments = [{
      id: 'focus-preserved', user_id: 'user-a', action_id: 'action-1', committed_on: focusDate,
      position: 1, source_mutation_id: null, created_at: timestamp,
    }]
    renderData(initial)

    await act(async () => { await api.deleteAction('action-1') })
    expect(api.data.actions.find((item) => item.id === 'action-1')).toMatchObject({ status: 'cancelled', focus_date: null })
    expect(api.data.focusCommitments).toEqual([expect.objectContaining({ id: 'focus-preserved', committed_on: focusDate })])

    await act(async () => { await api.undoLastMutation() })
    expect(api.data.actions.find((item) => item.id === 'action-1')).toMatchObject({ focus_date: focusDate, focus_position: 1 })
    expect(api.data.focusCommitments).toHaveLength(1)
    expect(api.data.focusCommitments?.[0]).toMatchObject({ id: 'focus-preserved', committed_on: focusDate })
  })

  it('creates a selected previous-week review without replacing the current week', async () => {
    renderData(appData())
    const previousWeek = shiftDate(startOfWeek(), -7)
    const previousMetrics = { ...metrics, period: { weekStart: previousWeek, asOf: shiftDate(previousWeek, 6) } }

    await act(async () => { await api.saveReview(previousWeek, { wins: 'Прошлая', blockers: '', next_focus: '', self_score: null }, previousMetrics) })

    expect(api.data.reviews).toHaveLength(2)
    expect(api.data.reviews.find((item) => item.week_start === startOfWeek())?.wins).toBe('Старые победы')
    expect(api.data.reviews.find((item) => item.week_start === previousWeek)).toMatchObject({ wins: 'Прошлая', metrics_snapshot: previousMetrics })
  })

  it('preserves the first review snapshot when its text is edited later', async () => {
    renderData(appData())
    const changedMetrics = { ...metrics, score: 99 }
    await act(async () => { await api.saveReview(startOfWeek(), { wins: 'Исправленный текст', blockers: '', next_focus: '', self_score: 9 }, changedMetrics) })
    expect(api.data.reviews[0].wins).toBe('Исправленный текст')
    expect(api.data.reviews[0].metrics_snapshot).toEqual(metrics)
  })

  it('stores pause and resume periods in the same durable habit row', async () => {
    renderData(appData())
    await act(async () => { await api.setHabitActive('habit-1', false) })
    expect(api.data.habits[0]).toMatchObject({ active: false, activity_periods: [{ started_on: '2026-08-24', ended_on: localDate() }] })
    await act(async () => { await api.setHabitActive('habit-1', true) })
    expect(api.data.habits[0].activity_periods).toEqual([{ started_on: '2026-08-24', ended_on: localDate() }, { started_on: localDate(), ended_on: null }])
    expect(mocks.persistOrQueue).toHaveBeenCalledTimes(2)
  })

  it('clamps habit targets to the durable 1…7 contract', async () => {
    renderData(appData())
    await act(async () => { await api.addHabit('Слишком часто', 99, null) })
    expect(api.data.habits.at(-1)).toMatchObject({ target_per_week: 7 })
    expect(mocks.persistOrQueue.mock.calls.at(-1)?.[2]).toMatchObject({ target_per_week: 7 })
  })

  it('ignores an old account failure in the new account state, cache, notice and busy state', async () => {
    const initialA = appData('user-a')
    mocks.readCachedData.mockImplementation((owner: string) => appData(owner))
    let rejectA: ((reason: Error) => void) | undefined
    mocks.persistOrQueue.mockReturnValue(new Promise<void>((_resolve, reject) => { rejectA = reject }))
    const view = render(<DataProvider><Probe /></DataProvider>)
    await waitFor(() => expect(api.data.goals[0].user_id).toBe('user-a'))
    const oldMutation = api.toggleAction('action-1')
    const oldResult = oldMutation.catch((reason: unknown) => reason)
    await waitFor(() => expect(mocks.persistOrQueue).toHaveBeenCalledTimes(1))

    mocks.user = { id: 'user-b' }
    view.rerender(<DataProvider><Probe /></DataProvider>)
    await waitFor(() => expect(api.data.goals[0].user_id).toBe('user-b'))
    rejectA?.(new DOMException('quota exceeded'))
    await act(async () => { expect(await oldResult).toBeInstanceOf(Error) })

    expect(api.data.goals[0].user_id).toBe('user-b')
    expect(api.mutationError).toBeNull()
    expect(api.isMutating('action', 'action-1')).toBe(false)
    expect(mocks.cacheData.mock.calls.some((call: unknown[]) => {
      const [owner, data] = call as [string, AppData]
      return owner === 'user-b' && data.goals[0]?.user_id === 'user-a'
    })).toBe(false)
    expect(initialA.actions[0].status).toBe('todo')
  })

  it('does not expose or cache an account A review in account B when save completes after switching', async () => {
    mocks.readCachedData.mockImplementation((owner: string) => appData(owner))
    let releaseA: (() => void) | undefined
    mocks.persistOrQueue.mockReturnValue(new Promise<void>((resolve) => { releaseA = resolve }))
    const view = render(<DataProvider><Probe /></DataProvider>)
    await waitFor(() => expect(api.data.reviews[0].user_id).toBe('user-a'))
    const saveA = api.saveReview(startOfWeek(), { wins: 'Только A', blockers: '', next_focus: '', self_score: null }, metrics)
    await waitFor(() => expect(mocks.persistOrQueue).toHaveBeenCalledTimes(1))

    mocks.user = { id: 'user-b' }
    view.rerender(<DataProvider><Probe /></DataProvider>)
    await waitFor(() => expect(api.data.reviews[0].user_id).toBe('user-b'))
    releaseA?.()
    await act(async () => { await saveA })

    expect(api.data.reviews[0]).toMatchObject({ user_id: 'user-b', wins: 'Старые победы' })
    expect(mocks.cacheData.mock.calls.some((call: unknown[]) => {
      const [owner, cached] = call as [string, AppData]
      return owner === 'user-b' && cached.reviews.some((review) => review.user_id === 'user-a' || review.wins === 'Только A')
    })).toBe(false)
  })

  it('commits a durable result to the owner cache even if the provider unmounts in flight', async () => {
    mocks.readCachedData.mockReturnValue(appData())
    let release: (() => void) | undefined
    mocks.persistOrQueue.mockReturnValue(new Promise<void>((resolve) => { release = resolve }))
    const view = render(<DataProvider><Probe /></DataProvider>)
    const mutation = api.toggleAction('action-1')
    await waitFor(() => expect(mocks.persistOrQueue).toHaveBeenCalledTimes(1))

    view.unmount()
    release?.()
    await mutation

    const cached = mocks.cacheData.mock.calls.at(-1)?.[1] as AppData
    expect(cached.actions.find((item) => item.id === 'action-1')?.status).toBe('done')
  })
})
