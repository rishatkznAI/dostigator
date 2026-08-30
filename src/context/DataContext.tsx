import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { localDate, shiftDate, startOfWeek } from '../lib/date'
import { FOCUS_LIMIT, dailyFocus } from '../lib/focus'
import { confirmedUndoQueueBlockReason } from '../lib/historyUndo'
import { cacheData, loadAppData, readCachedData, stripOwnership } from '../lib/repository'
import { discardRejectedMutation, flushQueue, persistOrQueue, persistUndoOrQueue, quarantineFailedQueue, queuedUndoBlockReason, queueStats, readQueue, retryFailed, type PersistenceResult } from '../lib/offline'
import type { ActionItem, AppData, FocusCommitment, Goal, GoalKind, Habit, HabitCheckin, HistoryEntityType, HistoryEvent, HistoryOperation, MutationDescriptor, PendingOperation, WeeklyMetrics, WeeklyReview } from '../types'

interface NewGoal {
  title: string
  kind: GoalKind
  areaId: string | null
  targetDate: string | null
  why: string
  description?: string
}

interface DataValue {
  data: AppData
  loading: boolean
  error: string | null
  mutationError: string | null
  pending: number
  failedSync: number
  quarantinedSync: number
  legacySyncQuarantine: boolean
  syncing: boolean
  online: boolean
  historyNotice: HistoryNotice | null
  clearMutationError(): void
  dismissHistoryNotice(): void
  undoLastMutation(): Promise<void>
  undoHistoryMutation(event: HistoryEvent): Promise<void>
  isMutating(scope: MutationScope, id?: string): boolean
  refresh(): Promise<void>
  retrySync(): Promise<void>
  resolveFailedSync(): Promise<void>
  addGoal(input: NewGoal): Promise<Goal>
  updateGoal(id: string, updates: Partial<Pick<Goal, 'title' | 'description' | 'why' | 'kind' | 'area_id' | 'status' | 'progress' | 'target_date'>>): Promise<void>
  addAction(goalId: string, title: string, dueDate?: string | null): Promise<ActionItem>
  updateAction(id: string, updates: Partial<Pick<ActionItem, 'title' | 'due_date' | 'result_note'>>): Promise<void>
  toggleAction(id: string, resultNote?: string): Promise<void>
  deleteAction(id: string): Promise<void>
  toggleFocus(id: string): Promise<void>
  addHabit(title: string, targetPerWeek: number, areaId: string | null): Promise<Habit>
  updateHabit(id: string, updates: Partial<Pick<Habit, 'title' | 'target_per_week' | 'area_id'>>): Promise<void>
  toggleHabitToday(habitId: string, note?: string): Promise<void>
  setHabitActive(id: string, active: boolean): Promise<void>
  saveReview(weekStart: string, input: Pick<WeeklyReview, 'wins' | 'blockers' | 'next_focus' | 'self_score'>, metrics: WeeklyMetrics): Promise<void>
}

export type MutationScope = 'goal-add' | 'goal' | 'action-add' | 'action' | 'focus' | 'habit-add' | 'habit' | 'review'

export interface HistoryNotice {
  ownerId: string
  mutationId: string
  label: string
  status: PersistenceResult['status']
  undoing: boolean
  canUndo: boolean
}

interface PreparedHistory {
  descriptor: MutationDescriptor
  revert(current: AppData): AppData
}

interface PreparedMutation<T> {
  apply(current: AppData): AppData
  rollback(current: AppData): AppData
  persist(): Promise<PersistenceResult | void>
  result: T
  history?: PreparedHistory
}

interface UndoableMutation extends PreparedHistory {
  ownerId: string
  locks: Array<[MutationScope, string?]>
  reapply(current: AppData): AppData
}

interface ActiveMutation {
  intent: string
  task: Promise<unknown>
}

const empty: AppData = { areas: [], goals: [], actions: [], habits: [], checkins: [], reviews: [], focusCommitments: [] }
const DataContext = createContext<DataValue | null>(null)

function now() { return new Date().toISOString() }
function mutationIntent(kind: string, payload: unknown) { return `${kind}:${JSON.stringify(payload)}` }
function rowPayload<T extends { user_id: string }>(row: T): Record<string, unknown> {
  return stripOwnership(row) as unknown as Record<string, unknown>
}
function nextRevision<T extends { revision?: number; last_mutation_id?: string | null }>(row: T, mutationId: string): T & { revision: number; last_mutation_id: string } {
  return { ...row, revision: (row.revision ?? 0) + 1, last_mutation_id: mutationId }
}
function boundedHistoryLabel(label: string, maximum: number) {
  const codePoints = Array.from(label.trim())
  return codePoints.length <= maximum ? codePoints.join('') : `${codePoints.slice(0, maximum - 1).join('')}…`
}
function historyDescriptor(
  mutationId: string,
  entityType: HistoryEntityType,
  entityId: string,
  operation: Exclude<HistoryOperation, 'undo'>,
  label: string,
  baseRevision: number,
  before: { user_id: string } | null,
): MutationDescriptor {
  return { mutationId, entityType, entityId, operation, label: boundedHistoryLabel(label, 172), baseRevision, before: before ? rowPayload(before) : null, source: 'ui' }
}

function focusCommitment(
  action: ActionItem,
  committedOn: string,
  position: number,
  sourceMutationId: string | null,
): FocusCommitment {
  return {
    id: crypto.randomUUID(), user_id: action.user_id, action_id: action.id,
    committed_on: committedOn, position, source_mutation_id: sourceMutationId, created_at: now(),
  }
}

/** Mirrors the database trigger while preserving legacy focus pointers in an old offline cache. */
function reconcileFocusCommitments(
  current: AppData,
  previous: ActionItem | undefined,
  next: ActionItem | undefined,
  sourceMutationId: string | null = null,
  focusDeleteDate: string | null = null,
): AppData {
  const previousDate = previous?.focus_date ?? null
  const nextDate = next?.focus_date ?? null
  const previousPosition = previous?.focus_position ?? null
  const nextPosition = next?.focus_position ?? null
  if (previousDate === nextDate && previousPosition === nextPosition) return current

  let rows = [...(current.focusCommitments ?? [])]
  const has = (actionId: string, date: string) => rows.some((row) => row.action_id === actionId && row.committed_on === date)
  const remove = (actionId: string, date: string) => { rows = rows.filter((row) => row.action_id !== actionId || row.committed_on !== date) }
  const ensure = (action: ActionItem, date: string, position: number) => {
    const index = rows.findIndex((row) => row.action_id === action.id && row.committed_on === date)
    if (index >= 0) rows[index] = { ...rows[index], position }
    else rows.push(focusCommitment(action, date, position, sourceMutationId))
  }

  if (previous && previousDate && previousPosition !== null && previousDate !== nextDate) {
    if (next?.status === 'cancelled') {
      if (previousDate === focusDeleteDate) {
        // Deleting an action releases today's slot and cancels only today's promise.
        remove(previous.id, previousDate)
      } else {
        // A past promise is history. Materialize it if this is a legacy cache.
        ensure(previous, previousDate, previousPosition)
      }
    } else if (!nextDate) {
      // Removing focus before completion cancels only this day's commitment.
      remove(previous.id, previousDate)
    } else if (has(previous.id, nextDate)) {
      // Moving back to an already recorded date is Undo: discard only the date being reverted.
      remove(previous.id, previousDate)
    } else {
      // A new day is additive. Also materialize the old pointer if this is a pre-migration cache.
      ensure(previous, previousDate, previousPosition)
    }
  }
  if (next && nextDate && nextPosition !== null) ensure(next, nextDate, nextPosition)
  return { ...current, focusCommitments: rows }
}

