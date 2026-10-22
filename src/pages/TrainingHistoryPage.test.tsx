import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TRAINING_SYNC_COMPLETED_EVENT } from '../hooks/useSyncQueue'
import type { HistoryWorkout } from '../types/training'
import { TrainingHistoryPage } from './TrainingHistoryPage'

const mocks = vi.hoisted(() => ({
  loadHistory: vi.fn(),
}))

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-a' } }),
}))
vi.mock('../lib/trainingRepository', () => ({
  loadHistory: mocks.loadHistory,
}))
// The page also refreshes linked cardio. Keep that external request isolated
// when CI provides real Supabase credentials to the separate API suite.
vi.mock('../lib/cardio', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/cardio')>(),
  loadCardio: vi.fn().mockResolvedValue([]),
}))
vi.mock('../lib/storage', () => ({
  getSyncQueue: vi.fn(() => []),
}))

const syncedWorkout: HistoryWorkout = {
  id: 'session-a',
  templateCode: 'A',
  title: 'Грудь + ноги + спина',
  startedAt: '2026-08-30T09:00:00.000Z',
  finishedAt: '2026-08-30T10:00:00.000Z',
  timerPausedDurationMs: 0,
  readinessMode: 'normal',
  exercises: [],
}

describe('training history sync refresh', () => {
  beforeEach(() => {
    mocks.loadHistory.mockReset().mockResolvedValueOnce([]).mockResolvedValue([syncedWorkout])
  })
  afterEach(cleanup)

  it('shows a workout drained from the offline queue without a page reload', async () => {
    render(<MemoryRouter><TrainingHistoryPage /></MemoryRouter>)
    await waitFor(() => expect(mocks.loadHistory).toHaveBeenCalledTimes(1))

    window.dispatchEvent(new CustomEvent(TRAINING_SYNC_COMPLETED_EVENT, { detail: { userId: 'user-a' } }))

    expect(await screen.findByRole('heading', { name: syncedWorkout.title })).toBeInTheDocument()
    expect(mocks.loadHistory).toHaveBeenCalledTimes(2)
  })

  it('ignores a sync event belonging to another account', async () => {
    render(<MemoryRouter><TrainingHistoryPage /></MemoryRouter>)
    await waitFor(() => expect(mocks.loadHistory).toHaveBeenCalledTimes(1))

    window.dispatchEvent(new CustomEvent(TRAINING_SYNC_COMPLETED_EVENT, { detail: { userId: 'user-b' } }))
    await Promise.resolve()

    expect(mocks.loadHistory).toHaveBeenCalledTimes(1)
  })

  it('does not let an older in-flight response erase newly synchronized history', async () => {
    const initial = deferred<HistoryWorkout[]>()
    const afterSync = deferred<HistoryWorkout[]>()
    mocks.loadHistory.mockReset()
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(afterSync.promise)
    render(<MemoryRouter><TrainingHistoryPage /></MemoryRouter>)
    await waitFor(() => expect(mocks.loadHistory).toHaveBeenCalledTimes(1))

    window.dispatchEvent(new CustomEvent(TRAINING_SYNC_COMPLETED_EVENT, { detail: { userId: 'user-a' } }))
    await waitFor(() => expect(mocks.loadHistory).toHaveBeenCalledTimes(2))
    await act(async () => { afterSync.resolve([syncedWorkout]); await afterSync.promise })
    expect(await screen.findByRole('heading', { name: syncedWorkout.title })).toBeInTheDocument()

    await act(async () => { initial.resolve([]); await initial.promise })
    expect(screen.getByRole('heading', { name: syncedWorkout.title })).toBeInTheDocument()
  })
})
