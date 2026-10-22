import { PROGRAM_V21, programV21Templates, programV21Exercises } from './program-v21'
import type { Exercise, WorkoutTemplate } from '../types/training'

// The shipped program is product data, available on a fresh install and offline.
// Environment flags, preview adapters and legacy server templates do not select it.
export const ACTIVE_PROGRAM_REVISION = PROGRAM_V21

export async function loadTemplates(): Promise<WorkoutTemplate[]> {
  return structuredClone(programV21Templates)
}

export async function loadExerciseLibrary(): Promise<Exercise[]> {
  return structuredClone(programV21Exercises)
}
