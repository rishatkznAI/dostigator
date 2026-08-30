import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MutationDescriptor } from '../types'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: {
    auth: { getSession: mocks.getSession },
    rpc: mocks.rpc,
  },
}))

import {
  clearQuarantine, discardRejectedMutation, flushQueue, persistOrQueue, persistUndoOrQueue,
  quarantineFailedQueue, queueStats, readQuarantine, readQueue, retryFailed,
} from './offline'

const fixtureTime = '2026-08-24T08:00:00.000Z'
const fixtureUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fixtureUuids = new Map<string, string>()

function fixtureUuid(value: string) {
  if (fixtureUuidPattern.test(value)) return value
  const existing = fixtureUuids.get(value)
  if (existing) return existing
  const suffix = (fixtureUuids.size + 1).toString(16).padStart(12, '0')
  const generated = `10000000-0000-4000-8000-${suffix}`
  fixtureUuids.set(value, generated)
  return generated
}

function goalSnapshot(id: string, title = 'До'): Record<string, unknown> {
  return {
    id: fixtureUuid(id), area_id: null, title, description: '', why: '', kind: 'goal', status: 'active',
    progress: 0, target_date: null, completed_at: null,
  }
}

function goalPayload(id: string, title: string, mutationId: string, revision: number) {
  return {
    ...goalSnapshot(id, title), created_at: fixtureTime, updated_at: fixtureTime,
    revision, last_mutation_id: mutationId,
  }
}

function descriptor(id: string, entityId: string, baseRevision: number, label = 'Изменена цель'): MutationDescriptor {
  return {
    mutationId: id,
    entityType: 'goal',
    entityId: fixtureUuid(entityId),
    operation: baseRevision === 0 ? 'goal_create' : 'goal_edit',
    label,
    baseRevision,
    before: baseRevision === 0 ? null : goalSnapshot(entityId),
    source: 'ui',
  }
}

function persistGoal(ownerId: string, entityId: string, title: string, mutationId: string, baseRevision = 0) {
  return persistOrQueue(
    ownerId,
    'dostigator_goals',
    goalPayload(entityId, title, mutationId, baseRevision + 1),
    descriptor(mutationId, entityId, baseRevision),
  )
}

function actionSnapshot(id: string, overrides: Record<string, unknown> = {}) {
  const snapshot = {
    id: fixtureUuid(id), goal_id: fixtureUuid('goal-1'), title: 'Шаг', status: 'todo', due_date: null,
    focus_date: null, focus_position: null, result_note: '', completed_at: null,
    ...overrides,
  }
  return { ...snapshot, goal_id: typeof snapshot.goal_id === 'string' ? fixtureUuid(snapshot.goal_id) : snapshot.goal_id }
}

function actionPayload(id: string, mutationId: string, revision: number, overrides: Record<string, unknown> = {}) {
  return {
    ...actionSnapshot(id), created_at: fixtureTime, updated_at: fixtureTime,
    revision, last_mutation_id: mutationId, ...overrides,
  }
}

function habitSnapshot(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id: fixtureUuid(id), area_id: null, title: 'Привычка', target_per_week: 3, active: true,
    activity_periods: [{ started_on: '2026-08-24', ended_on: null }],
    ...overrides,
  }
}

function habitPayload(id: string, mutationId: string, revision = 1, overrides: Record<string, unknown> = {}) {
  return {
    ...habitSnapshot(id), created_at: fixtureTime, updated_at: fixtureTime,
    revision, last_mutation_id: mutationId, ...overrides,
  }
}

function checkinPayload(id: string, mutationId: string) {
  return {
    id: fixtureUuid(id), habit_id: fixtureUuid('habit-1'), checked_on: '2026-08-24', note: '', created_at: fixtureTime,
    revision: 1, last_mutation_id: mutationId,
  }
}

function reviewPayload(id: string, mutationId: string) {
  return {
    id: fixtureUuid(id), week_start: '2026-08-24', wins: '', blockers: '', next_focus: '', self_score: null,
    metrics_snapshot: {
      score: null, focus: null, habits: null, actions: null,
      period: { weekStart: '2026-08-24', asOf: '2026-08-30' },
    },
    created_at: fixtureTime, updated_at: fixtureTime, revision: 1, last_mutation_id: mutationId,
  }
}

function eventFrom(args: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    user_id: 'user-a',
    mutation_id: args.p_mutation_id,
    entity_type: args.p_entity_type ?? 'goal',
    entity_id: args.p_entity_id ?? fixtureUuid('goal-1'),
    operation: args.p_operation ?? 'undo',
    label: args.p_label ?? 'Undo',
    before_data: null,
    after_data: null,
    base_revision: args.p_expected_revision ?? 0,
    result_revision: Number(args.p_expected_revision ?? 0) + 1,
    source: args.p_source ?? 'offline',
    reverts_event_id: null,
    created_at: new Date().toISOString(),
  }
}

function storedMutation(id: string, entityId: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    ownerId: 'user-a',
    type: 'mutation',
    table: 'dostigator_goals',
    payload: goalPayload(entityId, 'Queued', id, 1),
    mutation: descriptor(id, entityId, 0),
    mutationId: id,
    label: 'Изменена цель',
    createdAt: '2026-08-24T08:00:00.000Z',
    state: 'pending',
    attempts: 0,
    lastError: null,
    ...overrides,
  }
}

function installDelayedWebLock(delayedCall = 1) {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks')
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let calls = 0
  const request = vi.fn(async (...args: unknown[]) => {
    calls += 1
    if (calls === delayedCall) await gate
    const callback = args.at(-1) as (lock: null) => unknown
    return callback(null)
  })
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })
  return {
    release,
    request,
    restore() {
      if (descriptor) Object.defineProperty(navigator, 'locks', descriptor)
      else Reflect.deleteProperty(navigator, 'locks')
    },
  }
}

beforeEach(() => {
  localStorage.clear()
  mocks.rpc.mockReset().mockImplementation(async (_name: string, args: Record<string, unknown>) => ({
    data: { event: eventFrom(args) },
    error: null,
  }))
  mocks.getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: 'user-a' } } }, error: null })
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
})
afterEach(() => vi.restoreAllMocks())

