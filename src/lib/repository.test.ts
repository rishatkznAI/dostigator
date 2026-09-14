import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureAreas, importBackup, isBackup, loadAllHistory, loadAppData, makeBackup, previewBackup, readCachedData, stripOwnership } from './repository'
import type { AppData, Goal, HistoryEvent, PersonalBackup } from '../types'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: {
    auth: { getUser: mocks.getUser },
    from: mocks.from,
    rpc: mocks.rpc,
  },
}))

const data: AppData = { areas: [], goals: [], actions: [], habits: [], checkins: [], reviews: [] }
const activeUser = (id = 'user-a') => Promise.resolve({ data: { user: { id } }, error: null })
const currentArea = {
  id: 'area-current', user_id: 'user-a', name: 'Личное', color: '#fff', icon: 'sparkles', position: 0,
  archived_at: null, created_at: '2026-08-28T09:00:00Z', updated_at: '2026-08-28T09:00:00Z', revision: 0, last_mutation_id: null,
}

function historyEvent(index: number, ownerId = 'user-a'): HistoryEvent {
  return {
    id: `event-${index.toString().padStart(3, '0')}`, user_id: ownerId, mutation_id: `mutation-${index}`,
    entity_type: 'goal', entity_id: 'goal-1', operation: 'goal_edit', label: 'Изменена цель',
    before_data: null, after_data: { title: `Цель ${index}` }, base_revision: index, result_revision: index + 1,
    source: 'ui', reverts_event_id: null, created_at: `2026-08-28T09:${String(index % 60).padStart(2, '0')}:00Z`,
  }
}

function goal(id: string, ownerId = 'backup-owner'): Goal {
  return {
    id, user_id: ownerId, area_id: null, title: id, description: '', why: '', kind: 'goal', status: 'active',
    progress: 0, target_date: null, completed_at: null, created_at: '2026-08-28T09:00:00Z',
    updated_at: '2026-08-28T09:00:00Z', revision: 0, last_mutation_id: null,
  }
}

function backupWithGoals(...goals: Goal[]): PersonalBackup {
  return { product: 'dostigator', version: 3, exportedAt: '2026-08-28T09:00:00Z', data: { ...data, goals }, history: [] }
}

function backupWithEveryMutationEntity(): PersonalBackup {
  const timestamp = '2026-08-28T09:00:00Z'
  return {
    product: 'dostigator', version: 3, exportedAt: timestamp, history: [], data: {
      areas: [],
      goals: [goal('goal-1')],
      actions: [{
        id: 'action-1', user_id: 'backup-owner', goal_id: 'goal-1', title: 'Действие', status: 'todo',
        due_date: null, focus_date: null, focus_position: null, result_note: '', completed_at: null,
        created_at: timestamp, updated_at: timestamp, revision: 0, last_mutation_id: null,
      }],
      habits: [{
        id: 'habit-1', user_id: 'backup-owner', area_id: null, title: 'Привычка', target_per_week: 3,
        active: true, activity_periods: [{ started_on: '2026-08-24', ended_on: null }],
        created_at: timestamp, updated_at: timestamp, revision: 0, last_mutation_id: null,
      }],
      checkins: [{
        id: 'checkin-1', user_id: 'backup-owner', habit_id: 'habit-1', checked_on: '2026-08-28', note: '',
        created_at: timestamp, revision: 0, last_mutation_id: null,
      }],
      reviews: [{
        id: 'review-1', user_id: 'backup-owner', week_start: '2026-08-24', wins: '', blockers: '', next_focus: '',
        self_score: null, metrics_snapshot: null, created_at: timestamp, updated_at: timestamp,
        revision: 0, last_mutation_id: null,
      }],
      focusCommitments: [{
        id: 'focus-1', user_id: 'backup-owner', action_id: 'action-1', committed_on: '2026-08-28',
        position: 1, source_mutation_id: null, created_at: timestamp,
      }],
    },
  }
}

