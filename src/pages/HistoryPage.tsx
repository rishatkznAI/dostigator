import { AlertTriangle, CheckCircle2, Clock3, History, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { confirmedUndoQueueBlockReason } from '../lib/historyUndo'
import { queuedUndoBlockReason, readQueue } from '../lib/offline'
import { loadHistoryPage } from '../lib/repository'
import type { AppData, HistoryEvent, PendingOperation } from '../types'

const fieldNames: Record<string, string> = {
  title: 'Название',
  date: 'Дата записи',
  entry_type: 'Тип записи',
  content: 'Содержание',
  description: 'Описание',
  why: 'Причина',
  kind: 'Тип',
  area_id: 'Сфера',
  target_date: 'Срок',
  due_date: 'Срок',
  result_note: 'Комментарий',
  status: 'Статус',
  progress: 'Прогресс',
  focus_date: 'Дата фокуса',
  focus_position: 'Позиция фокуса',
  active: 'Активность',
  target_per_week: 'Раз в неделю',
  wins: 'Победы',
  blockers: 'Препятствия',
  next_focus: 'Следующий фокус',
  self_score: 'Самооценка',
  checked_on: 'Дата',
  note: 'Заметка',
  goal_id: 'Цель',
  habit_id: 'Привычка',
  activity_periods: 'Периоды активности',
  metrics_snapshot: 'Снимок недели',
  completed_at: 'Завершено',
}

const hiddenFields = new Set(['id', 'user_id', 'revision', 'last_mutation_id', 'created_at', 'updated_at'])
const enumNames: Record<string, string> = {
  idea: 'Идея', plan: 'План', 'day-note': 'Как прошёл день',
  goal: 'Цель', project: 'Проект', active: 'Активно', paused: 'На паузе', completed: 'Завершено',
  archived: 'В архиве', todo: 'В работе', done: 'Выполнено', cancelled: 'Отменено',
}

function metricsSummary(value: Record<string, unknown>) {
  const score = typeof value.score === 'number' ? `индекс ${Math.round(value.score)}%` : 'индекс ещё не рассчитан'
  const focus = value.focus && typeof value.focus === 'object' && 'done' in value.focus
    ? `фокус ${String((value.focus as { done: unknown }).done)}` : null
  const habits = value.habits && typeof value.habits === 'object' && 'done' in value.habits
    ? `привычки ${String((value.habits as { done: unknown }).done)}` : null
  return [score, focus, habits].filter(Boolean).join(' · ')
}

function present(key: string, value: unknown, data: AppData) {
  if (value === null || value === undefined || value === '') return 'не задано'
  if (typeof value === 'boolean') return value ? 'да' : 'нет'
  if (key === 'area_id') return data.areas.find((item) => item.id === value)?.name ?? 'Сфера не найдена'
  if (key === 'goal_id') return data.goals.find((item) => item.id === value)?.title ?? 'Цель не найдена'
  if (key === 'habit_id') return data.habits.find((item) => item.id === value)?.title ?? 'Привычка не найдена'
  if (typeof value === 'string' && enumNames[value]) return enumNames[value]
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) {
    const date = new Date(value.length === 10 ? `${value}T12:00:00` : value)
    if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(date)
  }
  if (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) return 'Связанный объект'
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? 'период' : 'периода'}`
  if (typeof value === 'object') return key === 'metrics_snapshot'
    ? metricsSummary(value as Record<string, unknown>)
    : 'Состав данных изменён'
  return String(value)
}

function historyError(reason: unknown, fallback: string) {
  const message = reason instanceof Error ? reason.message : ''
  if (/dostigator_history_page|schema cache/i.test(message)) return 'История станет доступна после обновления базы данных приложения.'
  return message || fallback
}

function EventDiff({ event, data }: { event: Pick<HistoryEvent, 'before_data' | 'after_data'>; data: AppData }) {
  const [expanded, setExpanded] = useState(false)
  const keys = [...new Set([...Object.keys(event.before_data ?? {}), ...Object.keys(event.after_data ?? {})])]
    .filter((key) => !hiddenFields.has(key))
    .filter((key) => JSON.stringify(event.before_data?.[key]) !== JSON.stringify(event.after_data?.[key]))
  if (!keys.length) return null
  const visibleKeys = expanded ? keys : keys.slice(0, 5)
  return <><dl className="history-diff">{visibleKeys.map((key) => <div key={key}>
    <dt>{fieldNames[key] ?? key}</dt>
    <dd><span>{present(key, event.before_data?.[key], data)}</span><b aria-hidden="true">→</b><span>{present(key, event.after_data?.[key], data)}</span></dd>
  </div>)}</dl>{keys.length > 5 && <button className="secondary-button history-diff-more" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? 'Скрыть дополнительные поля' : `Показать ещё ${keys.length - 5}`}</button>}</>
}

function entityRevision(event: HistoryEvent, data: AppData) {
  const rows = event.entity_type === 'goal' ? data.goals
    : event.entity_type === 'action' ? data.actions
    : event.entity_type === 'habit' ? data.habits
    : event.entity_type === 'habit_checkin' ? data.checkins
    : event.entity_type === 'journal' ? data.journals ?? []
    : data.reviews
  return rows.find((row) => row.id === event.entity_id)?.revision ?? null
}

function pendingAsEvent(item: PendingOperation, ownerId: string): HistoryEvent | null {
  if (item.ownerId !== ownerId) return null
  if (item.type === 'mutation' && item.mutation) {
    return {
      id: item.id,
      user_id: ownerId,
      mutation_id: item.mutationId,
      entity_type: item.mutation.entityType,
      entity_id: item.mutation.entityId,
      operation: item.mutation.operation,
      label: item.label,
      before_data: item.mutation.before,
      after_data: item.mutation.operation === 'journal_delete' ? null : item.payload ?? null,
      base_revision: item.mutation.baseRevision,
      result_revision: item.mutation.baseRevision + 1,
      source: 'offline',
      reverts_event_id: null,
      created_at: item.createdAt,
    }
  }
  if (item.type === 'undo' && item.mutation) {
    return {
      id: item.id,
      user_id: ownerId,
      mutation_id: item.mutationId,
      entity_type: item.mutation.entityType,
      entity_id: item.mutation.entityId,
      operation: 'undo',
      label: item.label,
      before_data: null,
      after_data: item.mutation.before,
      base_revision: item.mutation.baseRevision + 1,
      result_revision: item.mutation.baseRevision + 2,
      source: 'offline',
      reverts_event_id: null,
      created_at: item.createdAt,
    }
  }
  return null
}

export function HistoryPage() {
  const { user } = useAuth()
  const context = useData()
  const { online, undoHistoryMutation, clearMutationError } = context
  const globalAssertive = Boolean(
    context.mutationError || context.historyNotice?.status === 'failed' || context.failedSync > 0
    || context.quarantinedSync > 0 || context.legacySyncQuarantine || context.error,
  )
  const data = context.data ?? { areas: [], goals: [], actions: [], habits: [], checkins: [], reviews: [] }
  const [events, setEvents] = useState<HistoryEvent[]>([])
  const [queue, setQueue] = useState<PendingOperation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [undoing, setUndoing] = useState<string | null>(null)
  const loadGeneration = useRef(0)
  const ownerIdRef = useRef(user?.id)
  useLayoutEffect(() => { ownerIdRef.current = user?.id }, [user?.id])

  const syncQueue = useCallback(() => {
    if (user && ownerIdRef.current === user.id) setQueue(readQueue(user.id))
  }, [user])

  const loadFirst = useCallback(async (silent = false) => {
    if (!user) return
    const requestOwnerId = user.id
    const generation = ++loadGeneration.current
    setLoadingMore(false)
    if (!silent) setLoading(true)
    setMessage(null); syncQueue()
    try {
      const page = await loadHistoryPage(null, 30)
      if (loadGeneration.current !== generation || ownerIdRef.current !== requestOwnerId) return
      setEvents(page)
      setHasMore(page.length === 30)
    } catch (reason) {
      if (loadGeneration.current !== generation || ownerIdRef.current !== requestOwnerId) return
      setMessage(historyError(reason, 'Не удалось загрузить историю'))
    } finally {
      if (loadGeneration.current === generation && ownerIdRef.current === requestOwnerId) setLoading(false)
    }
  }, [syncQueue, user])

  useEffect(() => { void loadFirst(false) }, [loadFirst])
  useEffect(() => {
    const queueChanged = () => { syncQueue(); void loadFirst(true) }
    window.addEventListener('dostigator:queue', queueChanged)
    return () => window.removeEventListener('dostigator:queue', queueChanged)
  }, [loadFirst, syncQueue])

  const localEvents = useMemo(() => user
    ? queue.map((item) => pendingAsEvent(item, user.id)).filter((item): item is HistoryEvent => Boolean(item))
    : [], [queue, user])
  const reverted = useMemo(() => new Set(events.map((event) => event.reverts_event_id).filter(Boolean)), [events])

  const more = async () => {
    const last = events.at(-1)
    if (!last || loadingMore) return
    setLoadingMore(true); setMessage(null)
    const generation = loadGeneration.current
    const requestOwnerId = user?.id
    try {
      const page = await loadHistoryPage({ createdAt: last.created_at, id: last.id }, 30)
      if (loadGeneration.current !== generation || ownerIdRef.current !== requestOwnerId) return
      setEvents((current) => [...current, ...page])
      setHasMore(page.length === 30)
    } catch (reason) {
      if (loadGeneration.current !== generation || ownerIdRef.current !== requestOwnerId) return
      setMessage(historyError(reason, 'Не удалось загрузить продолжение истории'))
    } finally {
      if (loadGeneration.current === generation && ownerIdRef.current === requestOwnerId) setLoadingMore(false)
    }
  }

  const undo = async (event: HistoryEvent) => {
    setUndoing(event.id); setMessage(null)
    try {
      await undoHistoryMutation(event)
      await loadFirst(false)
    } catch (reason) {
      clearMutationError()
      setMessage(reason instanceof Error ? reason.message : 'Не удалось отменить изменение')
    } finally {
      setUndoing(null)
    }
  }

  const renderEvent = (event: HistoryEvent, syncState: 'pending' | 'failed' | 'synced', operation?: PendingOperation) => {
    const wasReverted = reverted.has(event.id)
    const queuedInverse = !operation
      ? queue.find((item) => item.type === 'undo' && item.originalMutationId === event.mutation_id) : null
    const confirmedQueueBlock = !operation && syncState === 'synced'
      ? confirmedUndoQueueBlockReason(event, queue) : null
    const queueBlock = user && operation?.type === 'mutation'
      ? queuedUndoBlockReason(user.id, operation.mutationId)
      : queuedInverse ? queuedInverse.state === 'failed'
        ? 'Undo отклонён — разрешите конфликт в профиле'
        : 'Undo уже ожидает синхронизации'
        : confirmedQueueBlock
    const currentRevision = syncState === 'synced' ? entityRevision(event, data) : event.result_revision
    const missingRowIsExpected = event.after_data === null || event.operation === 'action_delete'
    const revisionBlock = syncState === 'synced' && currentRevision !== event.result_revision
      ? currentRevision === null && missingRowIsExpected ? null
        : currentRevision === null ? 'Объект больше не существует или ещё не загружен' : 'Есть более свежее изменение'
      : null
    const dependencyBlock = syncState === 'synced' && event.before_data === null
      ? event.entity_type === 'goal' && data.actions.some((action) => action.goal_id === event.entity_id)
        ? 'Сначала удалите связанные действия'
        : event.entity_type === 'habit' && data.checkins.some((checkin) => checkin.habit_id === event.entity_id)
          ? 'Сначала удалите связанные отметки'
          : null
      : null
    const canUndo = event.operation !== 'undo' && !wasReverted && !queueBlock && !revisionBlock && !dependencyBlock && (syncState !== 'synced' || online)
    const unavailable = queueBlock
      ?? (event.operation === 'undo' ? 'Это уже операция Undo'
      : syncState === 'synced' && !online ? 'Для Undo нужна сеть'
      : wasReverted ? 'Изменение уже отменено'
      : revisionBlock ?? dependencyBlock)
    return <article className="history-event" key={`${syncState}-${event.id}`}>
      <div className="history-event-head">
        <span className={`history-state ${syncState}`}>{syncState === 'synced' ? <CheckCircle2 /> : syncState === 'failed' ? <AlertTriangle /> : <Clock3 />}{syncState === 'synced' ? 'Синхронизировано' : syncState === 'failed' ? 'Ошибка' : 'Ожидает'}</span>
        <time dateTime={event.created_at}>{new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.created_at))}</time>
      </div>
      <h2>{event.label}</h2>
      <EventDiff event={event} data={data} />
      {operation?.lastError && <p className="history-error">Причина: {operation.lastError}</p>}
      <div className="history-event-actions">
        {canUndo && <button className="secondary-button" type="button" disabled={undoing === event.id} aria-busy={undoing === event.id} onClick={() => void undo(event)}><RotateCcw />{undoing === event.id ? 'Отменяем…' : 'Undo'}</button>}
        {unavailable && <small>{unavailable}</small>}
      </div>
    </article>
  }

  return <div className="page history-page">
    <PageHeader eyebrow="Контроль" title="История" text="Каждое подтверждённое изменение сохраняется на сервере. Undo не перезаписывает более свежие данные." />
    {message && <p className="form-message error" role={globalAssertive ? 'status' : 'alert'} aria-live={globalAssertive ? 'polite' : 'assertive'} aria-atomic="true">{message}</p>}
    {localEvents.length > 0 && <section className="history-section"><h2>Локальные изменения</h2>{localEvents.map((event) => {
      const item = queue.find((candidate) => candidate.id === event.id)
      return renderEvent(event, item?.state === 'failed' ? 'failed' : 'pending', item)
    })}</section>}
    <section className="history-section">
      <h2><History />Подтверждено сервером</h2>
      {loading ? <div className="skeleton-card" role="status"><span className="visually-hidden">Загружаем историю</span></div> : events.length ? events.map((event) => renderEvent(event, 'synced')) : !message ? <div className="empty-card"><History /><h3>История пока пуста</h3><p>Первое изменение цели, действия, привычки или обзора появится здесь.</p></div> : null}
      {hasMore && <button className="secondary-button history-more" disabled={loadingMore} onClick={() => void more()}>{loadingMore ? 'Загружаем…' : 'Показать ещё'}</button>}
    </section>
  </div>
}
