import { describe, expect, it } from 'vitest'
import { exerciseFactsText } from './training-insights'
import type { HistoryWorkout, WorkoutSetDraft } from '../types/training'

const set = (id: string, weightKg: number | null, reps: number): WorkoutSetDraft => ({ id, weightKg, reps, setNumber: 1, rir: null, done: true, isWarmup: false, completedAt: null })
const exercise = (sets: WorkoutSetDraft[], target = '8–12'): HistoryWorkout['exercises'][number] => ({ id: 'fixture-exercise', exerciseKey: 'press', exerciseName: 'Жим', target, sortOrder: 1, skipped: false, skipReason: '', sets })

describe('recorded exercise fact text', () => {
  it('distinguishes an unknown weight from a recorded zero and preserves quarter-kilogram values', () => {
    expect(exerciseFactsText(exercise([set('fraction', 43.75, 10), set('unknown', null, 8), set('bodyweight', 0, 12)]))).toBe('43,75 кг × 10 · вес не указан · 8 повт. · 0 кг × 12')
  })

  it('keeps timed seconds distinct and does not include warm-up or unfinished sets', () => {
    expect(exerciseFactsText(exercise([set('time', null, 30), { ...set('warmup', 0, 20), isWarmup: true }, { ...set('unfinished', 0, 99), done: false }], '30–45 сек'))).toBe('30 сек')
  })
})
