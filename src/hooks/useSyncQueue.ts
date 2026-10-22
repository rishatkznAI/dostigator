import { useCallback, useEffect, useRef, useState } from 'react'
import { createWorkoutSyncQueue } from '../lib/workout-sync'
import { deleteWorkoutSession, syncWorkoutDraft } from '../lib/trainingRepository'
import { getCancelQueue, getSyncQueue, removeCancelledWorkout, removeQueuedDraft } from '../lib/storage'

export const TRAINING_SYNC_COMPLETED_EVENT = 'dostigator:training-sync-completed'

export function useSyncQueue(userId?: string) {
  const [workoutWrites]=useState(()=>createWorkoutSyncQueue(syncWorkoutDraft))
  const running = useRef(false)
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)

  const sync = useCallback(async () => {
    if (!userId || !navigator.onLine || running.current) return
    running.current = true
    let changed = false
    try {
      const cancellations = getCancelQueue(userId)
      const queue = getSyncQueue(userId).filter((draft) => !cancellations.includes(draft.id))
      setPending(queue.length + cancellations.length)
      if (!queue.length && !cancellations.length) return
      setSyncing(true)
      for (const id of cancellations) {
        try {
          await workoutWrites.cancel(userId, id, () => deleteWorkoutSession(id))
          removeQueuedDraft(userId, id)
          removeCancelledWorkout(userId, id)
          changed = true
        } catch { return }
      }
      for (const draft of queue) {
        try {
          await workoutWrites.enqueue(draft)
          removeQueuedDraft(userId, draft.id, draft.updatedAt)
          changed = true
        } catch { break }
      }
    } finally {
      running.current = false
      setPending(getSyncQueue(userId).length + getCancelQueue(userId).length)
      setSyncing(false)
      if (changed) window.dispatchEvent(new CustomEvent(TRAINING_SYNC_COMPLETED_EVENT, { detail: { userId } }))
    }
  }, [userId,workoutWrites])

  useEffect(() => {
    if (!userId) return
    setPending(getSyncQueue(userId).length + getCancelQueue(userId).length)
    void sync()
    const visible = () => { if (document.visibilityState === 'visible') void sync() }
    window.addEventListener('online', sync)
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', visible)
    return () => { window.removeEventListener('online', sync); window.removeEventListener('focus', sync); document.removeEventListener('visibilitychange', visible) }
  }, [sync, userId])

  return { pending, syncing, sync }
}
