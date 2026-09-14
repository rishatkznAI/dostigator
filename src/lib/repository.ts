import { supabase } from './supabase'
import { localDateFromTimestamp, shiftDate } from './date'
import { persistOrQueue, queueStats } from './offline'
import type { AppData, Area, HistoryEvent, JournalEntry, PersonalBackup, RevisionedRow } from '../types'

const emptyData = (): AppData => ({ areas: [], goals: [], actions: [], habits: [], checkins: [], reviews: [], journals: [], focusCommitments: [] })
const ownerChangedMessage = 'Аккаунт изменился во время операции. Повторите действие в активном аккаунте.'

export type RepositoryOperationGuard = () => void | Promise<void>

export async function assertActiveOwner(expectedOwnerId: string) {
  const { data, error } = await supabase.auth.getUser()
  if (error) throw new Error('Не удалось подтвердить активный аккаунт. Проверьте подключение и повторите действие.')
  if (!data.user || data.user.id !== expectedOwnerId) throw new Error(ownerChangedMessage)
}

async function assertOperationAllowed(expectedOwnerId: string, guard: RepositoryOperationGuard) {
  await guard()
  const queue = queueStats(expectedOwnerId)
  if (queue.pending > 0 || queue.failed > 0) {
    throw new Error('Сначала завершите синхронизацию текущих изменений, затем повторите восстановление.')
  }
  await assertActiveOwner(expectedOwnerId)
}

function assertDataOwner(data: AppData, expectedOwnerId: string) {
  const rows = [data.areas, data.goals, data.actions, data.habits, data.checkins, data.reviews, data.focusCommitments ?? [], data.journals ?? []].flat()
  if (rows.some((row) => row.user_id !== expectedOwnerId)) throw new Error(ownerChangedMessage)
}

function assertHistoryOwner(history: HistoryEvent[], expectedOwnerId: string) {
  if (history.some((event) => event.user_id !== expectedOwnerId)) throw new Error(ownerChangedMessage)
}

function normalizeData(data: Partial<AppData>): AppData {
  const revisioned = <T extends Partial<RevisionedRow>>(row: T) => ({
    ...row,
    revision: typeof row.revision === 'number' ? row.revision : 0,
    last_mutation_id: typeof row.last_mutation_id === 'string' ? row.last_mutation_id : null,
  })
  return {
    areas: (data.areas ?? []).map(revisioned),
    goals: (data.goals ?? []).map(revisioned),
    actions: (data.actions ?? []).map(revisioned),
    habits: (data.habits ?? []).map((habit) => ({
      ...revisioned(habit),
      activity_periods: habit.activity_periods?.length ? habit.activity_periods : [{
        started_on: localDateFromTimestamp(habit.created_at) ?? '1970-01-01',
        ended_on: habit.active ? null : localDateFromTimestamp(habit.updated_at),
      }],
    })),
    checkins: (data.checkins ?? []).map(revisioned),
    reviews: (data.reviews ?? []).map((review) => ({
      ...revisioned(review),
      metrics_snapshot: review.metrics_snapshot ?? {
        score: null, focus: null, habits: null, actions: null,
        period: { weekStart: review.week_start, asOf: shiftDate(review.week_start, 6) },
      },
    })),
    focusCommitments: Array.isArray(data.focusCommitments) ? data.focusCommitments : [],
    journals: (data.journals ?? []).map(revisioned),
  }
}

function assertImportRows(data: AppData) {
  const rows = [data.areas, data.goals, data.actions, data.habits, data.checkins, data.reviews, data.focusCommitments ?? [], data.journals ?? []].flat()
  const invalid = rows.some((row) => !row || typeof row.id !== 'string' || !row.id.trim())
  if (invalid) throw new Error('Резервная копия содержит некорректную запись и не была восстановлена.')
}

const defaultAreas = [
  { name: 'Личное развитие', color: '#ffc857', icon: 'sparkles' },
  { name: 'Дом и ремонт', color: '#8bd3dd', icon: 'home' },
  { name: 'Автомобиль', color: '#f28f8f', icon: 'car' },
  { name: 'Финансы', color: '#8ed081', icon: 'wallet' },
  { name: 'Семья', color: '#d7aefb', icon: 'heart' },
  { name: 'Здоровье', color: '#ff9f68', icon: 'activity' },
] as const

