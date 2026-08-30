export type ExerciseWeightGuide = {
  light: string
  working: string
  tryNext: string
  note: string
}

const MACHINE_NOTE = 'По шкале тренажёра: на другой модели цифры могут отличаться.'
const DUMBBELL_NOTE = 'Указан вес одной гантели.'
const SMITH_NOTE = 'Указан добавленный вес без учёта грифа Смита.'

export const EXERCISE_WEIGHT_GUIDES = {
  biceps_curl: { light: '6 кг', working: '8 кг', tryNext: '10 кг', note: DUMBBELL_NOTE },
  cable_crunch: { light: '15 кг', working: '25 кг', tryNext: '35 кг', note: MACHINE_NOTE },
  calf_raise: { light: '+20 кг', working: '+40 кг', tryNext: '+60 кг', note: SMITH_NOTE },
  chest_press: { light: '20 кг', working: '35 кг', tryNext: '45 кг', note: MACHINE_NOTE },
  db_bench: { light: '12 кг', working: '16 кг', tryNext: '20 кг', note: DUMBBELL_NOTE },
  incline_db_press: { light: '10 кг', working: '14 кг', tryNext: '18 кг', note: DUMBBELL_NOTE },
  knee_raise: { light: '8 повторов', working: 'вес тела', tryNext: 'пауза 1 сек', note: 'Начни с согнутых коленей и не раскачивай корпус.' },
  lat_pulldown: { light: '25 кг', working: '40 кг', tryNext: '50 кг', note: MACHINE_NOTE },
  lat_pulldown_close: { light: '25 кг', working: '40 кг', tryNext: '50 кг', note: MACHINE_NOTE },
  lateral_raise: { light: '4 кг', working: '6 кг', tryNext: '8 кг', note: DUMBBELL_NOTE },
  leg_curl: { light: '15 кг', working: '25 кг', tryNext: '35 кг', note: MACHINE_NOTE },
  leg_extension: { light: '20 кг', working: '30 кг', tryNext: '40 кг', note: MACHINE_NOTE },
  leg_press: { light: '60 кг', working: '100 кг', tryNext: '140 кг', note: 'Вес дисков или значение на тренажёре; конструкция сильно влияет на нагрузку.' },
  one_arm_row: { light: '10 кг', working: '16 кг', tryNext: '20 кг', note: DUMBBELL_NOTE },
  plank: { light: '20 сек', working: '40 сек', tryNext: '60 сек', note: 'Без дополнительного веса; заканчивай при потере ровной линии корпуса.' },
  rdl: { light: '12 кг', working: '18 кг', tryNext: '24 кг', note: DUMBBELL_NOTE },
  seated_row: { light: '25 кг', working: '40 кг', tryNext: '50 кг', note: MACHINE_NOTE },
  shoulder_press: { light: '6 кг', working: '10 кг', tryNext: '14 кг', note: DUMBBELL_NOTE },
  smith_squat: { light: '+10 кг', working: '+30 кг', tryNext: '+50 кг', note: SMITH_NOTE },
  triceps_pushdown: { light: '10 кг', working: '20 кг', tryNext: '25 кг', note: MACHINE_NOTE },
} as const satisfies Record<string, ExerciseWeightGuide>

export function getExerciseWeightGuide(exerciseKey: string): ExerciseWeightGuide | null {
  return EXERCISE_WEIGHT_GUIDES[exerciseKey as keyof typeof EXERCISE_WEIGHT_GUIDES] ?? null
}
