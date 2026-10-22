import { describe, expect, it } from 'vitest'
import { getWorkoutTargets, selectPreviousResults } from '../src/lib/workout-targets'
import { compareExercise, mergeTrainingHistory, weeklyProgress, workoutChanges } from '../src/lib/training-insights'
import { fixtureHistory } from './local-browser/fixtures'
import { createWorkoutDraft } from '../src/lib/workout'
import { template } from './local-browser/fixtures'

const latest = () => structuredClone(fixtureHistory[0])
const previous = () => selectPreviousResults(structuredClone(fixtureHistory), ['lat_pulldown', 'chest_press'], '2026-10-15T10:00:00Z')

describe('conservative progression from complete sessions', () => {
  it('offers only one additional total rep after a complete stable session, without changing history', () => {
    const p = previous().get('lat_pulldown')!
    const before = structuredClone(p)
    const result = getWorkoutTargets('8–12', 3, p)
    expect(result.targets.map((set) => set.reps)).toEqual([11, 10, 10])
    expect(result.targets.map((set) => set.weightKg)).toEqual([50, 50, 50])
    expect(result.targets.filter((set) => set.optional)).toHaveLength(1)
    expect(p).toEqual(before)
  })
  it('requires two completed top-of-range sessions and an explicit equipment step', () => {
    const p = previous().get('chest_press')!
    p.sets.forEach(set=>{set.rir=2});p.earlier!.sets.forEach(set=>{set.rir=2})
    expect(getWorkoutTargets('8–12', 3, { ...p, earlier: undefined }, false, { weightStep: 2.5 }).targets.every((t) => !t.optional)).toBe(true)
    expect(getWorkoutTargets('8–12', 3, p).mode).toBe('repeat')
    const result = getWorkoutTargets('8–12', 3, p, false, { weightStep: 1.25 })
    expect(result.targets.every((set) => set.weightKg === 41.25 && set.reps === 8 && set.optional)).toBe(true)
    expect(getWorkoutTargets('8–12', 3, p, false, { weightStep: 20 }).mode).toBe('repeat')
  })
  it('does not infer spare capacity from missing RIR, even after two upper-bound sessions',()=>{
    const p=previous().get('chest_press')!
    const before=structuredClone(p)
    expect(getWorkoutTargets('8–12',3,p,false,{weightStep:1.25}).mode).toBe('repeat')
    expect(p).toEqual(before)
  })
  it.each(['partial', 'worseReps', 'worseWeight', 'failure', 'changedRange', 'reduced', 'longBreak'])('never increases for %s', (reason) => {
    const p = previous().get('lat_pulldown')!
    if (reason === 'partial') p.sets[1].done = false
    if (reason === 'worseReps') p.sets[2].reps = 8 // earlier was 9
    if (reason === 'worseWeight') p.sets[0].weightKg = 47.5
    if (reason === 'failure') p.sets[2].rir = 0
    if (reason === 'changedRange') p.target = '12–15'
    const result = getWorkoutTargets('8–12', 3, p, reason === 'reduced', { today: reason === 'longBreak' ? '2026-11-15T10:00:00Z' : '2026-10-15T10:00:00Z' })
    expect(result.targets.every((set) => !set.optional)).toBe(true)
    expect(result.message.length).toBeGreaterThan(10)
  })
  it('adds a rep to the next set when the first is already at the top', () => {
    const p = previous().get('lat_pulldown')!; p.sets[0].reps = 12
    expect(getWorkoutTargets('8–12', 3, p).targets.map((set) => set.reps)).toEqual([12, 11, 10])
  })
})

describe('facts-based progress', () => {
  it('compares repetitions only at identical weight, target and complete set count', () => {
    const current = latest().exercises[0], older = fixtureHistory[1].exercises[0]
    expect(compareExercise(current, older)).toContain('30 (+3 повт.)')
    current.sets[0].done = false
    expect(compareExercise(current, older)).toContain('нагрузку не сравниваем')
  })
  it('shows both weights and repetitions when weight changed', () => {
    const current = latest().exercises[0]
    expect(compareExercise(current, fixtureHistory[2].exercises[0])).toContain('47,5 → 50 кг')
    expect(compareExercise(current, fixtureHistory[2].exercises[0])).toContain('36 → 30')
  })
  it('matches each exercise against an actual earlier comparable workout', () => {
    const current = latest(); current.id = 'new'; current.startedAt = '2026-10-15T08:00:00Z'; current.finishedAt = '2026-10-15T09:00:00Z'
    expect(workoutChanges(current, fixtureHistory)[0].previousWorkout?.id).toBe('fixture-0')
  })
  it('deduplicates local and synchronized strength by UUID', () => {
    const draft = createWorkoutDraft(template, 'test'); draft.id = fixtureHistory[0].id; draft.finishedAt = '2026-10-15T10:00:00Z'
    const result = mergeTrainingHistory(fixtureHistory, [draft])
    expect(result).toHaveLength(fixtureHistory.length)
    expect(result[0].finishedAt).toBe(draft.finishedAt)
  })
  it('counts 25 minutes of elliptical without any extra metric, includes empty weeks and boundaries', () => {
    const cardio = [{ id: 'e', user_id: 'test', kind: 'elliptical' as const, activity_date: '2026-10-15', duration_minutes: 25, distance_km: null, average_pulse: null, effort: null, note: '', created_at: '', updated_at: '' }, { id: 's', user_id: 'test', kind: 'elliptical' as const, activity_date: '2026-10-11', duration_minutes: 20, distance_km: null, average_pulse: null, effort: null, note: '', created_at: '', updated_at: '' }]
    const weeks = weeklyProgress(fixtureHistory, cardio, new Date('2026-10-15T12:00:00'))
    expect(weeks).toHaveLength(8)
    expect(weeks[0]).toMatchObject({ from: '2026-10-12', cardioMinutes: 25, sets: 6 })
    expect(weeks[1].cardioMinutes).toBe(20)
    expect(weeks.at(-1)?.cardioMinutes).toBe(0)
  })
})

it('does not describe unknown legacy weights as the same measured load',()=>{
 const first=latest().exercises[0],second=structuredClone(first)
 first.sets[0].weightKg=null;second.sets[0].weightKg=null
 expect(compareExercise(first,second)).toBe('Вес указан не во всех подходах — нагрузку не сравниваем.')
})