function unwrap<T>(result: { data: T | null; error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message)
  return result.data
}

export async function ensureAreas(expectedOwnerId?: string) {
  if (expectedOwnerId) await assertActiveOwner(expectedOwnerId)
  const current = unwrap(await supabase.from('dostigator_areas').select('*').is('archived_at', null).order('position')) ?? []
  if (expectedOwnerId) {
    await assertActiveOwner(expectedOwnerId)
    if (current.some((row) => row.user_id !== expectedOwnerId)) throw new Error(ownerChangedMessage)
  }
  if (current.length) return current
  const timestamp = new Date().toISOString()
  const rows = defaultAreas.map((item, index) => ({
    id: crypto.randomUUID(),
    ...item,
    position: index,
    archived_at: null,
    updated_at: timestamp,
    ...(expectedOwnerId ? { user_id: expectedOwnerId } : {}),
  }))
  if (expectedOwnerId) await assertActiveOwner(expectedOwnerId)
  const result = await supabase.from('dostigator_areas').upsert(rows, {
    onConflict: 'user_id,name',
    ignoreDuplicates: true,
  }).select('*')
  const created = unwrap(result) ?? []
  if (expectedOwnerId) {
    await assertActiveOwner(expectedOwnerId)
    if (created.some((row) => row.user_id !== expectedOwnerId)) throw new Error(ownerChangedMessage)
  }
  return created
}

export async function loadAppData(expectedOwnerId?: string): Promise<AppData> {
  if (expectedOwnerId) await assertActiveOwner(expectedOwnerId)
  await ensureAreas(expectedOwnerId)
  const [areas, goals, actions, habits, checkins, reviews, focusCommitments, journals] = await Promise.all([
    supabase.from('dostigator_areas').select('*').order('position'),
    supabase.from('dostigator_goals').select('*').order('updated_at', { ascending: false }),
    supabase.from('dostigator_actions').select('*').order('created_at'),
    supabase.from('dostigator_habits').select('*').order('created_at'),
    supabase.from('dostigator_habit_checkins').select('*').order('checked_on', { ascending: false }),
    supabase.from('dostigator_weekly_reviews').select('*').order('week_start', { ascending: false }),
    supabase.from('dostigator_focus_commitments').select('*').order('committed_on'),
    supabase.from('dostigator_journals').select('*').order('date', { ascending: false }),
  ])
  const loaded = normalizeData({
    areas: unwrap(areas) ?? [],
    goals: unwrap(goals) ?? [],
    actions: unwrap(actions) ?? [],
    habits: unwrap(habits) ?? [],
    checkins: unwrap(checkins) ?? [],
    reviews: unwrap(reviews) ?? [],
    focusCommitments: unwrap(focusCommitments) ?? [],
    journals: unwrap(journals) ?? [],
  })
  if (expectedOwnerId) {
    await assertActiveOwner(expectedOwnerId)
    assertDataOwner(loaded, expectedOwnerId)
    // Earlier journal builds stored entries only in the owner-scoped cache.
    // Consult server history before adopting a missing row so an old device
    // cannot resurrect a journal entry deleted on another device.
    const remoteIds = new Set(loaded.journals?.map((row) => row.id))
    const localOnly = (readCachedData(expectedOwnerId).journals ?? [])
      .filter((row) => row.user_id === expectedOwnerId && !remoteIds.has(row.id))
    for (const entry of localOnly) {
      await assertActiveOwner(expectedOwnerId)
      const events = unwrap(await supabase.from('dostigator_history_events').select('id')
        .eq('entity_type', 'journal').eq('entity_id', entry.id).limit(1)) ?? []
      if (events.length) continue
      const mutationId = entry.last_mutation_id ?? entry.id
      const adopted: JournalEntry = { ...entry, revision: 1, last_mutation_id: mutationId }
      const result = await persistOrQueue(expectedOwnerId, 'dostigator_journals', { ...adopted }, {
        mutationId, entityType: 'journal', entityId: entry.id, operation: 'journal_create',
        label: 'Запись перенесена из локального дневника', baseRevision: 0, before: null, source: 'legacy',
      })
      if (result.status === 'failed') throw new Error('Не удалось перенести локальную запись. Она сохранена на этом устройстве.')
      loaded.journals!.push(adopted)
    }
    await assertActiveOwner(expectedOwnerId)
  }
  return loaded
}

