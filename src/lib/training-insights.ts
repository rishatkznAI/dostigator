import type { HistoryWorkout, WorkoutDraft, WorkoutSetDraft } from '../types/training'
import type { CardioSession } from './cardio'
import { localDate } from './date'
import { formatNumber, parseRepRange } from './workout'

export const workFacts = (sets: WorkoutSetDraft[]) => sets.filter((set) => set.done && !set.isWarmup && set.reps !== null)
export function draftToHistory(draft: WorkoutDraft): HistoryWorkout {
  return { id: draft.id, templateCode: draft.templateCode, title: draft.title, startedAt: draft.startedAt, finishedAt: draft.finishedAt!, timerPausedDurationMs: draft.timerPausedDurationMs, readinessMode: draft.readiness?.mode ?? null, exercises: draft.exercises.map((item) => ({ ...item, exerciseKey: item.exercise.key, exerciseName: item.exercise.name })) }
}
export function mergeTrainingHistory(history: HistoryWorkout[], pending: WorkoutDraft[]) {
  const map = new Map(history.map((item) => [item.id, item]))
  pending.filter((item) => item.finishedAt).forEach((item) => map.set(item.id, draftToHistory(item)))
  return [...map.values()].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))
}
export const historyCacheKey = (userId: string) => `trainlog:history-cache:${userId}`
export function cachedTrainingHistory(userId: string): HistoryWorkout[] {
  try { const value = JSON.parse(localStorage.getItem(historyCacheKey(userId)) ?? '[]'); return Array.isArray(value) ? value : [] } catch { return [] }
}
export function cacheTrainingHistory(userId: string, history: HistoryWorkout[]) {
  try { localStorage.setItem(historyCacheKey(userId), JSON.stringify(history)) } catch { /* remote history still available; no local guarantee */ }
}
const signed = (value: number) => `${value > 0 ? '+' : ''}${formatNumber(value)}`
export function compareExercise(current: HistoryWorkout['exercises'][number], previous?: HistoryWorkout['exercises'][number]) {
  const sets = workFacts(current.sets)
  const older = previous && workFacts(previous.sets)
  if (!sets.length) return 'Нет выполненных рабочих подходов'
  if (!previous || previous.skipped || !older?.length || current.target !== previous.target) return 'Нет сопоставимого прошлого результата'
  if (sets.length !== older.length || current.sets.filter((s) => !s.isWarmup).some((s) => !s.done) || previous.sets.filter((s) => !s.isWarmup).some((s) => !s.done)) return `Выполнено ${sets.length} подхода; раньше ${older.length}. Состав подходов отличается — нагрузку не сравниваем.`
  if (sets.some(set=>set.weightKg===null) || older.some(set=>set.weightKg===null)) return 'Вес указан не во всех подходах — нагрузку не сравниваем.'
  const sameWeights = sets.every((set, index) => (set.weightKg ?? 0) === (older[index].weightKg ?? 0))
  const timed = parseRepRange(current.target)?.timed
  const total = sets.reduce((sum, set) => sum + set.reps!, 0)
  const before = older.reduce((sum, set) => sum + set.reps!, 0)
  if (sameWeights) return `${timed ? 'Время' : 'Повторы'}: ${total} (${signed(total - before)} ${timed ? 'сек' : 'повт.'}) при том же весе и числе подходов`
  const uniform = sets.every((set) => set.weightKg === sets[0].weightKg) && older.every((set) => set.weightKg === older[0].weightKg)
  return uniform ? `Рабочий вес: ${formatNumber(older[0].weightKg ?? 0)} → ${formatNumber(sets[0].weightKg ?? 0)} кг; ${timed ? 'секунды' : 'повторы'}: ${before} → ${total}` : 'Веса по подходам изменились. Сравни факты по каждому подходу.'
}
export function workoutChanges(current: HistoryWorkout, history: HistoryWorkout[]) {
  return current.exercises.filter((item) => !item.skipped && workFacts(item.sets).length).map((exercise) => {
    const previousWorkout = history.filter((item) => item.id !== current.id && item.finishedAt < current.startedAt && item.readinessMode === current.readinessMode).sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)).find((item) => item.exercises.some((older) => older.exerciseKey === exercise.exerciseKey && !older.skipped && older.target === exercise.target && workFacts(older.sets).length))
    return { exercise, previousWorkout, text: compareExercise(exercise, previousWorkout?.exercises.find((item) => item.exerciseKey === exercise.exerciseKey)) }
  })
}
export function weekMonday(date: Date) {
  const value = new Date(date); value.setHours(12, 0, 0, 0); value.setDate(value.getDate() - (value.getDay() + 6) % 7); return value
}
export function weeklyProgress(history: HistoryWorkout[], cardio: CardioSession[], today = new Date(), count = 8) {
  const monday = weekMonday(today)
  return Array.from({ length: count }, (_, index) => {
    const start = new Date(monday); start.setDate(start.getDate() - index * 7)
    const end = new Date(start); end.setDate(end.getDate() + 7)
    const from = localDate(start), to = localDate(end)
    const workouts = history.filter((item) => { const date = localDate(new Date(item.finishedAt)); return date >= from && date < to })
    const sessions = cardio.filter((item) => item.activity_date >= from && item.activity_date < to)
    return { from, to, workouts: workouts.length, sets: workouts.reduce((sum, item) => sum + item.exercises.filter((e) => !e.skipped).reduce((total, e) => total + workFacts(e.sets).length, 0), 0), cardioMinutes: Math.floor(sessions.reduce((sum,item)=>sum+(item.duration_seconds??item.duration_minutes*60),0)/60), cardioSeconds:sessions.reduce((sum,item)=>sum+(item.duration_seconds??item.duration_minutes*60),0) }
  })
}
export function exerciseFactsText(exercise: HistoryWorkout['exercises'][number]) {
  const timed = parseRepRange(exercise.target)?.timed
  return workFacts(exercise.sets).map((set) => timed ? `${set.reps} сек` : `${formatNumber(set.weightKg ?? 0)} кг × ${set.reps}`).join(' · ')
}