describe('personal backup', () => {
  beforeEach(() => {
    mocks.getUser.mockReset().mockImplementation(() => activeUser())
    mocks.rpc.mockReset()
    mocks.from.mockReset().mockImplementation((table: string) => {
      const chain = {
        select: vi.fn(() => chain),
        is: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn().mockResolvedValue({ data: table === 'dostigator_areas' ? [currentArea] : [], error: null }),
        upsert: vi.fn(() => ({ select: vi.fn().mockResolvedValue({ data: [], error: null }) })),
      }
      return chain
    })
  })

  afterEach(() => localStorage.clear())

  it('creates and validates a Dostigator backup', () => {
    const backup = makeBackup(data, [], 'user-a')
    expect(backup.version).toBe(3)
    expect(backup.history).toEqual([])
    expect(isBackup(backup)).toBe(true)
    expect(isBackup({ product: 'trainlog', version: 1, data })).toBe(false)
  })

  it('previews object counts and existing-id conflicts without writing', () => {
    const backup = backupWithEveryMutationEntity()
    const preview = previewBackup(backup, {
      ...data,
      goals: [goal('goal-1', 'user-a')],
      focusCommitments: [{ ...backup.data.focusCommitments![0], user_id: 'user-a' }],
    })

    expect(preview).toEqual({
      counts: { areas: 0, goals: 1, actions: 1, habits: 1, checkins: 1, reviews: 1, focusCommitments: 1, journals: 0 },
      total: 6,
      idMatches: 2,
      areaNameMatches: 0,
      areaIdentityConflicts: 0,
      dependencyConflicts: 0,
      conflicts: 0,
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('reports every broken backup dependency and blocks orphaned focus history', () => {
    const backup = backupWithEveryMutationEntity()
    backup.data.goals[0] = { ...backup.data.goals[0], area_id: 'missing-goal-area' }
    backup.data.habits[0] = { ...backup.data.habits[0], area_id: 'missing-habit-area' }
    backup.data.actions[0] = { ...backup.data.actions[0], goal_id: 'missing-goal' }
    backup.data.checkins[0] = { ...backup.data.checkins[0], habit_id: 'missing-habit' }
    backup.data.focusCommitments![0] = { ...backup.data.focusCommitments![0], action_id: 'missing-action' }

    expect(previewBackup(backup, data)).toMatchObject({
      areaIdentityConflicts: 0,
      dependencyConflicts: 5,
      conflicts: 5,
    })
  })

  it('distinguishes area name mappings from ID matches and identity conflicts', () => {
    const incoming = backupWithGoals()
    incoming.data.areas = [{ ...currentArea, id: 'area-by-id', user_id: 'backup-owner' }]
    const current = {
      ...data,
      areas: [
        currentArea,
        { ...currentArea, id: 'area-by-id', name: 'Текущая сфера' },
      ],
    }

    expect(previewBackup(incoming, current)).toMatchObject({
      idMatches: 1,
      areaNameMatches: 1,
      conflicts: 1,
    })
  })

  it('reports a default area with a cross-account ID as a safe name mapping', () => {
    const incoming = backupWithGoals()
    incoming.data.areas = [{ ...currentArea, id: 'source-area', user_id: 'backup-owner' }]

    expect(previewBackup(incoming, { ...data, areas: [currentArea] })).toMatchObject({
      idMatches: 0,
      areaNameMatches: 1,
      conflicts: 0,
    })
  })

  it('includes a portable history archive without exporting account ownership', () => {
    const backup = makeBackup(data, [{
      id: 'event-1', user_id: 'private-owner', mutation_id: 'mutation-1', entity_type: 'goal', entity_id: 'goal-1',
      operation: 'goal_edit', label: 'Изменена цель', before_data: null, after_data: { title: 'Цель' },
      base_revision: 0, result_revision: 1, source: 'ui', reverts_event_id: null, created_at: '2026-08-28T09:00:00Z',
    }], 'private-owner')
    expect(backup.history).toHaveLength(1)
    expect(backup.history?.[0]).not.toHaveProperty('user_id')
    expect(isBackup(backup)).toBe(true)
    expect(isBackup({ ...backup, history: null })).toBe(false)
  })

  it('refuses to assemble a mixed-owner export', () => {
    expect(() => makeBackup({ ...data, goals: [goal('goal-b', 'user-b')] }, [], 'user-a')).toThrow('Аккаунт изменился')
    expect(() => makeBackup(data, [historyEvent(1, 'user-b')], 'user-a')).toThrow('Аккаунт изменился')
  })

  it('accepts v1, v2 and v3 backups and normalizes missing Stage 4 history fields from cache', () => {
    expect(isBackup({ product: 'dostigator', version: 1, exportedAt: '2026-08-01T00:00:00Z', data })).toBe(true)
    expect(isBackup({ product: 'dostigator', version: 2, exportedAt: '2026-08-01T00:00:00Z', data })).toBe(true)
    expect(isBackup({ product: 'dostigator', version: 3, exportedAt: '2026-08-01T00:00:00Z', data, history: [] })).toBe(true)
    expect(isBackup({
      product: 'dostigator', version: 3, exportedAt: '2026-08-01T00:00:00Z',
      data: { ...data, focusCommitments: {} }, history: [],
    })).toBe(false)
    expect(isBackup({ product: 'dostigator', version: 3, exportedAt: '2026-08-01T00:00:00Z', data })).toBe(false)
    localStorage.setItem('dostigator:cache:user-a', JSON.stringify({
      ...data,
      habits: [{ id: 'habit-1', user_id: 'user-a', title: 'Читать', active: true, target_per_week: 3, created_at: '2026-08-24T08:00:00Z', updated_at: '2026-08-24T08:00:00Z' }],
      reviews: [{ id: 'review-1', user_id: 'user-a', week_start: '2026-08-24', wins: '', blockers: '', next_focus: '', self_score: null, created_at: '2026-08-24T08:00:00Z', updated_at: '2026-08-24T08:00:00Z' }],
    }))
    const normalized = readCachedData('user-a')
    expect(normalized.habits[0].activity_periods).toEqual([{ started_on: '2026-08-24', ended_on: null }])
    expect(normalized.reviews[0].metrics_snapshot).toEqual({ score: null, focus: null, habits: null, actions: null, period: { weekStart: '2026-08-24', asOf: '2026-08-30' } })
  })

  it('removes user ownership before import', () => {
    const row = { id: 'goal', user_id: 'private-user', title: 'Книга' } as Goal
    expect(stripOwnership(row)).not.toHaveProperty('user_id')
    expect(stripOwnership(row)).toHaveProperty('title', 'Книга')
  })

  it('aborts paginated history export when the active owner changes between pages', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => historyEvent(index))
    mocks.rpc.mockResolvedValue({ data: firstPage, error: null })
    mocks.getUser
      .mockImplementationOnce(() => activeUser('user-a'))
      .mockImplementationOnce(() => activeUser('user-a'))
      .mockImplementationOnce(() => activeUser('user-a'))
      .mockImplementationOnce(() => activeUser('user-b'))

    await expect(loadAllHistory('user-a')).rejects.toThrow('Аккаунт изменился')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('rejects a mixed-owner history page before it can become an export', async () => {
    mocks.rpc.mockResolvedValue({ data: [historyEvent(1, 'user-b')], error: null })
    await expect(loadAllHistory('user-a')).rejects.toThrow('Аккаунт изменился')
  })

  it('stops import before a second write when the authenticated owner changes', async () => {
    let writes = 0
    mocks.getUser.mockImplementation(() => activeUser(writes ? 'user-b' : 'user-a'))
    mocks.rpc.mockImplementation(async (name: string) => {
      expect(name).toBe('dostigator_import_backup')
      writes += 1
      return { data: {}, error: null }
    })

    await expect(importBackup(backupWithGoals(goal('goal-1'), goal('goal-2')), 'user-a', () => undefined)).rejects.toThrow('Аккаунт изменился')
    expect(writes).toBe(1)
  })

  it('stops import before further writes when the mutation queue guard closes', async () => {
    let queueActive = false
    mocks.rpc.mockImplementation(async () => {
      queueActive = true
      return { data: {}, error: null }
    })
    const guard = vi.fn(() => {
      if (queueActive) throw new Error('Очередь активна')
    })

    await expect(importBackup(backupWithGoals(goal('goal-1'), goal('goal-2')), 'user-a', guard)).rejects.toThrow('Очередь активна')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('enforces the durable queue guard inside the repository boundary', async () => {
    const mutationId = '00000000-0000-4000-8000-000000000001'
    const queuedGoalId = '30000000-0000-4000-8000-000000000001'
    const before = {
      id: queuedGoalId, area_id: null, title: 'До', description: '', why: '', kind: 'goal', status: 'active',
      progress: 0, target_date: null, completed_at: null,
    }
    localStorage.setItem('dostigator:sync-queue:v3:user-a', JSON.stringify([{
      id: '90000000-0000-4000-8000-000000000001', ownerId: 'user-a', type: 'mutation', table: 'dostigator_goals',
      payload: {
        ...before, title: 'Локально', created_at: '2026-08-28T08:00:00Z', updated_at: '2026-08-28T09:00:00Z',
        revision: 2, last_mutation_id: mutationId,
      }, mutation: {
        mutationId, entityType: 'goal', entityId: queuedGoalId,
        operation: 'goal_edit', label: 'Локальное изменение', baseRevision: 1, before,
      }, mutationId, label: 'Локальное изменение',
      createdAt: '2026-08-28T09:00:00Z', state: 'pending', attempts: 0, lastError: null,
    }]))

    await expect(importBackup(backupWithGoals(goal('goal-1')), 'user-a', () => undefined))
      .rejects.toThrow('Сначала завершите синхронизацию')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('never imports portable history as authoritative server events', async () => {
    const backup = backupWithGoals(goal('goal-1'))
    backup.history = [{ ...historyEvent(1), user_id: undefined } as never]
    mocks.rpc.mockResolvedValue({ data: {}, error: null })

    await importBackup(backup, 'user-a', () => undefined)

    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('dostigator_import_backup', expect.objectContaining({
      p_expected_owner: 'user-a',
      p_payload: expect.not.objectContaining({ history: expect.anything() }),
    }))
    expect(mocks.from).not.toHaveBeenCalledWith('dostigator_history_events')
  })

  it('binds every imported mutation entity to the expected active owner', async () => {
    mocks.rpc.mockResolvedValue({ data: {}, error: null })

    await importBackup(backupWithEveryMutationEntity(), 'user-a', () => undefined)

    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    const [name, args] = mocks.rpc.mock.calls[0]
    expect(name).toBe('dostigator_import_backup')
    expect(args.p_expected_owner).toBe('user-a')
    expect([args.p_payload.goals, args.p_payload.actions, args.p_payload.habits, args.p_payload.checkins, args.p_payload.reviews, args.p_payload.focusCommitments]
      .flat().every((row: { user_id: string }) => row.user_id === 'user-a')).toBe(true)
    expect(args.p_payload.focusCommitments).toEqual([
      expect.objectContaining({ id: 'focus-1', action_id: 'action-1', user_id: 'user-a' }),
    ])
  })

  it('uses the caller-owned import id so a lost response can be retried idempotently', async () => {
    const importId = '90000000-0000-4000-8000-000000000099'
    mocks.rpc.mockResolvedValue({ data: {}, error: null })

    await importBackup(backupWithGoals(goal('goal-1')), 'user-a', () => undefined, importId)

    expect(mocks.rpc).toHaveBeenCalledWith('dostigator_import_backup', expect.objectContaining({ p_import_id: importId }))
  })

  it('imports a backward-compatible backup without a focus ledger as an empty ledger', async () => {
    mocks.rpc.mockResolvedValue({ data: {}, error: null })

    await importBackup(backupWithGoals(goal('goal-1')), 'user-a', () => undefined)

    expect(mocks.rpc).toHaveBeenCalledWith('dostigator_import_backup', expect.objectContaining({
      p_payload: expect.objectContaining({ focusCommitments: [] }),
    }))
  })

  it('pins imported areas to the expected owner inside the atomic RPC', async () => {
    const backup = backupWithGoals(goal('goal-1'))
    backup.data.areas = [{ ...currentArea, user_id: 'user-b' }]
    mocks.rpc.mockResolvedValue({ data: {}, error: null })

    await importBackup(backup, 'user-a', () => undefined)

    expect(mocks.rpc).toHaveBeenCalledWith('dostigator_import_backup', expect.objectContaining({
      p_expected_owner: 'user-a',
      p_payload: expect.objectContaining({ areas: [expect.objectContaining({ user_id: 'user-a' })] }),
    }))
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('pins generated default areas to the expected owner before upsert', async () => {
    let inserted: AppData['areas'] = []
    const chain = {
      select: vi.fn(() => chain),
      is: vi.fn(() => chain),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
      upsert: vi.fn((rows: AppData['areas']) => {
        inserted = rows
        return {
          select: vi.fn().mockResolvedValue({
            data: rows.map((row) => ({ ...row, created_at: row.updated_at })),
            error: null,
          }),
        }
      }),
    }
    mocks.from.mockReturnValue(chain)

    const created = await ensureAreas('user-a')

    expect(inserted).toHaveLength(6)
    expect(inserted.every((row) => row.user_id === 'user-a')).toBe(true)
    expect(created.every((row) => row.user_id === 'user-a')).toBe(true)
  })

  it('keeps existing areas without adding a duplicate training model', async () => {
    let inserted: AppData['areas'] = []
    const chain = {
      select: vi.fn(() => chain),
      is: vi.fn(() => chain),
      order: vi.fn().mockResolvedValue({ data: [currentArea], error: null }),
      upsert: vi.fn((rows: AppData['areas']) => {
        inserted = rows
        return { select: vi.fn().mockResolvedValue({ data: rows.map((row) => ({ ...row, created_at: row.updated_at })), error: null }) }
      }),
    }
    mocks.from.mockReturnValue(chain)

    const areas = await ensureAreas('user-a')

    expect(inserted).toEqual([])
    expect(areas).toEqual([currentArea])
  })

  it('loads cancelled action tombstones and hidden parents for portable exports', async () => {
    const tombstone = {
      ...backupWithEveryMutationEntity().data.actions[0],
      id: 'cancelled-action', user_id: 'user-a', status: 'cancelled' as const,
    }
    const archivedGoal = { ...goal('archived-goal', 'user-a'), status: 'archived' as const }
    const tableChains = new Map<string, { neq: ReturnType<typeof vi.fn> }>()
    mocks.from.mockImplementation((table: string) => {
      const chain = {
        select: vi.fn(() => chain),
        is: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        order: vi.fn().mockResolvedValue({
          data: table === 'dostigator_areas' ? [currentArea]
            : table === 'dostigator_goals' ? [archivedGoal]
              : table === 'dostigator_actions' ? [tombstone] : [],
          error: null,
        }),
        upsert: vi.fn().mockResolvedValue({ data: [], error: null }),
      }
      tableChains.set(table, chain)
      return chain
    })

    const loaded = await loadAppData('user-a')

    expect(loaded.actions).toEqual([tombstone])
    expect(loaded.goals).toEqual([expect.objectContaining({ id: 'archived-goal', status: 'archived' })])
    expect(tableChains.get('dostigator_actions')?.neq).not.toHaveBeenCalled()
    expect(tableChains.get('dostigator_goals')?.neq).not.toHaveBeenCalled()
  })

  it('surfaces an owner rejection from the mutation RPC without masking it', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'mutation owner mismatch' } })

    await expect(importBackup(backupWithGoals(goal('goal-1')), 'user-a', () => undefined))
      .rejects.toThrow('mutation owner mismatch')

    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('dostigator_import_backup', expect.objectContaining({
      p_expected_owner: 'user-a',
    }))
  })

  it('rejects an obviously invalid late entity before the first backup write', async () => {
    const backup = backupWithEveryMutationEntity()
    backup.data.areas = [{ ...currentArea, user_id: 'backup-owner' }]
    backup.data.reviews[0] = { ...backup.data.reviews[0], id: '' }

    await expect(importBackup(backup, 'user-a', () => undefined))
      .rejects.toThrow('Резервная копия содержит некорректную запись')

    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects an invalid focus commitment before calling the atomic RPC', async () => {
    const backup = backupWithEveryMutationEntity()
    backup.data.focusCommitments = [{ ...backup.data.focusCommitments![0], id: '' }]

    await expect(importBackup(backup, 'user-a', () => undefined))
      .rejects.toThrow('Резервная копия содержит некорректную запись')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
