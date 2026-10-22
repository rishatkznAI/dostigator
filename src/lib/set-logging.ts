import type { WorkoutExerciseDraft, WorkoutSetDraft } from '../types/training'
import { parseRepRange, validateWorkoutSetValue } from './workout'
import type { SetTarget } from './workout-targets'

export type SetEntryValues = Pick<WorkoutSetDraft, 'weightKg' | 'reps' | 'rir'>

export function getNextSetTarget(repTarget: string, last?: WorkoutSetDraft, planned?: SetTarget, reduced = false): SetTarget | undefined {
  const range = parseRepRange(repTarget)
  if (!last?.done || last.isWarmup || last.reps === null || !range) return planned
  const below = last.reps < range.min || (last.rir !== null && last.rir < 2) || (planned && ((last.weightKg ?? 0) < (planned.weightKg ?? 0) || last.reps < planned.reps))
  if (below || reduced) return { weightKg: last.weightKg, reps: Math.min(last.reps, range.max), rir: reduced ? 3 : 2, timed: range.timed }
  return planned ?? { weightKg: last.weightKg, reps: Math.min(last.reps, range.max), rir: 2, timed: range.timed }

}

export function recordSetAndPrepareNext(exercise: WorkoutExerciseDraft, submitted: WorkoutSetDraft, reduced: boolean, now = new Date(), plannedNext?: SetTarget): WorkoutExerciseDraft {
  const index = exercise.sets.findIndex((set) => set.id === submitted.id)
  const current = exercise.sets[index]
  if (!current || current.skipped || current.done !== submitted.done || current.completedAt !== submitted.completedAt) return exercise
  for (const field of ['weightKg', 'reps', 'rir'] as const) {
    const validation = validateWorkoutSetValue(field, submitted[field])
    if (!validation.valid) throw new Error(validation.message)
  }
  if (submitted.weightKg === null || submitted.reps === null) throw new Error('Укажи вес и результат; 0 кг — свой вес')
  const recorded = { ...current, weightKg: submitted.weightKg, reps: submitted.reps, rir: submitted.rir, done: true, completedAt: current.completedAt ?? now.toISOString() }
  void reduced; void plannedNext
  return { ...exercise, sets: exercise.sets.map((set) => set.id === recorded.id ? recorded : set) }

}

export function undoSet(exercise: WorkoutExerciseDraft, setId: string): WorkoutExerciseDraft {
  return { ...exercise, sets: exercise.sets.map((set) => set.id === setId ? { ...set, done: false, completedAt: null } : set) }
}

export function skipSet(exercise: WorkoutExerciseDraft, setId: string): WorkoutExerciseDraft {
  return { ...exercise, sets: exercise.sets.map((set) => set.id === setId && !set.done ? { ...set, skipped: !set.skipped } : set) }
}

export function formatSetResult(set: Pick<WorkoutSetDraft, 'weightKg' | 'reps'>, timed: boolean) {
  if (set.reps === null) return 'Нет записи'
  return timed ? `${set.reps} сек` : `${set.weightKg===null ? 'Вес не указан' : set.weightKg ? new Intl.NumberFormat('ru-RU').format(set.weightKg) + ' кг' : 'Свой вес'} × ${set.reps}`
}
