import { describe, expect, it, vi } from 'vitest'
import { createWorkoutDraft, draftSummary, elapsedClock, finishWorkoutTimer, getOverloadRecommendation, getWeeklyStats, parseRepRange, toggleWorkoutTimer, validateWorkoutSetValue, workoutDraftValidationError } from '../src/lib/workout'
import type { HistoryWorkout, PreviousResult, WorkoutDraft, WorkoutTemplate } from '../src/types/training'

const result = (sets: PreviousResult['sets']): PreviousResult => ({
  sessionId: 'session',
  finishedAt: '2026-08-20T10:00:00.000Z',
  exerciseKey: 'lat_pulldown',
  sets,
})

const set = (reps: number, rir: number, weightKg = 70, index = 1) => ({
  id: `set-${index}`,
  setNumber: index,
  weightKg,
  reps,
  rir,
  done: true,
  isWarmup: false,
  completedAt: '2026-08-20T10:00:00.000Z',
})

describe('deterministic progressive overload', () => {
  it('parses repetition and time ranges', () => {
    expect(parseRepRange('8–12')).toEqual({ min: 8, max: 12, timed: false })
    expect(parseRepRange('30–60 сек')).toEqual({ min: 30, max: 60, timed: true })
  })

  it('increases load only when every set reaches the top with RIR >= 1', () => {
    const recommendation = getOverloadRecommendation('8–12', result([set(12, 1, 70, 1), set(12, 2, 70, 2), set(12, 1, 70, 3)]))
    expect(recommendation.mode).toBe('increase')
    expect(recommendation.message).toContain('72,5 кг')
  })

  it('keeps load and adds repetitions inside the target range', () => {
    const recommendation = getOverloadRecommendation('8–12', result([set(10, 2, 70, 1), set(9, 2, 70, 2), set(8, 1, 70, 3)]))
    expect(recommendation.mode).toBe('reps')
    expect(recommendation.message).toContain('добавь 1 повтор')
  })

  it('prioritizes recovery when a set misses the range or reaches RIR 0', () => {
    expect(getOverloadRecommendation('8–12', result([set(7, 0)])).mode).toBe('recover')
  })
})

describe('workout draft and weekly metrics', () => {
  it('accepts only sync-safe set values inside the UI and database bounds', () => {
    expect(validateWorkoutSetValue('weightKg', 72.5)).toEqual({ valid: true, value: 72.5 })
    expect(validateWorkoutSetValue('reps', 12)).toEqual({ valid: true, value: 12 })
    expect(validateWorkoutSetValue('rir', 0)).toEqual({ valid: true, value: 0 })
    expect(validateWorkoutSetValue('rir', 5)).toEqual({ valid: true, value: 5 })

    expect(validateWorkoutSetValue('weightKg', 72.25)).toMatchObject({ valid: false })
    expect(validateWorkoutSetValue('weightKg', 2001)).toMatchObject({ valid: false })
    expect(validateWorkoutSetValue('reps', -1)).toMatchObject({ valid: false })
    expect(validateWorkoutSetValue('reps', 10.5)).toMatchObject({ valid: false })
    expect(validateWorkoutSetValue('rir', -1)).toMatchObject({ valid: false })
    expect(validateWorkoutSetValue('rir', 6)).toMatchObject({ valid: false })
    expect(validateWorkoutSetValue('rir', Number.NaN)).toMatchObject({ valid: false })
  })

  it('blocks a legacy invalid draft before it can enter the sync queue', () => {
    const template: WorkoutTemplate = {
      code: 'A', title: 'A', sortOrder: 1,
      items: [{ sortOrder: 1, setCount: 1, repTarget: '8–12', exercise: { key: 'x', name: 'Жим', muscles: [], steps: [], mistakes: [], youtube_url: null } }],
    }
    const draft = createWorkoutDraft(template, 'user')
    draft.exercises[0]!.sets[0] = { ...draft.exercises[0]!.sets[0]!, reps: 10, rir: 11, done: true }
    expect(workoutDraftValidationError(draft)).toContain('RIR: целое число от 0 до 5')
  })

  it('creates stable client UUIDs for session, exercises and sets', () => {
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce('session-id')
      .mockReturnValueOnce('exercise-id')
      .mockReturnValueOnce('set-1')
      .mockReturnValueOnce('set-2') })
    const template: WorkoutTemplate = {
      code: 'A', title: 'A title', sortOrder: 1,
      items: [{ sortOrder: 1, setCount: 2, repTarget: '8–12', exercise: { key: 'x', name: 'X', muscles: [], steps: [], mistakes: [], youtube_url: null } }],
    }
    const draft = createWorkoutDraft(template, 'user-id', new Date('2026-08-25T10:00:00Z'))
    expect(draft.id).toBe('session-id')
    expect(draft.exercises[0]?.id).toBe('exercise-id')
    expect(draft.exercises[0]?.sets.map((item) => item.id)).toEqual(['set-1', 'set-2'])
    expect(draft).toMatchObject({ schemaVersion: 3, timerPausedAt: null, timerPausedDurationMs: 0, readiness: null, activeRest: null })
    vi.unstubAllGlobals()
  })

  it('pauses, survives elapsed time and resumes without counting the pause', () => {
    const template: WorkoutTemplate = { code: 'A', title: 'A', sortOrder: 1, items: [] }
    const draft = createWorkoutDraft(template, 'user', new Date('2026-08-25T10:00:00Z'))
    const paused = toggleWorkoutTimer(draft, new Date('2026-08-25T10:10:00Z'))
    expect(elapsedClock(paused, new Date('2026-08-25T10:40:00Z').getTime())).toBe('00:10:00')

    const resumed = toggleWorkoutTimer(paused, new Date('2026-08-25T10:40:00Z'))
    expect(resumed.timerPausedDurationMs).toBe(30 * 60_000)
    expect(elapsedClock(resumed, new Date('2026-08-25T10:45:00Z').getTime())).toBe('00:15:00')
    expect(draftSummary(resumed, new Date('2026-08-25T10:45:00Z')).minutes).toBe(15)
  })

  it('closes an active pause before finishing', () => {
    const draft = {
      schemaVersion: 3,
      id: 'session', userId: 'user', templateCode: 'A', title: 'A',
      startedAt: '2026-08-25T10:00:00Z', finishedAt: null,
      timerPausedAt: '2026-08-25T10:20:00Z', timerPausedDurationMs: 5 * 60_000,
      readiness: null, activeRest: null, deletedSetIds: [],
      updatedAt: '2026-08-25T10:20:00Z', syncState: 'pending', exercises: [],
    } satisfies WorkoutDraft
    const finished = finishWorkoutTimer(draft, new Date('2026-08-25T10:30:00Z'))
    expect(finished).toMatchObject({
      finishedAt: '2026-08-25T10:30:00.000Z',
      timerPausedAt: null,
      timerPausedDurationMs: 15 * 60_000,
    })
  })

  it('counts only completed sets from the current Monday', () => {
    const workout: HistoryWorkout = {
      id: 'w', templateCode: 'A', title: 'A', startedAt: '2026-08-24T10:00:00Z', finishedAt: '2026-08-24T11:00:00Z', timerPausedDurationMs: 0, readinessMode: 'normal',
      exercises: [{ id: 'e', exerciseKey: 'x', exerciseName: 'X', target: '8–12', sortOrder: 1, skipped: false, skipReason: '', sets: [set(10, 2, 50)] }],
    }
    expect(getWeeklyStats([workout], new Date('2026-08-25T12:00:00Z'))).toEqual({ workouts: 1, sets: 1, volume: 500 })
  })
})
