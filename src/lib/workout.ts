import type {
  HistoryWorkout,
  OverloadRecommendation,
  PreviousResult,
  WeeklyStats,
  WorkoutDraft,
  WorkoutSetDraft,
  WorkoutTemplate,
} from '../types/training'

const UUID_FALLBACK = () =>
  '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (char) =>
    (Number(char) ^ (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (Number(char) / 4)))).toString(16),
  )

export const createId = () => crypto.randomUUID?.() ?? UUID_FALLBACK()

export type WorkoutSetNumericField = 'weightKg' | 'reps' | 'rir'

export type WorkoutSetValueValidation =
  | { valid: true; value: number | null }
  | { valid: false; message: string }

export function validateWorkoutSetValue(field: WorkoutSetNumericField, value: number | null): WorkoutSetValueValidation {
  if (value === null) return { valid: true, value }
  if (!Number.isFinite(value)) return { valid: false, message: 'Введите конечное числовое значение' }
  if (field === 'weightKg') {
    return value >= 0 && value <= 1000 && Number.isInteger(value * 2)
      ? { valid: true, value }
      : { valid: false, message: 'Вес: от 0 до 1000 кг с шагом 0,5' }
  }
  if (field === 'reps') {
    return Number.isInteger(value) && value >= 1 && value <= 1000
      ? { valid: true, value }
      : { valid: false, message: 'Повторы: целое число от 1 до 1000' }
  }
  return Number.isInteger(value) && value >= 0 && value <= 5
    ? { valid: true, value }
    : { valid: false, message: 'RIR: целое число от 0 до 5' }
}

export function workoutDraftValidationError(draft: WorkoutDraft): string | null {
  for (const exercise of draft.exercises) {
    for (const set of exercise.sets) {
      for (const field of ['weightKg', 'reps', 'rir'] as const) {
        const result = validateWorkoutSetValue(field, set[field])
        if (!result.valid) return `${exercise.exercise.name}, подход ${set.setNumber}: ${result.message}`
      }
      if (set.done && (set.reps === null || set.rir === null)) {
        return `${exercise.exercise.name}, подход ${set.setNumber}: укажите повторы и RIR`
      }
    }
  }
  return null
}

export function createWorkoutDraft(template: WorkoutTemplate, userId: string, now = new Date()): WorkoutDraft {
  const sessionId = createId()
  return {
    schemaVersion: 3,
    id: sessionId,
    userId,
    templateCode: template.code,
    title: `Тренировка ${template.code}`,
    startedAt: now.toISOString(),
    finishedAt: null,
    timerPausedAt: null,
    timerPausedDurationMs: 0,
    readiness: null,
    activeRest: null,
    deletedSetIds: [],
    updatedAt: now.toISOString(),
    syncState: 'pending',
    exercises: template.items.map((item) => {
      const exerciseId = createId()
      return {
        id: exerciseId,
        exercise: item.exercise,
        target: item.repTarget,
        sortOrder: item.sortOrder,
        skipped: false,
        skipReason: '',
        sets: Array.from({ length: item.setCount }, (_, index) => ({
          id: createId(),
          setNumber: index + 1,
          weightKg: null,
          reps: null,
          rir: null,
          done: false,
          isWarmup: false,
          completedAt: null,
        })),
      }
    }),
  }
}

export function parseRepRange(target: string): { min: number; max: number; timed: boolean } | null {
  const values = target.match(/\d+/g)?.map(Number)
  if (!values?.length) return null
  const min = values[0]!
  return { min, max: values[1] ?? min, timed: /сек|second/i.test(target) }
}

