import data from './program-v21.json'
import type { WorkoutTemplate } from '../types/training'

export const PROGRAM_V21 = 'v2.1-2026-10-22'
// Immutable product revision. Legacy reference rows and user snapshots are never rewritten.
export const programV21Templates = data as WorkoutTemplate[]
export const programV21Exercises = [...new Map(programV21Templates.flatMap(t => t.items.map(i => [i.exercise.key, i.exercise] as const))).values()]
export const programV21Rules = 'Первые две недели — запас 2–3 повтора, без отказа. Тяжёлые подходы: около 2 минут отдыха; изолирующие: 60–90 секунд. Можно отдыхать дольше ради техники. Повышай вес только после уверенного достижения верхней границы во всех рабочих подходах. RIR необязателен; без него приложение не предлагает прибавку веса. При заметной усталости выбери облегчённый режим: постоянная программа не изменится.'
