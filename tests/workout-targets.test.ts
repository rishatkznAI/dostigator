import { describe, expect, it } from 'vitest'
import { getSetTargetStatus, getWorkoutTargets, selectPreviousResults } from '../src/lib/workout-targets'
import type { HistoryWorkout, PreviousResult, WorkoutSetDraft } from '../src/types/training'

const set = (weightKg = 60, reps = 12, rir = 2): WorkoutSetDraft => ({ id: 'set', setNumber: 1, weightKg, reps, rir, done: true, isWarmup: false, completedAt: null })
const previous = (sets: WorkoutSetDraft[]): PreviousResult => ({ sessionId: 'last', finishedAt: '2026-10-10T10:00:00Z', exerciseKey: 'press', sets })
const session = (id: string, finishedAt: string, sets: WorkoutSetDraft[], skipped = false): HistoryWorkout => ({ id, finishedAt, startedAt: finishedAt, title: 'A', templateCode: 'A', timerPausedDurationMs: 0, readinessMode: null, exercises: [{ id: 'exercise', exerciseKey: 'press', exerciseName: 'Жим', target: '8–12', sortOrder: 1, skipped, skipReason: '', sets }] })

describe('per-set workout targets', () => {
  it('preserves each set weight instead of using the maximum for every set', () => {
    const result = getWorkoutTargets('8–12', 2, previous([set(60, 10), set(50, 9)]))
    expect(result.targets.map((target) => [target.weightKg, target.reps])).toEqual([[60, 11], [50, 9]])
  })
  it('increases weight only after all planned sets reach the top with a reserve', () => {
    expect(getWorkoutTargets('8–12', 3, previous([set()])).mode).toBe('repeat')
    expect(getWorkoutTargets('8–12', 2, previous([set(), set(60, 12, 1)])).mode).toBe('recover')
    const history = previous([set(), set()]); history.earlier = previous([set(), set()])
    const result = getWorkoutTargets('8–12', 2, history, false, { weightStep: 2.5 })
    expect(result.mode).toBe('increase')
    expect(result.targets[0]).toMatchObject({ weightKg: 62.5, reps: 8, rir: 2 })
    expect(result.targets[1]).toMatchObject({ weightKg: 62.5, reps: 8, optional: true })
  })
  it('does not increase effort in reduced mode or after failure', () => {
    expect(getWorkoutTargets('8–12', 1, previous([set()]), true).targets[0]).toMatchObject({ weightKg: 60, reps: 12, rir: 3 })
    expect(getWorkoutTargets('8–12', 1, previous([set(60, 7, 0)])).mode).toBe('recover')
    expect(getWorkoutTargets('8–12', 1, previous([set(60, 10, 1)])).targets[0]?.reps).toBe(10)
  })
  it('handles timed and bodyweight exercises without inventing kilograms', () => {
    expect(getWorkoutTargets('30–60 сек', 1, previous([set(0, 45)])).targets[0]).toMatchObject({ weightKg: 0, reps: 45, timed: true })
    expect(getWorkoutTargets('30–60 сек', 1, previous([set(0, 60)])).targets[0]?.reps).toBe(60)
    expect(getWorkoutTargets('8–12', 1, previous([set(0)])).targets[0]?.weightKg).toBe(0)
  })
  it('does not mark a target achieved when the effort exceeds the reserve', () => {
    const history = previous([set()]); history.earlier = previous([set()])
    const target = getWorkoutTargets('8–12', 1, history, false, { weightStep: 2.5 }).targets[0]!
    expect(getSetTargetStatus(set(62.5, 8, 2), target)).toBe('Цель выполнена')
    expect(getSetTargetStatus(set(62.5, 8, 0), target)).toContain('Нагрузка высокая')
  })
  it('looks past skipped, empty, warmup-only and future sessions', () => {
    const history = [session('future', '2026-10-15T10:00:00Z', [set(90)]), session('skipped', '2026-10-13T10:00:00Z', [set()], true), session('warmup', '2026-10-12T10:00:00Z', [{ ...set(), isWarmup: true }]), session('empty', '2026-10-11T10:00:00Z', []), session('valid', '2026-10-10T10:00:00Z', [set(50)])]
    expect(selectPreviousResults(history, ['press'], '2026-10-14T10:00:00Z').get('press')).toMatchObject({ sessionId: 'valid', sets: [expect.objectContaining({ weightKg: 50 })] })
  })
  it('repeats unknown reserve or incomplete history and preserves holes between facts', () => {
    const unknown = previous([set(60, 10), { ...set(50, 9), rir: null }])
    expect(getWorkoutTargets('8–12', 2, unknown).targets.map((target) => target.reps)).toEqual([11, 9])
    expect(getWorkoutTargets('8–12', 3, previous([set(60, 10)])).targets[0]?.reps).toBe(10)
    const source = session('partial', '2026-10-10T10:00:00Z', [set(60, 10), { ...set(50, 9), done: false }, set(40, 8)])
    const selected = selectPreviousResults([source], ['press'], '2026-10-14T10:00:00Z').get('press')!
    expect(selected.sets[1]?.done).toBe(false)
    expect(getWorkoutTargets('8–12', 3, selected).targets[2]?.weightKg).toBe(40)
  })
})
it('uses the new A/B rep range without rewriting the prior facts or increasing weight',()=>{
 const history={...previous([set(20,8),set(20,12),set(20,14)]),target:'8–12'}
 const before=structuredClone(history)
 const result=getWorkoutTargets('10–12',3,history)
 expect(result.targets.map(s=>[s.weightKg,s.reps])).toEqual([[20,10],[20,12],[20,12]])
 expect(history).toEqual(before);expect(result.mode).toBe('repeat')
})
