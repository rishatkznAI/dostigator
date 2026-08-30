import type { WeeklyReportData } from '../types/training'

const DAY_MS = 24 * 60 * 60 * 1000

export const MEAL_TYPE_LABELS = {
  breakfast: 'Завтрак',
  lunch: 'Обед',
  dinner: 'Ужин',
  snack: 'Перекус',
  other: 'Другое',
} as const

export type MealType = keyof typeof MEAL_TYPE_LABELS

export function localDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function localDateTimeInput(date: Date) {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${localDateKey(date)}T${hours}:${minutes}`
}

export function getWeekRange(reference = new Date()) {
  const weekStart = new Date(reference)
  weekStart.setHours(0, 0, 0, 0)
  const mondayOffset = (weekStart.getDay() + 6) % 7
  weekStart.setDate(weekStart.getDate() - mondayOffset)
  const weekEndExclusive = new Date(weekStart)
  weekEndExclusive.setDate(weekEndExclusive.getDate() + 7)
  return { weekStart, weekEndExclusive }
}

export function shiftWeek(reference: Date, weeks: number) {
  return new Date(reference.getTime() + weeks * 7 * DAY_MS)
}

export function weekDays(weekStart: Date) {
  return Array.from({ length: 7 }, (_, index) => new Date(weekStart.getTime() + index * DAY_MS))
}

export function formatWeekRange(weekStart: Date, weekEndExclusive: Date) {
  const formatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
  return `${formatter.format(weekStart)} - ${formatter.format(new Date(weekEndExclusive.getTime() - DAY_MS))}`
}

export function summarizeWeek(report: WeeklyReportData) {
  const steps = report.activity.reduce((total, day) => total + day.steps, 0)
  const recordedDays = report.activity.filter((day) => day.steps > 0).length
  const averageSteps = recordedDays ? Math.round(steps / recordedDays) : 0
  const calories = report.nutrition.reduce((total, entry) => total + (entry.calories ?? 0), 0)
  const protein = report.nutrition.reduce((total, entry) => total + (entry.protein_g ?? 0), 0)
  const alcohol = report.nutrition.reduce((total, entry) => total + (entry.alcohol_units ?? 0), 0)
  const daysWithFood = new Set(report.nutrition.map((entry) => localDateKey(new Date(entry.eaten_at)))).size
  const completedCodes = new Set(report.workouts.map((workout) => workout.templateCode))
  const averageCalories = daysWithFood ? Math.round(calories / daysWithFood) : 0
  const averageProtein = daysWithFood ? Math.round(protein / daysWithFood) : 0
  const totalSets = report.workouts.reduce((total, workout) => total + workout.sets, 0)
  const totalVolume = report.workouts.reduce((total, workout) => total + workout.volume, 0)
  const rirValues = report.workouts.map((workout) => workout.averageRir).filter((value): value is number => value !== null)
  const averageRir = rirValues.length ? rirValues.reduce((total, value) => total + value, 0) / rirValues.length : null
  const orderedMeasurements = [...report.measurements].sort((a, b) => a.measured_at.localeCompare(b.measured_at))
  const latestMeasurement = orderedMeasurements.at(-1)
  const baselineMeasurement = orderedMeasurements.find((item) => new Date(item.measured_at) <= report.weekStart) ?? orderedMeasurements[0]
  const weightDelta = latestMeasurement?.weight_kg !== null && latestMeasurement?.weight_kg !== undefined && baselineMeasurement?.weight_kg !== null && baselineMeasurement?.weight_kg !== undefined
    ? latestMeasurement.weight_kg - baselineMeasurement.weight_kg : null
  const waistDelta = latestMeasurement?.waist_cm !== null && latestMeasurement?.waist_cm !== undefined && baselineMeasurement?.waist_cm !== null && baselineMeasurement?.waist_cm !== undefined
    ? latestMeasurement.waist_cm - baselineMeasurement.waist_cm : null
  const workoutScore = (completedCodes.has('A') ? 20 : 0) + (completedCodes.has('B') ? 20 : 0)
  const stepsScore = Math.round(25 * Math.min(1, averageSteps / 9000))
  const loggingScore = Math.round(15 * Math.min(1, daysWithFood / 7))
  const proteinScore = protein > 0 ? Math.round(20 * Math.min(1, averageProtein / 150)) : 0
  return {
    steps,
    recordedDays,
    averageSteps,
    meals: report.nutrition.length,
    workouts: report.workouts.length,
    calories,
    protein,
    alcohol,
    daysWithFood,
    averageCalories,
    averageProtein,
    totalSets,
    totalVolume,
    averageRir,
    completedA: completedCodes.has('A'),
    completedB: completedCodes.has('B'),
    completedC: completedCodes.has('C'),
    weightDelta,
    waistDelta,
    latestMeasurement,
    score: Math.min(100, workoutScore + stepsScore + loggingScore + proteinScore),
  }
}
