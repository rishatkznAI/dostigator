import { describe, expect, it } from 'vitest'
import { isPersonalBackup } from '../src/lib/trainingRepository'
import { estimatedOneRepMax, getNextMandatoryWorkout, workoutVolume } from '../src/lib/workout'
import { getNextSetTarget } from '../src/lib/set-logging'
import type { HistoryWorkout, WorkoutSetDraft } from '../src/types/training'

const set = (overrides: Partial<WorkoutSetDraft> = {}): WorkoutSetDraft => ({
  id: 'set', setNumber: 1, weightKg: 40, reps: 10, rir: 2, done: true, isWarmup: false, completedAt: '2026-08-27T10:00:00Z', ...overrides,
})

const history = (templateCode: 'A' | 'B'): HistoryWorkout => ({
  id: templateCode, templateCode, title: templateCode, startedAt: '2026-08-27T10:00:00Z', finishedAt: '2026-08-27T11:00:00Z', timerPausedDurationMs: 0, readinessMode: 'normal', exercises: [],
})

describe('personal coaching improvements', () => {
  it('rotates required A/B workouts from completed history', () => {
    expect(getNextMandatoryWorkout([])).toBe('A')
    expect(getNextMandatoryWorkout([history('A')])).toBe('B')
    expect(getNextMandatoryWorkout([history('B'), history('A')])).toBe('A')
  })

  it('excludes warmups from volume and evaluates calibration', () => {
    expect(workoutVolume([set({ isWarmup: true, weightKg: 20 }), set()])).toBe(400)
    expect(getNextSetTarget('8–12', set({ reps: 12, rir: 4 }))?.weightKg).toBe(40)
    expect(getNextSetTarget('8–12', set({ reps: 7, rir: 0 }))?.weightKg).toBe(40)
  })

  it('uses repetitions in the strength progress metric', () => {
    expect(estimatedOneRepMax(60, 12)).toBeGreaterThan(estimatedOneRepMax(60, 6))
  })

  it('accepts only the versioned TrainLog backup envelope', () => {
    expect(isPersonalBackup({ format: 'trainlog-backup', version: 1, exportedAt: '', data: {
      workoutSessions: [], workoutExercises: [], workoutSets: [], bodyMeasurements: [], nutritionEntries: [], dailyActivity: [],
    } })).toBe(true)
    expect(isPersonalBackup({ format: 'trainlog-backup', version: 2, data: {} })).toBe(false)
  })
})
