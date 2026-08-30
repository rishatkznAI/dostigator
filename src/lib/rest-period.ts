export type RestDurationSeconds = 90 | 120 | 180

const LONG_REST_EXERCISES = new Set([
  'leg_press',
  'rdl',
  'smith_squat',
])

const STANDARD_REST_EXERCISES = new Set([
  'chest_press',
  'db_bench',
  'incline_db_press',
  'lat_pulldown',
  'lat_pulldown_close',
  'one_arm_row',
  'seated_row',
  'shoulder_press',
])

export function getRestDurationSeconds(exerciseKey: string): RestDurationSeconds {
  if (LONG_REST_EXERCISES.has(exerciseKey)) return 180
  if (STANDARD_REST_EXERCISES.has(exerciseKey)) return 120
  return 90
}

export function formatRestDuration(seconds: RestDurationSeconds) {
  if (seconds % 60 === 0) return `${seconds / 60} мин`
  return `${Math.floor(seconds / 60)} мин ${seconds % 60} сек`
}