function applyQueuedSnapshot(current: AppData, operation: PendingOperation, snapshot: Record<string, unknown> | null): AppData {
  const descriptor = operation.mutation
  if (!descriptor) return current
  const restore = <T extends { id: string }>(rows: T[]) => {
    const without = rows.filter((item) => item.id !== descriptor.entityId)
    if (!snapshot) return without
    return [{ ...snapshot, id: descriptor.entityId, user_id: operation.ownerId } as unknown as T, ...without]
  }
  switch (descriptor.entityType) {
    case 'goal': return { ...current, goals: restore(current.goals) }
    case 'action': {
      const previous = current.actions.find((item) => item.id === descriptor.entityId)
      const focusDeleteDate = typeof operation.payload?.focus_delete_date === 'string' ? operation.payload.focus_delete_date : null
      const safeSnapshot = snapshot ? Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== 'focus_delete_date')) : null
      const next = safeSnapshot ? { ...safeSnapshot, id: descriptor.entityId, user_id: operation.ownerId } as unknown as ActionItem : undefined
      const reconciled = reconcileFocusCommitments(current, previous, next, operation.mutationId, focusDeleteDate)
      const without = reconciled.actions.filter((item) => item.id !== descriptor.entityId)
      return { ...reconciled, actions: next ? [next, ...without] : without }
    }
    case 'habit': return { ...current, habits: restore(current.habits) }
    case 'habit_checkin': return { ...current, checkins: restore(current.checkins) }
    case 'review': return { ...current, reviews: restore(current.reviews) }
  }
}

function currentQueuedSnapshot(current: AppData, operation: PendingOperation): Record<string, unknown> | null {
  const descriptor = operation.mutation
  if (!descriptor) return null
  const row = descriptor.entityType === 'goal' ? current.goals.find((item) => item.id === descriptor.entityId)
    : descriptor.entityType === 'action' ? current.actions.find((item) => item.id === descriptor.entityId)
    : descriptor.entityType === 'habit' ? current.habits.find((item) => item.id === descriptor.entityId)
    : descriptor.entityType === 'habit_checkin' ? current.checkins.find((item) => item.id === descriptor.entityId)
    : current.reviews.find((item) => item.id === descriptor.entityId)
  return row ? { ...row } as unknown as Record<string, unknown> : null
}

function stampEntityRevision(current: AppData, descriptor: MutationDescriptor, revision: number, mutationId: string): AppData {
  const stamp = <T extends { id: string }>(rows: T[]) => rows.map((item) => item.id === descriptor.entityId
    ? { ...item, revision, last_mutation_id: mutationId } : item)
  switch (descriptor.entityType) {
    case 'goal': return { ...current, goals: stamp(current.goals) }
    case 'action': return { ...current, actions: stamp(current.actions) }
    case 'habit': return { ...current, habits: stamp(current.habits) }
    case 'habit_checkin': return { ...current, checkins: stamp(current.checkins) }
    case 'review': return { ...current, reviews: stamp(current.reviews) }
  }
}

function assertFocusUndoAllowed(current: AppData, descriptor: MutationDescriptor) {
  if (descriptor.entityType !== 'action' || !descriptor.before) return
  const focusDate = descriptor.before.focus_date
  const focusPosition = descriptor.before.focus_position
  if (typeof focusDate !== 'string' || typeof focusPosition !== 'number') return
  const occupied = current.actions.filter((item) => item.id !== descriptor.entityId
    && item.status !== 'cancelled' && item.focus_date === focusDate)
  if (occupied.length >= FOCUS_LIMIT || occupied.some((item) => item.focus_position === focusPosition)) {
    throw new Error('Undo недоступен: место в «Фокусе 3» уже занято более новым действием')
  }
}

function descriptorMutationLocks(descriptor: MutationDescriptor, after?: Record<string, unknown> | null): Array<[MutationScope, string?]> {
  if (descriptor.entityType === 'goal' && descriptor.before === null) {
    return [['goal', descriptor.entityId], ['action-add', descriptor.entityId]]
  }
  if (descriptor.entityType === 'habit_checkin') {
    const habitId = after?.habit_id ?? descriptor.before?.habit_id
    if (typeof habitId !== 'string') throw new Error('Не удалось определить привычку для безопасного Undo')
    return [['habit', habitId]]
  }
  if (descriptor.entityType === 'review') {
    const week = after?.week_start ?? descriptor.before?.week_start
    if (typeof week !== 'string') throw new Error('Не удалось определить неделю для безопасного Undo')
    return [['review', week]]
  }
  if (descriptor.entityType === 'action') {
    const affectsFocus = descriptor.operation === 'focus_add' || descriptor.operation === 'focus_remove'
      || descriptor.operation === 'action_delete'
      || typeof descriptor.before?.focus_date === 'string' || typeof after?.focus_date === 'string'
    return affectsFocus ? [['action', descriptor.entityId], ['focus']] : [['action', descriptor.entityId]]
  }
  return [[descriptor.entityType, descriptor.entityId]]
}

