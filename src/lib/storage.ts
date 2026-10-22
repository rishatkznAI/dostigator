import type { WorkoutDraft, WorkoutExerciseDraft, WorkoutSetDraft, WorkoutTemplate } from '../types/training'

const ACTIVE_PREFIX = 'trainlog:active:'
const QUEUE_PREFIX = 'trainlog:queue:'
const CANCEL_QUEUE_PREFIX = 'trainlog:cancel-queue:'
const TEMPLATE_CACHE = 'trainlog:templates:v1'

type StoredWorkoutSetDraft = Omit<WorkoutSetDraft, 'isWarmup'> & { isWarmup?: boolean }
type StoredWorkoutExerciseDraft = Omit<WorkoutExerciseDraft, 'sets' | 'skipped' | 'skipReason'> & {
  sets: StoredWorkoutSetDraft[]
  skipped?: boolean
  skipReason?: string
}
type StoredWorkoutDraft = Omit<WorkoutDraft, 'schemaVersion' | 'timerPausedAt' | 'timerPausedDurationMs' | 'readiness' | 'activeRest' | 'deletedSetIds' | 'exercises'> & {
  schemaVersion: 1 | 2 | 3
  timerPausedAt?: string | null
  timerPausedDurationMs?: number
  readiness?: WorkoutDraft['readiness']
  activeRest?: WorkoutDraft['activeRest']
  deletedSetIds?: string[]
  exercises: StoredWorkoutExerciseDraft[]
}

const parse = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

const normalizeDraft = (draft: StoredWorkoutDraft): WorkoutDraft => ({
  ...draft,
  schemaVersion: 3,
  timerPausedAt: draft.timerPausedAt ?? null,
  timerPausedDurationMs: Math.max(0, draft.timerPausedDurationMs ?? 0),
  readiness: draft.readiness ?? null,
  activeRest: draft.activeRest ?? null,
  deletedSetIds: draft.deletedSetIds ?? [],
  exercises: draft.exercises.map((exercise) => ({
    ...exercise,
    skipped: exercise.skipped ?? false,
    skipReason: exercise.skipReason ?? '',
    sets: exercise.sets.map((set) => ({ ...set, isWarmup: set.isWarmup ?? false })),
  })),
})

export const getActiveDraft = (userId: string) => {
  const draft = parse<StoredWorkoutDraft | null>(localStorage.getItem(`${ACTIVE_PREFIX}${userId}`), null)
  return draft ? normalizeDraft(draft) : null
}

export function saveActiveDraft(draft: WorkoutDraft) {
  const existing = getActiveDraft(draft.userId)
  if (existing?.id === draft.id && Date.parse(existing.updatedAt) > Date.parse(draft.updatedAt)) return
  localStorage.setItem(`${ACTIVE_PREFIX}${draft.userId}`, JSON.stringify(draft))
}

export const clearActiveDraft = (userId: string) => localStorage.removeItem(`${ACTIVE_PREFIX}${userId}`)

export const getSyncQueue = (userId: string) =>
  parse<StoredWorkoutDraft[]>(localStorage.getItem(`${QUEUE_PREFIX}${userId}`), []).map(normalizeDraft)

export function enqueueDraft(draft: WorkoutDraft) {
  const queue = getSyncQueue(draft.userId).filter((item) => item.id !== draft.id)
  localStorage.setItem(`${QUEUE_PREFIX}${draft.userId}`, JSON.stringify([...queue, draft]))
}

export function removeQueuedDraft(userId: string, draftId: string, expectedUpdatedAt?: string) {
  const queue = getSyncQueue(userId).filter((item) => item.id !== draftId || (expectedUpdatedAt!==undefined && item.updatedAt!==expectedUpdatedAt))
  localStorage.setItem(`${QUEUE_PREFIX}${userId}`, JSON.stringify(queue))
}

export const getCancelQueue = (userId: string) =>
  parse<string[]>(localStorage.getItem(`${CANCEL_QUEUE_PREFIX}${userId}`), [])

export function enqueueCancelledWorkout(userId: string, draftId: string) {
  const queue = new Set(getCancelQueue(userId))
  queue.add(draftId)
  localStorage.setItem(`${CANCEL_QUEUE_PREFIX}${userId}`, JSON.stringify([...queue]))
}

export function removeCancelledWorkout(userId: string, draftId: string) {
  const queue = getCancelQueue(userId).filter((id) => id !== draftId)
  localStorage.setItem(`${CANCEL_QUEUE_PREFIX}${userId}`, JSON.stringify(queue))
}

export const cacheTemplates = (templates: WorkoutTemplate[]) =>
  localStorage.setItem(TEMPLATE_CACHE, JSON.stringify(templates))

export const getCachedTemplates = () => parse<WorkoutTemplate[]>(localStorage.getItem(TEMPLATE_CACHE), [])
