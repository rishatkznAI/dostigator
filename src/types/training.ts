import type { TableRow } from './trainingDatabase'

export type Exercise = Pick<
  TableRow<'exercise_library'>,
  'key' | 'name' | 'muscles' | 'steps' | 'mistakes' | 'youtube_url'
>

export type WorkoutTemplateItem = {
  exercise: Exercise
  sortOrder: number
  setCount: number
  repTarget: string
}

export type WorkoutTemplate = {
  code: string
  title: string
  sortOrder: number
  items: WorkoutTemplateItem[]
}

export type WorkoutSetDraft = {
  id: string
  setNumber: number
  weightKg: number | null
  reps: number | null
  rir: number | null
  done: boolean
  isWarmup: boolean
  completedAt: string | null
}

export type WorkoutExerciseDraft = {
  id: string
  exercise: Exercise
  target: string
  sortOrder: number
  skipped: boolean
  skipReason: string
  sets: WorkoutSetDraft[]
}

export type WorkoutReadiness = {
  sleep: number
  energy: number
  stress: number
  discomfort: boolean
  note: string
  mode: 'normal' | 'reduced'
}

export type ActiveRestState = {
  until: number
  exerciseName: string
  plannedSeconds: 90 | 120 | 180
}

export type WorkoutDraft = {
  schemaVersion: 3
  id: string
  userId: string
  templateCode: string
  title: string
  startedAt: string
  finishedAt: string | null
  timerPausedAt: string | null
  timerPausedDurationMs: number
  readiness: WorkoutReadiness | null
  activeRest: ActiveRestState | null
  deletedSetIds: string[]
  updatedAt: string
  syncState: 'pending' | 'synced'
  exercises: WorkoutExerciseDraft[]
}

export type PreviousResult = {
  sessionId: string
  finishedAt: string
  exerciseKey: string
  sets: WorkoutSetDraft[]
}

export type HistoryWorkout = {
  id: string
  templateCode: string | null
  title: string
  startedAt: string
  finishedAt: string
  timerPausedDurationMs: number
  readinessMode: 'normal' | 'reduced' | null
  exercises: Array<{
    id: string
    exerciseKey: string | null
    exerciseName: string
    target: string
    sortOrder: number
    skipped: boolean
    skipReason: string
    sets: WorkoutSetDraft[]
  }>
}

export type BodyMeasurement = TableRow<'body_measurements'>
export type NutritionEntry = TableRow<'nutrition_entries'>
export type DailyActivity = TableRow<'daily_activity'>

export type WeeklyWorkoutSummary = {
  id: string
  templateCode: string | null
  title: string
  startedAt: string
  finishedAt: string
  durationMinutes: number
  sets: number
  volume: number
  averageRir: number | null
  readinessMode: 'normal' | 'reduced' | null
}

export type WeeklyReportData = {
  weekStart: Date
  weekEndExclusive: Date
  nutrition: NutritionEntry[]
  activity: DailyActivity[]
  workouts: WeeklyWorkoutSummary[]
  measurements: BodyMeasurement[]
}

export type WeeklyStats = {
  workouts: number
  sets: number
  volume: number
}

export type OverloadRecommendation = {
  mode: 'baseline' | 'increase' | 'reps' | 'recover'
  eyebrow: string
  message: string
}

export type PersonalBackup = {
  format: 'trainlog-backup'
  version: 1
  exportedAt: string
  data: {
    workoutSessions: TableRow<'workout_sessions'>[]
    workoutExercises: TableRow<'workout_session_exercises'>[]
    workoutSets: TableRow<'workout_sets'>[]
    bodyMeasurements: BodyMeasurement[]
    nutritionEntries: NutritionEntry[]
    dailyActivity: DailyActivity[]
  }
}
