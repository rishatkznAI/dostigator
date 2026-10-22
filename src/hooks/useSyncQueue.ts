import { useCallback, useEffect, useState } from 'react'
import { createWorkoutSyncQueue } from '../lib/workout-sync'
import { deleteWorkoutSession, syncWorkoutDraft } from '../lib/trainingRepository'
import { getCancelQueue, getSyncQueue, removeCancelledWorkout, removeQueuedDraft } from '../lib/storage'

export const TRAINING_SYNC_COMPLETED_EVENT = 'dostigator:training-sync-completed'

export function useSyncQueue(userId?: string) {
  const [workoutWrites]=useState(()=>createWorkoutSyncQueue(syncWorkoutDraft))
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)

  const sync = useCallback(async () => {
    if (!userId || !navigator.onLine) return
    const cancellations = getCancelQueue(userId)
    const queue = getSyncQueue(userId).filter((draft) => !cancellations.includes(draft.id))
    setPending(queue.length + cancellations.length)
    if (!queue.length && !cancellations.length) return
    setSyncing(true)
    let changed = false
    for (const id of cancellations) {
      try {
        await deleteWorkoutSession(id)
        removeCancelledWorkout(userId, id)
        changed = true
      } catch {
        setSyncing(false)
        return
      }
    }
    for (const draft of queue) {
      try {
        await workoutWrites.enqueue(draft)
        removeQueuedDraft(userId, draft.id, draft.updatedAt)
        changed = true
      } catch {
        break
      }
    }
    setPending(getSyncQueue(userId).length + getCancelQueue(userId).length)
    setSyncing(false)
    if (changed) window.dispatchEvent(new CustomEvent(TRAINING_SYNC_COMPLETED_EVENT, { detail: { userId } }))
  }, [userId,workoutWrites])

  useEffect(() => {
    if (!userId) return
    setPending(getSyncQueue(userId).length + getCancelQueue(userId).length)
    void sync()
    window.addEventListener('online', sync)
    return () => window.removeEventListener('online', sync)
  }, [sync, userId])

  return { pending, syncing, sync }
}
