import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataProvider, useData } from './DataContext'
import type { AppData } from '../types'

const empty: AppData = { areas: [], goals: [], actions: [], habits: [], checkins: [], reviews: [] }
const userData = (owner: string): AppData => ({
  ...empty,
  goals: [{ id: `goal-${owner}`, user_id: owner, area_id: null, title: `Цель ${owner}`, description: '', why: '', kind: 'goal', status: 'active', progress: 0, target_date: null, completed_at: null, created_at: 'now', updated_at: 'now' }],
})

const mocks = vi.hoisted(() => ({
  user: { id: 'user-a' } as { id: string } | null,
  cacheData: vi.fn(),
  loadAppData: vi.fn(),
  readCachedData: vi.fn(),
  flushQueue: vi.fn(),
  queueStats: vi.fn(),
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
  retryFailed: () => Promise.resolve({ completed: 0, pending: 0, failed: 0, quarantined: 0, legacyQuarantined: false }),
  readQueue: () => [],
  discardRejectedMutation: vi.fn(),
  quarantineFailedQueue: vi.fn(),
  queuedUndoBlockReason: () => null,
  persistOrQueue: vi.fn(),
  persistUndoOrQueue: vi.fn(),
}))

function Probe() {
  const { data, pending, failedSync } = useData()
  return <p>{data.goals[0]?.title ?? 'Нет данных'} · {pending}/{failedSync}</p>
}

describe('account-scoped data state', () => {
  afterEach(cleanup)

  beforeEach(() => {
    mocks.user = { id: 'user-a' }
    mocks.cacheData.mockReset()
    mocks.loadAppData.mockReset().mockRejectedValue(new Error('offline'))
    mocks.readCachedData.mockReset().mockImplementation((owner: string) => userData(owner))
    mocks.queueStats.mockReset().mockReturnValue({ pending: 0, failed: 0, quarantined: 0, legacyQuarantined: false })
    mocks.flushQueue.mockReset().mockResolvedValue({ completed: 0, pending: 0, failed: 0, quarantined: 0, legacyQuarantined: false })
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
  })

  it('never writes or renders account A data as account B during a direct session change', async () => {
    const view = render(<DataProvider><Probe /></DataProvider>)
    expect(await screen.findByText('Цель user-a · 0/0')).toBeInTheDocument()
    mocks.cacheData.mockClear()

    mocks.user = { id: 'user-b' }
    view.rerender(<DataProvider><Probe /></DataProvider>)
    expect(screen.queryByText('Цель user-a · 0/0')).not.toBeInTheDocument()
    expect(await screen.findByText('Цель user-b · 0/0')).toBeInTheDocument()

    await waitFor(() => expect(mocks.cacheData).toHaveBeenCalled())
    expect(mocks.cacheData.mock.calls.some((call: unknown[]) => {
      const [owner, data] = call as [string, AppData]
      return owner === 'user-b' && data.goals[0]?.user_id === 'user-a'
    })).toBe(false)
  })

  it('ignores a completed account A flush after account B is rendered', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    let resolveA: ((value: { completed: number; pending: number; failed: number; quarantined: number; legacyQuarantined: boolean }) => void) | undefined
    mocks.flushQueue.mockImplementation((owner: string) => owner === 'user-a'
      ? new Promise((resolve) => { resolveA = resolve })
      : Promise.resolve({ completed: 0, pending: 0, failed: 0, quarantined: 0, legacyQuarantined: false }))
    const view = render(<DataProvider><Probe /></DataProvider>)
    await waitFor(() => expect(mocks.flushQueue).toHaveBeenCalledWith('user-a'))

    mocks.user = { id: 'user-b' }
    view.rerender(<DataProvider><Probe /></DataProvider>)
    expect(await screen.findByText('Цель user-b · 0/0')).toBeInTheDocument()
    resolveA?.({ completed: 0, pending: 7, failed: 5, quarantined: 0, legacyQuarantined: false })

    await waitFor(() => expect(screen.getByText('Цель user-b · 0/0')).toBeInTheDocument())
    expect(mocks.cacheData.mock.calls.some((call: unknown[]) => {
      const [owner, data] = call as [string, AppData]
      return owner === 'user-b' && data.goals[0]?.user_id === 'user-a'
    })).toBe(false)
  })
})
