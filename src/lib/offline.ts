import { supabase } from './supabase'
import type {
  HistoryEntityType, HistoryEvent, HistoryOperation, MutationDescriptor, PendingOperation, TableName,
} from '../types'

const legacyQueueKey = 'dostigator:sync-queue:v1'
const legacyQuarantineKey = 'dostigator:sync-queue:legacy-quarantine:v1'
const v2QueueKey = (ownerId: string) => `dostigator:sync-queue:v2:${ownerId}`
const queueKey = (ownerId: string) => `dostigator:sync-queue:v3:${ownerId}`
const corruptQueueKey = (ownerId: string) => `dostigator:sync-queue:corrupt-quarantine:v3:${ownerId}`
const recoveryQueueKey = (ownerId: string) => `dostigator:sync-queue:recovery-quarantine:v3:${ownerId}`
const activeFlushes = new Map<string, Promise<FlushResult>>()
const localLockTails = new Map<string, Promise<void>>()
const fallbackLockId = crypto.randomUUID()
const fallbackLockPrefix = 'dostigator:sync-queue:lock:v1:'
const queueLockName = 'dostigator:sync-queue:v3'
const fallbackLockLeaseMs = 10_000
let queueLockDepth = 0
let verifiedQueueOwner: string | null = null

const tableEntities: Partial<Record<TableName, HistoryEntityType>> = {
  dostigator_goals: 'goal',
  dostigator_actions: 'action',
  dostigator_habits: 'habit',
  dostigator_habit_checkins: 'habit_checkin',
  dostigator_weekly_reviews: 'review',
}

const entityOperations: Record<HistoryEntityType, ReadonlySet<Exclude<HistoryOperation, 'undo'>>> = {
  goal: new Set(['goal_create', 'goal_edit', 'goal_pause', 'goal_resume', 'goal_complete', 'legacy_upsert']),
  action: new Set(['action_create', 'action_edit', 'action_complete', 'action_reopen', 'action_delete', 'focus_add', 'focus_remove', 'legacy_upsert']),
  habit: new Set(['habit_create', 'habit_edit', 'habit_pause', 'habit_resume', 'legacy_upsert']),
  habit_checkin: new Set(['habit_check', 'habit_uncheck', 'legacy_upsert', 'legacy_delete']),
  review: new Set(['review_create', 'review_edit', 'legacy_upsert']),
}

type StoredPendingOperation = PendingOperation & { source?: 'undo' | 'offline' }

export interface QueueStats {
  pending: number
  failed: number
  quarantined: number
  legacyQuarantined: boolean
}

export interface FlushResult extends QueueStats {
  completed: number
}

export interface PersistenceResult {
  mutationId: string
  status: 'synced' | 'pending' | 'failed'
  event: HistoryEvent | null
}

interface QuarantineEntry {
  capturedAt: string
  source: string
  raw: string
}

interface LegacyV2Operation {
  id: string
  ownerId: string
  table: TableName
  type: 'upsert' | 'delete'
  payload?: Record<string, unknown>
  rowId?: string
  createdAt: string
  state: 'pending' | 'failed'
  attempts: number
  lastError: string | null
}

function appendQuarantine(ownerId: string, key: string, source: string, raw: string) {
  if (queueLockDepth === 0 || verifiedQueueOwner !== ownerId) {
    throw new Error('Изменение карантина требует owner-aware блокировки очереди')
  }
  assertFallbackLock()
  const stored = localStorage.getItem(key)
  let entries: QuarantineEntry[] = []
  if (stored !== null) {
    try {
      const parsed: unknown = JSON.parse(stored)
      entries = Array.isArray(parsed) ? parsed as QuarantineEntry[] : []
    } catch {
      entries = [{ capturedAt: new Date().toISOString(), source: 'previous-quarantine', raw: stored }]
    }
  }
  entries.push({ capturedAt: new Date().toISOString(), source, raw })
  localStorage.setItem(key, JSON.stringify(entries))
}

function quarantineLegacyQueue(ownerId: string) {
  const legacy = localStorage.getItem(legacyQueueKey)
  if (legacy === null) return
  appendQuarantine(ownerId, legacyQuarantineKey, 'legacy-v1', legacy)
  assertFallbackLock()
  localStorage.removeItem(legacyQueueKey)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function isStringWithin(value: unknown, minimum: number, maximum: number): value is string {
  if (typeof value !== 'string') return false
  const length = Array.from(value.trim()).length
  return length >= minimum && length <= maximum
}

function isIntegerWithin(value: unknown, minimum: number, maximum: number) {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
}

function isDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.includes('T') && !Number.isNaN(Date.parse(value))
}

function isNullableDate(value: unknown) {
  return value === null || isDateString(value)
}

function isNullableTimestamp(value: unknown) {
  return value === null || isTimestamp(value)
}

function isNullableId(value: unknown) {
  return value === null || isUuid(value)
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => sameJson(value, right[index]))
  }
  if (!isRecord(left) || !isRecord(right)) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && sameJson(left[key], right[key]))
}

function hasValidOptionalMetadata(value: Record<string, unknown>, ownerId: string) {
  return (value.user_id === undefined || value.user_id === ownerId)
    && (value.revision === undefined || isIntegerWithin(value.revision, 0, Number.MAX_SAFE_INTEGER))
    && (value.last_mutation_id === undefined || value.last_mutation_id === null || isUuid(value.last_mutation_id))
    && (value.created_at === undefined || isTimestamp(value.created_at))
    && (value.updated_at === undefined || isTimestamp(value.updated_at))
}

function hasFullRowMetadata(value: Record<string, unknown>, ownerId: string, updatedAtRequired: boolean) {
  return hasValidOptionalMetadata(value, ownerId)
    && isTimestamp(value.created_at)
    && (!updatedAtRequired || isTimestamp(value.updated_at))
    && isIntegerWithin(value.revision, 0, Number.MAX_SAFE_INTEGER)
    && (value.last_mutation_id === null || isUuid(value.last_mutation_id))
}

function isActivityPeriods(value: unknown, active: boolean) {
  if (!Array.isArray(value) || value.length === 0) return false
  let openPeriods = 0
  let previousEnd: string | null = null
  const valid = value.every((period, index) => {
    if (!isRecord(period) || !isDateString(period.started_on) || !isNullableDate(period.ended_on)) return false
    if (period.ended_on !== null && period.ended_on < period.started_on) return false
    if (period.ended_on === null) openPeriods += 1
    if (openPeriods > 1 || period.ended_on === null && index !== value.length - 1) return false
    if (previousEnd !== null && period.started_on < previousEnd) return false
    previousEnd = typeof period.ended_on === 'string' ? period.ended_on : null
    return true
  })
  return valid && openPeriods === (active ? 1 : 0)
}

