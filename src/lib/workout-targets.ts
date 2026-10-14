import type { HistoryWorkout, PreviousResult, WorkoutSetDraft } from '../types/training'
import { formatNumber, parseRepRange } from './workout'

export type SetTarget = { weightKg: number | null; reps: number; rir: number; timed: boolean }

export function selectPreviousResults(history: HistoryWorkout[], keys: string[], before = new Date().toISOString()) {
  const wanted = new Set(keys)
  const results = new Map<string, PreviousResult>()
  for (const session of [...history].sort((first, second) => second.finishedAt.localeCompare(first.finishedAt))) {
    if (new Date(session.finishedAt) >= new Date(before)) continue
    for (const exercise of session.exercises) {
      if (!exercise.exerciseKey || !wanted.has(exercise.exerciseKey) || results.has(exercise.exerciseKey) || exercise.skipped) continue
      const sets = exercise.sets.filter((set) => set.done && !set.isWarmup && set.reps !== null)
      if (!sets.length) continue
      results.set(exercise.exerciseKey, { sessionId: session.id, finishedAt: session.finishedAt, exerciseKey: exercise.exerciseKey, sets })
    }
  }
  return results
}

export function getWorkoutTargets(target: string, plannedSets: number, previous?: PreviousResult, reduced = false) {
  const range = parseRepRange(target)
  const sets = previous?.sets.filter((set) => set.done && !set.isWarmup && set.reps !== null) ?? []
  if (!range || !sets.length) return { mode: 'baseline', message: 'Запиши первый результат. Рабочий вес выбирай по технике, оставляя 2 повтора в запасе.', targets: [] as SetTarget[] }
  const recover = reduced || sets.some((set) => (set.reps ?? 0) < range.min || set.rir === 0)
  const increase = !recover && sets.length >= plannedSets && sets.every((set) => (set.reps ?? 0) >= range.max && (set.rir ?? 0) >= 2)
  const mode = recover ? 'recover' : increase ? 'increase' : 'reps'
  const targets = sets.slice(0, plannedSets).map<SetTarget>((set) => {
    const weight = set.weightKg ?? 0
    const increment = weight >= 100 ? 5 : weight >= 25 ? 2.5 : 0.5
    const raiseWeight = increase && !range.timed && weight > 0 && weight + increment <= 1000
    const canAdd = !recover && (set.rir ?? 0) >= 2
    const reps = recover ? Math.max(range.min, Math.min(set.reps!, range.max))
      : raiseWeight ? range.min
      : range.timed ? Math.min(set.reps! + (canAdd ? 5 : 0), increase ? Math.min(range.max + 5, 1000) : range.max)
      : Math.min(set.reps! + (canAdd ? 1 : 0), range.max)
    return { weightKg: raiseWeight ? weight + increment : set.weightKg, reps, rir: reduced ? 3 : 2, timed: range.timed }
  })
  const message = reduced ? 'Сегодня без повышения нагрузки: сохрани или снизь вес, оставь 3 повтора в запасе.'
    : recover ? 'Сохрани или снизь вес и верни подходы в диапазон программы. Не добавляй нагрузку через отказ.'
    : increase ? range.timed ? 'Верх диапазона достигнут с запасом: можно добавить 5 секунд.'
      : sets.every((set) => !set.weightKg) ? 'Верх диапазона достигнут: сохрани результат или выбери более сложный вариант с чистой техникой.'
      : 'Верх диапазона достигнут с запасом: попробуй небольшой шаг веса, начав с нижней границы повторов.'
    : 'Добавь 1 повтор (для удержания — 5 секунд) в подходах с запасом. Остальные повтори с чистой техникой.'
  return { mode, message, targets }
}

export function formatSetTarget(target: SetTarget) {
  return target.timed ? `${target.reps} сек` : `${target.weightKg ? `${formatNumber(target.weightKg)} кг` : 'свой вес'} × ${target.reps}`
}

export function getSetTargetStatus(set: WorkoutSetDraft, target?: SetTarget) {
  if (!set.done || !target || set.reps === null) return null
  if (set.rir !== null && set.rir < target.rir) return 'Нагрузка высокая · сохрани или снизь'
  if (target.timed && (set.weightKg ?? 0) !== (target.weightKg ?? 0)) return 'Вес изменён · результат несопоставим'
  if ((set.weightKg ?? 0) >= (target.weightKg ?? 0) && set.reps >= target.reps) return 'Цель выполнена'
  if ((set.weightKg ?? 0) > (target.weightKg ?? 0)) return 'Вес выше цели · проверь технику'
  return 'Ниже ориентира · оцени самочувствие'
}
