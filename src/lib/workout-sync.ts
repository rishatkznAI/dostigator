import type { WorkoutDraft } from '../types/training'

export type WorkoutDraftSync = (draft: WorkoutDraft) => Promise<void>

/** Serializes draft writes so an older snapshot can never finish after a newer one. */
export function createWorkoutSyncQueue(syncDraft: WorkoutDraftSync) {
  let tail: Promise<void> = Promise.resolve()

  return {
    enqueue(draft: WorkoutDraft) {
      const run = () => syncDraft(draft)
      const task = tail.then(run, run)
      tail = task
      return task
    },
    drain() {
      return tail.catch(() => undefined)
    },
  }
}
