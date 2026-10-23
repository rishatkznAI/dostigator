import { supabase } from './supabase'
import { validateWorkoutSetValue } from './workout'
import type { HistoryWorkout, WorkoutSetDraft } from '../types/training'

export type CorrectionValues = { weightKg: number; reps: number; rir: number | null }
type Request = { p_expected_owner: string; p_mutation_id: string; p_session_id: string; p_set_id: string; p_expected_revision: number; p_expected_updated_at: string; p_values: {weight_kg:number;reps:number;rir:number|null} }
export const correctionKey = (owner: string, setId: string) => `trainlog:set-correction:${owner}:${setId}`

export async function correctWorkoutSet(owner: string, workout: HistoryWorkout, set: WorkoutSetDraft, values: CorrectionValues) {
  for (const field of ['weightKg', 'reps', 'rir'] as const) {
    const validation = validateWorkoutSetValue(field, values[field])
    if (!validation.valid) throw new Error(validation.message)
  }
  if (!set.done || workout.revision === undefined || !workout.updatedAt) throw new Error('Обнови историю перед исправлением.')
  if (!navigator.onLine) throw new Error('Ввод сохранён на устройстве. Подключись к сети и повтори сохранение.')
  const identity = await supabase.auth.getUser()
  if (identity.error || identity.data.user?.id !== owner) throw new Error('Аккаунт изменился. Исправление осталось в исходном профиле.')
  const key = correctionKey(owner, set.id)
  const prior = JSON.parse(localStorage.getItem(key) ?? 'null') as Request | null
  const payload = { weight_kg: values.weightKg, reps: values.reps, rir: values.rir }
  // Replay the exact envelope after a lost response before permitting a second correction.
  const request: Request = prior ?? { p_expected_owner: owner, p_mutation_id: crypto.randomUUID(), p_session_id: workout.id, p_set_id: set.id, p_expected_revision: workout.revision, p_expected_updated_at: workout.updatedAt, p_values: payload }
  localStorage.setItem(key, JSON.stringify(request))
  const { data, error } = await supabase.rpc('training_correct_set', request)
  if (error) {
    if (['PT409','40001'].includes(error.code)) {
      // A conflict is definitive: keep the input, allow a fresh attempt after reloading history.
      localStorage.removeItem(key)
      throw new Error('История изменилась на другом устройстве. Закрой исправление, обнови историю и проверь новый результат. Твой ввод сохранён.')
    }
    if (error.code === 'PGRST202') { localStorage.removeItem(key); throw new Error('Сервер пока не поддерживает исправление истории. Ввод сохранён на устройстве.') }
    throw new Error('Сервер не подтвердил исправление. Ввод сохранён; повтори сохранение при наличии сети.')
  }
  if (data?.id !== workout.id || data.revision !== request.p_expected_revision+1 || data.set?.id !== set.id
    || data.set.weight_kg !== request.p_values.weight_kg || data.set.reps !== request.p_values.reps || data.set.rir !== request.p_values.rir || !data.updated_at) {
    throw new Error('Сервер не подтвердил исправление. Повтори сохранение; ввод сохранён.')
  }
  localStorage.removeItem(key)
  const corrected = { ...workout, revision: data.revision, updatedAt: data.updated_at as string,
    exercises: workout.exercises.map(exercise => ({...exercise, sets: exercise.sets.map(item => item.id === set.id ? {...item, weightKg:data.set.weight_kg, reps:data.set.reps, rir:data.set.rir} : item)})) }
  if (JSON.stringify(request.p_values) !== JSON.stringify(payload)) return correctWorkoutSet(owner, corrected, set, values)
  return corrected
}
