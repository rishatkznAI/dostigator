import type { HistoryWorkout, PreviousResult, WorkoutSetDraft } from '../types/training'
import { formatNumber, parseRepRange } from './workout'

export type SetTarget = { weightKg: number | null; reps: number; rir: number; timed: boolean; optional?: boolean }

export function selectPreviousResults(history: HistoryWorkout[], keys: string[], before = new Date().toISOString()) {
  const results = new Map<string, PreviousResult>()
  for (const key of keys) {
    const matches: PreviousResult[] = []
    for (const session of [...history].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))) {
      if (Date.parse(session.finishedAt) >= Date.parse(before)) continue
      const exercise = session.exercises.find((item) => item.exerciseKey === key && !item.skipped)
      if (!exercise?.sets.some((set) => set.done && !set.isWarmup && set.reps !== null)) continue
      matches.push({ sessionId: session.id, finishedAt: session.finishedAt, exerciseKey: key, target: exercise.target, readinessMode: session.readinessMode, sets: exercise.sets.filter((set) => !set.isWarmup) })
      if (matches.length === 2) break
    }
    if (matches[0]) results.set(key, { ...matches[0], earlier: matches[1] })
  }
  return results
}

// Recommendations are separate from facts. No recommended increase is applied here.
export function getWorkoutTargets(target: string, plannedSets: number, previous?: PreviousResult, reduced = false, options: { weightStep?: number; today?: string } = {}) {
  const range = parseRepRange(target)
  const work = previous?.sets.filter((set) => !set.isWarmup) ?? []
  const sets = work.filter((set) => set.done && set.reps !== null)
  if (!range || !sets.length) return { mode: 'baseline', message: 'Нет прошлого факта. Выбери вес и запиши результат.', targets: [] as SetTarget[] }
  const targets = Array.from({ length: plannedSets }, (_, index): SetTarget => {
    const set = work[index]
    return { weightKg: set?.done ? set.weightKg : null, reps: set?.done && set.reps !== null ? set.reps : range.min, rir: reduced ? 3 : 2, timed: range.timed }
  })
  const repeat = (message: string, mode = 'repeat') => ({ mode, message, targets })
  if (reduced) return repeat('Облегчённый режим: повтори или уменьши нагрузку, без прибавки.', 'recover')
  if (previous?.target && previous.target !== target) return repeat('Диапазон программы изменился. Прошлый факт показан без прибавки.')
  if (previous?.readinessMode === 'reduced') return repeat('Прошлое занятие было в облегчённом режиме. Пока без прибавки.')
  if (options.today && (Date.parse(options.today) - Date.parse(previous!.finishedAt)) / 86400000 >= 14) return repeat('С последнего занятия прошло 14 дней или больше. Повтори прошлый факт и оцени новый результат.')
  if (work.length !== plannedSets || sets.length !== plannedSets) return repeat('В прошлый раз выполнены не все рабочие подходы. Повтори план без прибавки.')
  if (sets.some(set=>set.weightKg===null)) return repeat('В прошлом результате не указан вес. Уточни нагрузку без автоматической прибавки.')
  if (sets.some((set) => set.reps! < range.min || (set.rir !== null && set.rir < 2))) return repeat('Не все подходы освоены в диапазоне с запасом. Повтори прошлую нагрузку.', 'recover')
  const earlier = previous?.earlier
  const older = earlier?.sets.filter((set) => !set.isWarmup) ?? []
  const comparable = earlier && (!earlier.target || earlier.target === target) && earlier.readinessMode !== 'reduced' && older.length === plannedSets && older.every((set) => set.done && set.reps !== null)
  const worse = comparable && sets.some((set, index) => (set.weightKg ?? 0) < (older[index].weightKg ?? 0) || ((set.weightKg ?? 0) === (older[index].weightKg ?? 0) && set.reps! < older[index].reps!))
  if (worse) return repeat('В прошлый раз вес или повторы ниже предыдущего сопоставимого занятия. Пока без прибавки.')
  if (range.timed) return repeat('Повтори прошлое время. Прибавка секунд программой не задана.')
  const allTop = sets.every((set) => set.reps! >= range.max)
  if (allTop) {
    const weight = sets[0].weightKg ?? 0
    const stable = comparable && sets.every((set, index) => (set.weightKg ?? 0) === weight && (older[index].weightKg ?? 0) === weight && older[index].reps! >= range.max)
    if (!stable) return repeat(`В прошлый раз все ${plannedSets} подхода на верхней границе. Повтори результат для подтверждения.`)
    if (sets.some(set=>set.rir===null) || older.some(set=>set.rir===null || set.rir!<2)) return repeat('Верх диапазона выполнен, но запас не оценён. Повтори вес; автоматической прибавки нет.')
    const step = options.weightStep
    if (!weight || !step || step <= 0 || step > weight * 0.1 || weight + step > 1000) return repeat('Верх диапазона подтверждён дважды. Укажи доступный небольшой шаг оборудования для предложения веса.')
    return { mode: 'increase', message: `Дважды выполнено ${plannedSets} × ${range.max} с весом ${formatNumber(weight)} кг. Можно попробовать ${formatNumber(weight + step)} кг × ${range.min}.`, targets: targets.map((set) => ({ ...set, weightKg: weight + step, reps: range.min, optional: true })) }
  }
  // Add just one total rep, to the first set that has room in the range.
  const index = sets.findIndex((set) => set.reps! < range.max)
  if (index >= 0) targets[index] = { ...targets[index], reps: targets[index].reps + 1, optional: true }
  return { mode: 'reps', message: `Все ${plannedSets} рабочих подхода в диапазоне${comparable ? ', снижения нет' : ''}. Можно попробовать +1 повтор в подходе ${index + 1}; остальные повтори.`, targets }
}

export function formatSetTarget(target: SetTarget) {
  return target.timed ? `${target.reps} сек` : `${target.weightKg===null ? 'Вес не задан' : target.weightKg ? `${formatNumber(target.weightKg)} кг` : 'свой вес'} × ${target.reps}`
}

export function getSetTargetStatus(set: WorkoutSetDraft, target?: SetTarget) {
  if (!set.done || !target || set.reps === null) return null
  if (set.rir !== null && set.rir < target.rir) return 'Нагрузка высокая · сохрани или снизь'
  if (target.timed && (set.weightKg ?? 0) !== (target.weightKg ?? 0)) return 'Вес изменён · результат несопоставим'
  if ((set.weightKg ?? 0) >= (target.weightKg ?? 0) && set.reps >= target.reps) return 'Цель выполнена'
  if ((set.weightKg ?? 0) > (target.weightKg ?? 0)) return 'Вес выше цели · проверь технику'
  return 'Ниже ориентира · оцени самочувствие'
}
