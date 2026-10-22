import { useEffect, useRef, useState } from 'react'
import type { SetEntryValues } from '../lib/set-logging'
import { formatSetResult } from '../lib/set-logging'
import { formatNumber, parseRepRange, validateWorkoutSetValue } from '../lib/workout'
import { formatSetTarget, type SetTarget } from '../lib/workout-targets'
import type { WorkoutSetDraft } from '../types/training'

type Props = {
  set: WorkoutSetDraft
  userId: string
  exerciseName: string
  displayNumber: number
  total: number
  targetText: string
  timed: boolean
  previous?: WorkoutSetDraft
  historyFromCache?: boolean
  historyStatus?: 'loading' | 'ready' | 'error'
  target?: SetTarget
  locked?: boolean
  onRecord: (values: SetEntryValues) => boolean | void
  onCancelEdit: () => void
  onUndo: () => void
  onSkip: () => void
}

type Entry = Partial<Record<'weightKg' | 'reps' | 'rir', string>>

export function SetRecorder({ set, userId, exerciseName, displayNumber, total, targetText, timed, previous, historyStatus = 'ready', historyFromCache = false, target, locked = false, onRecord, onCancelEdit, onUndo, onSkip }: Props) {
  const key = `trainlog:set-entry:${userId}:${set.id}`
  const [entry, setEntry] = useState<Entry>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? 'null')
      return stored?.basis === set.completedAt && stored?.exerciseName === exerciseName ? stored.entry : {}
    } catch { return {} }
  })
  const submitted = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const headingRef = useRef<HTMLDivElement>(null)
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }) }, [])
  const [error, setError] = useState<string | null>(null)
  const name = `${exerciseName}, ${set.isWarmup ? 'разминка' : 'подход'} ${displayNumber}`
  const planWeight = target?.optional ? undefined : target?.weightKg
  const defaultWeight = timed ? (set.weightKg ?? 0) : (set.weightKg ?? planWeight ?? (previous?.done ? previous.weightKg : undefined) ?? target?.weightKg)
  const weight = entry.weightKg ?? (defaultWeight == null ? '' : String(defaultWeight))
  const reps = entry.reps ?? String(set.reps ?? (target && !target.optional ? target.reps : undefined) ?? (previous?.done ? previous.reps : undefined) ?? target?.reps ?? parseRepRange(targetText)?.min ?? '')
  const reserve = entry.rir ?? (set.rir === null ? '' : String(set.rir))
  const change = (field: keyof Entry, value: string) => {
    const next = { ...entry, [field]: value }
    setEntry(next)
    setError(null)
    try { localStorage.setItem(key, JSON.stringify({ basis: set.completedAt, exerciseName, entry: next })) } catch { setError('Ввод не удалось сохранить на устройстве. Оставь страницу открытой.') }
  }
  const record = () => {
    if (submitted.current) return
    const values = { weightKg: weight === '' ? null : Number(weight), reps: reps === '' ? null : Number(reps), rir: reserve === '' ? null : Number(reserve) }
    for (const field of ['weightKg', 'reps', 'rir'] as const) {
      const validation = validateWorkoutSetValue(field, values[field])
      if (!validation.valid) { setError(validation.message); return }
    }
    if (values.weightKg === null || values.reps === null) return
    submitted.current = true
    setSubmitting(true)
    try { if (onRecord(values) === false) { submitted.current = false; setSubmitting(false); return } } catch { submitted.current = false; setSubmitting(false); setError('Не удалось записать на устройство. Проверь доступность хранилища.'); return }
    try { localStorage.removeItem(key) } catch { /* confirmed fact already persisted */ }
  }
  return <section className="active-set" aria-label={name}>
    <div className="active-set-heading" ref={headingRef} tabIndex={-1}><strong>{set.done ? 'Исправление записи' : set.isWarmup ? 'Разминочный подход' : `Подход ${displayNumber} из ${total}`}</strong><span>{targetText}{timed ? '' : ' повторов'}</span></div>
    <div className="training-comparison"><div><span>Прошлый факт{historyFromCache?' · кэш':''}</span><strong>{historyStatus === 'loading' ? 'Загружаем…' : historyStatus === 'error' ? 'Недоступно' : previous ? formatSetResult(previous, timed) : 'Нет записи'}</strong></div><div><span>План{target?.optional ? ' · можно попробовать' : ''}</span><strong>{target ? formatSetTarget(target) : targetText}</strong></div></div>
    <p className="entry-caption entry-state">{set.done?'Исправь фактический результат':'Факт сегодня · подтвердится после записи'}</p>
    <div className={`active-set-inputs ${timed ? 'timed-entry' : ''}`}><label hidden={timed}>Вес, кг<input aria-label={`${name}, вес кг`} type="number" inputMode="decimal" min="0" max="1000" step="0.25" value={weight} placeholder="0 = свой вес" onChange={(event) => change('weightKg', event.target.value)} /></label><label>{timed ? 'Время, сек' : 'Повторения'}<div className="training-stepper"><button type="button" aria-label={timed ? 'Уменьшить время' : 'Уменьшить повторы'} disabled={!reps || Number(reps) <= 1} onClick={() => change('reps', String(Math.max(1, Number(reps) - 1)))}>−</button><input aria-label={`${name}, ${timed ? 'секунды' : 'повторы'}`} type="number" inputMode="numeric" min="1" max="1000" step="1" value={reps} onChange={(event) => change('reps', event.target.value)} /><button type="button" aria-label={timed ? 'Добавить секунду' : 'Добавить повтор'} disabled={Number(reps) >= 1000} onClick={() => change('reps', String(Math.min(1000, Number(reps || 0) + 1)))}>+</button></div></label></div>

    {set.done && <p className="entry-caption">{set.done ? `Сохранённый факт: ${formatSetResult(set, timed)}` : ''}</p>}
    {error && <p className="error-card" role="alert">{error}</p>}
    <button type="button" className="primary-button training-record-button" disabled={!weight || !reps || submitting || (!set.done && locked)} aria-label={set.done ? `Сохранить исправление · ${name}` : `Записать подход ${displayNumber} · ${exerciseName}`} onClick={record}>{`${set.done ? 'Исправить' : 'Записать'}: ${timed ? `${reps || '—'} сек` : `${weight === '' ? '—' : formatNumber(Number(weight))} кг × ${reps || '—'}`}`}</button>
    {!set.done && target?.optional && <button type="button" className="training-secondary" onClick={() => { change('weightKg', String(target.weightKg ?? 0)); change('reps', String(target.reps)); setEntry((current) => { const next = { ...current, weightKg: String(target.weightKg ?? 0), reps: String(target.reps) }; try { localStorage.setItem(key, JSON.stringify({ basis: set.completedAt, exerciseName, entry: next })) } catch { setError('Предложение применено только на экране; локальное хранение недоступно.') }; return next }) }}>Попробовать: {formatSetTarget(target)}</button>}
    {set.done && <button type="button" className="text-button" onClick={() => { localStorage.removeItem(key); onCancelEdit() }}>Отменить исправление</button>}
    <details className="training-extras"><summary>Дополнительно</summary><label>Запас повторов · необязательно<select aria-label={`${name}, запас повторов`} value={reserve} onChange={(event) => change('rir', event.target.value)}><option value="">Не оценивал</option>{[0, 1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value === 5 ? '5+' : value} {timed ? '· оценка запаса' : 'повторов ещё'}</option>)}</select></label><small>{timed ? 'Приблизительная оценка запаса для удержания.' : 'Сколько повторов смог бы сделать с чистой техникой, без отдыха.'}</small>{set.done ? <button type="button" className="text-button" onClick={onUndo}>Снять отметку выполнения</button> : <button type="button" className="text-button" onClick={onSkip}>Пропустить этот подход</button>}</details>
  </section>
}
