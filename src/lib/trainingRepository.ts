import { supabase } from './supabase'
import { cacheTemplates, getCachedTemplates } from './storage'
import type {
  BodyMeasurement,
  DailyActivity,
  Exercise,
  HistoryWorkout,
  NutritionEntry,
  PersonalBackup,
  PreviousResult,
  WorkoutDraft,
  WorkoutSetDraft,
  WorkoutTemplate,
  WeeklyReportData,
  WeeklyWorkoutSummary,
} from '../types/training'
import type { TableRow } from '../types/trainingDatabase'
import { historySummary } from './workout'
import { selectPreviousResults } from './workout-targets'

type QueryError = { message: string }

const fail = (context: string, error: QueryError | null) => {
  if (error) throw new Error(`${context}: ${error.message}`)
}

export async function loadTemplates(): Promise<WorkoutTemplate[]> {
  const [templatesResult, itemsResult, libraryResult] = await Promise.all([
    supabase.from('workout_templates').select('*').eq('active', true).order('sort_order'),
    supabase.from('workout_template_items').select('*').order('sort_order'),
    supabase.from('exercise_library').select('*').eq('active', true),
  ])

  const error = templatesResult.error ?? itemsResult.error ?? libraryResult.error
  if (error) {
    const cached = getCachedTemplates()
    if (cached.length) return cached
    fail('Не удалось загрузить программу', error)
  }

  const exercises = new Map((libraryResult.data ?? []).map((exercise) => [exercise.key, exercise]))
  const result = (templatesResult.data ?? []).map<WorkoutTemplate>((template) => ({
    code: template.code,
    title: template.title,
    sortOrder: template.sort_order,
    items: (itemsResult.data ?? [])
      .filter((item) => item.template_code === template.code)
      .map((item) => {
        const exercise = exercises.get(item.exercise_key)
        if (!exercise) throw new Error(`Упражнение ${item.exercise_key} отсутствует в exercise_library`)
        return {
          sortOrder: item.sort_order,
          setCount: item.set_count,
          repTarget: item.rep_target,
          exercise: {
            key: exercise.key,
            name: exercise.name,
            muscles: exercise.muscles,
            steps: exercise.steps,
            mistakes: exercise.mistakes,
            youtube_url: exercise.youtube_url,
          },
        }
      }),
  }))

  cacheTemplates(result)
  return result
}

const mapSet = (set: TableRow<'workout_sets'>): WorkoutSetDraft => ({
  id: set.id,
  setNumber: set.set_number,
  weightKg: set.weight_kg,
  reps: set.reps,
  rir: set.rir,
  done: set.done,
  isWarmup: set.is_warmup,
  completedAt: set.completed_at,
})

export async function loadExerciseLibrary(): Promise<Exercise[]> {
  const result = await supabase.from('exercise_library').select('*').eq('active', true).order('name')
  fail('Не удалось загрузить библиотеку упражнений', result.error)
  return (result.data ?? []).map((exercise) => ({
    key: exercise.key,
    name: exercise.name,
    muscles: exercise.muscles,
    steps: exercise.steps,
    mistakes: exercise.mistakes,
    youtube_url: exercise.youtube_url,
  }))
}

export async function loadHistory(limit = 100): Promise<HistoryWorkout[]> {
  const sessionsResult = await supabase
    .from('workout_sessions')
    .select('*')
    .not('finished_at', 'is', null)
    .order('finished_at', { ascending: false })
    .limit(limit)
  fail('Не удалось загрузить историю', sessionsResult.error)
  const sessions = sessionsResult.data ?? []
  if (!sessions.length) return []

  const sessionIds = sessions.map((session) => session.id)
  const exercisesResult = await supabase
    .from('workout_session_exercises')
    .select('*')
    .in('session_id', sessionIds)
    .order('sort_order')
  fail('Не удалось загрузить упражнения истории', exercisesResult.error)
  const exercises = exercisesResult.data ?? []

  const exerciseIds = exercises.map((exercise) => exercise.id)
  const setsResult = exerciseIds.length
    ? await supabase
        .from('workout_sets')
        .select('*')
        .in('session_exercise_id', exerciseIds)
        .order('set_number')
    : { data: [], error: null }
  fail('Не удалось загрузить подходы истории', setsResult.error)
  const sets = setsResult.data ?? []

  return sessions.map((session) => ({
    id: session.id,
    templateCode: session.template_code,
    title: session.title,
    startedAt: session.started_at,
    finishedAt: session.finished_at!,
    timerPausedDurationMs: session.timer_paused_duration_ms,
    readinessMode: session.readiness_mode as 'normal' | 'reduced' | null,
    exercises: exercises
      .filter((exercise) => exercise.session_id === session.id)
      .map((exercise) => ({
        id: exercise.id,
        exerciseKey: exercise.exercise_key,
        exerciseName: exercise.exercise_name,
        target: exercise.target,
        sortOrder: exercise.sort_order,
        skipped: exercise.skipped,
        skipReason: exercise.skip_reason,
        sets: sets.filter((set) => set.session_exercise_id === exercise.id).map(mapSet),
      })),
  }))
}

