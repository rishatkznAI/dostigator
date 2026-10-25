import type { Exercise, HistoryWorkout, WorkoutDraft, WorkoutTemplate, WorkoutTemplateItem } from '../types/training'
import { createId, createWorkoutDraft } from './workout'
import { getActiveDraft, saveActiveDraft } from './storage'

export const FREE_WORKOUT_CODE = 'free'
export const FREE_WORKOUT_NOTE = 'dostigator:free-workout:v1'
export const FREE_WORKOUT_TEMPLATE: WorkoutTemplate = { code: FREE_WORKOUT_CODE, title: 'Свободная тренировка', sortOrder: 99, items: [] }
export type CatalogItem = { exercise: Exercise; target: string }
const prefix = 'dostigator:custom-exercise:v1:'
const personalKey = (owner: string) => `trainlog:personal-exercises:${owner}`
const customKey = /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createPersonalExercise(name: string, muscles: string, hint = ''): Exercise {
  const clean = name.trim().replace(/\s+/g, ' ')
  if (!clean || clean.length > 100) throw new Error('Название упражнения: от 1 до 100 символов.')
  if (muscles.trim().length > 80 || hint.trim().length > 200) throw new Error('Сократи описание мышц или подсказку.')
  return { key: `custom:${createId()}`, name: clean, muscles: muscles.trim() ? [muscles.trim()] : [], steps: hint.trim() ? [hint.trim()] : [], mistakes: [], youtube_url: null, custom: true }
}

export function encodePersonalExercise(exercise: Exercise): string {
  if (!exercise.custom || !customKey.test(exercise.key)) return ''
  const note = prefix + JSON.stringify({ key: exercise.key, name: exercise.name, muscles: exercise.muscles, steps: exercise.steps })
  if (note.length > 1000) throw new Error('Описание своего упражнения слишком длинное.')
  return note
}

export function decodePersonalExercise(note: string, name: string): Exercise | undefined {
  if (!note.startsWith(prefix)) return undefined
  try {
    const value = JSON.parse(note.slice(prefix.length))
    if (!customKey.test(value.key) || value.name !== name || !name.trim() || name.length > 100 || !Array.isArray(value.muscles) || value.muscles.length > 5 || !Array.isArray(value.steps) || value.steps.length > 3) return undefined
    if (value.muscles.some((v: unknown) => typeof v !== 'string' || v.length > 80) || value.steps.some((v: unknown) => typeof v !== 'string' || v.length > 200)) return undefined
    return { key: value.key, name, muscles: value.muscles, steps: value.steps, mistakes: [], youtube_url: null, custom: true }
  } catch { return undefined }
}

export function readPersonalExercises(owner: string): CatalogItem[] {
  try {
    const rows = JSON.parse(localStorage.getItem(personalKey(owner)) ?? '[]')
    if (!Array.isArray(rows)) return []
    return rows.flatMap(row => {
      if (!row?.exercise?.custom || typeof row.exercise.name !== 'string' || typeof row.target !== 'string' || row.target.length > 80) return []
      const exercise = decodePersonalExercise(prefix + JSON.stringify(row.exercise), row.exercise.name)
      return exercise ? [{ exercise, target: row.target }] : []
    })
  } catch { return [] }
}

export function savePersonalExercise(owner: string, item: CatalogItem) {
  encodePersonalExercise(item.exercise)
  const rows = readPersonalExercises(owner)
  if (rows.some(row => row.exercise.name.toLocaleLowerCase('ru-RU') === item.exercise.name.toLocaleLowerCase('ru-RU'))) throw new Error('Такое своё упражнение уже есть в каталоге.')
  localStorage.setItem(personalKey(owner), JSON.stringify([...rows, item]))
}

export function personalExercisesFromHistory(history: HistoryWorkout[]): CatalogItem[] {
  const unique = new Map<string, CatalogItem>()
  for (const session of history) for (const item of session.exercises) {
    if (item.customExercise && !unique.has(item.customExercise.key)) unique.set(item.customExercise.key, { exercise: item.customExercise, target: item.target })
  }
  return [...unique.values()]
}

export function validateFreeSelection(items: WorkoutTemplateItem[]) {
  if (!items.length || items.length > 30) throw new Error('Выбери от 1 до 30 упражнений.')
  const keys = new Set<string>()
  for (const item of items) {
    if (keys.has(item.exercise.key)) throw new Error('Упражнение уже выбрано.')
    keys.add(item.exercise.key)
    if (!Number.isInteger(item.setCount) || item.setCount < 1 || item.setCount > 10) throw new Error('Укажи от 1 до 10 подходов.')
    if (!/^\d{1,3}(?:\s*[–-]\s*\d{1,3})?(?:\s*сек)?$/.test(item.repTarget.trim())) throw new Error('План: число или диапазон, например 8–12 или 30 сек.')
    const numbers = item.repTarget.match(/\d+/g)!.map(Number)
    if (numbers.some(n => n < 1) || (numbers.length > 1 && numbers[0] > numbers[1])) throw new Error('Проверь диапазон повторов или секунд.')
  }
}

export function startFreeWorkout(owner: string, title: string, items: WorkoutTemplateItem[]): WorkoutDraft {
  if (getActiveDraft(owner)) throw new Error('Уже есть активная тренировка. Продолжи её или добавь выбранные упражнения в неё.')
  validateFreeSelection(items)
  const name = title.trim() || FREE_WORKOUT_TEMPLATE.title
  if (name.length > 100) throw new Error('Название тренировки: до 100 символов.')
  const draft = { ...createWorkoutDraft({ ...FREE_WORKOUT_TEMPLATE, items: items.map((item, i) => ({ ...item, sortOrder: i + 1 })) }, owner), title: name }
  saveActiveDraft(draft)
  return draft
}

export function appendExercisesToWorkout(owner: string, items: WorkoutTemplateItem[], expectedSessionId: string): WorkoutDraft {
  validateFreeSelection(items)
  const current = getActiveDraft(owner)
  if (!current || current.finishedAt) throw new Error('Активная тренировка не найдена. Вернись к списку и повтори.')
  if (current.id !== expectedSessionId) throw new Error('Активная тренировка изменилась в другой вкладке. Проверь её название и повтори добавление.')
  const existing = new Set(current.exercises.map(row => row.exercise.key))
  const fresh = items.filter(row => !existing.has(row.exercise.key))
  if (!fresh.length) throw new Error('Выбранные упражнения уже есть в текущей тренировке.')
  if (current.exercises.length + fresh.length > 30) throw new Error('В одной тренировке можно использовать до 30 упражнений.')
  const offset = Math.max(0, ...current.exercises.map(row => row.sortOrder))
  const additions = createWorkoutDraft({ ...FREE_WORKOUT_TEMPLATE, items: fresh }, owner).exercises.map((row, i) => ({ ...row, sortOrder: offset + i + 1 }))
  const next = { ...current, exercises: [...current.exercises, ...additions], updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString(), syncState: 'pending' as const }
  saveActiveDraft(next)
  return next
}