export interface HistoryCursor {
  createdAt: string
  id: string
}

export async function loadHistoryPage(cursor: HistoryCursor | null = null, limit = 30): Promise<HistoryEvent[]> {
  const { data, error } = await supabase.rpc('dostigator_history_page', {
    p_before_created_at: cursor?.createdAt ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: limit,
  })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function loadAllHistory(expectedOwnerId: string): Promise<HistoryEvent[]> {
  await assertActiveOwner(expectedOwnerId)
  const history: HistoryEvent[] = []
  let cursor: HistoryCursor | null = null
  while (true) {
    await assertActiveOwner(expectedOwnerId)
    const page = await loadHistoryPage(cursor, 100)
    await assertActiveOwner(expectedOwnerId)
    assertHistoryOwner(page, expectedOwnerId)
    history.push(...page)
    if (page.length < 100) {
      await assertActiveOwner(expectedOwnerId)
      return history
    }
    const last = page.at(-1)
    if (!last) return history
    cursor = { createdAt: last.created_at, id: last.id }
  }
}

export function cacheData(userId: string, data: AppData) {
  localStorage.setItem(`dostigator:cache:${userId}`, JSON.stringify(data))
}

export function readCachedData(userId: string): AppData {
  try {
    const parsed = JSON.parse(localStorage.getItem(`dostigator:cache:${userId}`) ?? 'null') as Partial<AppData> | null
    if (!parsed) return emptyData()
    return normalizeData(parsed)
  } catch {
    return emptyData()
  }
}

export function makeBackup(data: AppData, history: HistoryEvent[] = [], expectedOwnerId: string): PersonalBackup {
  assertDataOwner(data, expectedOwnerId)
  assertHistoryOwner(history, expectedOwnerId)
  return {
    product: 'dostigator', version: 3, exportedAt: new Date().toISOString(), data: normalizeData(data),
    history: history.map(({ user_id: _owner, ...event }) => event),
  }
}

export function isBackup(value: unknown): value is PersonalBackup {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<PersonalBackup>
  const supportedVersion = item.version === 1 || item.version === 2 || item.version === 3
  const validHistory = item.version !== 3 || Array.isArray(item.history)
  const validFocusCommitments = item.data?.focusCommitments === undefined || Array.isArray(item.data.focusCommitments)
  const validJournals = item.data?.journals === undefined || Array.isArray(item.data.journals)
  return item.product === 'dostigator' && supportedVersion && !!item.data
    && Array.isArray(item.data.goals) && validHistory && validFocusCommitments && validJournals
}

export function stripOwnership<T extends { user_id: string }>(row: T): Omit<T, 'user_id'> {
  const { user_id: _ignored, ...safe } = row
  return safe
}

function withExpectedOwner<T extends { user_id: string }>(row: T, expectedOwnerId: string): T {
  return { ...row, user_id: expectedOwnerId }
}

export interface BackupPreview {
  counts: { areas: number; goals: number; actions: number; habits: number; checkins: number; reviews: number; focusCommitments: number; journals: number }
  total: number
  idMatches: number
  areaNameMatches: number
  areaIdentityConflicts: number
  dependencyConflicts: number
  conflicts: number
}

export function previewBackup(backup: PersonalBackup, current: AppData): BackupPreview {
  const normalized = normalizeData(backup.data)
  assertImportRows(normalized)
  const counts = {
    areas: normalized.areas.length,
    goals: normalized.goals.length,
    actions: normalized.actions.length,
    habits: normalized.habits.length,
    checkins: normalized.checkins.length,
    reviews: normalized.reviews.length,
    focusCommitments: normalized.focusCommitments?.length ?? 0,
    journals: normalized.journals?.length ?? 0,
  }
  const groups = [
    [normalized.areas, current.areas], [normalized.goals, current.goals],
    [normalized.actions, current.actions], [normalized.habits, current.habits],
    [normalized.checkins, current.checkins], [normalized.reviews, current.reviews],
    [normalized.focusCommitments ?? [], current.focusCommitments ?? []],
    [normalized.journals ?? [], current.journals ?? []],
  ] as const
  const idMatches = groups.reduce((sum, [incoming, existing]) => {
    const ids = new Set(existing.map((row) => row.id))
    return sum + incoming.filter((row) => ids.has(row.id)).length
  }, 0)
  const currentAreasById = new Map(current.areas.map((area) => [area.id, area]))
  const currentAreasByName = new Map(current.areas.map((area) => [area.name.trim(), area]))
  let areaNameMatches = 0
  let areaIdentityConflicts = 0
  for (const area of normalized.areas) {
    const byId = currentAreasById.get(area.id)
    const byName = currentAreasByName.get(area.name.trim())
    if (byName && byName.id !== area.id) areaNameMatches += 1
    if (byId && byName && byId.id !== byName.id) areaIdentityConflicts += 1
  }
  const areaIds = new Set(normalized.areas.map((area) => area.id))
  const goalIds = new Set(normalized.goals.map((goal) => goal.id))
  const actionIds = new Set(normalized.actions.map((action) => action.id))
  const habitIds = new Set(normalized.habits.map((habit) => habit.id))
  const dependencyConflicts = normalized.goals.filter((goal) => goal.area_id && !areaIds.has(goal.area_id)).length
    + normalized.habits.filter((habit) => habit.area_id && !areaIds.has(habit.area_id)).length
    + normalized.actions.filter((action) => !goalIds.has(action.goal_id)).length
    + normalized.checkins.filter((checkin) => !habitIds.has(checkin.habit_id)).length
    + (normalized.focusCommitments ?? []).filter((commitment) => !actionIds.has(commitment.action_id)).length
  return {
    counts,
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    idMatches,
    areaNameMatches,
    areaIdentityConflicts,
    dependencyConflicts,
    conflicts: areaIdentityConflicts + dependencyConflicts,
  }
}

export async function importBackup(
  backup: PersonalBackup,
  expectedOwnerId: string,
  guard: RepositoryOperationGuard,
  importId: string = crypto.randomUUID(),
) {
  // backup.history is a portable, read-only archive. It is deliberately never
  // inserted: every restored product row produces a fresh authoritative import
  // event owned by the active account. Focus commitments are restored as an
  // owner-bound ledger and cannot forge the server mutation history.
  await assertOperationAllowed(expectedOwnerId, guard)
  const normalized = normalizeData(backup.data)
  assertImportRows(normalized)
  await assertOperationAllowed(expectedOwnerId, guard)
  const payload = {
    areas: normalized.areas.map((row) => withExpectedOwner(row, expectedOwnerId)),
    goals: normalized.goals.map((row) => withExpectedOwner(row, expectedOwnerId)),
    actions: normalized.actions.map((row) => withExpectedOwner(row, expectedOwnerId)),
    habits: normalized.habits.map((row) => withExpectedOwner(row, expectedOwnerId)),
    checkins: normalized.checkins.map((row) => withExpectedOwner(row, expectedOwnerId)),
    reviews: normalized.reviews.map((row) => withExpectedOwner(row, expectedOwnerId)),
    focusCommitments: (normalized.focusCommitments ?? []).map((row) => withExpectedOwner(row, expectedOwnerId)),
    journals: (normalized.journals ?? []).map((row) => withExpectedOwner(row, expectedOwnerId)),
  }
  const { error } = await supabase.rpc('dostigator_import_backup', {
    p_expected_owner: expectedOwnerId,
    p_import_id: importId,
    p_payload: payload,
  })
  if (error) throw new Error(error.message)
  await assertOperationAllowed(expectedOwnerId, guard)
}

export function areaFor(areas: Area[], areaId: string | null) {
  return areas.find((item) => item.id === areaId)
}