export async function loadPreviousResults(exerciseKeys: string[], before?: string): Promise<Map<string, PreviousResult>> {
  const history = await loadHistory(250)
  return selectPreviousResults(history, exerciseKeys, before)
}

export async function syncWorkoutDraft(draft: WorkoutDraft): Promise<void> {
  const sessionResult = await supabase.from('workout_sessions').upsert(
    {
      id: draft.id,
      template_code: draft.templateCode,
      title: draft.title,
      started_at: draft.startedAt,
      finished_at: draft.finishedAt,
      timer_paused_at: draft.timerPausedAt,
      timer_paused_duration_ms: draft.timerPausedDurationMs,
      readiness_sleep: draft.readiness?.sleep ?? null,
      readiness_energy: draft.readiness?.energy ?? null,
      readiness_stress: draft.readiness?.stress ?? null,
      readiness_discomfort: draft.readiness?.discomfort ?? false,
      readiness_mode: draft.readiness?.mode ?? null,
      readiness_note: draft.readiness?.note ?? '',
      updated_at: draft.updatedAt,
    },
    { onConflict: 'id' },
  )
  fail('Не удалось синхронизировать тренировку', sessionResult.error)

  const exerciseRows = draft.exercises.map((exercise) => ({
    id: exercise.id,
    session_id: draft.id,
    exercise_key: exercise.exercise.key,
    exercise_name: exercise.exercise.name,
    target: exercise.target,
    sort_order: exercise.sortOrder,
    skipped: exercise.skipped,
    skip_reason: exercise.skipReason,
  }))
  const exerciseResult = await supabase
    .from('workout_session_exercises')
    .upsert(exerciseRows, { onConflict: 'id' })
  fail('Не удалось синхронизировать упражнения', exerciseResult.error)

  const setRows = draft.exercises.flatMap((exercise) =>
    exercise.sets.map((set) => ({
      id: set.id,
      session_id: draft.id,
      session_exercise_id: exercise.id,
      set_number: set.setNumber,
      weight_kg: set.weightKg,
      reps: set.reps,
      rir: set.rir,
      done: set.done,
      is_warmup: set.isWarmup,
      completed_at: set.completedAt,
    })),
  )
  if (setRows.length) {
    const setsResult = await supabase.from('workout_sets').upsert(setRows, { onConflict: 'id' })
    fail('Не удалось синхронизировать подходы', setsResult.error)
  }
  if (draft.deletedSetIds.length) {
    const deletedResult = await supabase.from('workout_sets').delete().in('id', draft.deletedSetIds)
    fail('Не удалось удалить подход', deletedResult.error)
  }
}

export async function deleteWorkoutSession(id: string): Promise<void> {
  const result = await supabase.from('workout_sessions').delete().eq('id', id)
  fail('Не удалось отменить тренировку', result.error)
}

export async function loadMeasurements(): Promise<BodyMeasurement[]> {
  const result = await supabase.from('body_measurements').select('*').order('measured_at', { ascending: false })
  fail('Не удалось загрузить замеры', result.error)
  return result.data ?? []
}

export async function saveMeasurement(input: {
  id: string
  measuredAt: string
  weightKg: number | null
  waistCm: number | null
  chestCm?: number | null
  photoFrontPath?: string | null
  photoSidePath?: string | null
  photoBackPath?: string | null
}): Promise<BodyMeasurement> {
  const result = await supabase
    .from('body_measurements')
    .upsert(
      {
        id: input.id,
        measured_at: input.measuredAt,
        weight_kg: input.weightKg,
        waist_cm: input.waistCm,
        chest_cm: input.chestCm ?? null,
        photo_front_path: input.photoFrontPath ?? null,
        photo_side_path: input.photoSidePath ?? null,
        photo_back_path: input.photoBackPath ?? null,
      },
      { onConflict: 'id' },
    )
    .select()
    .single()
  fail('Не удалось сохранить замер', result.error)
  return result.data!
}