function queuedMutationLocks(operation: PendingOperation): Array<[MutationScope, string?]> {
  if (!operation.mutation) throw new Error('Локальное изменение повреждено')
  return descriptorMutationLocks(operation.mutation, operation.payload)
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [data, setData] = useState<AppData>(() => user ? readCachedData(user.id) : empty)
  const [dataOwnerId, setDataOwnerId] = useState(user?.id ?? null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mutationNotice, setMutationNotice] = useState<{ ownerId: string; message: string } | null>(null)
  const [historyNotice, setHistoryNotice] = useState<HistoryNotice | null>(null)
  const [pending, setPending] = useState(0)
  const [failedSync, setFailedSync] = useState(0)
  const [quarantinedSync, setQuarantinedSync] = useState(0)
  const [legacySyncQuarantine, setLegacySyncQuarantine] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [online, setOnline] = useState(() => navigator.onLine)
  const activeUserId = useRef(user?.id ?? null)
  const dataOwnerIdRef = useRef(dataOwnerId)
  const dataRef = useRef(data)
  const durableData = useRef(new Map<string, AppData>(user ? [[user.id, data]] : []))
  const mutationTasks = useRef(new Map<string, ActiveMutation>())
  const lastUndoable = useRef<UndoableMutation | null>(null)
  const mounted = useRef(true)
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(() => new Set())
  useLayoutEffect(() => {
    activeUserId.current = user?.id ?? null
  }, [user])
  useLayoutEffect(() => {
    dataOwnerIdRef.current = dataOwnerId
    dataRef.current = data
  }, [data, dataOwnerId])
  useEffect(() => {
    mounted.current = true
    const tasks = mutationTasks.current
    return () => {
      mounted.current = false
      tasks.clear()
    }
  }, [])

  useEffect(() => {
    const nextOwnerId = user?.id ?? null
    if (dataOwnerId === nextOwnerId) return
    const nextData = user ? readCachedData(user.id) : empty
    if (user) durableData.current.set(user.id, nextData)
    setDataOwnerId(nextOwnerId)
    setData(nextData)
    setLoading(Boolean(user))
    setError(null)
    setMutationNotice(null)
    setHistoryNotice(null)
    lastUndoable.current = null
    setPending(0)
    setFailedSync(0)
    setQuarantinedSync(0)
    setLegacySyncQuarantine(false)
    setSyncing(false)
  }, [dataOwnerId, user])

  const refresh = useCallback(async () => {
    if (!user) return
    const requestUserId = user.id
    if (activeUserId.current !== requestUserId) return
    setError(null)
    const queued = queueStats(user.id)
    if (activeUserId.current !== requestUserId) return
    if (queued.pending || queued.failed) {
      const cached = readCachedData(user.id)
      durableData.current.set(user.id, cached)
      setData(cached)
      setLoading(false)
      setPending(queued.pending)
      setFailedSync(queued.failed)
      setQuarantinedSync(queued.quarantined)
      setLegacySyncQuarantine(queued.legacyQuarantined)
      return
    }
    try {
      const remote = await loadAppData(requestUserId)
      if (activeUserId.current !== requestUserId) return
      if ([...mutationTasks.current.keys()].some((key) => key.startsWith(`${requestUserId}:`))) return
      durableData.current.set(user.id, remote)
      setData(remote)
      try { cacheData(user.id, remote) } catch { /* Remote data remains authoritative in memory. */ }
    } catch (reason) {
      if (activeUserId.current !== requestUserId) return
      const cached = readCachedData(user.id)
      durableData.current.set(user.id, cached)
      setData(cached)
      setError(navigator.onLine ? (reason instanceof Error ? reason.message : 'Не удалось загрузить данные') : null)
    } finally {
      if (activeUserId.current === requestUserId) setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!user || dataOwnerId !== user.id) return
    const hasActiveMutation = [...mutationTasks.current.keys()].some((key) => key.startsWith(`${user.id}:`))
    if (hasActiveMutation) return
    durableData.current.set(user.id, data)
    try { cacheData(user.id, data) } catch { /* A mutation writes through its own durable path. */ }
  }, [user, data, dataOwnerId, busyKeys])

  useEffect(() => {
    if (!user) return
    const updateSyncState = () => {
      if (activeUserId.current !== user.id) return
      const stats = queueStats(user.id)
      if (activeUserId.current !== user.id) return
      setPending(stats.pending)
      setFailedSync(stats.failed)
      setQuarantinedSync(stats.quarantined)
      setLegacySyncQuarantine(stats.legacyQuarantined)
    }
    const sync = () => {
      if (activeUserId.current !== user.id) return
      setOnline(true)
      setSyncing(true)
      void flushQueue(user.id)
        .then((result) => {
          if (activeUserId.current !== user.id) return
          updateSyncState()
          if (!result.pending && !result.failed && !result.quarantined) return refresh()
        })
        .finally(() => { if (activeUserId.current === user.id) setSyncing(false) })
    }
    const markOffline = () => setOnline(false)
    window.addEventListener('online', sync)
    window.addEventListener('offline', markOffline)
    window.addEventListener('dostigator:queue', updateSyncState)
    updateSyncState()
    if (navigator.onLine) sync()
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', markOffline)
      window.removeEventListener('dostigator:queue', updateSyncState)
    }
  }, [refresh, user])

  const retrySync = async () => {
    const currentUser = requireUser()
    setSyncing(true)
    try {
      const result = await retryFailed(currentUser.id)
      if (activeUserId.current !== currentUser.id) return
      setPending(result.pending)
      setFailedSync(result.failed)
      setQuarantinedSync(result.quarantined)
      setLegacySyncQuarantine(result.legacyQuarantined)
      if (!result.pending && !result.failed && !result.quarantined) await refresh()
    } finally {
      if (activeUserId.current === currentUser.id) setSyncing(false)
    }
  }

  const resolveFailedSync = async () => {
    const currentUser = requireUser()
    if (!navigator.onLine) throw new Error('Подключитесь к сети, чтобы безопасно загрузить серверную версию данных')
    setSyncing(true)
    try {
      const remote = await loadAppData(currentUser.id)
      if (activeUserId.current !== currentUser.id) return
      await quarantineFailedQueue(currentUser.id)
      if (activeUserId.current !== currentUser.id) return
      durableData.current.set(currentUser.id, remote)
      applyData(remote)
      try { cacheData(currentUser.id, remote) } catch { /* Server data remains authoritative in memory. */ }
      const stats = queueStats(currentUser.id)
      setPending(stats.pending)
      setFailedSync(stats.failed)
      setQuarantinedSync(stats.quarantined)
      setLegacySyncQuarantine(stats.legacyQuarantined)
      setMutationNotice({ ownerId: currentUser.id, message: 'Локальные изменения перемещены в карантин. Серверные данные загружены заново.' })
    } finally {
      if (activeUserId.current === currentUser.id) setSyncing(false)
    }
  }

  const requireUser = () => {
    if (!user) throw new Error('Сессия входа завершилась')
    return user
  }

  const mutationKey = (ownerId: string, scope: MutationScope, id?: string) => `${ownerId}:${scope}:${id ?? '*'}`

  const isMutating = (scope: MutationScope, id?: string) => {
    const ownerId = user?.id
    return ownerId ? busyKeys.has(mutationKey(ownerId, scope, id)) : false
  }

  const updateBusyKeys = () => {
    if (mounted.current) setBusyKeys(new Set(mutationTasks.current.keys()))
  }

  const applyData = (next: AppData) => {
    dataRef.current = next
    setData(next)
  }

  const executeMutation = <T,>(
    ownerId: string,
    locks: Array<[MutationScope, string?]>,
    prepare: (current: AppData) => PreparedMutation<T>,
    failureMessage: string,
    intent: string,
    globalError = true,
  ): Promise<T> => {
    const keys = locks.map(([scope, id]) => mutationKey(ownerId, scope, id))
    const active = keys.map((key) => mutationTasks.current.get(key)).filter((item): item is ActiveMutation => Boolean(item))
    if (active.length) {
      if (active.every((item) => item.intent === intent && item.task === active[0].task)) return active[0].task as Promise<T>
      const conflictMessage = 'Дождитесь завершения предыдущего изменения и повторите действие.'
      if (globalError && activeUserId.current === ownerId) setMutationNotice({ ownerId, message: conflictMessage })
      return Promise.reject(new Error(conflictMessage))
    }
    if (!intent.startsWith('undo:') && queueStats(ownerId).failed > 0) {
      const conflictMessage = 'Сначала разрешите конфликт синхронизации в профиле — новые изменения временно заблокированы.'
      if (globalError && activeUserId.current === ownerId) setMutationNotice({ ownerId, message: conflictMessage })
      return Promise.reject(new Error(conflictMessage))
    }
    setMutationNotice(null)

    let task: Promise<T>
    task = Promise.resolve().then(async () => {
      if (!mounted.current || activeUserId.current !== ownerId || dataOwnerIdRef.current !== ownerId) {
        throw new Error('Аккаунт изменился. Повторите действие.')
      }
      let prepared: PreparedMutation<T>
      try {
        prepared = prepare(dataRef.current)
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : 'Не удалось выполнить действие'
        if (globalError) setMutationNotice({ ownerId, message })
        throw new Error(message)
      }
      applyData(prepared.apply(dataRef.current))
      let persistence: PersistenceResult | void
      try {
        persistence = await prepared.persist()
      } catch {
        if (mounted.current && activeUserId.current === ownerId && dataOwnerIdRef.current === ownerId) {
          const rolledBack = prepared.rollback(dataRef.current)
          applyData(rolledBack)
          if (globalError) setMutationNotice({ ownerId, message: failureMessage })
        } else {
          const durable = durableData.current.get(ownerId) ?? prepared.rollback(readCachedData(ownerId))
          try { cacheData(ownerId, durable) } catch { /* The prior cached version remains unchanged. */ }
        }
        throw new Error(failureMessage)
      }
      try {
        const durable = durableData.current.get(ownerId) ?? readCachedData(ownerId)
        const committed = prepared.apply(durable)
        durableData.current.set(ownerId, committed)
        try { cacheData(ownerId, committed) } catch { /* Server or queue remains authoritative. */ }
      } catch {
        // Persistence is already durable. A later cache bookkeeping failure
        // must never roll back the UI while leaving an executable operation.
      }
      if (prepared.history && mounted.current && activeUserId.current === ownerId) {
        lastUndoable.current = {
          ...prepared.history,
          ownerId,
          locks,
          reapply: prepared.apply,
        }
        setHistoryNotice({
          ownerId,
          mutationId: prepared.history.descriptor.mutationId,
          label: prepared.history.descriptor.label,
          status: persistence?.status ?? 'synced',
          undoing: false,
          canUndo: true,
        })
      }
      return prepared.result
    }).finally(() => {
      keys.forEach((key) => {
        if (mutationTasks.current.get(key)?.task === task) mutationTasks.current.delete(key)
      })
      updateBusyKeys()
    })
    keys.forEach((key) => mutationTasks.current.set(key, { intent, task }))
    updateBusyKeys()
    return task
  }

  const clearMutationError = () => setMutationNotice(null)
  const dismissHistoryNotice = () => setHistoryNotice(null)

  const undoLastMutation = async () => {
    const currentUser = requireUser()
    const undoable = lastUndoable.current
    if (!undoable || undoable.ownerId !== currentUser.id) throw new Error('Это изменение больше нельзя отменить')
    setHistoryNotice((current) => current ? { ...current, undoing: true } : current)
    const undoMutationId = crypto.randomUUID()
    let undoStatus: PersistenceResult['status'] = 'synced'
    try {
      const ownerQueue = readQueue(currentUser.id)
      const queuedInverse = ownerQueue.find((item) => item.type === 'undo' && item.originalMutationId === undoable.descriptor.mutationId)
      if (queuedInverse) throw new Error(queuedInverse.state === 'failed'
        ? 'Предыдущий Undo отклонён. Разрешите конфликт синхронизации в профиле.'
        : 'Undo уже ожидает синхронизации')
      const queuedOriginal = ownerQueue.find((item) => item.type === 'mutation' && item.mutationId === undoable.descriptor.mutationId)
      if (queuedOriginal) {
        const blocked = queuedUndoBlockReason(currentUser.id, undoable.descriptor.mutationId)
        if (blocked) throw new Error(blocked)
      }
      assertFocusUndoAllowed(dataRef.current, undoable.descriptor)
      const rejectedOriginal = queuedOriginal?.state === 'failed'
      await executeMutation(currentUser.id, undoable.locks, (_current) => ({
        apply: (current) => {
          const reverted = undoable.revert(current)
          return rejectedOriginal ? reverted : stampEntityRevision(
            reverted, undoable.descriptor, undoable.descriptor.baseRevision + 2, undoMutationId,
          )
        },
        rollback: undoable.reapply,
        persist: async () => {
          if (rejectedOriginal) {
            await discardRejectedMutation(currentUser.id, undoable.descriptor.mutationId)
            undoStatus = 'synced'
            return
          }
          const result = await persistUndoOrQueue(currentUser.id, undoable.descriptor.mutationId, undoMutationId, boundedHistoryLabel(`Отмена: ${undoable.descriptor.label}`, 180), undoable.descriptor)
          if (result.status === 'failed') throw new Error('Undo отклонён сервером')
          undoStatus = result.status
          return result
        },
        result: undefined,
      }), 'Изменение не отменено — появились более свежие данные.', mutationIntent('undo', undoable.descriptor.mutationId))
      lastUndoable.current = null
      setHistoryNotice({ ownerId: currentUser.id, mutationId: undoMutationId, label: 'Изменение отменено', status: undoStatus, undoing: false, canUndo: false })
    } catch (reason) {
      setHistoryNotice((current) => current ? { ...current, undoing: false } : current)
      throw reason
    }
  }

  const undoHistoryMutation = async (event: HistoryEvent) => {
    const currentUser = requireUser()
    const ownerQueue = readQueue(currentUser.id)
    const queued = ownerQueue.find((item) => item.type === 'mutation' && item.mutationId === event.mutation_id)
    if (queued?.mutation) {
      const blocked = queuedUndoBlockReason(currentUser.id, queued.mutationId)
      if (blocked) throw new Error(blocked)
      assertFocusUndoAllowed(dataRef.current, queued.mutation)
      const undoMutationId = crypto.randomUUID()
      const rejectedOriginal = queued.state === 'failed'
      await executeMutation(currentUser.id, queuedMutationLocks(queued), (current) => {
        const preUndo = currentQueuedSnapshot(current, queued)
        return {
          apply: (latest) => {
            const reverted = applyQueuedSnapshot(latest, queued, queued.mutation?.before ?? null)
            return rejectedOriginal ? reverted : stampEntityRevision(
              reverted, queued.mutation!, queued.mutation!.baseRevision + 2, undoMutationId,
            )
          },
          rollback: (latest) => applyQueuedSnapshot(latest, queued, preUndo),
          persist: async () => {
            if (rejectedOriginal) {
              await discardRejectedMutation(currentUser.id, queued.mutationId)
              return
            }
            const result = await persistUndoOrQueue(currentUser.id, queued.mutationId, undoMutationId, boundedHistoryLabel(`Отмена: ${queued.label}`, 180), queued.mutation)
            if (result.status === 'failed') throw new Error('Undo отклонён сервером')
            return result
          },
          result: undefined,
        }
      }, 'Локальное изменение не отменено.', mutationIntent('undo', queued.mutationId))
      return
    }
    const queuedInverse = ownerQueue.find((item) => item.type === 'undo' && item.originalMutationId === event.mutation_id)
    if (queuedInverse) throw new Error(queuedInverse.state === 'failed'
      ? 'Этот Undo отклонён. Разрешите конфликт синхронизации в профиле.'
      : 'Undo уже ожидает синхронизации')
    if (!navigator.onLine) throw new Error('Для безопасного Undo подтверждённого изменения нужна сеть')
    const descriptor: MutationDescriptor = {
      mutationId: event.mutation_id,
      entityType: event.entity_type,
      entityId: event.entity_id,
      operation: event.operation === 'undo' ? 'legacy_upsert' : event.operation,
      label: event.label,
      baseRevision: event.base_revision,
      before: event.before_data,
      source: event.source === 'undo' ? 'ui' : event.source,
    }
    const queueBlock = confirmedUndoQueueBlockReason(event, ownerQueue)
    if (queueBlock) throw new Error(queueBlock)
    assertFocusUndoAllowed(dataRef.current, descriptor)
    const undoMutationId = crypto.randomUUID()
    await executeMutation(currentUser.id, descriptorMutationLocks(descriptor, event.after_data), () => {
      const latestQueueBlock = confirmedUndoQueueBlockReason(event, readQueue(currentUser.id))
      if (latestQueueBlock) throw new Error(latestQueueBlock)
      return {
        apply: (current: AppData) => current,
        rollback: (current: AppData) => current,
        persist: async () => {
          const result = await persistUndoOrQueue(currentUser.id, event.mutation_id, undoMutationId, 'Отмена изменения из истории', descriptor)
          if (result.status !== 'synced') throw new Error('Undo отклонён сервером или ожидает ручного повтора')
          return result
        },
        result: undefined,
      }
    }, 'Undo не выполнен — появились более свежие данные или операция ожидает синхронизации.', mutationIntent('undo', event.mutation_id), false)
    await refresh()
  }

  const addGoal = async (input: NewGoal) => {
    const currentUser = requireUser()
    return executeMutation(currentUser.id, [['goal-add']], () => {
      const timestamp = now()
      const mutationId = crypto.randomUUID()
      const title = input.title.trim()
      if (!title || title.length > 140) throw new Error('Название цели должно содержать от 1 до 140 символов')
      const goal: Goal = {
        id: crypto.randomUUID(), user_id: currentUser.id, area_id: input.areaId,
        title, description: input.description?.trim() ?? '', why: input.why.trim(),
        kind: input.kind, status: 'active', progress: 0, target_date: input.targetDate,
        completed_at: null, created_at: timestamp, updated_at: timestamp,
        revision: 1, last_mutation_id: mutationId,
      }
      const descriptor = historyDescriptor(mutationId, 'goal', goal.id, 'goal_create', `Создана цель «${goal.title}»`, 0, null)
      const revert = (latest: AppData) => ({ ...latest, goals: latest.goals.filter((item) => item.id !== goal.id) })
      return {
        apply: (latest) => latest.goals.some((item) => item.id === goal.id) ? latest : { ...latest, goals: [goal, ...latest.goals] },
        rollback: revert,
        persist: () => persistOrQueue(currentUser.id, 'dostigator_goals', rowPayload(goal), descriptor),
        result: goal,
        history: { descriptor, revert },
      }
    }, 'Цель не сохранена. Изменение отменено — попробуйте ещё раз.', mutationIntent('add-goal', input), false)
  }

  const updateGoal = async (id: string, updates: Partial<Pick<Goal, 'title' | 'description' | 'why' | 'kind' | 'area_id' | 'status' | 'progress' | 'target_date'>>) => {
    const currentUser = requireUser()
    return executeMutation(currentUser.id, [['goal', id]], (current) => {
      const goal = current.goals.find((item) => item.id === id)
      if (!goal) return { apply: (latest: AppData) => latest, rollback: (latest: AppData) => latest, persist: async () => undefined, result: undefined }
      const normalized = {
        ...updates,
        ...(updates.title !== undefined ? { title: updates.title.trim() } : {}),
        ...(updates.description !== undefined ? { description: updates.description.trim() } : {}),
        ...(updates.why !== undefined ? { why: updates.why.trim() } : {}),
      }
      if (normalized.title !== undefined && (!normalized.title || normalized.title.length > 140)) throw new Error('Название цели должно содержать от 1 до 140 символов')
      if (normalized.description !== undefined && normalized.description.length > 2000) throw new Error('Описание цели длиннее 2000 символов')
      if (normalized.why !== undefined && normalized.why.length > 1000) throw new Error('Причина цели длиннее 1000 символов')
      const changed = Object.entries(normalized).some(([key, value]) => goal[key as keyof Goal] !== value)
      if (!changed) return { apply: (latest: AppData) => latest, rollback: (latest: AppData) => latest, persist: async () => undefined, result: undefined }
      let completedAt = goal.completed_at
      if (normalized.status === 'completed') completedAt = now()
      else if (normalized.status !== undefined) completedAt = null
      const mutationId = crypto.randomUUID()
      const next = nextRevision({ ...goal, ...normalized, completed_at: completedAt, updated_at: now() }, mutationId)
      const operation: Exclude<HistoryOperation, 'undo'> = normalized.status === 'completed' ? 'goal_complete'
        : normalized.status === 'paused' ? 'goal_pause'
        : normalized.status === 'active' ? 'goal_resume'
        : 'goal_edit'
      const label = operation === 'goal_complete' ? `Достигнута цель «${goal.title}»`
        : operation === 'goal_pause' ? `Цель «${goal.title}» поставлена на паузу`
        : operation === 'goal_resume' ? `Цель «${goal.title}» возвращена в работу`
        : `Изменена цель «${next.title}»`
      const descriptor = historyDescriptor(mutationId, 'goal', id, operation, label, goal.revision ?? 0, goal)
      const revert = (latest: AppData) => ({ ...latest, goals: latest.goals.map((item) => item.id === id ? goal : item) })
      return {
        apply: (latest: AppData) => ({ ...latest, goals: latest.goals.map((item) => item.id === id ? next : item) }),
        rollback: (latest: AppData) => ({ ...latest, goals: latest.goals.map((item) => item.id === id && item.updated_at === next.updated_at ? goal : item) }),
        persist: () => persistOrQueue(currentUser.id, 'dostigator_goals', rowPayload(next), descriptor),
        result: undefined,
        history: { descriptor, revert },
      }
    }, 'Цель не изменена. Изменение отменено — попробуйте ещё раз.', mutationIntent('update-goal', { id, updates }))
  }

  const addAction = async (goalId: string, title: string, dueDate: string | null = null) => {
    const currentUser = requireUser()
    return executeMutation(currentUser.id, [['action-add', goalId]], () => {
      const timestamp = now()
      const mutationId = crypto.randomUUID()
      const safeTitle = title.trim()
      if (!safeTitle || safeTitle.length > 240) throw new Error('Название действия должно содержать от 1 до 240 символов')
      const item: ActionItem = {
        id: crypto.randomUUID(), user_id: currentUser.id, goal_id: goalId, title: safeTitle,
        status: 'todo', due_date: dueDate, focus_date: null, focus_position: null,
        result_note: '', completed_at: null, created_at: timestamp, updated_at: timestamp,
        revision: 1, last_mutation_id: mutationId,
      }
      const descriptor = historyDescriptor(mutationId, 'action', item.id, 'action_create', `Создано действие «${item.title}»`, 0, null)
      const revert = (latest: AppData) => ({ ...latest, actions: latest.actions.filter((action) => action.id !== item.id) })
      return {
        apply: (latest) => latest.actions.some((action) => action.id === item.id) ? latest : { ...latest, actions: [...latest.actions, item] },
        rollback: revert,
        persist: () => persistOrQueue(currentUser.id, 'dostigator_actions', rowPayload(item), descriptor),
        result: item,
        history: { descriptor, revert },
      }
    }, 'Действие не сохранено. Изменение отменено — попробуйте ещё раз.', mutationIntent('add-action', { goalId, title, dueDate }), false)
  }

  const updateAction = async (id: string, updates: Partial<Pick<ActionItem, 'title' | 'due_date' | 'result_note'>>) => {
    const currentUser = requireUser()
    return executeMutation(currentUser.id, [['action', id]], (current) => {
      const item = current.actions.find((action) => action.id === id)
      if (!item) return { apply: (latest: AppData) => latest, rollback: (latest: AppData) => latest, persist: async () => undefined, result: undefined }
      const normalized = {
        ...updates,
        ...(updates.title !== undefined ? { title: updates.title.trim() } : {}),
        ...(updates.result_note !== undefined ? { result_note: updates.result_note.trim() } : {}),
      }
      if (normalized.title !== undefined && (!normalized.title || normalized.title.length > 240)) throw new Error('Название действия должно содержать от 1 до 240 символов')
      if (normalized.result_note !== undefined && normalized.result_note.length > 1500) throw new Error('Комментарий к результату длиннее 1500 символов')
      if (!Object.entries(normalized).some(([key, value]) => item[key as keyof ActionItem] !== value)) {
        return { apply: (latest: AppData) => latest, rollback: (latest: AppData) => latest, persist: async () => undefined, result: undefined }
      }
      const mutationId = crypto.randomUUID()
      const next = nextRevision({ ...item, ...normalized, updated_at: now() }, mutationId)
      const descriptor = historyDescriptor(mutationId, 'action', id, 'action_edit', `Изменено действие «${next.title}»`, item.revision ?? 0, item)
      const revert = (latest: AppData) => ({ ...latest, actions: latest.actions.map((action) => action.id === id ? item : action) })
      return {
        apply: (latest: AppData) => ({ ...latest, actions: latest.actions.map((action) => action.id === id ? next : action) }),
        rollback: (latest: AppData) => ({ ...latest, actions: latest.actions.map((action) => action.id === id && action.updated_at === next.updated_at ? item : action) }),
        persist: () => persistOrQueue(currentUser.id, 'dostigator_actions', rowPayload(next), descriptor),
        result: undefined,
        history: { descriptor, revert },
      }
    }, 'Действие не изменено. Изменение отменено — попробуйте ещё раз.', mutationIntent('update-action', { id, updates }))
  }

  const toggleAction = async (id: string, resultNote = '') => {
    const currentUser = requireUser()
    return executeMutation(currentUser.id, [['action', id]], (current) => {
      const item = current.actions.find((action) => action.id === id)
      if (!item) return { apply: (latest: AppData) => latest, rollback: (latest: AppData) => latest, persist: async () => undefined, result: undefined }
      const done = item.status !== 'done'
      const mutationId = crypto.randomUUID()
      const next = nextRevision<ActionItem>({
        ...item, status: done ? 'done' : 'todo', completed_at: done ? now() : null,
        result_note: done ? resultNote.trim() || item.result_note : '', updated_at: now(),
      }, mutationId)
      const operation = done ? 'action_complete' : 'action_reopen'
      const descriptor = historyDescriptor(mutationId, 'action', id, operation, done ? `Выполнено действие «${item.title}»` : `Возвращено действие «${item.title}»`, item.revision ?? 0, item)
      const revert = (latest: AppData) => ({ ...latest, actions: latest.actions.map((action) => action.id === id ? item : action) })
      return {
        apply: (latest: AppData) => ({ ...latest, actions: latest.actions.map((action) => action.id === id ? next : action) }),
        rollback: (latest: AppData) => ({ ...latest, actions: latest.actions.map((action) => action.id === id && action.updated_at === next.updated_at ? item : action) }),
        persist: () => persistOrQueue(currentUser.id, 'dostigator_actions', rowPayload(next), descriptor),
        result: undefined,
        history: { descriptor, revert },
      }
    }, 'Статус действия не сохранён. Изменение отменено — попробуйте ещё раз.', mutationIntent('toggle-action', { id, resultNote }))
  }

  const deleteAction = async (id: string) => {
    const currentUser = requireUser()
    return executeMutation(currentUser.id, [['action', id], ['focus']], (current) => {
      const index = current.actions.findIndex((item) => item.id === id)
      if (index < 0) return { apply: (latest: AppData) => latest, rollback: (latest: AppData) => latest, persist: async () => undefined, result: undefined }
      const item = current.actions[index]
      const mutationId = crypto.randomUUID()
      const focusDeleteDate = localDate()
      const cancelled = nextRevision<ActionItem>({ ...item, status: 'cancelled', focus_date: null, focus_position: null, completed_at: null, updated_at: now() }, mutationId)
      const descriptor = historyDescriptor(mutationId, 'action', id, 'action_delete', `Удалено действие «${item.title}»`, item.revision ?? 0, item)
      const revert = (latest: AppData) => {
        const currentItem = latest.actions.find((action) => action.id === id)
        if (currentItem && currentItem.status !== 'cancelled') return latest
        const reconciled = reconcileFocusCommitments(latest, currentItem, item, null)
        const actions = reconciled.actions.filter((action) => action.id !== id)
        actions.splice(Math.min(index, actions.length), 0, item)
        return { ...reconciled, actions }
      }
      return {
        apply: (latest: AppData) => {
          const currentItem = latest.actions.find((action) => action.id === id)
          const reconciled = reconcileFocusCommitments(latest, currentItem, cancelled, mutationId, focusDeleteDate)
          return { ...reconciled, actions: reconciled.actions.map((action) => action.id === id ? cancelled : action) }
        },
        rollback: revert,
        persist: () => persistOrQueue(currentUser.id, 'dostigator_actions', {
          ...rowPayload(cancelled), focus_delete_date: focusDeleteDate,
        }, descriptor),
        result: undefined,
        history: { descriptor, revert },
      }
    }, 'Действие не удалено. Изменение отменено — попробуйте ещё раз.', mutationIntent('delete-action', id))
  }

  const toggleFocus = async (id: string) => {
    const currentUser = requireUser()
    return executeMutation(currentUser.id, [['action', id], ['focus']], (current) => {
      const item = current.actions.find((action) => action.id === id)
      if (!item || item.status !== 'todo') return { apply: (latest: AppData) => latest, rollback: (latest: AppData) => latest, persist: async () => undefined, result: undefined }
      const today = localDate()
      const alreadyFocused = item.focus_date === today
      const focus = dailyFocus(current.actions, today)
      if (!alreadyFocused && focus.usedSlots >= FOCUS_LIMIT) throw new Error('На сегодня уже выбраны три главных действия')
      const used = new Set(current.actions.filter((action) => action.id !== id && action.focus_date === today && action.status !== 'cancelled').map((action) => action.focus_position))
      const position = alreadyFocused ? null : Array.from({ length: FOCUS_LIMIT }, (_, index) => index + 1).find((candidate) => !used.has(candidate)) ?? null
      if (!alreadyFocused && position === null) throw new Error('На сегодня уже выбраны три главных действия')
      const mutationId = crypto.randomUUID()
      const next = nextRevision({ ...item, focus_date: alreadyFocused ? null : today, focus_position: position, updated_at: now() }, mutationId)
      const operation = alreadyFocused ? 'focus_remove' : 'focus_add'
      const descriptor = historyDescriptor(mutationId, 'action', id, operation, alreadyFocused ? `Убрано из фокуса «${item.title}»` : `Добавлено в фокус «${item.title}»`, item.revision ?? 0, item)
      const replaceWith = (latest: AppData, target: ActionItem, sourceId: string | null) => {
        const currentItem = latest.actions.find((action) => action.id === id)
        const reconciled = reconcileFocusCommitments(latest, currentItem, target, sourceId)
        return { ...reconciled, actions: reconciled.actions.map((action) => action.id === id ? target : action) }
      }
      const revert = (latest: AppData) => replaceWith(latest, item, null)
      return {
        apply: (latest: AppData) => replaceWith(latest, next, mutationId),
        rollback: (latest: AppData) => latest.actions.find((action) => action.id === id)?.updated_at === next.updated_at
          ? replaceWith(latest, item, null) : latest,
        persist: () => persistOrQueue(currentUser.id, 'dostigator_actions', rowPayload(next), descriptor),
        result: undefined,
        history: { descriptor, revert },
      }
    }, 'Фокус не изменён. Изменение отменено — попробуйте ещё раз.', mutationIntent('toggle-focus', id))
  }

  const addHabit = async (title: string, targetPerWeek: number, areaId: string | null) => {
    const currentUser = requireUser()
    return executeMutation(currentUser.id, [['habit-add']], () => {
      const timestamp = now()
      const mutationId = crypto.randomUUID()
      const safeTarget = Math.min(7, Math.max(1, Math.round(targetPerWeek)))
      const safeTitle = title.trim()
      if (!safeTitle || safeTitle.length > 140) throw new Error('Название привычки должно содержать от 1 до 140 символов')
      const habit: Habit = {
        id: crypto.randomUUID(), user_id: currentUser.id, area_id: areaId, title: safeTitle,
        target_per_week: safeTarget, active: true, activity_periods: [{ started_on: localDate(), ended_on: null }], created_at: timestamp, updated_at: timestamp,
        revision: 1, last_mutation_id: mutationId,
      }
      const descriptor = historyDescriptor(mutationId, 'habit', habit.id, 'habit_create', `Создана привычка «${habit.title}»`, 0, null)
      const revert = (latest: AppData) => ({ ...latest, habits: latest.habits.filter((item) => item.id !== habit.id) })
      return {
        apply: (latest) => latest.habits.some((item) => item.id === habit.id) ? latest : { ...latest, habits: [...latest.habits, habit] },
        rollback: revert,
        persist: () => persistOrQueue(currentUser.id, 'dostigator_habits', rowPayload(habit), descriptor),
        result: habit,
        history: { descriptor, revert },
      }
    }, 'Привычка не сохранена. Изменение отменено — попробуйте ещё раз.', mutationIntent('add-habit', { title, targetPerWeek: Math.min(7, Math.max(1, Math.round(targetPerWeek))), areaId }), false)
  }

  const updateHabit = async (id: string, updates: Partial<Pick<Habit, 'title' | 'target_per_week' | 'area_id'>>) => {
    const currentUser = requireUser()
    return executeMutation(currentUser.id, [['habit', id]], (current) => {
      const habit = current.habits.find((item) => item.id === id && item.user_id === currentUser.id)
      if (!habit) return { apply: (latest: AppData) => latest, rollback: (latest: AppData) => latest, persist: async () => undefined, result: undefined }
      const normalized = {
        ...updates,
        ...(updates.title !== undefined ? { title: updates.title.trim() } : {}),
        ...(updates.target_per_week !== undefined ? { target_per_week: Math.min(7, Math.max(1, Math.round(updates.target_per_week))) } : {}),
      }
      if (normalized.title !== undefined && (!normalized.title || normalized.title.length > 140)) throw new Error('Название привычки должно содержать от 1 до 140 символов')
      if (!Object.entries(normalized).some(([key, value]) => habit[key as keyof Habit] !== value)) {
        return { apply: (latest: AppData) => latest, rollback: (latest: AppData) => latest, persist: async () => undefined, result: undefined }
      }
      const mutationId = crypto.randomUUID()
      const next = nextRevision({ ...habit, ...normalized, updated_at: now() }, mutationId)
      const descriptor = historyDescriptor(mutationId, 'habit', id, 'habit_edit', `Изменена привычка «${next.title}»`, habit.revision ?? 0, habit)
      const revert = (latest: AppData) => ({ ...latest, habits: latest.habits.map((item) => item.id === id ? habit : item) })
      return {
        apply: (latest: AppData) => ({ ...latest, habits: latest.habits.map((item) => item.id === id ? next : item) }),
        rollback: (latest: AppData) => ({ ...latest, habits: latest.habits.map((item) => item.id === id && item.updated_at === next.updated_at ? habit : item) }),
        persist: () => persistOrQueue(currentUser.id, 'dostigator_habits', rowPayload(next), descriptor),
        result: undefined,
        history: { descriptor, revert },
      }
    }, 'Привычка не изменена. Изменение отменено — попробуйте ещё раз.', mutationIntent('update-habit', { id, updates }))
  }

  const toggleHabitToday = async (habitId: string, note = '') => {
    const currentUser = requireUser()
    const safeNote = note.trim()
    if (Array.from(safeNote).length > 500) throw new Error('Заметка должна содержать не больше 500 символов')
    return executeMutation(currentUser.id, [['habit', habitId]], (current) => {
      const today = localDate()
      const habit = current.habits.find((item) => item.id === habitId && item.user_id === currentUser.id)
      if (!habit || !habit.active) throw new Error('Привычка недоступна или находится на паузе')
      const isWorkout = current.areas.some((area) => area.id === habit.area_id && area.name.trim().toLocaleLowerCase('ru-RU') === 'тренировки')
      const existingIndex = current.checkins.findIndex((item) => item.habit_id === habitId && item.checked_on === today && item.user_id === currentUser.id)
      if (existingIndex >= 0) {
        const existing = current.checkins[existingIndex]
        const mutationId = crypto.randomUUID()
        const descriptor = historyDescriptor(mutationId, 'habit_checkin', existing.id, 'habit_uncheck', isWorkout ? `Удалена тренировка «${habit.title}»` : `Снята отметка «${habit.title}»`, existing.revision ?? 0, existing)
        const revert = (latest: AppData) => {
          if (latest.checkins.some((item) => item.id === existing.id)) return latest
          const checkins = [...latest.checkins]
          checkins.splice(Math.min(existingIndex, checkins.length), 0, existing)
          return { ...latest, checkins }
        }
        return {
          apply: (latest: AppData) => ({ ...latest, checkins: latest.checkins.filter((item) => item.id !== existing.id) }),
          rollback: revert,
          persist: () => persistOrQueue(currentUser.id, 'dostigator_habit_checkins', rowPayload(existing), descriptor),
          result: undefined,
          history: { descriptor, revert },
        }
      }
      const mutationId = crypto.randomUUID()
      const checkin: HabitCheckin = {
        id: crypto.randomUUID(), user_id: currentUser.id, habit_id: habitId,
        checked_on: today, note: safeNote, created_at: now(),
        revision: 1, last_mutation_id: mutationId,
      }
      const descriptor = historyDescriptor(mutationId, 'habit_checkin', checkin.id, 'habit_check', isWorkout ? `Записана тренировка «${habit.title}»` : `Отмечена привычка «${habit.title}»`, 0, null)
      const revert = (latest: AppData) => ({ ...latest, checkins: latest.checkins.filter((item) => item.id !== checkin.id) })
      return {
        apply: (latest: AppData) => latest.checkins.some((item) => item.id === checkin.id) ? latest : { ...latest, checkins: [checkin, ...latest.checkins] },
        rollback: revert,
        persist: () => persistOrQueue(currentUser.id, 'dostigator_habit_checkins', rowPayload(checkin), descriptor),
        result: undefined,
        history: { descriptor, revert },
      }
    }, 'Отметка не сохранена. Изменение отменено — попробуйте ещё раз.', mutationIntent('toggle-habit-today', { habitId, note: safeNote }))
  }

  const setHabitActive = async (id: string, active: boolean) => {
    const currentUser = requireUser()
    return executeMutation(currentUser.id, [['habit', id]], (current) => {
      const habit = current.habits.find((item) => item.id === id && item.user_id === currentUser.id)
      if (!habit) return { apply: (latest: AppData) => latest, rollback: (latest: AppData) => latest, persist: async () => undefined, result: undefined }
      if (habit.active === active) return { apply: (latest: AppData) => latest, rollback: (latest: AppData) => latest, persist: async () => undefined, result: undefined }
      const today = localDate()
      const periods = habit.activity_periods?.length
        ? habit.activity_periods.map((period) => ({ ...period }))
        : [{ started_on: localDate(new Date(habit.created_at)), ended_on: habit.active ? null : localDate(new Date(habit.updated_at)) }]
      if (active) periods.push({ started_on: today, ended_on: null })
      else {
        const open = periods.findLastIndex((period) => period.ended_on === null)
        if (open >= 0) periods[open] = { ...periods[open], ended_on: today }
      }
      const mutationId = crypto.randomUUID()
      const next = nextRevision({ ...habit, active, activity_periods: periods, updated_at: now() }, mutationId)
      const operation = active ? 'habit_resume' : 'habit_pause'
      const descriptor = historyDescriptor(mutationId, 'habit', id, operation, active ? `Возобновлена привычка «${habit.title}»` : `Приостановлена привычка «${habit.title}»`, habit.revision ?? 0, habit)
      const revert = (latest: AppData) => ({ ...latest, habits: latest.habits.map((item) => item.id === id ? habit : item) })
      return {
        apply: (latest: AppData) => ({ ...latest, habits: latest.habits.map((item) => item.id === id ? next : item) }),
        rollback: (latest: AppData) => ({ ...latest, habits: latest.habits.map((item) => item.id === id && item.updated_at === next.updated_at ? habit : item) }),
        persist: () => persistOrQueue(currentUser.id, 'dostigator_habits', rowPayload(next), descriptor),
        result: undefined,
        history: { descriptor, revert },
      }
    }, 'Статус привычки не сохранён. Изменение отменено — попробуйте ещё раз.', mutationIntent('set-habit-active', { id, active }))
  }

  const saveReview = async (week: string, input: Pick<WeeklyReview, 'wins' | 'blockers' | 'next_focus' | 'self_score'>, metrics: WeeklyMetrics) => {
    const currentUser = requireUser()
    const normalizedInput = { ...input, wins: input.wins.trim(), blockers: input.blockers.trim(), next_focus: input.next_focus.trim() }
    if (startOfWeek(new Date(`${week}T12:00:00`)) !== week || week > startOfWeek()) throw new Error('Некорректная неделя обзора')
    if (metrics.period.weekStart !== week || metrics.period.asOf < week || metrics.period.asOf > shiftDate(week, 6) || metrics.score !== null && (metrics.score < 0 || metrics.score > 100)) throw new Error('Некорректный снимок обзора')
    if (normalizedInput.wins.length > 3000 || normalizedInput.blockers.length > 3000 || normalizedInput.next_focus.length > 2000) throw new Error('Текст обзора превышает допустимую длину')
    if (normalizedInput.self_score !== null && (!Number.isInteger(normalizedInput.self_score) || normalizedInput.self_score < 1 || normalizedInput.self_score > 10)) throw new Error('Самооценка должна быть от 1 до 10')
    return executeMutation(currentUser.id, [['review', week]], (current) => {
      const existing = current.reviews.find((item) => item.week_start === week && item.user_id === currentUser.id)
      const previousIndex = current.reviews.findIndex((item) => item.week_start === week && item.user_id === currentUser.id)
      const timestamp = now()
      const mutationId = crypto.randomUUID()
      const draft: WeeklyReview = {
        id: existing?.id ?? crypto.randomUUID(), user_id: currentUser.id, week_start: week,
        ...normalizedInput, metrics_snapshot: existing?.metrics_snapshot ?? metrics, created_at: existing?.created_at ?? timestamp, updated_at: timestamp,
        revision: existing?.revision ?? 0, last_mutation_id: existing?.last_mutation_id ?? null,
      }
      const review = existing ? nextRevision(draft, mutationId) : { ...draft, revision: 1, last_mutation_id: mutationId }
      const changed = !existing || existing.wins !== review.wins || existing.blockers !== review.blockers
        || existing.next_focus !== review.next_focus || existing.self_score !== review.self_score
      if (!changed) return { apply: (latest: AppData) => latest, rollback: (latest: AppData) => latest, persist: async () => undefined, result: undefined }
      const operation = existing ? 'review_edit' : 'review_create'
      const descriptor = historyDescriptor(mutationId, 'review', review.id, operation, existing ? `Обновлён обзор недели ${week}` : `Создан обзор недели ${week}`, existing?.revision ?? 0, existing ?? null)
      const revert = (latest: AppData) => {
        const withoutReview = latest.reviews.filter((item) => item.id !== review.id)
        if (!existing) return { ...latest, reviews: withoutReview }
        const reviews = [...withoutReview]
        reviews.splice(Math.min(Math.max(previousIndex, 0), reviews.length), 0, existing)
        return { ...latest, reviews }
      }
      return {
        apply: (latest: AppData) => ({ ...latest, reviews: [review, ...latest.reviews.filter((item) => item.week_start !== week || item.user_id !== currentUser.id)] }),
        rollback: (latest: AppData) => {
          const withoutOptimistic = latest.reviews.filter((item) => !(item.id === review.id && item.updated_at === review.updated_at))
          if (!existing) return { ...latest, reviews: withoutOptimistic }
          if (withoutOptimistic.some((item) => item.week_start === week && item.user_id === currentUser.id)) return latest
          const reviews = [...withoutOptimistic]
          reviews.splice(Math.min(Math.max(previousIndex, 0), reviews.length), 0, existing)
          return { ...latest, reviews }
        },
        persist: () => persistOrQueue(currentUser.id, 'dostigator_weekly_reviews', rowPayload(review), descriptor),
        result: undefined,
        history: { descriptor, revert },
      }
    }, 'Обзор не сохранён. Изменение отменено — попробуйте ещё раз.', mutationIntent('save-review', { week, input }), false)
  }

  const visibleData = dataOwnerId === (user?.id ?? null) ? data : empty
  const visibleMutationError = mutationNotice && mutationNotice.ownerId === user?.id ? mutationNotice.message : null
  const value: DataValue = {
    data: visibleData, loading: loading || dataOwnerId !== (user?.id ?? null), error, mutationError: visibleMutationError, pending, failedSync,
    quarantinedSync, legacySyncQuarantine, syncing, online,
    historyNotice: historyNotice?.ownerId === user?.id ? historyNotice : null,
    clearMutationError, dismissHistoryNotice, undoLastMutation, undoHistoryMutation, isMutating, refresh, retrySync, resolveFailedSync,
    addGoal, updateGoal, addAction, updateAction, toggleAction, deleteAction, toggleFocus,
    addHabit, updateHabit, toggleHabitToday, setHabitActive, saveReview,
  }

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData() {
  const value = useContext(DataContext)
  if (!value) throw new Error('useData must be used inside DataProvider')
  return value
}
