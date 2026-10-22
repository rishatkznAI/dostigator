import { describe, expect, it } from 'vitest'
import { getNextSetTarget, recordSetAndPrepareNext, skipSet, undoSet } from '../src/lib/set-logging'
import type { WorkoutExerciseDraft, WorkoutSetDraft } from '../src/types/training'

const set = (id: string, overrides: Partial<WorkoutSetDraft> = {}): WorkoutSetDraft => ({ id, setNumber: Number(id), weightKg: null, reps: null, rir: null, done: false, isWarmup: false, completedAt: null, ...overrides })
const exercise = (...sets: WorkoutSetDraft[]): WorkoutExerciseDraft => ({ id: 'exercise', exercise: { key: 'press', name: 'Жим', muscles: [], steps: [], mistakes: [], youtube_url: null }, target: '8–12', sortOrder: 1, skipped: false, skipReason: '', sets })

describe('set recording', () => {
  it('confirms a fact without RIR and prepares only the next unperformed draft', () => {
    const original = exercise(set('1'), set('2'), set('3'))
    const recorded = recordSetAndPrepareNext(original, { ...original.sets[0]!, weightKg: 60, reps: 10 }, false)
    expect(recorded.sets[0]).toMatchObject({ done: true, rir: null, weightKg: 60, reps: 10 })
    expect(recorded.sets[1]).toEqual(original.sets[1])
    expect(recorded.sets[2]).toEqual(original.sets[2])
    expect(original.sets[0]?.done).toBe(false)
  })
  it('is idempotent for rapid duplicate confirmation and ignores a stale edit', () => {
    const original = exercise(set('1'))
    const submitted = { ...original.sets[0]!, weightKg: 60, reps: 10 }
    const recorded = recordSetAndPrepareNext(original, submitted, false)
    expect(recordSetAndPrepareNext(recorded, submitted, false)).toBe(recorded)
    expect(recordSetAndPrepareNext(undoSet(recorded, '1'), { ...recorded.sets[0]!, reps: 9 }, false).sets[0]?.done).toBe(false)
  })
  it('edits an existing fact without creating a new completion timestamp', () => {
    const original = exercise(set('1', { done: true, weightKg: 60, reps: 10, completedAt: '2026-10-14T10:00:00Z' }))
    const edited = recordSetAndPrepareNext(original, { ...original.sets[0]!, reps: 9 }, false)
    expect(edited.sets[0]).toMatchObject({ reps: 9, done: true, completedAt: '2026-10-14T10:00:00Z' })
  })
  it('respects known per-set plans and never adds arbitrary seconds or repetitions', () => {
    const last = set('1', { done: true, weightKg: 60, reps: 11, rir: 4 })
    expect(getNextSetTarget('8–12', last, { weightKg: 50, reps: 10, rir: 2, timed: false })).toMatchObject({ weightKg: 50, reps: 10 })
    expect(getNextSetTarget('8–12', last)).toMatchObject({ weightKg: 60, reps: 11 })
    expect(getNextSetTarget('30–60 сек', { ...last, weightKg: 0, reps: 45 })).toMatchObject({ weightKg: 0, reps: 45, timed: true })
    expect(getNextSetTarget('8–12', { ...last, rir: 0 })).toMatchObject({ weightKg: 60 })
    expect(getNextSetTarget('8–12', { ...last, reps: 7, rir: 0 }, { weightKg: 50, reps: 9, rir: 2, timed: false })).toMatchObject({ weightKg: 60 })
  })
  it('never carries warmup load, overwrites a manual draft, or records a skipped set', () => {
    const warming = exercise(set('1', { isWarmup: true }), set('2'))
    expect(recordSetAndPrepareNext(warming, { ...warming.sets[0]!, weightKg: 20, reps: 12 }, false).sets[1]).toEqual(warming.sets[1])
    const original = exercise(set('1'), set('2', { weightKg: 50, reps: 9 }))
    expect(recordSetAndPrepareNext(original, { ...original.sets[0]!, weightKg: 60, reps: 10 }, false).sets[1]).toEqual(original.sets[1])
    const skipped = skipSet(original, '1')
    expect(recordSetAndPrepareNext(skipped, { ...skipped.sets[0]!, weightKg: 60, reps: 10 }, false)).toBe(skipped)
  })
  it('validates actual values before confirmation', () => {
    const original = exercise(set('1'))
    expect(() => recordSetAndPrepareNext(original, { ...original.sets[0]!, reps: 10 }, false)).toThrow('вес')
    expect(() => recordSetAndPrepareNext(original, { ...original.sets[0]!, weightKg: 55.13, reps: 10 }, false)).toThrow('Вес')
  })
})