const PHOTO_BUCKET = 'trainlog-progress-photos'

export async function uploadProgressPhoto(userId: string, measuredDate: string, view: 'front' | 'side' | 'back', file: File) {
  const allowed = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']])
  const extension = allowed.get(file.type)
  if (!extension) throw new Error('Фото должно быть JPEG, PNG или WebP')
  if (file.size > 5 * 1024 * 1024) throw new Error('Фото должно быть не больше 5 МБ')
  const path = `${userId}/${measuredDate}-${view}-${crypto.randomUUID()}.${extension}`
  const result = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { cacheControl: '3600', upsert: false })
  fail('Не удалось загрузить фото', result.error)
  return path
}

export async function getProgressPhotoUrl(path: string) {
  const result = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, 60 * 60)
  fail('Не удалось открыть фото', result.error)
  return result.data!.signedUrl
}

export async function loadNutritionEntries(from: Date, to: Date): Promise<NutritionEntry[]> {
  const result = await supabase
    .from('nutrition_entries')
    .select('*')
    .gte('eaten_at', from.toISOString())
    .lt('eaten_at', to.toISOString())
    .order('eaten_at', { ascending: false })
  fail('Не удалось загрузить дневник питания', result.error)
  return result.data ?? []
}

export async function saveNutritionEntry(input: {
  id: string
  eatenAt: string
  mealType: string
  description: string
  calories: number | null
  proteinG: number | null
  alcoholUnits?: number | null
}): Promise<NutritionEntry> {
  const timestamp = new Date().toISOString()
  const result = await supabase
    .from('nutrition_entries')
    .upsert({
      id: input.id,
      eaten_at: input.eatenAt,
      meal_type: input.mealType,
      description: input.description.trim(),
      calories: input.calories,
      protein_g: input.proteinG,
      alcohol_units: input.alcoholUnits ?? null,
      updated_at: timestamp,
    }, { onConflict: 'id' })
    .select()
    .single()
  fail('Не удалось сохранить приём пищи', result.error)
  return result.data!
}

export async function deleteNutritionEntry(id: string): Promise<void> {
  const result = await supabase.from('nutrition_entries').delete().eq('id', id)
  fail('Не удалось удалить запись', result.error)
}

export async function loadDailyActivity(fromDate: string, toDate: string): Promise<DailyActivity[]> {
  const result = await supabase
    .from('daily_activity')
    .select('*')
    .gte('activity_date', fromDate)
    .lte('activity_date', toDate)
    .order('activity_date')
  fail('Не удалось загрузить шаги', result.error)
  return result.data ?? []
}

