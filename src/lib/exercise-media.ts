export type ExerciseMedia = {
  src: string
  alt: string
  phaseLabels: readonly [string, string]
}

export const EXERCISE_IMAGE_FILES = {
  biceps_curl: 'biceps_curl.jpg',
  calf_raise: 'calf_raise.jpg',
  cable_crunch: 'cable_crunch.jpg',
  chest_press: 'chest_press.jpg',
  db_bench: 'db_bench.jpg',
  incline_db_press: 'incline_db_press.jpg',
  knee_raise: 'knee_raise.jpg',
  lat_pulldown: 'lat_pulldown.jpg',
  lat_pulldown_close: 'lat_pulldown_close.jpg',
  lateral_raise: 'lateral_raise.jpg',
  leg_curl: 'leg_curl.jpg',
  leg_extension: 'leg_extension.jpg',
  leg_press: 'leg_press.jpg',
  one_arm_row: 'one_arm_row.jpg',
  plank: 'plank.jpg',
  rdl: 'rdl.jpg',
  seated_row: 'seated_row.jpg',
  shoulder_press: 'shoulder_press.jpg',
  smith_squat: 'smith_squat.jpg',
  triceps_pushdown: 'triceps_pushdown.jpg',
} as const

const exercisePhaseLabels: Partial<Record<keyof typeof EXERCISE_IMAGE_FILES, readonly [string, string]>> = {
  plank: ['Настройка', 'Линия корпуса'],
}

export function getExerciseMedia(key: string, name: string): ExerciseMedia | null {
  const file = EXERCISE_IMAGE_FILES[key as keyof typeof EXERCISE_IMAGE_FILES]
  const src = EXERCISE_IMAGE_DATA[key]
  if (!file || !src) return null

  return {
    src,
    alt: key === 'plank'
      ? `Техника упражнения «${name}»: настройка и правильная линия корпуса`
      : `Техника упражнения «${name}»: исходное и конечное положение`,
    phaseLabels: exercisePhaseLabels[key as keyof typeof EXERCISE_IMAGE_FILES] ?? ['Старт', 'Рабочая точка'],
  }
}
import { EXERCISE_IMAGE_DATA } from './exercise-image-data'
