import type { HistoryEvent, PendingOperation } from '../types'

export const HISTORY_UNDO_QUEUE_BLOCK = 'Сначала синхронизируйте или разрешите более новые локальные изменения'

/**
 * Server history cannot see local FIFO work. Undoing an older authoritative
 * event ahead of that work would turn a valid queued mutation into a CAS/FK
 * conflict, so keep the server event immutable until its local dependants are
 * settled.
 */
export function confirmedUndoQueueBlockReason(event: HistoryEvent, queue: PendingOperation[]): string | null {
  const conflicts = queue.some((item) => {
    const descriptor = item.mutation
    if (!descriptor) return true
    if (item.mutationId === event.mutation_id) return true
    if (descriptor.entityType === event.entity_type && descriptor.entityId === event.entity_id) return true

    if (event.before_data === null && event.entity_type === 'goal' && descriptor.entityType === 'action') {
      return item.payload?.goal_id === event.entity_id || descriptor.before?.goal_id === event.entity_id
    }
    if (event.before_data === null && event.entity_type === 'habit' && descriptor.entityType === 'habit_checkin') {
      return item.payload?.habit_id === event.entity_id || descriptor.before?.habit_id === event.entity_id
    }
    return false
  })
  return conflicts ? HISTORY_UNDO_QUEUE_BLOCK : null
}