export async function saveDailyActivity(input: {
  id: string
  activityDate: string
  steps: number
  note?: string
}): Promise<DailyActivity> {
  const result = await supabase
    .from('daily_activity')
    .upsert({
      id: input.id,
      activity_date: input.activityDate,
      steps: input.steps,
      note: input.note?.trim() ?? '',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
    .select()
    .single()
  fail('Не удалось сохранить шаги', result.error)
  return result.data!
}

export async function loadWeeklyWorkouts(from: Date, to: Date): Promise<WeeklyWorkoutSummary[]> {
  const history = (await loadHistory(500))
    .filter((workout) => new Date(workout.finishedAt) >= from && new Date(workout.finishedAt) < to)
    .reverse()
  return history.map((workout) => {
    const summary = historySummary(workout)
    const rirValues = workout.exercises.flatMap((exercise) => exercise.sets).filter((set) => set.done && !set.isWarmup && set.rir !== null).map((set) => set.rir!)
    return {
    id: workout.id,
    templateCode: workout.templateCode,
    title: workout.title,
    startedAt: workout.startedAt,
    finishedAt: workout.finishedAt,
    durationMinutes: summary.minutes,
    sets: summary.sets,
    volume: summary.volume,
    averageRir: rirValues.length ? rirValues.reduce((sum, value) => sum + value, 0) / rirValues.length : null,
    readinessMode: workout.readinessMode,
  }})
}

export async function loadWeeklyReport(weekStart: Date, weekEndExclusive: Date): Promise<WeeklyReportData> {
  const lastDate = new Date(weekEndExclusive)
  lastDate.setDate(lastDate.getDate() - 1)
  const dateKey = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  const [nutrition, activity, workouts, allMeasurements] = await Promise.all([
    loadNutritionEntries(weekStart, weekEndExclusive),
    loadDailyActivity(dateKey(weekStart), dateKey(lastDate)),
    loadWeeklyWorkouts(weekStart, weekEndExclusive),
    loadMeasurements(),
  ])
  const measurements = allMeasurements.filter((item) => new Date(item.measured_at) < weekEndExclusive).slice(0, 30)
  return { weekStart, weekEndExclusive, nutrition, activity, workouts, measurements }
}

export async function assertNoAnonymousUserData(): Promise<boolean> {
  const [sessions, measurements, nutrition, activity] = await Promise.all([
    supabase.from('workout_sessions').select('id').limit(1),
    supabase.from('body_measurements').select('id').limit(1),
    supabase.from('nutrition_entries').select('id').limit(1),
    supabase.from('daily_activity').select('id').limit(1),
  ])
  return [sessions, measurements, nutrition, activity].every((result) =>
    (result.data?.length ?? 0) === 0 && result.error !== null,
  )
}

export async function exportPersonalData(): Promise<PersonalBackup> {
  const [sessions, exercises, sets, measurements, nutrition, activity] = await Promise.all([
    supabase.from('workout_sessions').select('*').order('started_at'),
    supabase.from('workout_session_exercises').select('*').order('created_at'),
    supabase.from('workout_sets').select('*').order('created_at'),
    supabase.from('body_measurements').select('*').order('measured_at'),
    supabase.from('nutrition_entries').select('*').order('eaten_at'),
    supabase.from('daily_activity').select('*').order('activity_date'),
  ])
  const error = sessions.error ?? exercises.error ?? sets.error ?? measurements.error ?? nutrition.error ?? activity.error
  fail('Не удалось создать резервную копию', error)
  return {
    format: 'trainlog-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      workoutSessions: sessions.data ?? [],
      workoutExercises: exercises.data ?? [],
      workoutSets: sets.data ?? [],
      bodyMeasurements: measurements.data ?? [],
      nutritionEntries: nutrition.data ?? [],
      dailyActivity: activity.data ?? [],
    },
  }
}

export const isPersonalBackup = (value: unknown): value is PersonalBackup => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PersonalBackup>
  const data = candidate.data as Partial<PersonalBackup['data']> | undefined
  return candidate.format === 'trainlog-backup'
    && candidate.version === 1
    && !!data
    && [data.workoutSessions, data.workoutExercises, data.workoutSets, data.bodyMeasurements, data.nutritionEntries, data.dailyActivity]
      .every(Array.isArray)
}

export async function importPersonalData(backup: PersonalBackup): Promise<void> {
  const sessions = backup.data.workoutSessions.map(({ user_id: _userId, ...row }) => row)
  const exercises = backup.data.workoutExercises.map(({ user_id: _userId, ...row }) => row)
  const sets = backup.data.workoutSets.map(({ user_id: _userId, ...row }) => row)
  const measurements = backup.data.bodyMeasurements.map(({ user_id: _userId, ...row }) => row)
  const nutrition = backup.data.nutritionEntries.map(({ user_id: _userId, ...row }) => row)
  const activity = backup.data.dailyActivity.map(({ user_id: _userId, ...row }) => row)

  const batches: Array<{ label: string; table: keyof import('../types/trainingDatabase').Database['public']['Tables']; rows: object[] }> = [
    { label: 'тренировки', table: 'workout_sessions', rows: sessions },
    { label: 'упражнения', table: 'workout_session_exercises', rows: exercises },
    { label: 'подходы', table: 'workout_sets', rows: sets },
    { label: 'замеры', table: 'body_measurements', rows: measurements },
    { label: 'питание', table: 'nutrition_entries', rows: nutrition },
    { label: 'активность', table: 'daily_activity', rows: activity },
  ]
  for (const batch of batches) {
    if (!batch.rows.length) continue
    const result = await supabase.from(batch.table).upsert(batch.rows as never[], { onConflict: 'id' })
    fail(`Не удалось восстановить ${batch.label}`, result.error)
  }
}
