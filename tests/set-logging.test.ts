import { describe, expect, it } from 'vitest'
import { applySetEntry, getNextSetTarget, getSetCoachMessage, toggleSetAndPrepareNext } from '../src/lib/set-logging'
import { createWorkoutDraft } from '../src/lib/workout'
import type { WorkoutExerciseDraft, WorkoutSetDraft, WorkoutTemplate } from '../src/types/training'

const set = (id: string, overrides: Partial<WorkoutSetDraft> = {}): WorkoutSetDraft => ({ id, setNumber: Number(id), weightKg: null, reps: null, rir: null, done: false, isWarmup: false, completedAt: null, ...overrides })
const exercise = (...sets: WorkoutSetDraft[]): WorkoutExerciseDraft => ({ id: 'exercise', exercise: { key: 'press', name: 'Жим', muscles: [], steps: [], mistakes: [], youtube_url: null }, target: '8–12', sortOrder: 1, skipped: false, skipReason: '', sets })

describe('coach set logging', () => {
  it('creates all sets specified in the program, not only the first', () => {
    const template: WorkoutTemplate = { code: 'A', title: 'A', sortOrder: 1, items: [{ setCount: 4, repTarget: '8–12', sortOrder: 1, exercise: exercise().exercise }] }
    const draft = createWorkoutDraft(template, 'owner')
    expect(draft.exercises[0]!.sets.map((item) => item.setNumber)).toEqual([1, 2, 3, 4])
    expect(draft.exercises[0]!.sets.every((item) => !item.done)).toBe(true)
  })
  it('copies only the weight and reps into the next draft, never subjective RIR or completion', () => {
    const original = exercise(set('1', { weightKg: 60, reps: 10, rir: 2 }), set('2'), set('3'))
    const recorded = toggleSetAndPrepareNext(original, '1', false, new Date('2026-10-14T10:00:00Z'))
    expect(recorded.sets[0]).toMatchObject({ done: true, completedAt: '2026-10-14T10:00:00.000Z' })
    expect(recorded.sets[1]).toMatchObject({ weightKg: 60, reps: 10, rir: null, done: false, completedAt: null })
    expect(recorded.sets[2]).toEqual(original.sets[2])
    expect(original.sets[0]?.done).toBe(false)
  })
  it('does not overwrite previously entered values or carry warmup loads into working sets', () => {
    const entered = exercise(set('1', { weightKg: 60, reps: 10, rir: 2 }), set('2', { weightKg: 55, reps: 9, rir: 3 }))
    expect(toggleSetAndPrepareNext(entered, '1', false).sets[1]).toEqual(entered.sets[1])
    const warming = exercise(set('1', { isWarmup: true, weightKg: 20, reps: 12, rir: 5 }), set('2'))
    expect(toggleSetAndPrepareNext(warming, '1', false).sets[1]?.weightKg).toBeNull()
  })
  it('adjusts the next draft after failure and never increases effort in reduced mode', () => {
    const last = set('1', { done: true, weightKg: 60, reps: 7, rir: 0 })
    expect(getNextSetTarget('8–12', last)).toMatchObject({ weightKg: 57.5, reps: 7, rir: 3 })
    expect(getSetCoachMessage('8–12', last)).toContain('снижаем')
    const easy = set('1', { done: true, weightKg: 60, reps: 10, rir: 5 })
    expect(getNextSetTarget('8–12', easy, undefined, true)).toMatchObject({ weightKg: 60, reps: 10, rir: 3 })
    expect(getNextSetTarget('8–12', easy)).toMatchObject({ weightKg: 60, reps: 11, rir: 2 })
  })
  it('handles bodyweight and timed sets and validates before recording', () => {
    expect(getNextSetTarget('30–60 сек', set('1', { done: true, weightKg: 0, reps: 40, rir: 4 }))).toMatchObject({ weightKg: 0, reps: 45, timed: true })
    expect(getNextSetTarget('30–60 сек', set('1', { done: true, weightKg: 0, reps: 40, rir: 0 }))).toMatchObject({ weightKg: 0, reps: 35, rir: 3 })
    expect(getSetCoachMessage('8–12', set('1', { done: true, weightKg: 60, reps: 12, rir: 4 }))).toContain('Верх диапазона')
    expect(() => toggleSetAndPrepareNext(exercise(set('1', { reps: 10 })), '1', false)).toThrow('запас')
    expect(() => applySetEntry(exercise(set('1')), '1', { weightKg: 55.25, reps: 10 })).toThrow('Вес')
  })
  it('quick filling and undo do not manufacture completed sets', () => {
    const filled = applySetEntry(exercise(set('1')), '1', { weightKg: 60, reps: 10 })
    expect(filled.sets[0]).toMatchObject({ done: false, rir: null, completedAt: null })
    const complete = exercise(set('1', { done: true, weightKg: 60, reps: 10, rir: 2 }), set('2'))
    expect(applySetEntry(complete, '1', { weightKg: 70, reps: 12 }).sets[0]).toEqual(complete.sets[0])
    const undone = toggleSetAndPrepareNext(complete, '1', false)
    expect(undone.sets[0]).toMatchObject({ done: false, completedAt: null })
    expect(undone.sets[1]).toEqual(complete.sets[1])
  })
})