function isRateBreakdown(value: unknown, extraKey: 'committed' | 'expected' | 'target') {
  return isRecord(value)
    && isIntegerWithin(value.done, 0, Number.MAX_SAFE_INTEGER)
    && typeof value.rate === 'number' && Number.isFinite(value.rate) && value.rate >= 0 && value.rate <= 1
    && isIntegerWithin(value[extraKey], 0, Number.MAX_SAFE_INTEGER)
}

function dateAfterDays(value: string, days: number) {
  const result = new Date(`${value}T00:00:00.000Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

function utcDateFromTimestamp(value: unknown) {
  return isTimestamp(value) ? new Date(value).toISOString().slice(0, 10) : null
}

function isWeeklyMetrics(value: unknown, weekStart: string) {
  if (!isRecord(value) || !(value.score === null
    || typeof value.score === 'number' && Number.isFinite(value.score) && value.score >= 0 && value.score <= 100)
    || !(value.focus === null || isRateBreakdown(value.focus, 'committed'))
    || !(value.habits === null || isRateBreakdown(value.habits, 'expected'))
    || !(value.actions === null || isRateBreakdown(value.actions, 'target'))
    || !isRecord(value.period) || value.period.weekStart !== weekStart || !isDateString(value.period.asOf)) return false
  return value.period.asOf >= weekStart && value.period.asOf <= dateAfterDays(weekStart, 6)
}

function isGoalSnapshot(value: Record<string, unknown>, ownerId: string, entityId: string) {
  return value.id === entityId && hasValidOptionalMetadata(value, ownerId)
    && isNullableId(value.area_id) && isStringWithin(value.title, 1, 140)
    && isStringWithin(value.description, 0, 2000) && isStringWithin(value.why, 0, 1000)
    && (value.kind === 'goal' || value.kind === 'project')
    && (value.status === 'active' || value.status === 'paused' || value.status === 'completed' || value.status === 'archived')
    && isIntegerWithin(value.progress, 0, 100) && isNullableDate(value.target_date)
    && isNullableTimestamp(value.completed_at)
}

function isActionSnapshot(value: Record<string, unknown>, ownerId: string, entityId: string) {
  const focusPair = value.focus_date === null && value.focus_position === null
    || isDateString(value.focus_date) && isIntegerWithin(value.focus_position, 1, 3)
  return value.id === entityId && hasValidOptionalMetadata(value, ownerId)
    && isUuid(value.goal_id) && isStringWithin(value.title, 1, 240)
    && (value.status === 'todo' || value.status === 'done' || value.status === 'cancelled')
    && isNullableDate(value.due_date) && focusPair
    && isStringWithin(value.result_note, 0, 1500) && isNullableTimestamp(value.completed_at)
}

function isHabitSnapshot(value: Record<string, unknown>, ownerId: string, entityId: string) {
  return value.id === entityId && hasValidOptionalMetadata(value, ownerId)
    && isNullableId(value.area_id) && isStringWithin(value.title, 1, 140)
    && isIntegerWithin(value.target_per_week, 1, 7) && typeof value.active === 'boolean'
    && isActivityPeriods(value.activity_periods, value.active)
}

function isCheckinSnapshot(value: Record<string, unknown>, ownerId: string, entityId: string) {
  return value.id === entityId && hasValidOptionalMetadata(value, ownerId)
    && isUuid(value.habit_id) && isDateString(value.checked_on)
    && isStringWithin(value.note, 0, 500)
}

function isReviewSnapshot(value: Record<string, unknown>, ownerId: string, entityId: string) {
  return value.id === entityId && hasValidOptionalMetadata(value, ownerId)
    && isDateString(value.week_start) && new Date(`${value.week_start}T00:00:00.000Z`).getUTCDay() === 1
    && isStringWithin(value.wins, 0, 3000)
    && isStringWithin(value.blockers, 0, 3000) && isStringWithin(value.next_focus, 0, 2000)
    && (value.self_score === null || isIntegerWithin(value.self_score, 1, 10))
    && (value.metrics_snapshot === null || isWeeklyMetrics(value.metrics_snapshot, value.week_start))
}

function isEntitySnapshot(
  entityType: HistoryEntityType,
  value: unknown,
  ownerId: string,
  entityId: string,
): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  switch (entityType) {
    case 'goal': return isGoalSnapshot(value, ownerId, entityId)
    case 'action': return isActionSnapshot(value, ownerId, entityId)
    case 'habit': return isHabitSnapshot(value, ownerId, entityId)
    case 'habit_checkin': return isCheckinSnapshot(value, ownerId, entityId)
    case 'review': return isReviewSnapshot(value, ownerId, entityId)
  }
}

function isFullEntityRow(
  entityType: HistoryEntityType,
  value: Record<string, unknown>,
  ownerId: string,
  entityId: string,
) {
  return isEntitySnapshot(entityType, value, ownerId, entityId)
    && hasFullRowMetadata(value, ownerId, entityType !== 'habit_checkin')
}

function isCreateOperation(operation: Exclude<HistoryOperation, 'undo'>) {
  return operation === 'goal_create' || operation === 'action_create' || operation === 'habit_create'
    || operation === 'habit_check' || operation === 'review_create'
}

function isMutationDescriptor(value: unknown, ownerId: string): value is MutationDescriptor {
  if (!isRecord(value)) return false
  if (!isUuid(value.mutationId) || !isUuid(value.entityId)
    || !isStringWithin(value.label, 1, 180)
    || !Number.isSafeInteger(value.baseRevision) || Number(value.baseRevision) < 0
    || !isNonEmptyString(value.entityType) || !isNonEmptyString(value.operation)
    || !Object.prototype.hasOwnProperty.call(entityOperations, value.entityType)
    || !entityOperations[value.entityType as HistoryEntityType].has(value.operation as Exclude<HistoryOperation, 'undo'>)
    || !(value.before === null || isRecord(value.before))) return false
  if (value.source !== undefined
    && (typeof value.source !== 'string' || !['ui', 'offline', 'import', 'legacy'].includes(value.source))) return false
  const entityType = value.entityType as HistoryEntityType
  const operation = value.operation as Exclude<HistoryOperation, 'undo'>
  if (value.before !== null && !isEntitySnapshot(entityType, value.before, ownerId, value.entityId)) return false
  if (isRecord(value.before) && value.before.revision !== undefined && value.before.revision !== value.baseRevision) return false
  if (isCreateOperation(operation)) return value.baseRevision === 0 && value.before === null
  if (operation === 'legacy_upsert') return true
  return value.before !== null
}

function hasNextRevision(payload: Record<string, unknown>, mutation: MutationDescriptor) {
  return payload.revision === mutation.baseRevision + 1 && payload.last_mutation_id === mutation.mutationId
}

function fieldsMatch(
  payload: Record<string, unknown>,
  before: Record<string, unknown>,
  fields: readonly string[],
) {
  return fields.every((field) => sameJson(payload[field], before[field]))
}

function isHabitPausePeriods(before: unknown, after: unknown) {
  if (!Array.isArray(before) || !Array.isArray(after) || before.length === 0 || after.length !== before.length) return false
  const lastIndex = before.length - 1
  const previousOpen = before[lastIndex]
  const closed = after[lastIndex]
  return isRecord(previousOpen) && isRecord(closed)
    && previousOpen.ended_on === null && isDateString(closed.ended_on)
    && isDateString(previousOpen.started_on) && closed.ended_on >= previousOpen.started_on
    && previousOpen.started_on === closed.started_on
    && sameJson(before.slice(0, lastIndex), after.slice(0, lastIndex))
}

function isHabitResumePeriods(before: unknown, after: unknown) {
  if (!Array.isArray(before) || !Array.isArray(after) || after.length !== before.length + 1) return false
  const opened = after[after.length - 1]
  const lastClosed = before.at(-1)
  return before.every((period) => isRecord(period) && period.ended_on !== null)
    && isRecord(opened) && isDateString(opened.started_on) && opened.ended_on === null
    && (!isRecord(lastClosed) || isDateString(lastClosed.ended_on) && opened.started_on >= lastClosed.ended_on)
    && sameJson(before, after.slice(0, -1))
}

function isPayloadForMutation(
  ownerId: string,
  table: TableName,
  payload: Record<string, unknown>,
  mutation: MutationDescriptor,
) {
  if (tableEntities[table] !== mutation.entityType
    || !isFullEntityRow(mutation.entityType, payload, ownerId, mutation.entityId)) return false
  const before = mutation.before
  if (mutation.operation === 'legacy_upsert') {
    const canonicalState = mutation.entityType === 'goal'
      ? payload.status === 'completed'
        ? payload.progress === 100 && isTimestamp(payload.completed_at)
        : payload.completed_at === null
      : mutation.entityType === 'action'
        ? payload.status === 'done'
          ? isTimestamp(payload.completed_at)
          : payload.completed_at === null && (payload.status !== 'cancelled'
            || payload.focus_date === null && payload.focus_position === null)
        : true
    return canonicalState
      && (payload.revision === mutation.baseRevision || payload.revision === mutation.baseRevision + 1)
  }
  if (mutation.operation === 'legacy_delete') {
    return mutation.entityType === 'habit_checkin' && before !== null && payload.revision === mutation.baseRevision
      && sameJson(payload.habit_id, before.habit_id) && sameJson(payload.checked_on, before.checked_on)
  }
  if (mutation.operation === 'habit_uncheck') {
    return before !== null && payload.revision === mutation.baseRevision
      && ['habit_id', 'checked_on', 'note'].every((key) => sameJson(payload[key], before[key]))
  }
  if (!hasNextRevision(payload, mutation)) return false
  switch (mutation.operation) {
    case 'goal_create':
      return payload.status === 'active' && payload.completed_at === null
    case 'goal_edit':
      return before !== null && payload.status === before.status && payload.completed_at === before.completed_at
    case 'goal_pause':
      return before !== null && before.status !== 'paused'
        && payload.status === 'paused' && payload.completed_at === null
        && fieldsMatch(payload, before, ['area_id', 'title', 'description', 'why', 'kind', 'progress', 'target_date'])
    case 'goal_resume':
      return before !== null && before.status !== 'active'
        && payload.status === 'active' && payload.progress === 0 && payload.completed_at === null
        && fieldsMatch(payload, before, ['area_id', 'title', 'description', 'why', 'kind', 'target_date'])
    case 'goal_complete':
      return before !== null && before.status !== 'completed'
        && payload.status === 'completed' && payload.progress === 100 && isTimestamp(payload.completed_at)
        && fieldsMatch(payload, before, ['area_id', 'title', 'description', 'why', 'kind', 'target_date'])
    case 'action_create':
      return payload.status === 'todo' && payload.completed_at === null
    case 'action_edit':
      return before !== null && payload.goal_id === before.goal_id && payload.status === before.status
        && payload.focus_date === before.focus_date && payload.focus_position === before.focus_position
        && payload.completed_at === before.completed_at
    case 'action_complete':
      return before !== null && before.status === 'todo'
        && payload.status === 'done' && isTimestamp(payload.completed_at)
        && fieldsMatch(payload, before, ['goal_id', 'title', 'due_date', 'focus_date', 'focus_position'])
    case 'action_reopen':
      return before !== null && before.status === 'done'
        && payload.status === 'todo' && payload.result_note === '' && payload.completed_at === null
        && fieldsMatch(payload, before, ['goal_id', 'title', 'due_date', 'focus_date', 'focus_position'])
    case 'action_delete':
      return before !== null && payload.status === 'cancelled'
        && payload.focus_date === null && payload.focus_position === null && payload.completed_at === null
        && fieldsMatch(payload, before, ['goal_id', 'title', 'due_date', 'result_note'])
    case 'focus_add':
      return before !== null && before.status === 'todo' && payload.status === 'todo'
        && isDateString(payload.focus_date) && isIntegerWithin(payload.focus_position, 1, 3)
        && before.focus_date !== payload.focus_date
        && fieldsMatch(payload, before, ['goal_id', 'title', 'due_date', 'result_note', 'completed_at'])
    case 'focus_remove':
      return before !== null && before.status === 'todo' && payload.status === 'todo'
        && isDateString(before.focus_date) && isIntegerWithin(before.focus_position, 1, 3)
        && payload.focus_date === null && payload.focus_position === null
        && fieldsMatch(payload, before, ['goal_id', 'title', 'due_date', 'result_note', 'completed_at'])
    case 'habit_create':
      return payload.active === true && Array.isArray(payload.activity_periods)
        && payload.activity_periods.some((period) => isRecord(period) && period.ended_on === null)
    case 'habit_edit':
      return before !== null && payload.active === before.active
        && sameJson(payload.activity_periods, before.activity_periods)
    case 'habit_pause':
      return before !== null && before.active === true && payload.active === false
        && isHabitPausePeriods(before.activity_periods, payload.activity_periods)
        && fieldsMatch(payload, before, ['area_id', 'title', 'target_per_week'])
    case 'habit_resume':
      return before !== null && before.active === false && payload.active === true
        && isHabitResumePeriods(before.activity_periods, payload.activity_periods)
        && fieldsMatch(payload, before, ['area_id', 'title', 'target_per_week'])
    case 'habit_check':
      return true
    case 'review_create':
      return payload.metrics_snapshot !== null
    case 'review_edit':
      return before !== null && payload.week_start === before.week_start
        && sameJson(payload.metrics_snapshot, before.metrics_snapshot)
  }
}

function isMutationEnvelope(
  ownerId: string,
  table: TableName,
  payload: Record<string, unknown>,
  mutation: unknown,
): mutation is MutationDescriptor {
  return isNonEmptyString(ownerId)
    && isMutationDescriptor(mutation, ownerId) && isPayloadForMutation(ownerId, table, payload, mutation)
}

function isPendingOperation(value: unknown, expectedOwnerId: string): value is StoredPendingOperation {
  if (!isRecord(value)) return false
  const common = isNonEmptyString(expectedOwnerId) && isUuid(value.id)
    && value.ownerId === expectedOwnerId
    && (value.type === 'mutation' || value.type === 'undo')
    && isUuid(value.mutationId)
    && isStringWithin(value.label, 1, 180)
    && isNonEmptyString(value.createdAt)
    && !Number.isNaN(Date.parse(value.createdAt))
    && (value.state === 'pending' || value.state === 'failed')
    && Number.isSafeInteger(value.attempts) && Number(value.attempts) >= 0
    && (value.lastError === null || typeof value.lastError === 'string')
  if (!common) return false
  if (value.type === 'undo') {
    return isUuid(value.originalMutationId)
      && isMutationDescriptor(value.mutation, expectedOwnerId)
      && value.originalMutationId === value.mutation.mutationId
      && value.mutationId !== value.originalMutationId
      && (value.source === undefined || value.source === 'undo' || value.source === 'offline')
  }
  if (!isNonEmptyString(value.table) || !isRecord(value.payload)
    || !isMutationEnvelope(expectedOwnerId, value.table as TableName, value.payload, value.mutation)) return false
  return value.mutationId === value.mutation.mutationId && value.label === value.mutation.label
}

function isLegacyV2Operation(value: unknown): value is LegacyV2Operation {
  if (!isRecord(value)) return false
  return isUuid(value.id) && isNonEmptyString(value.ownerId)
    && typeof value.table === 'string' && (value.type === 'upsert' || value.type === 'delete')
    && isNonEmptyString(value.createdAt) && !Number.isNaN(Date.parse(value.createdAt))
    && (value.state === 'pending' || value.state === 'failed')
    && Number.isSafeInteger(value.attempts) && Number(value.attempts) >= 0
    && (value.lastError === null || typeof value.lastError === 'string')
}

function storedItemCount(raw: string | null) {
  if (raw === null) return 0
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return 1
    return parsed.reduce((total, value) => {
      if (!isRecord(value) || typeof value.raw !== 'string') return total + 1
      try {
        const captured: unknown = JSON.parse(value.raw)
        return total + (Array.isArray(captured) ? Math.max(1, captured.length) : 1)
      } catch { return total + 1 }
    }, 0)
  } catch { return 1 }
}

interface FallbackLockRecord {
  id: string
  epoch: string
  choosing: boolean
  ticket: number
  expiresAt: number
}

interface HeldFallbackLock {
  key: string
  epoch: string
  ticket: number
  deadline: number
  lost: boolean
}

let heldFallbackLock: HeldFallbackLock | null = null

function fallbackRecord(value: unknown): FallbackLockRecord | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !isUuid(value.epoch) || typeof value.choosing !== 'boolean'
    || !Number.isSafeInteger(value.ticket) || Number(value.ticket) < 0
    || typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt)) return null
  return value as unknown as FallbackLockRecord
}

function fallbackContenders(now = Date.now()) {
  const contenders: Array<{ key: string; record: FallbackLockRecord }> = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key?.startsWith(fallbackLockPrefix)) continue
    const raw = localStorage.getItem(key)
    let record: FallbackLockRecord | null = null
    try { record = fallbackRecord(raw === null ? null : JSON.parse(raw)) } catch { /* Invalid lock records expire below. */ }
    if (!record || record.expiresAt <= now) {
      if (localStorage.getItem(key) === raw) localStorage.removeItem(key)
      index -= 1
      continue
    }
    contenders.push({ key, record })
  }
  return contenders
}

function writeFallbackRecord(key: string, epoch: string, choosing: boolean, ticket: number, expiresAt: number) {
  const record: FallbackLockRecord = {
    id: fallbackLockId,
    epoch,
    choosing,
    ticket,
    expiresAt,
  }
  localStorage.setItem(key, JSON.stringify(record))
}

function waitForFallbackTurn() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 4))
}

function fallbackRecordAt(key: string) {
  const raw = localStorage.getItem(key)
  let record: FallbackLockRecord | null = null
  try { record = fallbackRecord(raw === null ? null : JSON.parse(raw)) } catch { /* Treat as lost. */ }
  return { raw, record }
}

function ownsFallbackRecord(lock: Pick<HeldFallbackLock, 'epoch' | 'ticket'>, record: FallbackLockRecord | null) {
  return record?.id === fallbackLockId && record.epoch === lock.epoch && record.ticket === lock.ticket
}

function loseFallbackLock(lock: HeldFallbackLock) {
  lock.lost = true
}

function renewFallbackLock(lock: HeldFallbackLock) {
  const now = Date.now()
  if (lock.lost || now >= lock.deadline) {
    loseFallbackLock(lock)
    return false
  }
  const { raw, record } = fallbackRecordAt(lock.key)
  if (!ownsFallbackRecord(lock, record) || !record || record.expiresAt <= now) {
    loseFallbackLock(lock)
    return false
  }
  const deadline = now + fallbackLockLeaseMs
  try {
    if (localStorage.getItem(lock.key) !== raw) {
      loseFallbackLock(lock)
      return false
    }
    writeFallbackRecord(lock.key, lock.epoch, false, lock.ticket, deadline)
    lock.deadline = deadline
    return true
  } catch {
    loseFallbackLock(lock)
    return false
  }
}

function assertFallbackLock() {
  if (!heldFallbackLock) return
  const now = Date.now()
  const { record } = fallbackRecordAt(heldFallbackLock.key)
  if (heldFallbackLock.lost || now >= heldFallbackLock.deadline
    || !ownsFallbackRecord(heldFallbackLock, record) || !record || record.expiresAt <= now) {
    loseFallbackLock(heldFallbackLock)
    throw new Error('Межвкладочная блокировка очереди потеряна')
  }
}

async function acquireFallbackLock() {
  const key = `${fallbackLockPrefix}${fallbackLockId}`
  const epoch = crypto.randomUUID()
  let deadline = Date.now() + fallbackLockLeaseMs
  writeFallbackRecord(key, epoch, true, 0, deadline)
  const contenders = fallbackContenders()
  const choosingNow = Date.now()
  const choosingCandidate = { epoch, ticket: 0 }
  const { raw: choosingRaw, record: choosingRecord } = fallbackRecordAt(key)
  if (choosingNow >= deadline || !ownsFallbackRecord(choosingCandidate, choosingRecord)
    || !choosingRecord || choosingRecord.expiresAt <= choosingNow) {
    if (ownsFallbackRecord(choosingCandidate, choosingRecord) && localStorage.getItem(key) === choosingRaw) {
      localStorage.removeItem(key)
    }
    throw new Error('Межвкладочная блокировка очереди потеряна')
  }
  const ticket = Math.max(0, ...contenders.map(({ record }) => record.ticket)) + 1
  deadline = choosingNow + fallbackLockLeaseMs
  if (localStorage.getItem(key) !== choosingRaw) {
    throw new Error('Межвкладочная блокировка очереди потеряна')
  }
  writeFallbackRecord(key, epoch, false, ticket, deadline)
  while (true) {
    const now = Date.now()
    const candidate = { epoch, ticket }
    const { raw, record } = fallbackRecordAt(key)
    if (now >= deadline || !ownsFallbackRecord(candidate, record) || !record || record.expiresAt <= now) {
      if (ownsFallbackRecord(candidate, record) && localStorage.getItem(key) === raw) localStorage.removeItem(key)
      throw new Error('Межвкладочная блокировка очереди потеряна')
    }
    if (localStorage.getItem(key) !== raw) throw new Error('Межвкладочная блокировка очереди потеряна')
    const nextDeadline = now + fallbackLockLeaseMs
    writeFallbackRecord(key, epoch, false, ticket, nextDeadline)
    deadline = nextDeadline
    const blocked = fallbackContenders().some(({ key: otherKey, record }) => otherKey !== key && (
      record.choosing || record.ticket < ticket || record.ticket === ticket && record.id < fallbackLockId
    ))
    if (!blocked) {
      const acquiredNow = Date.now()
      const { raw: acquiredRaw, record: acquiredRecord } = fallbackRecordAt(key)
      if (acquiredNow >= deadline || !ownsFallbackRecord(candidate, acquiredRecord)
        || !acquiredRecord || acquiredRecord.expiresAt <= acquiredNow) {
        if (ownsFallbackRecord(candidate, acquiredRecord) && localStorage.getItem(key) === acquiredRaw) {
          localStorage.removeItem(key)
        }
        throw new Error('Межвкладочная блокировка очереди потеряна')
      }
      break
    }
    await waitForFallbackTurn()
  }
  const lock: HeldFallbackLock = { key, epoch, ticket, deadline, lost: false }
  heldFallbackLock = lock
  const heartbeat = window.setInterval(() => {
    renewFallbackLock(lock)
  }, Math.floor(fallbackLockLeaseMs / 3))
  return () => {
    window.clearInterval(heartbeat)
    if (heldFallbackLock === lock) heldFallbackLock = null
    const { raw, record } = fallbackRecordAt(key)
    if (ownsFallbackRecord(lock, record) && localStorage.getItem(key) === raw) localStorage.removeItem(key)
  }
}

async function withQueueLock<T>(operation: () => T | Promise<T>): Promise<T> {
  const previous = localLockTails.get(queueLockName) ?? Promise.resolve()
  let releaseTurn!: () => void
  const turn = new Promise<void>((resolve) => { releaseTurn = resolve })
  const tail = previous.catch(() => undefined).then(() => turn)
  localLockTails.set(queueLockName, tail)
  void tail.then(() => { if (localLockTails.get(queueLockName) === tail) localLockTails.delete(queueLockName) })
  await previous.catch(() => undefined)
  const run = async () => {
    queueLockDepth += 1
    try { return await operation() } finally { queueLockDepth -= 1 }
  }
  try {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
    if (locks && typeof locks.request === 'function') {
      return await locks.request(queueLockName, { mode: 'exclusive' }, run)
    }
    const releaseFallback = await acquireFallbackLock()
    try { return await run() } finally { releaseFallback() }
  } finally {
    releaseTurn()
  }
}

async function withOwnerQueueLock<T>(
  ownerId: string,
  operation: () => T | Promise<T>,
  resource: 'Очередь' | 'Карантин' | 'Операция' = 'Очередь',
): Promise<T> {
  return withQueueLock(async () => {
    await assertActiveOwner(ownerId, resource)
    const previousOwner = verifiedQueueOwner
    verifiedQueueOwner = ownerId
    try { return await operation() } finally { verifiedQueueOwner = previousOwner }
  })
}

function writeQueue(ownerId: string, queue: StoredPendingOperation[]) {
  if (queueLockDepth === 0 || verifiedQueueOwner !== ownerId) {
    throw new Error('Запись очереди требует owner-aware межвкладочной блокировки')
  }
  assertFallbackLock()
  localStorage.setItem(queueKey(ownerId), JSON.stringify(queue))
  window.dispatchEvent(new Event('dostigator:queue'))
}

function quarantineV2(ownerId: string, source: string, raw: string) {
  appendQuarantine(ownerId, corruptQueueKey(ownerId), source, raw)
  // Keep the only durable copy until the complete capture has been persisted.
  assertFallbackLock()
  localStorage.removeItem(v2QueueKey(ownerId))
}

function migrateV2(ownerId: string, persist: boolean): StoredPendingOperation[] {
  const raw = localStorage.getItem(v2QueueKey(ownerId))
  if (raw === null) return []
  let values: unknown
  try { values = JSON.parse(raw) } catch { values = null }
  if (!Array.isArray(values) || !values.every(isLegacyV2Operation)) {
    if (persist) quarantineV2(ownerId, 'invalid-v2', raw)
    return []
  }
  const migrated: StoredPendingOperation[] = []
  for (const item of values) {
    const entityType = tableEntities[item.table]
    const payloadId = item.payload?.id
    if (!entityType || item.ownerId !== ownerId || !isUuid(payloadId) || item.type !== 'upsert') {
      if (persist) quarantineV2(ownerId, 'unsupported-v2-queue', raw)
      return []
    }
    const payload: Record<string, unknown> = {
      ...item.payload,
      revision: item.payload?.revision === undefined ? 0 : item.payload.revision,
      last_mutation_id: item.payload?.last_mutation_id === undefined ? item.id : item.payload.last_mutation_id,
    }
    if (entityType === 'habit' && payload.activity_periods === undefined) {
      const startedOn = utcDateFromTimestamp(payload.created_at)
      const endedOn = payload.active === true ? null : utcDateFromTimestamp(payload.updated_at)
      if (startedOn !== null && (payload.active === true || endedOn !== null)) {
        payload.activity_periods = [{ started_on: startedOn, ended_on: endedOn }]
      }
    }
    if (entityType === 'review' && payload.metrics_snapshot === undefined) payload.metrics_snapshot = null
    const baseRevision = typeof payload.revision === 'number' ? payload.revision : 0
    const descriptor: MutationDescriptor = {
      mutationId: item.id,
      entityType,
      entityId: payloadId,
      operation: 'legacy_upsert',
      label: 'Перенесённое локальное изменение',
      baseRevision,
      before: null,
      source: 'legacy',
    }
    migrated.push({
      id: item.id, ownerId, type: 'mutation', table: item.table, payload,
      mutation: descriptor, mutationId: item.id, label: descriptor.label,
      createdAt: item.createdAt, state: item.state, attempts: item.attempts, lastError: item.lastError,
    })
  }
  if (!migrated.every((item) => isPendingOperation(item, ownerId))) {
    if (persist) quarantineV2(ownerId, 'unsupported-v2-queue', raw)
    return []
  }
  if (!persist) return migrated
  // localStorage writes are atomic. Do not remove v2 until the complete v3
  // representation is durable; a quota failure must leave the original intact.
  writeQueue(ownerId, migrated)
  assertFallbackLock()
  localStorage.removeItem(v2QueueKey(ownerId))
  return migrated
}

function readQueueFromStorage(ownerId: string, maintain: boolean): StoredPendingOperation[] {
  if (maintain) quarantineLegacyQueue(ownerId)
  const raw = localStorage.getItem(queueKey(ownerId))
  if (raw === null) return migrateV2(ownerId, maintain)
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.every((item) => isPendingOperation(item, ownerId))) throw new Error('queue is invalid')
    // A crash after the atomic v3 write but before v2 cleanup leaves both keys.
    // Once a valid v3 snapshot is observed under the lock, it is authoritative.
    if (maintain) {
      assertFallbackLock()
      localStorage.removeItem(v2QueueKey(ownerId))
    }
    return parsed
  } catch {
    if (maintain) {
      appendQuarantine(ownerId, corruptQueueKey(ownerId), 'invalid-v3', raw)
      assertFallbackLock()
      localStorage.removeItem(queueKey(ownerId))
    }
    return []
  }
}

function readQueueForUpdate(ownerId: string) {
  if (queueLockDepth === 0 || verifiedQueueOwner !== ownerId) {
    throw new Error('Обслуживание очереди требует owner-aware межвкладочной блокировки')
  }
  return readQueueFromStorage(ownerId, true)
}

// Public reads are deliberately storage-pure: no migration, quarantine capture,
// cleanup or event dispatch can happen without an async owner check under lock.
export function readQueue(ownerId: string): StoredPendingOperation[] {
  return readQueueFromStorage(ownerId, false)
}

function queuedUndoBlockReasonIn(queue: StoredPendingOperation[], mutationId: string): string | null {
  const index = queue.findIndex((item) => item.type === 'mutation' && item.mutationId === mutationId)
  const original = queue[index]
  if (!original || original.type !== 'mutation' || !original.mutation) return 'Локальное изменение больше не найдено'
  const later = queue.slice(index + 1)
  if (later.some((item) => item.type === 'undo' && item.originalMutationId === mutationId)) {
    return 'Undo этого изменения уже ожидает синхронизации'
  }
  if (later.some((item) => item.mutation?.entityType === original.mutation?.entityType
    && item.mutation?.entityId === original.mutation?.entityId)) {
    return 'Сначала отмените более новое локальное изменение этого объекта'
  }
  if (original.mutation.before === null && original.mutation.entityType === 'goal'
    && later.some((item) => item.mutation?.entityType === 'action' && item.payload?.goal_id === original.mutation?.entityId)) {
    return 'Сначала отмените локальные действия, созданные для этой цели'
  }
  if (original.mutation.before === null && original.mutation.entityType === 'habit'
    && later.some((item) => item.mutation?.entityType === 'habit_checkin' && item.payload?.habit_id === original.mutation?.entityId)) {
    return 'Сначала отмените локальные отметки этой привычки'
  }
  return null
}

export function queuedUndoBlockReason(ownerId: string, mutationId: string): string | null {
  return queuedUndoBlockReasonIn(readQueue(ownerId), mutationId)
}

export function queueStats(ownerId: string): QueueStats {
  const queue = readQueue(ownerId)
  const rawV3 = localStorage.getItem(queueKey(ownerId))
  let invalidV3 = 0
  if (rawV3 !== null) {
    try {
      const parsed: unknown = JSON.parse(rawV3)
      if (!Array.isArray(parsed) || !parsed.every((item) => isPendingOperation(item, ownerId))) invalidV3 = storedItemCount(rawV3)
    } catch { invalidV3 = storedItemCount(rawV3) }
  }
  return {
    pending: queue.filter((item) => item.ownerId === ownerId && item.state === 'pending').length,
    failed: queue.filter((item) => item.ownerId !== ownerId || item.state === 'failed').length,
    quarantined: storedItemCount(localStorage.getItem(corruptQueueKey(ownerId))) + invalidV3
      + storedItemCount(localStorage.getItem(recoveryQueueKey(ownerId))),
    legacyQuarantined: localStorage.getItem(legacyQuarantineKey) !== null || localStorage.getItem(legacyQueueKey) !== null,
  }
}

export async function readQuarantine(ownerId: string) {
  return withOwnerQueueLock(ownerId, () => {
    readQueueForUpdate(ownerId)
    return {
      product: 'dostigator-sync-quarantine', version: 1, exportedAt: new Date().toISOString(),
      corrupt: localStorage.getItem(corruptQueueKey(ownerId)),
      recovery: localStorage.getItem(recoveryQueueKey(ownerId)),
    }
  }, 'Карантин')
}

export async function clearQuarantine(ownerId: string) {
  await withOwnerQueueLock(ownerId, () => {
    assertFallbackLock()
    localStorage.removeItem(corruptQueueKey(ownerId))
    localStorage.removeItem(recoveryQueueKey(ownerId))
    window.dispatchEvent(new Event('dostigator:queue'))
  }, 'Карантин')
}

function enqueueUnlocked(
  ownerId: string,
  input: Omit<StoredPendingOperation, 'id' | 'ownerId' | 'createdAt' | 'state' | 'attempts' | 'lastError'>,
  failure?: unknown,
) {
  const queue = readQueueForUpdate(ownerId)
  const next: StoredPendingOperation = {
    ...input,
    id: crypto.randomUUID(),
    ownerId,
    createdAt: new Date().toISOString(),
    state: failure === undefined ? 'pending' : 'failed',
    attempts: failure === undefined ? 0 : 1,
    lastError: failure === undefined ? null : failureMessageForQueue(failure),
  }
  // Never coalesce: A→B→C must produce three authoritative history events.
  writeQueue(ownerId, [...queue, next])
  return next
}

function enqueue(
  ownerId: string,
  input: Omit<StoredPendingOperation, 'id' | 'ownerId' | 'createdAt' | 'state' | 'attempts' | 'lastError'>,
  failure?: unknown,
) {
  return withOwnerQueueLock(ownerId, () => enqueueUnlocked(ownerId, input, failure))
}

export function isNetworkError(reason: unknown) {
  if (!navigator.onLine) return true
  const status = typeof reason === 'object' && reason && 'status' in reason ? Number(reason.status) : 0
  if (status >= 500) return true
  const message = reason instanceof Error ? reason.message : String(reason)
  return /fetch|network|offline|connection/i.test(message)
}

async function hasActiveOwner(ownerId: string) {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session?.user.id === ownerId
}

class OwnerMismatchError extends Error {}

async function assertActiveOwner(ownerId: string, resource: 'Очередь' | 'Карантин' | 'Операция' = 'Очередь') {
  if (!await hasActiveOwner(ownerId)) throw new OwnerMismatchError(`${resource} принадлежит другому аккаунту`)
}

async function executeOperation(operation: StoredPendingOperation): Promise<HistoryEvent> {
  if (!isPendingOperation(operation, operation.ownerId)) {
    throw new Error('Некорректная операция синхронизации')
  }
  if (operation.type === 'undo' && operation.originalMutationId) {
    const { data, error } = await supabase.rpc('dostigator_undo_mutation', {
      p_expected_owner: operation.ownerId,
      p_original_mutation_id: operation.originalMutationId,
      p_mutation_id: operation.mutationId,
      p_source: operation.source ?? 'offline',
    })
    if (error) throw error
    return data.event
  }
  if (operation.type === 'mutation' && operation.mutation && operation.payload) {
    const mutation = operation.mutation
    const { data, error } = await supabase.rpc('dostigator_apply_mutation', {
      p_expected_owner: operation.ownerId,
      p_mutation_id: mutation.mutationId,
      p_entity_type: mutation.entityType,
      p_entity_id: mutation.entityId,
      p_operation: mutation.operation,
      p_label: mutation.label,
      p_expected_revision: mutation.baseRevision,
      p_after: operation.payload,
      p_source: mutation.source ?? 'offline',
    })
    if (error) throw error
    return data.event
  }
  throw new Error('Некорректная операция синхронизации')
}

function failureMessageForQueue(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason)
}

function markFailedUnlocked(ownerId: string, queueId: string, reason: unknown) {
  writeQueue(ownerId, readQueueForUpdate(ownerId).map((item) => item.id === queueId
    ? { ...item, state: 'failed', attempts: item.attempts + 1, lastError: failureMessageForQueue(reason) }
    : item))
}

export async function persistOrQueue(
  ownerId: string,
  table: TableName,
  payload: Record<string, unknown>,
  descriptor?: MutationDescriptor,
): Promise<PersistenceResult> {
  const entityType = tableEntities[table]
  if (!entityType || typeof payload.id !== 'string') throw new Error('Таблица не поддерживает историю изменений')
  const mutation: MutationDescriptor = descriptor ?? {
    mutationId: crypto.randomUUID(), entityType, entityId: payload.id, operation: 'legacy_upsert',
    label: 'Локальное изменение', baseRevision: typeof payload.revision === 'number' ? payload.revision : 0,
    before: null, source: 'legacy',
  }
  const durableMutation: MutationDescriptor = {
    ...mutation,
    // The source is part of the server idempotency envelope. Choose it before
    // the first attempt and never rewrite it after an ambiguous network loss.
    source: navigator.onLine ? mutation.source ?? 'ui' : 'offline',
  }
  if (!isMutationEnvelope(ownerId, table, payload, durableMutation)) {
    throw new Error('Некорректная операция синхронизации')
  }
  const operationInput = {
    type: 'mutation' as const, table, payload, mutation: durableMutation,
    mutationId: durableMutation.mutationId, label: durableMutation.label,
  }
  if (!navigator.onLine) {
    await enqueue(ownerId, operationInput)
    return { mutationId: durableMutation.mutationId, status: 'pending', event: null }
  }
  await assertActiveOwner(ownerId, 'Операция')
  try {
    const transient: PendingOperation = {
      ...operationInput, id: crypto.randomUUID(), ownerId, createdAt: new Date().toISOString(),
      state: 'pending', attempts: 0, lastError: null,
    }
    const event = await executeOperation(transient)
    return { mutationId: durableMutation.mutationId, status: 'synced', event }
  } catch (reason) {
    if (reason instanceof OwnerMismatchError) throw reason
    const networkFailure = isNetworkError(reason)
    await enqueue(ownerId, operationInput, networkFailure ? undefined : reason)
    if (!networkFailure) return { mutationId: durableMutation.mutationId, status: 'failed', event: null }
    return { mutationId: durableMutation.mutationId, status: 'pending', event: null }
  }
}

export async function persistUndoOrQueue(ownerId: string, originalMutationId: string, mutationId: string, label: string, original?: MutationDescriptor): Promise<PersistenceResult> {
  const decision = await withOwnerQueueLock(ownerId, () => {
    const queue = readQueueForUpdate(ownerId)
    const queuedOriginal = queue.find((item) => item.type === 'mutation' && item.mutationId === originalMutationId)
    const originalDescriptor = original ?? queuedOriginal?.mutation
    if (!isNonEmptyString(ownerId) || !isUuid(originalMutationId) || !isUuid(mutationId)
      || mutationId === originalMutationId || !isStringWithin(label, 1, 180)
      || !originalDescriptor || originalDescriptor.mutationId !== originalMutationId
      || !isMutationDescriptor(originalDescriptor, ownerId)) {
      throw new Error('Не найден корректный дескриптор исходного изменения')
    }
    if (queuedOriginal?.state === 'failed') throw new Error('Сначала отмените отклонённое локальное изменение')
    if (queuedOriginal) {
      const blocked = queuedUndoBlockReasonIn(queue, originalMutationId)
      if (blocked) throw new Error(blocked)
      enqueueUnlocked(ownerId, {
        type: 'undo', originalMutationId, mutationId, label,
        mutation: originalDescriptor, source: 'offline',
      })
      return { queued: true as const, descriptor: originalDescriptor }
    }
    return { queued: false as const, descriptor: originalDescriptor }
  }, 'Операция')
  if (decision.queued) return { mutationId, status: 'pending', event: null }
  const originalDescriptor = decision.descriptor
  // Source is part of the undo idempotency envelope. Select it before the
  // first attempt, then persist the same value if the response is ambiguous.
  const input = {
    type: 'undo' as const, originalMutationId, mutationId, label,
    mutation: originalDescriptor, source: navigator.onLine ? 'undo' as const : 'offline' as const,
  }
  if (!navigator.onLine) {
    await enqueue(ownerId, input)
    return { mutationId, status: 'pending', event: null }
  }
  await assertActiveOwner(ownerId, 'Операция')
  try {
    const transient: PendingOperation = {
      ...input, id: crypto.randomUUID(), ownerId, createdAt: new Date().toISOString(),
      state: 'pending', attempts: 0, lastError: null,
    }
    const event = await executeOperation(transient)
    return { mutationId, status: 'synced', event }
  } catch (reason) {
    if (reason instanceof OwnerMismatchError) throw reason
    const networkFailure = isNetworkError(reason)
    await enqueue(ownerId, input, networkFailure ? undefined : reason)
    if (!networkFailure) return { mutationId, status: 'failed', event: null }
    return { mutationId, status: 'pending', event: null }
  }
}

export async function discardRejectedMutation(ownerId: string, mutationId: string) {
  const active = activeFlushes.get(ownerId)
  if (active) await active
  return withOwnerQueueLock(ownerId, () => {
    const queue = readQueueForUpdate(ownerId)
    const index = queue.findIndex((item) => item.type === 'mutation' && item.mutationId === mutationId)
    const operation = queue[index]
    if (!operation || operation.type !== 'mutation' || operation.state !== 'failed' || !operation.mutation) {
      throw new Error('Отклонённое изменение больше не найдено')
    }
    const blocked = queuedUndoBlockReasonIn(queue, mutationId)
    if (blocked) throw new Error(`${blocked}. Разрешите конфликт всей очереди в профиле.`)
    writeQueue(ownerId, queue.filter((item) => item.id !== operation.id))
    return operation
  }, 'Операция')
}

export async function quarantineFailedQueue(ownerId: string) {
  const active = activeFlushes.get(ownerId)
  if (active) await active
  return withOwnerQueueLock(ownerId, () => {
    const queue = readQueueForUpdate(ownerId)
    if (!queue.some((item) => item.state === 'failed')) throw new Error('В очереди нет отклонённых изменений')
    appendQuarantine(ownerId, recoveryQueueKey(ownerId), 'user-resolved-failed-queue', JSON.stringify(queue))
    writeQueue(ownerId, [])
    return queue.length
  })
}

// Compatibility export for old call sites/backups. Product UI mutations use
// persistOrQueue with a stable descriptor and never issue physical deletes here.
export async function deleteOrQueue(ownerId: string, table: TableName, rowId: string) {
  if (table !== 'dostigator_habit_checkins') throw new Error('Удаление требует атомарной операции с историей')
  return persistOrQueue(ownerId, table, { id: rowId }, {
    mutationId: crypto.randomUUID(), entityType: 'habit_checkin', entityId: rowId,
    operation: 'legacy_delete', label: 'Удалена отметка привычки', baseRevision: 0,
    before: null, source: 'legacy',
  })
}

async function runFlush(ownerId: string): Promise<FlushResult> {
  return withOwnerQueueLock(ownerId, async () => {
    const queue = readQueueForUpdate(ownerId)
    if (!navigator.onLine) return { completed: 0, ...queueStats(ownerId) }
    let completed = 0
    for (const operation of queue) {
      if (operation.ownerId !== ownerId) {
        markFailedUnlocked(ownerId, operation.id, new Error('Операция принадлежит другому аккаунту'))
        break
      }
      if (operation.state === 'failed') break
      await assertActiveOwner(ownerId)
      try {
        await executeOperation(operation)
      } catch (reason) {
        await assertActiveOwner(ownerId)
        if (isNetworkError(reason)) break
        markFailedUnlocked(ownerId, operation.id, reason)
        break
      }
      await assertActiveOwner(ownerId)
      writeQueue(ownerId, readQueueForUpdate(ownerId).filter((item) => item.id !== operation.id))
      completed += 1
    }
    return { completed, ...queueStats(ownerId) }
  })
}

export function flushQueue(ownerId: string): Promise<FlushResult> {
  const active = activeFlushes.get(ownerId)
  if (active) return active
  const current = runFlush(ownerId).finally(() => activeFlushes.delete(ownerId))
  activeFlushes.set(ownerId, current)
  return current
}

export async function retryFailed(ownerId: string) {
  const active = activeFlushes.get(ownerId)
  if (active) await active
  await withOwnerQueueLock(ownerId, () => writeQueue(ownerId, readQueueForUpdate(ownerId).map((item) => item.ownerId === ownerId && item.state === 'failed'
    ? { ...item, state: 'pending', lastError: null }
    : item)))
  return flushQueue(ownerId)
}
