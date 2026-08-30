import { act, cleanup, render, waitFor } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localDate, startOfWeek } from '../lib/date'
import type { AppData, HistoryEvent, PendingOperation, WeeklyMetrics } from '../types'
import { DataProvider, useData } from './DataContext'

const mocks = vi.hoisted(() => ({ user: { id: 'user-a' } as { id: string } | null }))
const goalId = '30000000-0000-4000-8000-000000000001'
const actionId = '50000000-0000-4000-8000-000000000001'

vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => ({ data: { session: mocks.user ? { user: mocks.user } : null }, error: null })) },
    from: vi.fn(),
  },
}))
vi.mock('../lib/repository', () => ({
  cacheData: (owner: string, data: AppData) => localStorage.setItem(`dostigator:cache:${owner}`, JSON.stringify(data)),
  readCachedData: (owner: string): AppData => JSON.parse(localStorage.getItem(`dostigator:cache:${owner}`) ?? '{"areas":[],"goals":[],"actions":[],"habits":[],"checkins":[],"reviews":[]}'),
  loadAppData: () => Promise.reject(new Error('offline')),
  stripOwnership: (row: Record<string, unknown>) => row,
}))

const initial: AppData = {
  areas: [],
  goals: [{ id: goalId, user_id: 'user-a', area_id: null, title: 'Цель', description: '', why: '', kind: 'goal', status: 'active', progress: 0, target_date: null, completed_at: null, created_at: '2026-08-24T08:00:00.000Z', updated_at: '2026-08-24T08:00:00.000Z' }],
  actions: [{ id: actionId, user_id: 'user-a', goal_id: goalId, title: 'Шаг', status: 'todo', due_date: null, focus_date: null, focus_position: null, result_note: '', completed_at: null, created_at: '2026-08-24T08:00:00.000Z', updated_at: '2026-08-24T08:00:00.000Z' }],
  habits: [], checkins: [], reviews: [],
}

let api: ReturnType<typeof useData>

function Probe() {
  const value = useData()
  useLayoutEffect(() => { api = value }, [value])
  return <output>{value.data.actions[0]?.status ?? 'empty'}</output>
}

