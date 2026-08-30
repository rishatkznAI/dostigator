import { describe, expect, it } from 'vitest'
import { enqueueDraft, getActiveDraft, getSyncQueue, removeQueuedDraft, saveActiveDraft } from '../src/lib/storage'
import type { WorkoutDraft } from '../src/types/training'

const draft: WorkoutDraft = {
  schemaVersion: 3,
  id: '550e8400-e29b-41d4-a716-446655440000',
  userId: 'user-a',
  templateCode: 'A',
  title: 'Тренировка A',
  startedAt: '2026-08-25T10:00:00Z',
  finishedAt: null,
  timerPausedAt: null,
  timerPausedDurationMs: 0,
  readiness: null,
  activeRest: null,
  deletedSetIds: [],
  updatedAt: '2026-08-25T10:05:00Z',
  syncState: 'pending',
  exercises: [],
}

describe('offline drafts', () => {
  it('survives a reload through localStorage', () => {
    saveActiveDraft(draft)
    expect(getActiveDraft('user-a')).toEqual(draft)
  })

  it('upgrades a version 1 draft with timer defaults', () => {
    const legacy = { ...draft, schemaVersion: 1, timerPausedAt: undefined, timerPausedDurationMs: undefined }
    localStorage.setItem(`trainlog:active:${draft.userId}`, JSON.stringify(legacy))
    expect(getActiveDraft(draft.userId)).toMatchObject({
      schemaVersion: 3,
      timerPausedAt: null,
      timerPausedDurationMs: 0,
    })
  })

  it('uses client id as an idempotency key in the queue', () => {
    enqueueDraft(draft)
    enqueueDraft({ ...draft, finishedAt: '2026-08-25T11:00:00Z' })
    expect(getSyncQueue('user-a')).toHaveLength(1)
    expect(getSyncQueue('user-a')[0]?.finishedAt).toBe('2026-08-25T11:00:00Z')
    removeQueuedDraft('user-a', draft.id)
    expect(getSyncQueue('user-a')).toEqual([])
  })
})
