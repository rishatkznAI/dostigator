import { fixtureHistory, owner } from './fixtures'
export { loadTemplates, loadExerciseLibrary } from '../../src/lib/training-program'
import type { HistoryWorkout, WorkoutDraft } from '../../src/types/training'
import { draftToHistory } from '../../src/lib/training-insights'
import { selectPreviousResults } from '../../src/lib/workout-targets'
const key = 'local-test:history'
export function readHistory(): HistoryWorkout[] { return JSON.parse(localStorage.getItem(key) ?? JSON.stringify(fixtureHistory)) }
export async function loadHistory() { if (!navigator.onLine) throw new Error('Тест: офлайн'); return readHistory() }
export const loadPreviousResults = async (keys: string[], before: string) => selectPreviousResults(await loadHistory(), keys, before)
export const syncWorkoutDraft = async (draft: WorkoutDraft) => {
  if (!navigator.onLine) throw new Error('Тест: офлайн')
  if (draft.finishedAt) localStorage.setItem(key, JSON.stringify([draftToHistory(draft), ...readHistory().filter((item) => item.id !== draft.id)]))
}
export const deleteWorkoutSession = async (id: string) => { if (!navigator.onLine) throw new Error('Тест: офлайн'); localStorage.setItem(key, JSON.stringify(readHistory().filter((item) => item.id !== id))) }
void owner

export * from './gateway'