describe('DataContext with the real offline queue', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('dostigator:cache:user-a', JSON.stringify(initial))
    mocks.user = { id: 'user-a' }
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('rolls back memory and preserves the prior cache when the queue write fails', async () => {
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (String(key) === 'dostigator:sync-queue:v3:user-a') throw new DOMException('quota exceeded', 'QuotaExceededError')
      return originalSetItem.call(this, key, value)
    })
    render(<DataProvider><Probe /></DataProvider>)

    await act(async () => { await expect(api.toggleAction(actionId)).rejects.toThrow('Изменение отменено') })

    expect(api.data.actions[0].status).toBe('todo')
    expect(api.mutationError).toContain('Изменение отменено')
    expect(JSON.parse(localStorage.getItem('dostigator:cache:user-a') ?? 'null')).toEqual(initial)
    expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).toBeNull()
  })

  it('keeps and caches an optimistic result after it is durable in the offline queue', async () => {
    render(<DataProvider><Probe /></DataProvider>)

    await act(async () => { await api.toggleAction(actionId) })

    expect(api.data.actions[0].status).toBe('done')
    await waitFor(() => expect(JSON.parse(localStorage.getItem('dostigator:cache:user-a') ?? 'null').actions[0].status).toBe('done'))
    const queue = JSON.parse(localStorage.getItem('dostigator:sync-queue:v3:user-a') ?? '[]')
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({ ownerId: 'user-a', table: 'dostigator_actions', type: 'mutation', state: 'pending', mutation: { operation: 'action_complete' } })
  })

  it('keeps offline Undo available after a full provider reload', async () => {
    const first = render(<DataProvider><Probe /></DataProvider>)
    await act(async () => { await api.toggleAction(actionId) })
    const queued = JSON.parse(localStorage.getItem('dostigator:sync-queue:v3:user-a') ?? '[]') as PendingOperation[]
    const original = queued[0]
    expect(api.data.actions[0].status).toBe('done')
    first.unmount()

    render(<DataProvider><Probe /></DataProvider>)
    await waitFor(() => expect(api.data.actions[0].status).toBe('done'))
    const event: HistoryEvent = {
      id: original.id, user_id: 'user-a', mutation_id: original.mutationId,
      entity_type: original.mutation?.entityType ?? 'action', entity_id: original.mutation?.entityId ?? actionId,
      operation: original.mutation?.operation ?? 'action_complete', label: original.label,
      before_data: original.mutation?.before ?? null, after_data: original.payload ?? null,
      base_revision: original.mutation?.baseRevision ?? 0, result_revision: (original.mutation?.baseRevision ?? 0) + 1,
      source: 'offline', reverts_event_id: null, created_at: original.createdAt,
    }

    await act(async () => { await api.undoHistoryMutation(event) })

    expect(api.data.actions[0]).toMatchObject({ status: 'todo', revision: 2 })
    let afterUndo = JSON.parse(localStorage.getItem('dostigator:sync-queue:v3:user-a') ?? '[]') as PendingOperation[]
    expect(afterUndo.map((item) => item.type)).toEqual(['mutation', 'undo'])
    expect(afterUndo[1]).toMatchObject({ originalMutationId: original.mutationId, mutation: original.mutation })

    await act(async () => { await api.updateAction(actionId, { title: 'После Undo' }) })
    afterUndo = JSON.parse(localStorage.getItem('dostigator:sync-queue:v3:user-a') ?? '[]') as PendingOperation[]
    expect(afterUndo[2]).toMatchObject({ type: 'mutation', mutation: { baseRevision: 2 }, payload: { title: 'После Undo' } })
  })

  it('rolls back durable Undo to the exact cancelled tombstone when inverse persistence fails', async () => {
    const first = render(<DataProvider><Probe /></DataProvider>)
    await act(async () => { await api.deleteAction(actionId) })
    const [original] = JSON.parse(localStorage.getItem('dostigator:sync-queue:v3:user-a') ?? '[]') as PendingOperation[]
    const tombstone = api.data.actions.find((item) => item.id === actionId)
    expect(tombstone).toMatchObject({ status: 'cancelled', focus_date: null, focus_position: null })
    first.unmount()

    render(<DataProvider><Probe /></DataProvider>)
    await waitFor(() => expect(api.data.actions.find((item) => item.id === actionId)).toEqual(tombstone))
    const event: HistoryEvent = {
      id: original.id, user_id: 'user-a', mutation_id: original.mutationId,
      entity_type: 'action', entity_id: actionId, operation: 'action_delete', label: original.label,
      before_data: original.mutation?.before ?? null, after_data: original.payload ?? null,
      base_revision: original.mutation?.baseRevision ?? 0, result_revision: (original.mutation?.baseRevision ?? 0) + 1,
      source: 'offline', reverts_event_id: null, created_at: original.createdAt,
    }
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (String(key) === 'dostigator:sync-queue:v3:user-a') throw new DOMException('quota exceeded', 'QuotaExceededError')
      return originalSetItem.call(this, key, value)
    })

    await act(async () => { await expect(api.undoHistoryMutation(event)).rejects.toThrow('Локальное изменение не отменено') })

    expect(api.data.actions.find((item) => item.id === actionId)).toEqual(tombstone)
  })

  it('never rolls back a durable queue item when later cache bookkeeping fails', async () => {
    const originalSetItem = Storage.prototype.setItem
    let queued = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (String(key) === 'dostigator:sync-queue:v3:user-a') queued = true
      if (queued && String(key) === 'dostigator:cache:user-a') throw new DOMException('cache quota exceeded', 'QuotaExceededError')
      return originalSetItem.call(this, key, value)
    })
    render(<DataProvider><Probe /></DataProvider>)

    await act(async () => { await expect(api.toggleAction(actionId)).resolves.toBeUndefined() })

    expect(api.data.actions[0].status).toBe('done')
    expect(api.mutationError).toBeNull()
    expect(JSON.parse(localStorage.getItem('dostigator:sync-queue:v3:user-a') ?? '[]')).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem('dostigator:cache:user-a') ?? 'null').actions[0].status).toBe('todo')
  })

  it('durably queues a selected-week review together with its metrics snapshot', async () => {
    render(<DataProvider><Probe /></DataProvider>)
    const week = startOfWeek()
    const metrics: WeeklyMetrics = { score: null, focus: null, habits: null, actions: null, period: { weekStart: week, asOf: localDate() } }

    await act(async () => { await api.saveReview(week, { wins: 'Факт', blockers: '', next_focus: '', self_score: null }, metrics) })

    const queue = JSON.parse(localStorage.getItem('dostigator:sync-queue:v3:user-a') ?? '[]')
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({ ownerId: 'user-a', table: 'dostigator_weekly_reviews', type: 'mutation', state: 'pending', mutation: { operation: 'review_create' }, payload: { week_start: week, wins: 'Факт', metrics_snapshot: metrics } })
    await waitFor(() => expect(JSON.parse(localStorage.getItem('dostigator:cache:user-a') ?? 'null').reviews[0]).toMatchObject({ week_start: week, wins: 'Факт', metrics_snapshot: metrics }))
  })
})
