import type { WorkoutExerciseDraft, WorkoutSetDraft } from '../types/training'
import { parseRepRange, validateWorkoutSetValue } from './workout'
import type { SetTarget } from './workout-targets'

export type SetEntryValues = Pick<WorkoutSetDraft, 'weightKg' | 'reps'>

export function getNextSetTarget(repTarget: string, last?: WorkoutSetDraft, planned?: SetTarget, reduced = false): SetTarget | undefined {
  const range = parseRepRange(repTarget)
  if (!last || last.isWarmup || !last.done || last.reps === null || last.rir === null || !range) return planned
  const difficult = last.rir <= 1 || last.reps < range.min
  const weight = last.weightKg ?? 0
  const step = weight >= 100 ? 5 : weight >= 25 ? 2.5 : 0.5
  const lowerWeight = weight > 0 && (last.rir === 0 || last.reps < range.min)
  const reps = range.timed && difficult ? Math.max(1, last.reps - 5) : reduced || difficult ? Math.min(last.reps, range.max)
    : Math.min(last.reps + (last.rir >= 3 ? range.timed ? 5 : 1 : 0), Math.max(range.max, planned?.reps ?? range.max))
  return { weightKg: lowerWeight ? Math.max(0, weight - step) : last.weightKg, reps, rir: reduced || difficult ? 3 : 2, timed: range.timed }
}

export function getSetCoachMessage(repTarget: string, last?: WorkoutSetDraft, reduced = false) {
  if (reduced) return 'Облегчённый день: без прибавки веса. Сохрани технику и оставь около 3 повторов в запасе.'
  if (!last || last.isWarmup || !last.done || last.reps === null || last.rir === null) return 'Выполни подход, затем укажи фактический результат и сколько повторов осталось в запасе.'
  const range = parseRepRange(repTarget)
  if (last.rir === 0 || (range && last.reps < range.min)) return last.weightKg ? 'Последний подход дался тяжело. Для следующего снижаем ориентир веса. Если восстановиться не удалось, пропусти подход.' : 'Последний подход дался тяжело. Упрости вариант упражнения или сократи удержание. Если восстановиться не удалось, пропусти подход.'
  if (last.rir === 1) return 'Остался только один повтор в запасе. Не добавляй вес: отдохни, при необходимости снизь нагрузку.'
  if (last.rir >= 4 && range && last.reps >= range.max) return 'Верх диапазона достигнут с запасом. Сохрани этот результат; прибавку нагрузки оценим по итогам всех рабочих подходов.'
  if (last.rir >= 4) return range?.timed ? 'Запас большой. Можно добавить время удержания с чистой техникой, ориентируясь на диапазон программы.' : 'Запас большой. Можно добавить повтор, сохранив технику; повышение веса оценим по итогам всех рабочих подходов.'
  return 'Запас подходящий. Продолжай с сопоставимой нагрузкой, оценивая каждый подход отдельно.'
}

export function applySetEntry(exercise: WorkoutExerciseDraft, setId: string, values: SetEntryValues): WorkoutExerciseDraft {
  for (const field of ['weightKg', 'reps'] as const) {
    const validation = validateWorkoutSetValue(field, values[field])
    if (!validation.valid) throw new Error(validation.message)
  }
  return { ...exercise, sets: exercise.sets.map((set) => set.id === setId && !set.done ? { ...set, ...values } : set) }
}

export function toggleSetAndPrepareNext(exercise: WorkoutExerciseDraft, setId: string, reduced: boolean, now = new Date()): WorkoutExerciseDraft {
  const index = exercise.sets.findIndex((set) => set.id === setId)
  const current = exercise.sets[index]
  if (!current) return exercise
  if (!current.done) {
    for (const field of ['weightKg', 'reps', 'rir'] as const) {
      const validation = validateWorkoutSetValue(field, current[field])
      if (!validation.valid) throw new Error(validation.message)
    }
    if (current.reps === null || current.rir === null) throw new Error('Укажи фактический результат и запас повторов')
  }
  const completed = { ...current, done: !current.done, completedAt: current.done ? null : now.toISOString() }
  const next = completed.done && !completed.isWarmup ? exercise.sets.slice(index + 1).find((set) => !set.done && !set.isWarmup) : undefined
  const suggested = next ? getNextSetTarget(exercise.target, completed, undefined, reduced) : undefined
  return {
    ...exercise,
    sets: exercise.sets.map((set) => set.id === current.id ? completed : set.id === next?.id && suggested ? {
      ...set,
      weightKg: set.weightKg === null ? suggested.weightKg : set.weightKg,
      reps: set.reps === null ? suggested.reps : set.reps,
    } : set),
  }
}
