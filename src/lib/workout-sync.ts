import type { WorkoutDraft } from '../types/training'

export type WorkoutDraftSync = (draft: WorkoutDraft) => Promise<void>
type SharedWrites = { tails: Map<string, Promise<void>>; completed: Set<string> }
const writers = new WeakMap<WorkoutDraftSync, SharedWrites>()

/** Serialize each session across the active editor and background retries. */
export function createWorkoutSyncQueue(syncDraft: WorkoutDraftSync) {
  let shared = writers.get(syncDraft)
  if (!shared) { shared = { tails: new Map(), completed: new Set() }; writers.set(syncDraft, shared) }
  const state = shared
  let tail: Promise<void> = Promise.resolve()
  return {
    enqueue(draft: WorkoutDraft) {
      const key = `${draft.userId}:${draft.id}`
      if (draft.finishedAt) state.completed.add(key)
      const other = state.tails.get(key)
      const before = other && other !== tail ? tail.then(() => other, () => other) : tail
      const run = () => !draft.finishedAt && state.completed.has(key) ? Promise.resolve() : syncDraft(draft)
      const task = before.then(run, run)
      tail = task
      state.tails.set(key, task)
      void task.finally(() => { if (state.tails.get(key) === task) state.tails.delete(key) }).catch(() => undefined)
      return task
    },
    drain() { return tail.catch(() => undefined) },
  }
}