describe('versioned mutation queue', () => {
  it('keeps A→B→C as three ordered operations without coalescing', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await persistGoal('user-a', 'goal-1', 'A', '00000000-0000-4000-8000-000000000001')
    await persistGoal('user-a', 'goal-1', 'B', '00000000-0000-4000-8000-000000000002', 1)
    await persistGoal('user-a', 'goal-1', 'C', '00000000-0000-4000-8000-000000000003', 2)

    expect(readQueue('user-a').map((item) => item.payload?.title)).toEqual(['A', 'B', 'C'])
    expect(readQueue('user-a').map((item) => item.mutationId)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    ])
  })

  it('isolates owner queues and only flushes the active owner', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await persistGoal('user-a', 'goal-a', 'A', '00000000-0000-4000-8000-000000000011')
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-b' } } }, error: null })
    await persistGoal('user-b', 'goal-b', 'B', '00000000-0000-4000-8000-000000000012')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })

    await flushQueue('user-b')

    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({
      p_expected_owner: 'user-b', p_entity_id: fixtureUuid('goal-b'),
    })
    expect(readQueue('user-a')).toHaveLength(1)
    expect(readQueue('user-b')).toHaveLength(0)
  })

  it('rechecks the owner inside a delayed lock for every queue and quarantine control', async () => {
    const rejectedMutation = '00000000-0000-4000-8000-000000000461'
    const failedRaw = JSON.stringify([storedMutation(rejectedMutation, 'goal-owner-race', {
      state: 'failed', attempts: 1, lastError: 'rejected',
    })])
    const scenarios: Array<{
      name: string
      setup: () => void
      run: () => Promise<unknown>
      verify: () => void
    }> = [{
      name: 'read quarantine',
      setup: () => localStorage.setItem('dostigator:sync-queue:corrupt-quarantine:v3:user-a', 'private-a'),
      run: () => readQuarantine('user-a'),
      verify: () => expect(localStorage.getItem('dostigator:sync-queue:corrupt-quarantine:v3:user-a')).toBe('private-a'),
    }, {
      name: 'clear quarantine',
      setup: () => localStorage.setItem('dostigator:sync-queue:corrupt-quarantine:v3:user-a', 'private-a'),
      run: () => clearQuarantine('user-a'),
      verify: () => expect(localStorage.getItem('dostigator:sync-queue:corrupt-quarantine:v3:user-a')).toBe('private-a'),
    }, {
      name: 'retry failed',
      setup: () => localStorage.setItem('dostigator:sync-queue:v3:user-a', failedRaw),
      run: () => retryFailed('user-a'),
      verify: () => expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).toBe(failedRaw),
    }, {
      name: 'discard rejected',
      setup: () => localStorage.setItem('dostigator:sync-queue:v3:user-a', failedRaw),
      run: () => discardRejectedMutation('user-a', rejectedMutation),
      verify: () => expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).toBe(failedRaw),
    }, {
      name: 'quarantine failed',
      setup: () => localStorage.setItem('dostigator:sync-queue:v3:user-a', failedRaw),
      run: () => quarantineFailedQueue('user-a'),
      verify: () => {
        expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).toBe(failedRaw)
        expect(localStorage.getItem('dostigator:sync-queue:recovery-quarantine:v3:user-a')).toBeNull()
      },
    }]

    for (const scenario of scenarios) {
      localStorage.clear()
      scenario.setup()
      let currentOwner = 'user-a'
      mocks.getSession.mockClear()
      mocks.getSession.mockImplementation(async () => ({
        data: { session: { user: { id: currentOwner } } }, error: null,
      }))
      const delayedLock = installDelayedWebLock()
      try {
        const pending = scenario.run()
        await vi.waitFor(() => expect(delayedLock.request, scenario.name).toHaveBeenCalledTimes(1))
        expect(mocks.getSession, scenario.name).not.toHaveBeenCalled()
        currentOwner = 'user-b'
        delayedLock.release()

        await expect(pending, scenario.name).rejects.toThrow('другому аккаунту')
        scenario.verify()
      } finally {
        delayedLock.restore()
      }
    }
  })

  it('forms the quarantine export snapshot inside the verified owner lock', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks')
    const key = 'dostigator:sync-queue:corrupt-quarantine:v3:user-a'
    localStorage.setItem(key, 'inside-lock')
    const request = vi.fn(async (...args: unknown[]) => {
      const callback = args.at(-1) as (lock: null) => unknown
      const result = await callback(null)
      localStorage.setItem(key, 'after-lock')
      return result
    })
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })
    try {
      await expect(readQuarantine('user-a')).resolves.toMatchObject({ corrupt: 'inside-lock' })
      expect(localStorage.getItem(key)).toBe('after-lock')
    } finally {
      if (descriptor) Object.defineProperty(navigator, 'locks', descriptor)
      else Reflect.deleteProperty(navigator, 'locks')
    }
  })

  it('rejects an offline enqueue when A changes to B while waiting for the lock', async () => {
    const existingMutation = '00000000-0000-4000-8000-000000000462'
    const raw = JSON.stringify([storedMutation(existingMutation, 'goal-owner-existing')])
    localStorage.setItem('dostigator:sync-queue:v3:user-a', raw)
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    let currentOwner = 'user-a'
    mocks.getSession.mockImplementation(async () => ({
      data: { session: { user: { id: currentOwner } } }, error: null,
    }))
    const delayedLock = installDelayedWebLock()
    try {
      const pending = persistGoal(
        'user-a', 'goal-owner-new', 'New', '00000000-0000-4000-8000-000000000463',
      )
      await vi.waitFor(() => expect(delayedLock.request).toHaveBeenCalledTimes(1))
      currentOwner = 'user-b'
      delayedLock.release()

      await expect(pending).rejects.toThrow('другому аккаунту')
      expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).toBe(raw)
    } finally {
      delayedLock.restore()
    }
  })

  it('rejects a failed online enqueue when A changes to B while it waits for the lock', async () => {
    const raw = JSON.stringify([storedMutation(
      '00000000-0000-4000-8000-000000000467', 'goal-owner-failed-existing',
    )])
    localStorage.setItem('dostigator:sync-queue:v3:user-a', raw)
    let currentOwner = 'user-a'
    mocks.getSession.mockImplementation(async () => ({
      data: { session: { user: { id: currentOwner } } }, error: null,
    }))
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('rejected') })
    const delayedLock = installDelayedWebLock()
    try {
      const pending = persistGoal(
        'user-a', 'goal-owner-failed-new', 'New', '00000000-0000-4000-8000-000000000468',
      )
      await vi.waitFor(() => expect(delayedLock.request).toHaveBeenCalledTimes(1))
      currentOwner = 'user-b'
      delayedLock.release()

      await expect(pending).rejects.toThrow('другому аккаунту')
      expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).toBe(raw)
    } finally {
      delayedLock.restore()
    }
  })

  it('does not append offline Undo after its owner changes while waiting for the lock', async () => {
    const original = '00000000-0000-4000-8000-000000000469'
    const inverse = '00000000-0000-4000-8000-000000000470'
    const raw = JSON.stringify([storedMutation(original, 'goal-owner-undo')])
    localStorage.setItem('dostigator:sync-queue:v3:user-a', raw)
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    let currentOwner = 'user-a'
    mocks.getSession.mockImplementation(async () => ({
      data: { session: { user: { id: currentOwner } } }, error: null,
    }))
    const delayedLock = installDelayedWebLock()
    try {
      const pending = persistUndoOrQueue('user-a', original, inverse, 'Отмена')
      await vi.waitFor(() => expect(delayedLock.request).toHaveBeenCalledTimes(1))
      currentOwner = 'user-b'
      delayedLock.release()

      await expect(pending).rejects.toThrow('другому аккаунту')
      expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).toBe(raw)
    } finally {
      delayedLock.restore()
    }
  })

  it('does not enqueue a failed online Undo after its owner changes before the second lock', async () => {
    const original = '00000000-0000-4000-8000-000000000471'
    const inverse = '00000000-0000-4000-8000-000000000472'
    let currentOwner = 'user-a'
    mocks.getSession.mockImplementation(async () => ({
      data: { session: { user: { id: currentOwner } } }, error: null,
    }))
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('rejected') })
    const delayedLock = installDelayedWebLock(2)
    try {
      const pending = persistUndoOrQueue(
        'user-a', original, inverse, 'Отмена', descriptor(original, 'goal-owner-direct-undo', 1),
      )
      await vi.waitFor(() => expect(delayedLock.request).toHaveBeenCalledTimes(2))
      currentOwner = 'user-b'
      delayedLock.release()

      await expect(pending).rejects.toThrow('другому аккаунту')
      expect(mocks.rpc).toHaveBeenCalledWith('dostigator_undo_mutation', expect.objectContaining({
        p_expected_owner: 'user-a', p_original_mutation_id: original, p_mutation_id: inverse,
      }))
      expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).toBeNull()
    } finally {
      delayedLock.restore()
    }
  })

  it('rejects a flush before reading A queue when A changes to B while waiting for the lock', async () => {
    const mutationId = '00000000-0000-4000-8000-000000000464'
    const raw = JSON.stringify([{
      id: mutationId, ownerId: 'user-a', table: 'dostigator_goals', type: 'upsert',
      payload: goalPayload('goal-owner-flush', 'Queued', mutationId, 1),
      createdAt: fixtureTime, state: 'pending', attempts: 0, lastError: null,
    }])
    localStorage.setItem('dostigator:sync-queue:v2:user-a', raw)
    let currentOwner = 'user-a'
    mocks.getSession.mockImplementation(async () => ({
      data: { session: { user: { id: currentOwner } } }, error: null,
    }))
    const delayedLock = installDelayedWebLock()
    try {
      const pending = flushQueue('user-a')
      await vi.waitFor(() => expect(delayedLock.request).toHaveBeenCalledTimes(1))
      currentOwner = 'user-b'
      delayedLock.release()

      await expect(pending).rejects.toThrow('другому аккаунту')
      expect(mocks.rpc).not.toHaveBeenCalled()
      expect(localStorage.getItem('dostigator:sync-queue:v2:user-a')).toBe(raw)
      expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).toBeNull()
      expect(localStorage.getItem('dostigator:sync-queue:corrupt-quarantine:v3:user-a')).toBeNull()
    } finally {
      delayedLock.restore()
    }
  })

  it('retains server rejection as failed and retries explicitly', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await persistGoal('user-a', 'goal-1', 'A', '00000000-0000-4000-8000-000000000021')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('revision conflict') })

    expect(await flushQueue('user-a')).toMatchObject({ completed: 0, pending: 0, failed: 1 })
    expect(readQueue('user-a')[0]).toMatchObject({ state: 'failed', attempts: 1, lastError: 'revision conflict' })

    expect(await retryFailed('user-a')).toMatchObject({ completed: 1, pending: 0, failed: 0 })
    expect(readQueue('user-a')).toHaveLength(0)
  })

  it('recovers from a permanent rejection without silently dropping the blocked tail', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await persistGoal('user-a', 'goal-1', 'A', '00000000-0000-4000-8000-000000000022')
    await persistGoal('user-a', 'goal-2', 'B', '00000000-0000-4000-8000-000000000023')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('revision conflict') })

    expect(await flushQueue('user-a')).toMatchObject({ failed: 1, pending: 1 })
    expect(await retryFailed('user-a')).toMatchObject({ failed: 1, pending: 1 })
    expect(mocks.rpc).toHaveBeenCalledTimes(2)

    await expect(quarantineFailedQueue('user-a')).resolves.toBe(2)
    expect(readQueue('user-a')).toEqual([])
    expect(queueStats('user-a')).toMatchObject({ failed: 0, pending: 0, quarantined: 2 })
    await expect(readQuarantine('user-a')).resolves.toMatchObject({ recovery: expect.stringContaining(fixtureUuid('goal-2')) })
  })

  it('cancels a rejected original without adding a doomed inverse', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('RLS rejection') })
    const original = '00000000-0000-4000-8000-000000000024'
    await persistGoal('user-a', 'goal-1', 'A', original)

    await expect(persistUndoOrQueue('user-a', original, crypto.randomUUID(), 'Отмена', descriptor(original, 'goal-1', 0)))
      .rejects.toThrow('Сначала отмените')
    expect(readQueue('user-a')).toHaveLength(1)
    await expect(discardRejectedMutation('user-a', original)).resolves.toMatchObject({ mutationId: original })
    expect(readQueue('user-a')).toEqual([])
  })

  it('quarantines unattributed v1 data under the queue lock and never exposes it', async () => {
    localStorage.setItem('dostigator:sync-queue:v1', JSON.stringify([{ id: 'legacy-private' }]))
    expect(readQueue('user-a')).toEqual([])
    expect(queueStats('user-a')).toMatchObject({ legacyQuarantined: true })
    await flushQueue('user-a')
    expect(localStorage.getItem('dostigator:sync-queue:v1')).toBeNull()
    expect(localStorage.getItem('dostigator:sync-queue:legacy-quarantine:v1')).toContain('legacy-private')
    expect(queueStats('user-a')).toMatchObject({ legacyQuarantined: true })
    await expect(readQuarantine('user-b')).rejects.toThrow('другому аккаунту')
  })

  it('keeps public readQueue storage-pure for legacy and v2 data', () => {
    const mutationId = '00000000-0000-4000-8000-000000000465'
    const legacyRaw = '[{"id":"private-v1"}]'
    const v2Raw = JSON.stringify([{
      id: mutationId, ownerId: 'user-a', table: 'dostigator_goals', type: 'upsert',
      payload: goalPayload('goal-pure-read', 'Legacy', mutationId, 1),
      createdAt: fixtureTime, state: 'pending', attempts: 0, lastError: null,
    }])
    localStorage.setItem('dostigator:sync-queue:v1', legacyRaw)
    localStorage.setItem('dostigator:sync-queue:v2:user-a', v2Raw)

    expect(readQueue('user-a')).toHaveLength(1)

    expect(localStorage.getItem('dostigator:sync-queue:v1')).toBe(legacyRaw)
    expect(localStorage.getItem('dostigator:sync-queue:v2:user-a')).toBe(v2Raw)
    expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).toBeNull()
    expect(localStorage.getItem('dostigator:sync-queue:legacy-quarantine:v1')).toBeNull()
  })

  it('appends repeated v1 quarantines without dropping either capture', async () => {
    localStorage.setItem('dostigator:sync-queue:v1', '[{"id":"one"}]')
    await flushQueue('user-a')
    localStorage.setItem('dostigator:sync-queue:v1', '[{"id":"two"}]')
    await flushQueue('user-a')
    const stored = localStorage.getItem('dostigator:sync-queue:legacy-quarantine:v1') ?? ''
    expect(stored).toContain('one')
    expect(stored).toContain('two')
  })

  it('stops in order when the active account changes between operations', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await persistGoal('user-a', 'goal-1', 'A', '00000000-0000-4000-8000-000000000031')
    await persistGoal('user-a', 'goal-2', 'B', '00000000-0000-4000-8000-000000000032')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    mocks.getSession
      .mockResolvedValueOnce({ data: { session: { user: { id: 'user-a' } } }, error: null })
      .mockResolvedValueOnce({ data: { session: { user: { id: 'user-a' } } }, error: null })
      .mockResolvedValueOnce({ data: { session: { user: { id: 'user-a' } } }, error: null })
      .mockResolvedValueOnce({ data: { session: { user: { id: 'user-b' } } }, error: null })

    await expect(flushQueue('user-a')).rejects.toThrow('другому аккаунту')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('dostigator_apply_mutation', expect.objectContaining({
      p_expected_owner: 'user-a',
    }))
    expect(readQueue('user-a')[0].payload?.id).toBe(fixtureUuid('goal-2'))
  })

  it('keeps A operation queued when the session changes during its RPC', async () => {
    const mutationId = '00000000-0000-4000-8000-000000000466'
    const raw = JSON.stringify([storedMutation(mutationId, 'goal-owner-rpc')])
    localStorage.setItem('dostigator:sync-queue:v3:user-a', raw)
    let currentOwner = 'user-a'
    mocks.getSession.mockImplementation(async () => ({
      data: { session: { user: { id: currentOwner } } }, error: null,
    }))
    mocks.rpc.mockImplementationOnce(async (_name: string, args: Record<string, unknown>) => {
      currentOwner = 'user-b'
      return { data: { event: eventFrom(args) }, error: null }
    })

    await expect(flushQueue('user-a')).rejects.toThrow('другому аккаунту')

    expect(mocks.rpc).toHaveBeenCalledWith('dostigator_apply_mutation', expect.objectContaining({
      p_expected_owner: 'user-a', p_mutation_id: mutationId,
    }))
    expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).toBe(raw)
  })

  it('preserves a failed operation and every later dependency', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await persistGoal('user-a', 'goal-1', 'A', '00000000-0000-4000-8000-000000000041')
    await persistGoal('user-a', 'goal-2', 'B', '00000000-0000-4000-8000-000000000042')
    await persistGoal('user-a', 'goal-3', 'C', '00000000-0000-4000-8000-000000000043')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    mocks.rpc
      .mockImplementationOnce(async (_name: string, args: Record<string, unknown>) => ({ data: { event: eventFrom(args) }, error: null }))
      .mockResolvedValueOnce({ data: null, error: new Error('blocked') })

    expect(await flushQueue('user-a')).toMatchObject({ completed: 1, pending: 1, failed: 1 })
    expect(readQueue('user-a').map((item) => item.payload?.id)).toEqual([fixtureUuid('goal-2'), fixtureUuid('goal-3')])
  })

  it('deduplicates concurrent flush runners', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await persistGoal('user-a', 'goal-1', 'A', '00000000-0000-4000-8000-000000000051')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    let release: ((value: { data: { event: ReturnType<typeof eventFrom> }; error: null }) => void) | undefined
    mocks.rpc.mockReturnValue(new Promise((resolve) => { release = resolve }))
    const first = flushQueue('user-a')
    const second = flushQueue('user-a')
    release?.({ data: { event: eventFrom({ p_mutation_id: 'x' }) }, error: null })
    await Promise.all([first, second])
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('queues an online RLS rejection as failed, never as false success', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('RLS rejection') })
    const result = await persistGoal('user-a', 'goal-1', 'A', '00000000-0000-4000-8000-000000000061')
    expect(result.status).toBe('failed')
    expect(readQueue('user-a')[0]).toMatchObject({ state: 'failed', lastError: 'RLS rejection' })
  })

  it('keeps network-failed operations pending in original order', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await persistGoal('user-a', 'goal-1', 'A', '00000000-0000-4000-8000-000000000071')
    await persistGoal('user-a', 'goal-2', 'B', '00000000-0000-4000-8000-000000000072')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    mocks.rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await flushQueue('user-a')).toMatchObject({ completed: 0, pending: 2, failed: 0 })
  })

  it('keeps the exact idempotency envelope after an ambiguous lost response', async () => {
    const mutation = descriptor('00000000-0000-4000-8000-000000000073', 'goal-1', 0)
    mocks.rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await persistOrQueue('user-a', 'dostigator_goals', goalPayload('goal-1', 'A', mutation.mutationId, 1), mutation))
      .toMatchObject({ status: 'pending' })
    expect(readQueue('user-a')[0].mutation?.source).toBe('ui')

    await flushQueue('user-a')

    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'dostigator_apply_mutation', expect.objectContaining({
      p_expected_owner: 'user-a',
      p_mutation_id: mutation.mutationId,
      p_source: 'ui',
    }))
    expect(readQueue('user-a')).toEqual([])
  })

  it('marks operations created while already offline without changing them on replay', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    const mutation = descriptor('00000000-0000-4000-8000-000000000074', 'goal-1', 0)
    await persistOrQueue('user-a', 'dostigator_goals', goalPayload('goal-1', 'A', mutation.mutationId, 1), mutation)
    expect(readQueue('user-a')[0].mutation?.source).toBe('offline')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    await flushQueue('user-a')
    expect(mocks.rpc).toHaveBeenCalledWith('dostigator_apply_mutation', expect.objectContaining({
      p_expected_owner: 'user-a', p_source: 'offline',
    }))
  })

  it('uses undo source for a direct online Undo', async () => {
    const original = '00000000-0000-4000-8000-000000000075'
    const inverse = '00000000-0000-4000-8000-000000000076'

    await expect(persistUndoOrQueue('user-a', original, inverse, 'Отмена', descriptor(original, 'goal-1', 1)))
      .resolves.toMatchObject({ status: 'synced' })

    expect(mocks.rpc).toHaveBeenCalledWith('dostigator_undo_mutation', expect.objectContaining({
      p_expected_owner: 'user-a',
      p_original_mutation_id: original,
      p_mutation_id: inverse,
      p_source: 'undo',
    }))
  })

  it('keeps offline as the Undo source selected before its first attempt', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    const original = '00000000-0000-4000-8000-000000000077'
    const inverse = '00000000-0000-4000-8000-000000000078'
    await persistUndoOrQueue('user-a', original, inverse, 'Отмена', descriptor(original, 'goal-1', 1))

    expect(readQueue('user-a')[0]).toMatchObject({ type: 'undo', source: 'offline' })
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    await flushQueue('user-a')

    expect(mocks.rpc).toHaveBeenCalledWith('dostigator_undo_mutation', expect.objectContaining({
      p_expected_owner: 'user-a', p_source: 'offline',
    }))
  })

  it('replays an ambiguously failed online Undo with the exact same source', async () => {
    const original = '00000000-0000-4000-8000-000000000079'
    const inverse = '00000000-0000-4000-8000-000000000080'
    mocks.rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(persistUndoOrQueue('user-a', original, inverse, 'Отмена', descriptor(original, 'goal-1', 1)))
      .resolves.toMatchObject({ status: 'pending' })
    expect(readQueue('user-a')[0]).toMatchObject({ type: 'undo', source: 'undo' })

    await flushQueue('user-a')
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'dostigator_undo_mutation', expect.objectContaining({
      p_expected_owner: 'user-a',
      p_original_mutation_id: original,
      p_mutation_id: inverse,
      p_source: 'undo',
    }))
  })

  it('accepts complete valid create fixtures for every mutation entity', async () => {
    const goalMutation = '00000000-0000-4000-8000-000000000301'
    const actionMutation = '00000000-0000-4000-8000-000000000302'
    const habitMutation = '00000000-0000-4000-8000-000000000303'
    const checkinMutation = '00000000-0000-4000-8000-000000000304'
    const reviewMutation = '00000000-0000-4000-8000-000000000305'

    await persistGoal('user-a', 'goal-valid', 'Цель', goalMutation)
    await persistOrQueue('user-a', 'dostigator_actions', actionPayload('action-valid', actionMutation, 1, {
      focus_date: '2026-08-24', focus_position: 1,
    }), {
      mutationId: actionMutation, entityType: 'action', entityId: fixtureUuid('action-valid'),
      operation: 'action_create', label: 'Создано действие', baseRevision: 0, before: null, source: 'ui',
    })
    await persistOrQueue('user-a', 'dostigator_habits', habitPayload('habit-valid', habitMutation), {
      mutationId: habitMutation, entityType: 'habit', entityId: fixtureUuid('habit-valid'),
      operation: 'habit_create', label: 'Создана привычка', baseRevision: 0, before: null, source: 'ui',
    })
    await persistOrQueue('user-a', 'dostigator_habit_checkins', checkinPayload('checkin-valid', checkinMutation), {
      mutationId: checkinMutation, entityType: 'habit_checkin', entityId: fixtureUuid('checkin-valid'),
      operation: 'habit_check', label: 'Отмечена привычка', baseRevision: 0, before: null, source: 'ui',
    })
    await persistOrQueue('user-a', 'dostigator_weekly_reviews', reviewPayload('review-valid', reviewMutation), {
      mutationId: reviewMutation, entityType: 'review', entityId: fixtureUuid('review-valid'),
      operation: 'review_create', label: 'Создан обзор', baseRevision: 0, before: null, source: 'ui',
    })

    expect(mocks.rpc.mock.calls.map((call) => call[1].p_entity_type)).toEqual([
      'goal', 'action', 'habit', 'habit_checkin', 'review',
    ])
    expect(readQueue('user-a')).toEqual([])
  })

  it.each([
    ['an impossible calendar date', [{ started_on: '2026-02-30', ended_on: null }]],
    ['an end before its start', [{ started_on: '2026-08-24', ended_on: '2026-08-23' }]],
    ['an open period before the final item', [
      { started_on: '2026-08-20', ended_on: null },
      { started_on: '2026-08-24', ended_on: null },
    ]],
    ['overlapping periods', [
      { started_on: '2026-08-20', ended_on: '2026-08-26' },
      { started_on: '2026-08-25', ended_on: null },
    ]],
    ['non-chronological periods', [
      { started_on: '2026-08-25', ended_on: '2026-08-27' },
      { started_on: '2026-08-24', ended_on: null },
    ]],
  ])('rejects habit activity history containing %s', async (_case, activityPeriods) => {
    const mutationId = crypto.randomUUID()
    await expect(persistOrQueue('user-a', 'dostigator_habits', habitPayload('habit-invalid-periods', mutationId, 1, {
      activity_periods: activityPeriods,
    }), {
      mutationId, entityType: 'habit', entityId: fixtureUuid('habit-invalid-periods'),
      operation: 'habit_create', label: 'Создана привычка', baseRevision: 0, before: null, source: 'ui',
    })).rejects.toThrow('Некорректная операция')
  })

  it('accepts canonical pause/resume history and rejects dates before the prior period', async () => {
    const pauseMutation = '00000000-0000-4000-8000-000000000331'
    const activeBefore = habitSnapshot('habit-period-pause', {
      activity_periods: [
        { started_on: '2026-08-20', ended_on: '2026-08-22' },
        { started_on: '2026-08-24', ended_on: null },
      ],
    })
    await persistOrQueue('user-a', 'dostigator_habits', habitPayload('habit-period-pause', pauseMutation, 2, {
      active: false,
      activity_periods: [
        { started_on: '2026-08-20', ended_on: '2026-08-22' },
        { started_on: '2026-08-24', ended_on: '2026-08-26' },
      ],
    }), {
      mutationId: pauseMutation, entityType: 'habit', entityId: fixtureUuid('habit-period-pause'),
      operation: 'habit_pause', label: 'Привычка приостановлена', baseRevision: 1, before: activeBefore, source: 'ui',
    })

    const resumeMutation = '00000000-0000-4000-8000-000000000332'
    const pausedBefore = habitSnapshot('habit-period-resume', {
      active: false,
      activity_periods: [
        { started_on: '2026-08-20', ended_on: '2026-08-22' },
        { started_on: '2026-08-24', ended_on: '2026-08-26' },
      ],
    })
    await persistOrQueue('user-a', 'dostigator_habits', habitPayload('habit-period-resume', resumeMutation, 2, {
      activity_periods: [
        { started_on: '2026-08-20', ended_on: '2026-08-22' },
        { started_on: '2026-08-24', ended_on: '2026-08-26' },
        { started_on: '2026-08-26', ended_on: null },
      ],
    }), {
      mutationId: resumeMutation, entityType: 'habit', entityId: fixtureUuid('habit-period-resume'),
      operation: 'habit_resume', label: 'Привычка возобновлена', baseRevision: 1, before: pausedBefore, source: 'ui',
    })

    const invalidResume = '00000000-0000-4000-8000-000000000333'
    await expect(persistOrQueue('user-a', 'dostigator_habits', habitPayload('habit-period-invalid-resume', invalidResume, 2, {
      activity_periods: [
        { started_on: '2026-08-20', ended_on: '2026-08-22' },
        { started_on: '2026-08-24', ended_on: '2026-08-26' },
        { started_on: '2026-08-25', ended_on: null },
      ],
    }), {
      mutationId: invalidResume, entityType: 'habit', entityId: fixtureUuid('habit-period-invalid-resume'),
      operation: 'habit_resume', label: 'Привычка возобновлена', baseRevision: 1,
      before: { ...pausedBefore, id: fixtureUuid('habit-period-invalid-resume') }, source: 'ui',
    })).rejects.toThrow('Некорректная операция')

    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['active habit without a final open period', true, [{ started_on: '2026-08-24', ended_on: '2026-08-25' }]],
    ['inactive habit with an open period', false, [{ started_on: '2026-08-24', ended_on: null }]],
  ])('rejects legacy %s', async (_case, active, activityPeriods) => {
    const mutationId = crypto.randomUUID()
    await expect(persistOrQueue('user-a', 'dostigator_habits', habitPayload('habit-state-mismatch', mutationId, 0, {
      active, activity_periods: activityPeriods,
    }), {
      mutationId, entityType: 'habit', entityId: fixtureUuid('habit-state-mismatch'),
      operation: 'legacy_upsert', label: 'Перенесена привычка', baseRevision: 0, before: null, source: 'legacy',
    })).rejects.toThrow('Некорректная операция')
  })

  it('accepts a same-day closed-to-open activity boundary', async () => {
    const mutationId = '00000000-0000-4000-8000-000000000335'
    await persistOrQueue('user-a', 'dostigator_habits', habitPayload('habit-same-day-boundary', mutationId, 0, {
      activity_periods: [
        { started_on: '2026-08-24', ended_on: '2026-08-24' },
        { started_on: '2026-08-24', ended_on: null },
      ],
    }), {
      mutationId, entityType: 'habit', entityId: fixtureUuid('habit-same-day-boundary'),
      operation: 'legacy_upsert', label: 'Перенесена привычка', baseRevision: 0, before: null, source: 'legacy',
    })

    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['score outside 0..100', { score: 999, focus: null, habits: null, actions: null, period: { weekStart: '2026-08-24', asOf: '2026-08-30' } }],
    ['asOf after the selected week', { score: 60, focus: null, habits: null, actions: null, period: { weekStart: '2026-08-24', asOf: '2026-08-31' } }],
    ['a mismatched period weekStart', { score: 60, focus: null, habits: null, actions: null, period: { weekStart: '2026-08-17', asOf: '2026-08-23' } }],
  ])('rejects review metrics with %s for create and legacy upsert', async (_case, metricsSnapshot) => {
    for (const [suffix, operation, revision] of [['create', 'review_create', 1], ['upsert', 'legacy_upsert', 0]] as const) {
      const mutationId = crypto.randomUUID()
      await expect(persistOrQueue('user-a', 'dostigator_weekly_reviews', {
        ...reviewPayload(`review-invalid-${suffix}`, mutationId),
        metrics_snapshot: metricsSnapshot, revision,
      }, {
        mutationId, entityType: 'review', entityId: fixtureUuid(`review-invalid-${suffix}`),
        operation, label: 'Обзор недели', baseRevision: 0, before: null, source: operation === 'legacy_upsert' ? 'legacy' : 'ui',
      })).rejects.toThrow('Некорректная операция')
    }
  })

  it('accepts canonical review metrics while preserving nullable sections', async () => {
    const mutationId = '00000000-0000-4000-8000-000000000334'
    await persistOrQueue('user-a', 'dostigator_weekly_reviews', {
      ...reviewPayload('review-null-sections', mutationId),
      metrics_snapshot: {
        score: 50,
        focus: { done: 1, committed: 2, rate: .5 },
        habits: null,
        actions: null,
        period: { weekStart: '2026-08-24', asOf: '2026-08-28' },
      },
    }, {
      mutationId, entityType: 'review', entityId: fixtureUuid('review-null-sections'),
      operation: 'review_create', label: 'Создан обзор', baseRevision: 0, before: null, source: 'ui',
    })

    expect(mocks.rpc).toHaveBeenCalledWith('dostigator_apply_mutation', expect.objectContaining({
      p_after: expect.objectContaining({
        metrics_snapshot: expect.objectContaining({ habits: null, actions: null }),
      }),
    }))
  })

  it('requires Monday and a non-null snapshot for review_create but keeps legacy null compatible', async () => {
    const nullCreateMutation = '00000000-0000-4000-8000-000000000336'
    await expect(persistOrQueue('user-a', 'dostigator_weekly_reviews', {
      ...reviewPayload('review-null-create', nullCreateMutation), metrics_snapshot: null,
    }, {
      mutationId: nullCreateMutation, entityType: 'review', entityId: fixtureUuid('review-null-create'),
      operation: 'review_create', label: 'Создан обзор', baseRevision: 0, before: null, source: 'ui',
    })).rejects.toThrow('Некорректная операция')

    const tuesdayMutation = '00000000-0000-4000-8000-000000000337'
    await expect(persistOrQueue('user-a', 'dostigator_weekly_reviews', {
      ...reviewPayload('review-tuesday', tuesdayMutation),
      week_start: '2026-08-25',
      metrics_snapshot: {
        score: null, focus: null, habits: null, actions: null,
        period: { weekStart: '2026-08-25', asOf: '2026-08-25' },
      },
    }, {
      mutationId: tuesdayMutation, entityType: 'review', entityId: fixtureUuid('review-tuesday'),
      operation: 'review_create', label: 'Создан обзор', baseRevision: 0, before: null, source: 'ui',
    })).rejects.toThrow('Некорректная операция')

    const legacyMutation = '00000000-0000-4000-8000-000000000338'
    await persistOrQueue('user-a', 'dostigator_weekly_reviews', {
      ...reviewPayload('review-legacy-null', legacyMutation), metrics_snapshot: null, revision: 0,
    }, {
      mutationId: legacyMutation, entityType: 'review', entityId: fixtureUuid('review-legacy-null'),
      operation: 'legacy_upsert', label: 'Перенесён обзор', baseRevision: 0, before: null, source: 'legacy',
    })

    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['completed goal without progress 100', 'dostigator_goals', 'goal', (mutationId: string) => ({
      ...goalPayload('legacy-invalid-goal-completed', 'Цель', mutationId, 0),
      status: 'completed', progress: 90, completed_at: fixtureTime,
    })],
    ['active goal with completed_at', 'dostigator_goals', 'goal', (mutationId: string) => ({
      ...goalPayload('legacy-invalid-goal-active', 'Цель', mutationId, 0), completed_at: fixtureTime,
    })],
    ['done action without completed_at', 'dostigator_actions', 'action', (mutationId: string) => ({
      ...actionPayload('legacy-invalid-action-done', mutationId, 0), status: 'done', completed_at: null,
    })],
    ['todo action with completed_at', 'dostigator_actions', 'action', (mutationId: string) => ({
      ...actionPayload('legacy-invalid-action-todo', mutationId, 0), completed_at: fixtureTime,
    })],
    ['focused cancelled action', 'dostigator_actions', 'action', (mutationId: string) => ({
      ...actionPayload('legacy-invalid-action-cancelled', mutationId, 0), status: 'cancelled',
      focus_date: '2026-08-24', focus_position: 1,
    })],
  ] as const)('rejects legacy_upsert row state: %s', async (_case, table, entityType, makePayload) => {
    const mutationId = crypto.randomUUID()
    const payload: Record<string, unknown> = makePayload(mutationId)
    await expect(persistOrQueue('user-a', table, payload, {
      mutationId, entityType, entityId: String(payload.id), operation: 'legacy_upsert',
      label: 'Перенесено изменение', baseRevision: 0, before: null, source: 'legacy',
    })).rejects.toThrow('Некорректная операция')
  })

  it('accepts canonical completed goal and done/cancelled action legacy rows', async () => {
    const goalMutation = '00000000-0000-4000-8000-000000000341'
    await persistOrQueue('user-a', 'dostigator_goals', {
      ...goalPayload('legacy-valid-goal-completed', 'Цель', goalMutation, 0),
      status: 'completed', progress: 100, completed_at: fixtureTime,
    }, {
      mutationId: goalMutation, entityType: 'goal', entityId: fixtureUuid('legacy-valid-goal-completed'),
      operation: 'legacy_upsert', label: 'Перенесена цель', baseRevision: 0, before: null, source: 'legacy',
    })
    const doneMutation = '00000000-0000-4000-8000-000000000342'
    await persistOrQueue('user-a', 'dostigator_actions', {
      ...actionPayload('legacy-valid-action-done', doneMutation, 0), status: 'done', completed_at: fixtureTime,
    }, {
      mutationId: doneMutation, entityType: 'action', entityId: fixtureUuid('legacy-valid-action-done'),
      operation: 'legacy_upsert', label: 'Перенесено действие', baseRevision: 0, before: null, source: 'legacy',
    })
    const cancelledMutation = '00000000-0000-4000-8000-000000000343'
    await persistOrQueue('user-a', 'dostigator_actions', {
      ...actionPayload('legacy-valid-action-cancelled', cancelledMutation, 0), status: 'cancelled',
    }, {
      mutationId: cancelledMutation, entityType: 'action', entityId: fixtureUuid('legacy-valid-action-cancelled'),
      operation: 'legacy_upsert', label: 'Перенесено действие', baseRevision: 0, before: null, source: 'legacy',
    })

    expect(mocks.rpc).toHaveBeenCalledTimes(3)
  })

  it('counts DB text limits in Unicode code points for action and Undo labels', async () => {
    const actionMutation = '00000000-0000-4000-8000-000000000306'
    const title = '😀'.repeat(120)
    const label = `Создано действие «${title}»`
    await persistOrQueue('user-a', 'dostigator_actions', actionPayload('action-unicode', actionMutation, 1, { title }), {
      mutationId: actionMutation, entityType: 'action', entityId: fixtureUuid('action-unicode'),
      operation: 'action_create', label, baseRevision: 0, before: null, source: 'ui',
    })

    const original = '00000000-0000-4000-8000-000000000307'
    const inverse = '00000000-0000-4000-8000-000000000308'
    await persistUndoOrQueue('user-a', original, inverse, '😀'.repeat(180), descriptor(original, 'goal-unicode', 1))

    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'dostigator_apply_mutation', expect.objectContaining({ p_label: label }))
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'dostigator_undo_mutation', expect.objectContaining({
      p_original_mutation_id: original, p_mutation_id: inverse,
    }))
  })

  it('rejects non-UUID server identifiers before RPC or enqueue', async () => {
    const validMutation = '00000000-0000-4000-8000-000000000309'
    await expect(persistOrQueue(
      'user-a',
      'dostigator_actions',
      actionPayload('action-invalid-fk', validMutation, 1, { goal_id: 'not-a-uuid' }),
      {
        mutationId: validMutation, entityType: 'action', entityId: fixtureUuid('action-invalid-fk'),
        operation: 'action_create', label: 'Создано действие', baseRevision: 0, before: null, source: 'ui',
      },
    )).rejects.toThrow('Некорректная операция')

    await expect(persistOrQueue(
      'user-a',
      'dostigator_goals',
      goalPayload('goal-invalid-mutation-id', 'Цель', 'not-a-uuid', 1),
      {
        mutationId: 'not-a-uuid', entityType: 'goal', entityId: fixtureUuid('goal-invalid-mutation-id'),
        operation: 'goal_create', label: 'Создана цель', baseRevision: 0, before: null, source: 'ui',
      },
    )).rejects.toThrow('Некорректная операция')

    await expect(persistUndoOrQueue(
      'user-a', 'not-a-uuid', crypto.randomUUID(), 'Отмена', descriptor(validMutation, 'goal-uuid', 1),
    )).rejects.toThrow('корректный дескриптор')

    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).toBeNull()
  })

  it.each([
    ['action_complete', async () => {
      const mutationId = '00000000-0000-4000-8000-000000000321'
      const before = actionSnapshot('action-smuggled', { title: 'До' })
      return persistOrQueue('user-a', 'dostigator_actions', actionPayload('action-smuggled', mutationId, 2, {
        goal_id: fixtureUuid('goal-other'), title: 'Подмена', status: 'done',
        focus_date: '2026-08-25', focus_position: 2, completed_at: fixtureTime,
      }), {
        mutationId, entityType: 'action', entityId: fixtureUuid('action-smuggled'),
        operation: 'action_complete', label: 'Выполнено действие', baseRevision: 1, before, source: 'ui',
      })
    }],
    ['goal_pause', async () => {
      const mutationId = '00000000-0000-4000-8000-000000000322'
      return persistOrQueue('user-a', 'dostigator_goals', {
        ...goalPayload('goal-smuggled', 'Подмена', mutationId, 2), status: 'paused',
      }, {
        mutationId, entityType: 'goal', entityId: fixtureUuid('goal-smuggled'),
        operation: 'goal_pause', label: 'Цель поставлена на паузу', baseRevision: 1,
        before: goalSnapshot('goal-smuggled', 'До'), source: 'ui',
      })
    }],
    ['habit_pause', async () => {
      const mutationId = '00000000-0000-4000-8000-000000000323'
      return persistOrQueue('user-a', 'dostigator_habits', habitPayload('habit-smuggled', mutationId, 2, {
        title: 'Подмена', active: false,
        activity_periods: [{ started_on: '2026-08-24', ended_on: '2026-08-25' }],
      }), {
        mutationId, entityType: 'habit', entityId: fixtureUuid('habit-smuggled'),
        operation: 'habit_pause', label: 'Привычка поставлена на паузу', baseRevision: 1,
        before: habitSnapshot('habit-smuggled', { title: 'До' }), source: 'ui',
      })
    }],
  ])('rejects unrelated field smuggling through %s before RPC/enqueue', async (_operation, run) => {
    await expect(run()).rejects.toThrow('Некорректная операция')
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).toBeNull()
  })

  it('accepts GoalPage resume and complete progress transitions', async () => {
    const resumeMutation = '00000000-0000-4000-8000-000000000324'
    await persistOrQueue('user-a', 'dostigator_goals', {
      ...goalPayload('goal-resume-progress', 'Цель', resumeMutation, 2), status: 'active', progress: 0,
    }, {
      mutationId: resumeMutation, entityType: 'goal', entityId: fixtureUuid('goal-resume-progress'),
      operation: 'goal_resume', label: 'Цель возобновлена', baseRevision: 1,
      before: { ...goalSnapshot('goal-resume-progress', 'Цель'), status: 'paused', progress: 75 }, source: 'ui',
    })

    const completeMutation = '00000000-0000-4000-8000-000000000325'
    await persistOrQueue('user-a', 'dostigator_goals', {
      ...goalPayload('goal-complete-progress', 'Цель', completeMutation, 2),
      status: 'completed', progress: 100, completed_at: fixtureTime,
    }, {
      mutationId: completeMutation, entityType: 'goal', entityId: fixtureUuid('goal-complete-progress'),
      operation: 'goal_complete', label: 'Цель завершена', baseRevision: 1,
      before: { ...goalSnapshot('goal-complete-progress', 'Цель'), progress: 80 }, source: 'ui',
    })

    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'dostigator_apply_mutation', expect.objectContaining({
      p_operation: 'goal_resume', p_after: expect.objectContaining({ progress: 0 }),
    }))
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'dostigator_apply_mutation', expect.objectContaining({
      p_operation: 'goal_complete', p_after: expect.objectContaining({ progress: 100 }),
    }))
  })

  it('rejects an incomplete goal_create before RPC or durable enqueue', async () => {
    const mutationId = '00000000-0000-4000-8000-000000000311'

    await expect(persistOrQueue('user-a', 'dostigator_goals', { id: fixtureUuid('goal-invalid') }, {
      mutationId, entityType: 'goal', entityId: fixtureUuid('goal-invalid'), operation: 'goal_create',
      label: 'Создана цель', baseRevision: 0, before: null, source: 'ui',
    })).rejects.toThrow('Некорректная операция')

    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).toBeNull()
  })

  it('rejects a false action_delete whose after row is still todo', async () => {
    const mutationId = '00000000-0000-4000-8000-000000000312'
    const before = actionSnapshot('action-invalid-delete')

    await expect(persistOrQueue(
      'user-a',
      'dostigator_actions',
      actionPayload('action-invalid-delete', mutationId, 2, { status: 'todo' }),
      {
        mutationId, entityType: 'action', entityId: fixtureUuid('action-invalid-delete'), operation: 'action_delete',
        label: 'Удалено действие', baseRevision: 1, before, source: 'ui',
      },
    )).rejects.toThrow('Некорректная операция')

    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).toBeNull()
  })

  it('rejects a goal_edit disguised as a status transition', async () => {
    const mutationId = '00000000-0000-4000-8000-000000000316'
    const payload = { ...goalPayload('goal-false-edit', 'После', mutationId, 2), status: 'paused' }

    await expect(persistOrQueue('user-a', 'dostigator_goals', payload, {
      mutationId, entityType: 'goal', entityId: fixtureUuid('goal-false-edit'), operation: 'goal_edit',
      label: 'Изменена цель', baseRevision: 1, before: goalSnapshot('goal-false-edit'), source: 'ui',
    })).rejects.toThrow('Некорректная операция')

    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).toBeNull()
  })

  it('accepts a real habit_uncheck snapshot and rejects a forged one', async () => {
    const validMutationId = '00000000-0000-4000-8000-000000000317'
    const before = {
      id: fixtureUuid('checkin-existing'), habit_id: fixtureUuid('habit-1'), checked_on: '2026-08-24', note: '',
    }
    await persistOrQueue(
      'user-a',
      'dostigator_habit_checkins',
      checkinPayload('checkin-existing', '00000000-0000-4000-8000-000000000299'),
      {
        mutationId: validMutationId, entityType: 'habit_checkin', entityId: fixtureUuid('checkin-existing'),
        operation: 'habit_uncheck', label: 'Снята отметка', baseRevision: 1, before, source: 'ui',
      },
    )
    expect(mocks.rpc).toHaveBeenCalledTimes(1)

    const forgedMutationId = '00000000-0000-4000-8000-000000000318'
    await expect(persistOrQueue(
      'user-a',
      'dostigator_habit_checkins',
      {
        ...checkinPayload('checkin-forged', '00000000-0000-4000-8000-000000000298'),
        habit_id: fixtureUuid('habit-other'),
      },
      {
        mutationId: forgedMutationId, entityType: 'habit_checkin', entityId: fixtureUuid('checkin-forged'),
        operation: 'habit_uncheck', label: 'Снята отметка', baseRevision: 1,
        before: {
          id: fixtureUuid('checkin-forged'), habit_id: fixtureUuid('habit-1'), checked_on: '2026-08-24', note: '',
        }, source: 'ui',
      },
    )).rejects.toThrow('Некорректная операция')

    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).toBeNull()
  })

  it('rejects a malformed before snapshot before RPC or enqueue', async () => {
    const mutationId = '00000000-0000-4000-8000-000000000313'

    await expect(persistOrQueue(
      'user-a',
      'dostigator_goals',
      goalPayload('goal-malformed-before', 'После', mutationId, 2),
      {
        mutationId, entityType: 'goal', entityId: fixtureUuid('goal-malformed-before'), operation: 'goal_edit',
        label: 'Изменена цель', baseRevision: 1,
        before: { id: fixtureUuid('goal-malformed-before'), title: 'До' }, source: 'ui',
      },
    )).rejects.toThrow('Некорректная операция')

    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).toBeNull()
  })

  it('rejects an entity-invalid operation and an oversized label before RPC', async () => {
    const wrongOperationId = '00000000-0000-4000-8000-000000000314'
    await expect(persistOrQueue(
      'user-a',
      'dostigator_goals',
      goalPayload('goal-wrong-operation', 'Цель', wrongOperationId, 1),
      {
        mutationId: wrongOperationId, entityType: 'goal', entityId: fixtureUuid('goal-wrong-operation'), operation: 'action_create',
        label: 'Создано действие', baseRevision: 0, before: null, source: 'ui',
      },
    )).rejects.toThrow('Некорректная операция')

    const longLabelId = '00000000-0000-4000-8000-000000000315'
    await expect(persistOrQueue(
      'user-a',
      'dostigator_goals',
      goalPayload('goal-long-label', 'Цель', longLabelId, 1),
      { ...descriptor(longLabelId, 'goal-long-label', 0, 'x'.repeat(181)) },
    )).rejects.toThrow('Некорректная операция')

    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).toBeNull()
  })

  it('retries an operation after a transient 500 response', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await persistGoal('user-a', 'goal-1', 'A', '00000000-0000-4000-8000-000000000081')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    mocks.rpc.mockRejectedValueOnce(Object.assign(new Error('service unavailable'), { status: 500 }))
    expect(await flushQueue('user-a')).toMatchObject({ pending: 1, failed: 0 })
    expect(await retryFailed('user-a')).toMatchObject({ completed: 1, pending: 0, failed: 0 })
  })

  it('keeps original then inverse when Undo is requested offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    const original = '00000000-0000-4000-8000-000000000091'
    const inverse = '00000000-0000-4000-8000-000000000092'
    await persistGoal('user-a', 'goal-1', 'A', original)
    await persistUndoOrQueue('user-a', original, inverse, 'Отмена создания')
    expect(readQueue('user-a').map((item) => item.type)).toEqual(['mutation', 'undo'])

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    await flushQueue('user-a')
    expect(mocks.rpc.mock.calls.map((call) => call[0])).toEqual(['dostigator_apply_mutation', 'dostigator_undo_mutation'])
    expect(mocks.rpc.mock.calls[1][1]).toMatchObject({ p_original_mutation_id: original, p_mutation_id: inverse })
  })

  it('refuses Undo of an older pending revision instead of creating a doomed FIFO inverse', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    const first = '00000000-0000-4000-8000-000000000093'
    await persistGoal('user-a', 'goal-1', 'A', first, 4)
    await persistGoal('user-a', 'goal-1', 'B', '00000000-0000-4000-8000-000000000094', 5)

    await expect(persistUndoOrQueue('user-a', first, crypto.randomUUID(), 'Отмена A', descriptor(first, 'goal-1', 4)))
      .rejects.toThrow('более новое локальное изменение')
    expect(readQueue('user-a').map((item) => item.type)).toEqual(['mutation', 'mutation'])
  })

  it('refuses Undo of a pending create with a later dependent child', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    const goalMutation = '00000000-0000-4000-8000-000000000095'
    await persistGoal('user-a', 'goal-1', 'Цель', goalMutation)
    const actionMutation = '00000000-0000-4000-8000-000000000096'
    await persistOrQueue('user-a', 'dostigator_actions', actionPayload('action-1', actionMutation, 1), {
      mutationId: actionMutation, entityType: 'action', entityId: fixtureUuid('action-1'),
      operation: 'action_create', label: 'Создано действие', baseRevision: 0, before: null, source: 'ui',
    })

    await expect(persistUndoOrQueue('user-a', goalMutation, crypto.randomUUID(), 'Отмена цели', descriptor(goalMutation, 'goal-1', 0)))
      .rejects.toThrow('действия, созданные для этой цели')
    expect(readQueue('user-a')).toHaveLength(2)
  })

  it('surfaces queue quota failures so optimistic UI can roll back', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (String(key) === 'dostigator:sync-queue:v3:user-a') throw new DOMException('quota exceeded')
      return originalSetItem.call(this, key, value)
    })
    await expect(persistGoal('user-a', 'goal-1', 'A', '00000000-0000-4000-8000-000000000101')).rejects.toThrow('quota exceeded')
  })

  it('persists a rejected operation and its failed metadata in one durable write', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('server rejection') })
    const originalSetItem = Storage.prototype.setItem
    let writes = 0
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (String(key) === 'dostigator:sync-queue:v3:user-a') writes += 1
      return originalSetItem.call(this, key, value)
    })
    await persistGoal('user-a', 'goal-1', 'A', '00000000-0000-4000-8000-000000000111')
    expect(readQueue('user-a')).toHaveLength(1)
    expect(readQueue('user-a')[0]).toMatchObject({ state: 'failed', attempts: 1, lastError: 'server rejection' })
    expect(writes).toBe(1)
  })

  it('quarantines malformed v3 JSON under lock and reports its item count before and after capture', async () => {
    localStorage.setItem('dostigator:sync-queue:v3:user-a', '{broken-json')
    expect(queueStats('user-a')).toMatchObject({ pending: 0, failed: 0, quarantined: 1 })
    expect(localStorage.getItem('dostigator:sync-queue:corrupt-quarantine:v3:user-a')).toBeNull()
    await flushQueue('user-a')
    expect(localStorage.getItem('dostigator:sync-queue:corrupt-quarantine:v3:user-a')).toContain('{broken-json')
  })

  it('appends repeated corrupt v3 captures and only lets their owner clear them', async () => {
    localStorage.setItem('dostigator:sync-queue:v3:user-a', '{broken-one')
    await flushQueue('user-a')
    localStorage.setItem('dostigator:sync-queue:v3:user-a', '{broken-two')
    await flushQueue('user-a')
    const stored = localStorage.getItem('dostigator:sync-queue:corrupt-quarantine:v3:user-a') ?? ''
    expect(stored).toContain('{broken-one')
    expect(stored).toContain('{broken-two')
    await expect(clearQuarantine('user-b')).rejects.toThrow('другому аккаунту')
    await clearQuarantine('user-a')
    expect(localStorage.getItem('dostigator:sync-queue:corrupt-quarantine:v3:user-a')).toBeNull()
  })

  it.each([
    ['Undo without a mutation descriptor', {
      id: '00000000-0000-4000-8000-000000000202', ownerId: 'user-a', type: 'undo',
      originalMutationId: '00000000-0000-4000-8000-000000000201',
      mutationId: '00000000-0000-4000-8000-000000000202', label: 'Отмена', source: 'offline',
      createdAt: '2026-08-24T08:01:00.000Z', state: 'pending', attempts: 0, lastError: null,
    }],
    ['Undo whose original id disagrees with its descriptor', {
      id: '00000000-0000-4000-8000-000000000204', ownerId: 'user-a', type: 'undo',
      originalMutationId: '00000000-0000-4000-8000-000000000203',
      mutationId: '00000000-0000-4000-8000-000000000204', label: 'Отмена', source: 'offline',
      mutation: descriptor('00000000-0000-4000-8000-000000000205', 'goal-2', 1),
      createdAt: '2026-08-24T08:02:00.000Z', state: 'pending', attempts: 0, lastError: null,
    }],
    ['Undo that reuses the original idempotency key', {
      id: '00000000-0000-4000-8000-000000000209', ownerId: 'user-a', type: 'undo',
      originalMutationId: '00000000-0000-4000-8000-000000000209',
      mutationId: '00000000-0000-4000-8000-000000000209', label: 'Отмена', source: 'offline',
      mutation: descriptor('00000000-0000-4000-8000-000000000209', 'goal-2', 1),
      createdAt: '2026-08-24T08:02:30.000Z', state: 'pending', attempts: 0, lastError: null,
    }],
    ['a table/entity mismatch', storedMutation(
      '00000000-0000-4000-8000-000000000206',
      'goal-2',
      {
        table: 'dostigator_actions',
        payload: { id: fixtureUuid('goal-2'), goal_id: fixtureUuid('goal-1') },
      },
    )],
    ['an invalid entity-specific payload relation', storedMutation(
      '00000000-0000-4000-8000-000000000207',
      'action-2',
      {
        table: 'dostigator_actions',
        payload: { id: fixtureUuid('action-2'), title: 'No parent' },
        mutation: {
          mutationId: '00000000-0000-4000-8000-000000000207',
          entityType: 'action', entityId: fixtureUuid('action-2'),
          operation: 'action_create', label: 'Изменена цель', baseRevision: 0, before: null, source: 'offline',
        },
      },
    )],
    ['a non-UUID local queue id', storedMutation(
      '00000000-0000-4000-8000-000000000210',
      'goal-invalid-queue-id',
      { id: 'not-a-uuid' },
    )],
    ['a non-UUID mutation id', storedMutation(
      '00000000-0000-4000-8000-000000000211',
      'goal-invalid-mutation-id-v3',
      {
        mutationId: 'not-a-uuid',
        payload: goalPayload('goal-invalid-mutation-id-v3', 'Цель', 'not-a-uuid', 1),
        mutation: {
          ...descriptor('00000000-0000-4000-8000-000000000211', 'goal-invalid-mutation-id-v3', 0),
          mutationId: 'not-a-uuid',
        },
      },
    )],
    ['a non-UUID owner-owned foreign key', storedMutation(
      '00000000-0000-4000-8000-000000000212',
      'action-invalid-fk-v3',
      {
        table: 'dostigator_actions',
        payload: actionPayload('action-invalid-fk-v3', '00000000-0000-4000-8000-000000000212', 1, {
          goal_id: 'not-a-uuid',
        }),
        mutation: {
          mutationId: '00000000-0000-4000-8000-000000000212', entityType: 'action',
          entityId: fixtureUuid('action-invalid-fk-v3'), operation: 'action_create',
          label: 'Создано действие', baseRevision: 0, before: null, source: 'offline',
        },
        label: 'Создано действие',
      },
    )],
    ['a non-UUID Undo original id', {
      id: '00000000-0000-4000-8000-000000000214', ownerId: 'user-a', type: 'undo',
      originalMutationId: 'not-a-uuid', mutationId: '00000000-0000-4000-8000-000000000214',
      label: 'Отмена', source: 'offline',
      mutation: descriptor('00000000-0000-4000-8000-000000000213', 'goal-invalid-undo-uuid', 1),
      createdAt: '2026-08-24T08:03:00.000Z', state: 'pending', attempts: 0, lastError: null,
    }],
    ['an action_complete that smuggles an unrelated title', storedMutation(
      '00000000-0000-4000-8000-000000000215',
      'action-smuggled-v3',
      {
        table: 'dostigator_actions',
        payload: actionPayload('action-smuggled-v3', '00000000-0000-4000-8000-000000000215', 2, {
          title: 'Подмена', status: 'done', completed_at: fixtureTime,
        }),
        mutation: {
          mutationId: '00000000-0000-4000-8000-000000000215', entityType: 'action',
          entityId: fixtureUuid('action-smuggled-v3'), operation: 'action_complete',
          label: 'Выполнено действие', baseRevision: 1,
          before: actionSnapshot('action-smuggled-v3', { title: 'До' }), source: 'offline',
        },
        label: 'Выполнено действие',
      },
    )],
    ['an operation invalid for the descriptor entity', storedMutation(
      '00000000-0000-4000-8000-000000000208',
      'goal-2',
      { mutation: { ...descriptor('00000000-0000-4000-8000-000000000208', 'goal-2', 0), operation: 'action_create' } },
    )],
  ])('quarantines the complete v3 queue before executing when it contains %s', async (_case, invalid) => {
    const valid = storedMutation('00000000-0000-4000-8000-000000000200', 'goal-1')
    const raw = JSON.stringify([valid, invalid])
    localStorage.setItem('dostigator:sync-queue:v3:user-a', raw)

    await expect(flushQueue('user-a')).resolves.toMatchObject({ completed: 0, pending: 0, failed: 0 })

    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).toBeNull()
    const captures = JSON.parse(localStorage.getItem('dostigator:sync-queue:corrupt-quarantine:v3:user-a') ?? '[]') as Array<{ raw: string }>
    expect(captures).toHaveLength(1)
    expect(captures[0].raw).toBe(raw)
  })

  it('losslessly normalizes real legacy v2 rows for every entity before FIFO flush', async () => {
    const goalMutation = '00000000-0000-4000-8000-000000000121'
    const actionMutation = '00000000-0000-4000-8000-000000000126'
    const habitMutation = '00000000-0000-4000-8000-000000000127'
    const checkinMutation = '00000000-0000-4000-8000-000000000128'
    const reviewMutation = '00000000-0000-4000-8000-000000000129'
    const legacyGoal: Record<string, unknown> = goalPayload('goal-legacy-v2', 'Legacy goal', goalMutation, 1)
    const legacyAction: Record<string, unknown> = actionPayload('action-legacy-v2', actionMutation, 1, { title: 'Legacy action' })
    const legacyHabit: Record<string, unknown> = habitPayload('habit-legacy-v2', habitMutation, 1, { active: false })
    const legacyCheckin: Record<string, unknown> = checkinPayload('checkin-legacy-v2', checkinMutation)
    const legacyReview: Record<string, unknown> = reviewPayload('review-legacy-v2', reviewMutation)
    delete legacyGoal.revision
    delete legacyGoal.last_mutation_id
    delete legacyAction.revision
    delete legacyAction.last_mutation_id
    delete legacyHabit.revision
    delete legacyHabit.last_mutation_id
    delete legacyHabit.activity_periods
    delete legacyCheckin.revision
    delete legacyCheckin.last_mutation_id
    delete legacyReview.revision
    delete legacyReview.last_mutation_id
    delete legacyReview.metrics_snapshot
    localStorage.setItem('dostigator:sync-queue:v2:user-a', JSON.stringify([{
      id: goalMutation,
      ownerId: 'user-a',
      table: 'dostigator_goals',
      type: 'upsert',
      payload: legacyGoal,
      createdAt: '2026-08-24T08:00:00.000Z',
      state: 'pending',
      attempts: 0,
      lastError: null,
    }, {
      id: actionMutation,
      ownerId: 'user-a',
      table: 'dostigator_actions',
      type: 'upsert',
      payload: legacyAction,
      createdAt: '2026-08-24T08:01:00.000Z',
      state: 'pending',
      attempts: 0,
      lastError: null,
    }, {
      id: habitMutation,
      ownerId: 'user-a',
      table: 'dostigator_habits',
      type: 'upsert',
      payload: legacyHabit,
      createdAt: '2026-08-24T08:02:00.000Z',
      state: 'pending',
      attempts: 0,
      lastError: null,
    }, {
      id: checkinMutation,
      ownerId: 'user-a',
      table: 'dostigator_habit_checkins',
      type: 'upsert',
      payload: legacyCheckin,
      createdAt: '2026-08-24T08:03:00.000Z',
      state: 'pending',
      attempts: 0,
      lastError: null,
    }, {
      id: reviewMutation,
      ownerId: 'user-a',
      table: 'dostigator_weekly_reviews',
      type: 'upsert',
      payload: legacyReview,
      createdAt: '2026-08-24T08:04:00.000Z',
      state: 'pending',
      attempts: 0,
      lastError: null,
    }]))

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await flushQueue('user-a')

    expect(readQueue('user-a')).toMatchObject([{
      type: 'mutation', mutationId: goalMutation,
      payload: { title: 'Legacy goal', revision: 0, last_mutation_id: goalMutation },
      mutation: { entityType: 'goal', operation: 'legacy_upsert', baseRevision: 0 },
    }, {
      type: 'mutation', mutationId: actionMutation,
      payload: {
        title: 'Legacy action', goal_id: fixtureUuid('goal-1'), revision: 0, last_mutation_id: actionMutation,
      },
      mutation: { entityType: 'action', operation: 'legacy_upsert', baseRevision: 0 },
    }, {
      type: 'mutation', mutationId: habitMutation,
      payload: {
        revision: 0, last_mutation_id: habitMutation,
        activity_periods: [{ started_on: '2026-08-24', ended_on: '2026-08-24' }],
      },
      mutation: { entityType: 'habit', operation: 'legacy_upsert', baseRevision: 0 },
    }, {
      type: 'mutation', mutationId: checkinMutation,
      payload: { revision: 0, last_mutation_id: checkinMutation },
      mutation: { entityType: 'habit_checkin', operation: 'legacy_upsert', baseRevision: 0 },
    }, {
      type: 'mutation', mutationId: reviewMutation,
      payload: { revision: 0, last_mutation_id: reviewMutation, metrics_snapshot: null },
      mutation: { entityType: 'review', operation: 'legacy_upsert', baseRevision: 0 },
    }])
    expect(localStorage.getItem('dostigator:sync-queue:v2:user-a')).toBeNull()
    expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).not.toBeNull()

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    await flushQueue('user-a')

    expect(mocks.rpc.mock.calls.map((call) => call[1])).toMatchObject([{
      p_entity_type: 'goal', p_expected_revision: 0,
      p_after: { title: 'Legacy goal', revision: 0, last_mutation_id: goalMutation },
    }, {
      p_entity_type: 'action', p_expected_revision: 0,
      p_after: { title: 'Legacy action', revision: 0, last_mutation_id: actionMutation },
    }, {
      p_entity_type: 'habit', p_expected_revision: 0,
      p_after: {
        revision: 0, last_mutation_id: habitMutation,
        activity_periods: [{ started_on: '2026-08-24', ended_on: '2026-08-24' }],
      },
    }, {
      p_entity_type: 'habit_checkin', p_expected_revision: 0,
      p_after: { revision: 0, last_mutation_id: checkinMutation },
    }, {
      p_entity_type: 'review', p_expected_revision: 0,
      p_after: { revision: 0, last_mutation_id: reviewMutation, metrics_snapshot: null },
    }])
    expect(readQueue('user-a')).toEqual([])
  })

  it('retains the full v2 source and surfaces a failed locked v3 quota write', async () => {
    const raw = JSON.stringify([{
      id: '00000000-0000-4000-8000-000000000122',
      ownerId: 'user-a',
      table: 'dostigator_goals',
      type: 'upsert',
      payload: goalPayload('goal-1', 'Legacy', '00000000-0000-4000-8000-000000000122', 2),
      createdAt: '2026-08-24T08:00:00.000Z',
      state: 'pending',
      attempts: 0,
      lastError: null,
    }])
    localStorage.setItem('dostigator:sync-queue:v2:user-a', raw)
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (String(key) === 'dostigator:sync-queue:v3:user-a') throw new DOMException('quota exceeded')
      return originalSetItem.call(this, key, value)
    })

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await expect(flushQueue('user-a')).rejects.toThrow('quota exceeded')
    expect(localStorage.getItem('dostigator:sync-queue:v2:user-a')).toBe(raw)
    expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).toBeNull()
    expect(localStorage.getItem('dostigator:sync-queue:corrupt-quarantine:v3:user-a')).toBeNull()
  })

  it('finishes v2 cleanup after a crash left an authoritative v3 snapshot beside it', async () => {
    const v2Mutation = '00000000-0000-4000-8000-000000000135'
    const v3Mutation = '00000000-0000-4000-8000-000000000136'
    localStorage.setItem('dostigator:sync-queue:v2:user-a', JSON.stringify([{
      id: v2Mutation, ownerId: 'user-a', table: 'dostigator_goals', type: 'upsert',
      payload: goalPayload('goal-v2-stale', 'Stale v2', v2Mutation, 1),
      createdAt: '2026-08-24T08:00:00.000Z', state: 'pending', attempts: 0, lastError: null,
    }]))
    localStorage.setItem('dostigator:sync-queue:v3:user-a', JSON.stringify([
      storedMutation(v3Mutation, 'goal-v3-authoritative'),
    ]))

    expect(readQueue('user-a').map((item) => item.mutationId)).toEqual([v3Mutation])
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await flushQueue('user-a')

    expect(localStorage.getItem('dostigator:sync-queue:v2:user-a')).toBeNull()
    expect(readQueue('user-a').map((item) => item.mutationId)).toEqual([v3Mutation])
  })

  it('quarantines a mixed unsupported v2 queue atomically without executing its valid tail', async () => {
    const raw = JSON.stringify([{
      id: '00000000-0000-4000-8000-000000000123',
      ownerId: 'user-a', table: 'dostigator_goals', type: 'upsert',
      payload: goalPayload('goal-1', 'Legacy', '00000000-0000-4000-8000-000000000123', 2),
      createdAt: '2026-08-24T08:00:00.000Z', state: 'pending', attempts: 0, lastError: null,
    }, {
      id: '00000000-0000-4000-8000-000000000124',
      ownerId: 'user-a', table: 'dostigator_actions', type: 'delete', rowId: 'action-1',
      createdAt: '2026-08-24T08:01:00.000Z', state: 'pending', attempts: 0, lastError: null,
    }, {
      id: '00000000-0000-4000-8000-000000000125',
      ownerId: 'user-a', table: 'dostigator_goals', type: 'upsert',
      payload: goalPayload('goal-2', 'Tail', '00000000-0000-4000-8000-000000000125', 1),
      createdAt: '2026-08-24T08:02:00.000Z', state: 'pending', attempts: 0, lastError: null,
    }])
    localStorage.setItem('dostigator:sync-queue:v2:user-a', raw)

    expect(readQueue('user-a')).toEqual([])
    await flushQueue('user-a')

    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(localStorage.getItem('dostigator:sync-queue:v2:user-a')).toBeNull()
    expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).toBeNull()
    const captures = JSON.parse(localStorage.getItem('dostigator:sync-queue:corrupt-quarantine:v3:user-a') ?? '[]') as Array<{ raw: string }>
    expect(captures).toHaveLength(1)
    expect(captures[0].raw).toBe(raw)
  })

  it('quarantines a structurally valid v2 row with non-canonical legacy state', async () => {
    const mutationId = '00000000-0000-4000-8000-000000000139'
    const raw = JSON.stringify([{
      id: mutationId,
      ownerId: 'user-a', table: 'dostigator_goals', type: 'upsert',
      payload: {
        ...goalPayload('goal-invalid-v2-state', 'Legacy', mutationId, 1),
        status: 'completed', progress: 75, completed_at: fixtureTime,
      },
      createdAt: fixtureTime, state: 'pending', attempts: 0, lastError: null,
    }])
    localStorage.setItem('dostigator:sync-queue:v2:user-a', raw)
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })

    await flushQueue('user-a')

    expect(readQueue('user-a')).toEqual([])
    expect(localStorage.getItem('dostigator:sync-queue:v2:user-a')).toBeNull()
    expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).toBeNull()
    const captures = JSON.parse(localStorage.getItem('dostigator:sync-queue:corrupt-quarantine:v3:user-a') ?? '[]') as Array<{ raw: string }>
    expect(captures).toEqual([expect.objectContaining({ raw })])
  })

  it('quarantines unsupported v2 deletes instead of guessing history', async () => {
    localStorage.setItem('dostigator:sync-queue:v2:user-a', JSON.stringify([{
      id: '00000000-0000-4000-8000-000000000131',
      ownerId: 'user-a',
      table: 'dostigator_actions',
      type: 'delete',
      rowId: 'action-1',
      createdAt: '2026-08-24T08:00:00.000Z',
      state: 'pending',
      attempts: 0,
      lastError: null,
    }]))
    expect(readQueue('user-a')).toEqual([])
    await flushQueue('user-a')
    expect(queueStats('user-a').quarantined).toBe(1)
  })

  it.each(['choosing', 'final contender check'] as const)(
    'fails closed when the fallback lease expires during %s acquisition',
    async (phase) => {
      const locksDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks')
      Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
      let now = 1_800_000_000_000
      vi.spyOn(Date, 'now').mockImplementation(() => now)
      const originalSetItem = Storage.prototype.setItem
      let contenderWrites = 0
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
        const result = originalSetItem.call(this, key, value)
        if (String(key).startsWith('dostigator:sync-queue:lock:v1:')) {
          const record = JSON.parse(String(value)) as { choosing: boolean }
          if (!record.choosing) contenderWrites += 1
          if ((phase === 'choosing' && record.choosing)
            || (phase === 'final contender check' && !record.choosing && contenderWrites === 2)) {
            now += 10_001
          }
        }
        return result
      })
      try {
        vi.resetModules()
        const tab = await import('./offline')
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
        const mutationId = phase === 'choosing'
          ? '00000000-0000-4000-8000-000000000453'
          : '00000000-0000-4000-8000-000000000454'

        await expect(tab.persistOrQueue(
          'user-a', 'dostigator_goals', goalPayload(`goal-${phase}`, 'Expired', mutationId, 1),
          descriptor(mutationId, `goal-${phase}`, 0),
        )).rejects.toThrow('Межвкладочная блокировка очереди потеряна')

        expect(tab.readQueue('user-a')).toEqual([])
        expect(localStorage.getItem('dostigator:sync-queue:v3:user-a')).toBeNull()
        expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
          .filter((key) => key?.startsWith('dostigator:sync-queue:lock:v1:'))).toEqual([])
      } finally {
        if (locksDescriptor) Object.defineProperty(navigator, 'locks', locksDescriptor)
        else Reflect.deleteProperty(navigator, 'locks')
        vi.resetModules()
      }
    },
  )

  it('never resurrects an expired fallback lease or lets its stale flush overwrite a competing enqueue', async () => {
    const locksDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks')
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    let now = 1_800_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    let nextInterval = 1
    const intervalCallbacks = new Map<number, () => void>()
    vi.spyOn(window, 'setInterval').mockImplementation(((handler: TimerHandler) => {
      if (typeof handler !== 'function') throw new Error('Expected an interval callback')
      const id = nextInterval
      nextInterval += 1
      intervalCallbacks.set(id, () => { handler() })
      return id
    }) as typeof window.setInterval)
    vi.spyOn(window, 'clearInterval').mockImplementation(((id: number) => {
      intervalCallbacks.delete(id)
    }) as typeof window.clearInterval)
    try {
      vi.resetModules()
      const tabA = await import('./offline')
      vi.resetModules()
      const tabB = await import('./offline')
      const mutationA = '00000000-0000-4000-8000-000000000451'
      const mutationB = '00000000-0000-4000-8000-000000000452'
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
      await tabA.persistOrQueue(
        'user-a', 'dostigator_goals', goalPayload('goal-expired-a', 'Tab A', mutationA, 1),
        descriptor(mutationA, 'goal-expired-a', 0),
      )

      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
      let releaseRpc!: (value: { data: { event: ReturnType<typeof eventFrom> }; error: null }) => void
      mocks.rpc.mockImplementationOnce((_name: string, args: Record<string, unknown>) => new Promise((resolve) => {
        releaseRpc = resolve
        expect(args.p_mutation_id).toBe(mutationA)
      }))
      const staleFlush = tabA.flushQueue('user-a')
      await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1))
      const staleKey = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        .find((key) => key?.startsWith('dostigator:sync-queue:lock:v1:'))
      expect(staleKey).toBeTruthy()
      expect(intervalCallbacks.size).toBe(1)

      now += 10_001
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
      await tabB.persistOrQueue(
        'user-a', 'dostigator_goals', goalPayload('goal-competing-b', 'Tab B', mutationB, 1),
        descriptor(mutationB, 'goal-competing-b', 0),
      )
      expect(tabB.readQueue('user-a').map((item) => item.mutationId)).toEqual([mutationA, mutationB])

      const foreignRecord = JSON.stringify({
        id: 'current-foreign-holder', epoch: '00000000-0000-4000-8000-000000000499',
        choosing: false, ticket: 99, expiresAt: now + 10_000,
      })
      localStorage.setItem(String(staleKey), foreignRecord)
      intervalCallbacks.forEach((heartbeat) => heartbeat())
      expect(localStorage.getItem(String(staleKey))).toBe(foreignRecord)

      releaseRpc({ data: { event: eventFrom({ p_mutation_id: mutationA }) }, error: null })
      await expect(staleFlush).rejects.toThrow('Межвкладочная блокировка очереди потеряна')

      expect(localStorage.getItem(String(staleKey))).toBe(foreignRecord)
      expect(tabB.readQueue('user-a').map((item) => item.mutationId)).toEqual([mutationA, mutationB])
      expect(intervalCallbacks.size).toBe(0)
    } finally {
      if (locksDescriptor) Object.defineProperty(navigator, 'locks', locksDescriptor)
      else Reflect.deleteProperty(navigator, 'locks')
      vi.resetModules()
    }
  })

  it('serializes concurrent durable enqueue across two module instances without Web Locks', async () => {
    const locksDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks')
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    try {
      const originalSetItem = Storage.prototype.setItem
      let lockWrites = 0
      let maximumSimultaneousContenders = 0
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
        const result = originalSetItem.call(this, key, value)
        if (String(key).startsWith('dostigator:sync-queue:lock:v1:')) {
          lockWrites += 1
          const contenders = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
            .filter((storedKey) => storedKey?.startsWith('dostigator:sync-queue:lock:v1:')).length
          maximumSimultaneousContenders = Math.max(maximumSimultaneousContenders, contenders)
        }
        return result
      })
      vi.resetModules()
      const tabA = await import('./offline')
      vi.resetModules()
      const tabB = await import('./offline')
      const mutationA = '00000000-0000-4000-8000-000000000401'
      const mutationB = '00000000-0000-4000-8000-000000000402'
      const durableAtResolution: Array<{ mutationId: string; queue: string[] }> = []

      await Promise.all([
        tabA.persistOrQueue('user-a', 'dostigator_goals', goalPayload('goal-tab-a', 'Tab A', mutationA, 1), descriptor(mutationA, 'goal-tab-a', 0))
          .then(() => { durableAtResolution.push({ mutationId: mutationA, queue: tabA.readQueue('user-a').map((item) => item.mutationId) }) }),
        tabB.persistOrQueue('user-a', 'dostigator_goals', goalPayload('goal-tab-b', 'Tab B', mutationB, 1), descriptor(mutationB, 'goal-tab-b', 0))
          .then(() => { durableAtResolution.push({ mutationId: mutationB, queue: tabB.readQueue('user-a').map((item) => item.mutationId) }) }),
      ])

      const queue = tabA.readQueue('user-a')
      expect(queue).toHaveLength(2)
      expect(new Set(queue.map((item) => item.mutationId))).toEqual(new Set([mutationA, mutationB]))
      expect(durableAtResolution).toHaveLength(2)
      expect(durableAtResolution.every((snapshot) => snapshot.queue.includes(snapshot.mutationId))).toBe(true)
      expect(lockWrites).toBeGreaterThanOrEqual(4)
      expect(maximumSimultaneousContenders).toBe(2)
      expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        .filter((key) => key?.startsWith('dostigator:sync-queue:lock:v1:'))).toEqual([])
    } finally {
      if (locksDescriptor) Object.defineProperty(navigator, 'locks', locksDescriptor)
      else Reflect.deleteProperty(navigator, 'locks')
      vi.resetModules()
    }
  })
})
