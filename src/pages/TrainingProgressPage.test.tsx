import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TrainingProgressPage } from './TrainingProgressPage'
import { loadHistory } from '../lib/trainingRepository'
import { getSyncQueue } from '../lib/storage'
import type { HistoryWorkout, WorkoutDraft } from '../types/training'

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'chart-owner' } }) }))
vi.mock('../lib/trainingRepository', () => ({ loadHistory: vi.fn() }))
vi.mock('../lib/storage', () => ({ getSyncQueue: vi.fn(() => []) }))
vi.mock('../lib/cardio', () => ({ CARDIO_CHANGED_EVENT: 'test:cardio', getCachedCardio: vi.fn(() => []), getCardioQueue: vi.fn(() => []), loadCardio: vi.fn().mockResolvedValue([]) }))
vi.mock('../hooks/useSyncQueue', () => ({ TRAINING_SYNC_COMPLETED_EVENT: 'test:strength' }))

const completedAt = '2026-10-20T11:00:00.000Z'
const sets = [{ id: 'set-one', setNumber: 1, weightKg: 40, reps: 10, rir: null, done: true, isWarmup: false, completedAt }]
const history: HistoryWorkout = { id: 'same-session', title: 'История', templateCode: 'A', startedAt: '2026-10-20T10:00:00.000Z', finishedAt: completedAt, timerPausedDurationMs: 0, readinessMode: null,
  exercises: [{ id: 'exercise-one', exerciseKey: 'press', exerciseName: 'Жим', target: '8–12', sortOrder: 1, skipped: false, skipReason: '', sets }] }
const pending: WorkoutDraft = { id: history.id, userId: 'chart-owner', schemaVersion: 3, templateCode: 'A', title: 'Локальная копия', startedAt: history.startedAt, finishedAt: completedAt, timerPausedAt: null, timerPausedDurationMs: 0, readiness: null, activeRest: null, deletedSetIds: [], updatedAt: completedAt, syncState: 'pending',
  exercises: [{ id: 'exercise-one', exercise: { key: 'press', name: 'Жим', muscles: [], steps: [], mistakes: [], youtube_url: null }, target: '8–12', sortOrder: 1, skipped: false, skipReason: '', sets: [{ ...sets[0], weightKg: 42.5 }] }] }

describe('training progress history sources', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }); vi.mocked(getSyncQueue).mockReturnValue([]); vi.mocked(loadHistory).mockResolvedValue([]) })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('plots the pending finished result once over its server copy without losing the history loading/cache flow', async () => {
    vi.mocked(loadHistory).mockResolvedValue([history])
    vi.mocked(getSyncQueue).mockReturnValue([pending])
    const { container } = render(<TrainingProgressPage />)
    await screen.findByText('История обновлена; локальные записи включены один раз')
    expect(loadHistory).toHaveBeenCalledWith(500)
    expect(JSON.parse(localStorage.getItem('trainlog:history-cache:chart-owner')!)).toEqual([history])
    const exerciseChart = within(container.querySelectorAll('.training-metric-plot')[1] as HTMLElement)
    expect(exerciseChart.getByText('42,5 кг', { exact: true })).toBeInTheDocument()
    expect(exerciseChart.getByRole('img', { name: /Точек: 1/ })).toBeInTheDocument()
    expect(screen.getAllByText('Локальный результат · ожидает синхронизации')).toHaveLength(1)
  })

  it('keeps cached exercise graphs available offline and shows missing weight without inventing a zero', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    const missing = { ...history, exercises: [{ ...history.exercises[0], sets: [{ ...sets[0], weightKg: null }] }] }
    localStorage.setItem('trainlog:history-cache:chart-owner', JSON.stringify([missing]))
    render(<TrainingProgressPage />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Офлайн'))
    expect(loadHistory).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Упражнение для сравнения')).toHaveValue('press')
    expect(screen.getByText('Нет записанных значений')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Сопоставимые условия' })).toBeChecked()
  })
})
