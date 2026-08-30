import { describe, expect, it } from 'vitest'
import { confirmedUndoQueueBlockReason } from './historyUndo'
import type { HistoryEvent, PendingOperation } from '../types'

const event = (overrides: Partial<HistoryEvent> = {}): HistoryEvent => ({
  id: 'event-1', user_id: 'user-a', mutation_id: 'server-mutation', entity_type: 'goal', entity_id: 'goal-1',
  operation: 'goal_edit', label: 'Изменена цель', before_data: { id: 'goal-1', title: 'До' },
  after_data: { id: 'goal-1', title: 'После' }, base_revision: 1, result_revision: 2,
  source: 'ui', reverts_event_id: null, created_at: '2026-08-28T10:00:00.000Z', ...overrides,
})

const queued = (overrides: Partial<PendingOperation> = {}): PendingOperation => ({
  id: 'queue-1', ownerId: 'user-a', type: 'mutation', table: 'dostigator_goals',
  payload: { id: 'goal-1', title: 'Локально' },
  mutation: {
    mutationId: 'local-mutation', entityType: 'goal', entityId: 'goal-1', operation: 'goal_edit',
    label: 'Локально изменена цель', baseRevision: 2, before: { id: 'goal-1', title: 'После' }, source: 'offline',
  },
  mutationId: 'local-mutation', label: 'Локально изменена цель', createdAt: '2026-08-28T11:00:00.000Z',
  state: 'pending', attempts: 0, lastError: null, ...overrides,
})

describe('confirmed history Undo queue guard', () => {
  it('blocks a newer pending or failed mutation of the same entity', () => {
    expect(confirmedUndoQueueBlockReason(event(), [queued()])).toContain('локальные изменения')
    expect(confirmedUndoQueueBlockReason(event(), [queued({ state: 'failed' })])).toContain('локальные изменения')
  })

  it('blocks Undo of a server goal create before a queued child create', () => {
    const child = queued({
      table: 'dostigator_actions', payload: { id: 'action-1', goal_id: 'goal-1', title: 'Шаг' },
      mutation: {
        mutationId: 'child-create', entityType: 'action', entityId: 'action-1', operation: 'action_create',
        label: 'Создано действие', baseRevision: 0, before: null, source: 'offline',
      }, mutationId: 'child-create', label: 'Создано действие',
    })
    expect(confirmedUndoQueueBlockReason(event({ operation: 'goal_create', before_data: null, base_revision: 0, result_revision: 1 }), [child]))
      .toContain('локальные изменения')
  })

  it('does not block unrelated FIFO work', () => {
    const unrelated = queued({
      payload: { id: 'goal-2', title: 'Другая' },
      mutation: { ...queued().mutation!, entityId: 'goal-2' },
    })
    expect(confirmedUndoQueueBlockReason(event(), [unrelated])).toBeNull()
  })
})