const formatWeight = (weight: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(weight)

export function getOverloadRecommendation(target: string, previous?: PreviousResult): OverloadRecommendation {
  const range = parseRepRange(target)
  const sets = previous?.sets.filter((set) => set.done && !set.isWarmup && set.reps !== null) ?? []
  if (!range || sets.length === 0) {
    return {
      mode: 'baseline',
      eyebrow: 'Первая точка',
      message: 'Выбери уверенный рабочий вес и оставь 2 повтора в запасе.',
    }
  }

  if (range.timed) {
    const best = Math.max(...sets.map((set) => set.reps ?? 0))
    return best >= range.max
      ? { mode: 'increase', eyebrow: 'Следующая цель', message: 'Усложни вариант или добавь 5 секунд.' }
      : { mode: 'reps', eyebrow: 'Цель сегодня', message: `Добавь время, сохраняя технику. Прошлый максимум — ${best} сек.` }
  }

  const allAtTop = sets.every((set) => (set.reps ?? 0) >= range.max && (set.rir ?? -1) >= 1)
  const hitLimit = sets.some((set) => (set.reps ?? 0) < range.min || set.rir === 0)
  const workingWeight = Math.max(...sets.map((set) => set.weightKg ?? 0))

  if (allAtTop && workingWeight > 0) {
    const increment = workingWeight >= 100 ? 5 : workingWeight >= 20 ? 2.5 : 1
    return {
      mode: 'increase',
      eyebrow: 'Следующая цель',
      message: `Попробуй ${formatWeight(workingWeight + increment)} кг. Если техника плывёт — вернись к прошлому весу.`,
    }
  }

  if (hitLimit) {
    return {
      mode: 'recover',
      eyebrow: 'Цель сегодня',
      message: workingWeight > 0
        ? `Сохрани ${formatWeight(workingWeight)} кг и верни все подходы в диапазон ${range.min}–${range.max}.`
        : `Верни все подходы в диапазон ${range.min}–${range.max} без отказа.`,
    }
  }

  return {
    mode: 'reps',
    eyebrow: 'Цель сегодня',
    message: workingWeight > 0
      ? `Сохрани ${formatWeight(workingWeight)} кг и добавь 1 повтор там, где можешь.`
      : 'Добавь 1 повтор там, где можешь, сохраняя запас минимум 1 RIR.',
  }
}

export const workoutVolume = (sets: WorkoutSetDraft[]) =>
  sets.filter((set) => set.done && !set.isWarmup).reduce((total, set) => total + (set.weightKg ?? 0) * (set.reps ?? 0), 0)

export function workoutElapsedMs(draft: WorkoutDraft, now = Date.now()) {
  const startedAt = new Date(draft.startedAt).getTime()
  const currentEndpoint = draft.timerPausedAt ? new Date(draft.timerPausedAt).getTime() : now
  return Math.max(0, currentEndpoint - startedAt - draft.timerPausedDurationMs)
}

export function toggleWorkoutTimer(draft: WorkoutDraft, now = new Date()): WorkoutDraft {
  const timestamp = now.toISOString()
  if (!draft.timerPausedAt) {
    return { ...draft, timerPausedAt: timestamp, updatedAt: timestamp, syncState: 'pending' }
  }

  const pausedFor = Math.max(0, now.getTime() - new Date(draft.timerPausedAt).getTime())
  return {
    ...draft,
    timerPausedAt: null,
    timerPausedDurationMs: draft.timerPausedDurationMs + pausedFor,
    updatedAt: timestamp,
    syncState: 'pending',
  }
}

export function finishWorkoutTimer(draft: WorkoutDraft, now = new Date()): WorkoutDraft {
  const runningDraft = draft.timerPausedAt ? toggleWorkoutTimer(draft, now) : draft
  const timestamp = now.toISOString()
  return { ...runningDraft, finishedAt: timestamp, updatedAt: timestamp, syncState: 'pending' }
}

export const draftSummary = (draft: WorkoutDraft, now = new Date()) => {
  const sets = draft.exercises.flatMap((exercise) => exercise.sets).filter((set) => set.done && !set.isWarmup)
  return {
    minutes: Math.max(1, Math.round(workoutElapsedMs(draft, now.getTime()) / 60_000)),
    sets: sets.length,
    volume: workoutVolume(sets),
  }
}

export const historySummary = (workout: HistoryWorkout) => {
  const sets = workout.exercises.flatMap((exercise) => exercise.sets).filter((set) => set.done && !set.isWarmup)
  return {
    minutes: Math.max(1, Math.round((new Date(workout.finishedAt).getTime() - new Date(workout.startedAt).getTime() - workout.timerPausedDurationMs) / 60_000)),
    sets: sets.length,
    volume: workoutVolume(sets),
  }
}

export function getWeeklyStats(history: HistoryWorkout[], now = new Date()): WeeklyStats {
  const start = new Date(now)
  const day = (start.getDay() + 6) % 7
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - day)
  const workouts = history.filter((item) => new Date(item.finishedAt) >= start)
  return workouts.reduce<WeeklyStats>(
    (stats, workout) => {
      const summary = historySummary(workout)
      stats.workouts += 1
      stats.sets += summary.sets
      stats.volume += summary.volume
      return stats
    },
    { workouts: 0, sets: 0, volume: 0 },
  )
}

export function formatSet(set: WorkoutSetDraft) {
  const weight = set.weightKg ? `${formatWeight(set.weightKg)} кг` : 'свой вес'
  return `${weight} × ${set.reps ?? '—'}${set.rir === null ? '' : ` · RIR ${set.rir}`}`
}

export function getNextMandatoryWorkout(history: HistoryWorkout[]): 'A' | 'B' {
  const lastMandatory = history.find((workout) => workout.templateCode === 'A' || workout.templateCode === 'B')
  return lastMandatory?.templateCode === 'A' ? 'B' : 'A'
}

export function getCompletedTemplateCodesThisWeek(history: HistoryWorkout[], now = new Date()) {
  const start = new Date(now)
  const day = (start.getDay() + 6) % 7
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - day)
  return new Set(history.filter((item) => new Date(item.finishedAt) >= start).map((item) => item.templateCode).filter(Boolean))
}

export function getCalibrationSuggestion(target: string, set?: WorkoutSetDraft) {
  if (!set?.done || set.reps === null || set.rir === null) return null
  const range = parseRepRange(target)
  if (!range) return null
  if (set.isWarmup) return 'Разминка готова. Для рабочего подхода выбери вес с запасом около 2 RIR.'
  if (set.rir >= 4 && set.reps >= range.max) return 'Вес лёгкий: следующий рабочий подход можно немного увеличить.'
  if (set.rir <= 1 || set.reps < range.min) return 'Нагрузка высокая: сохрани или немного уменьши вес в следующем подходе.'
  return 'Рабочий вес подобран удачно — сохрани его для следующего подхода.'
}

export const estimatedOneRepMax = (weightKg: number, reps: number) =>
  reps <= 0 || weightKg <= 0 ? 0 : weightKg * (1 + Math.min(reps, 30) / 30)

export const formatNumber = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)

export function elapsedClock(draft: WorkoutDraft, now = Date.now()) {
  const seconds = Math.floor(workoutElapsedMs(draft, now) / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return [hours, minutes, rest].map((part) => String(part).padStart(2, '0')).join(':')
}
