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
  exerciseKey?: string
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

export function SetRecorder({ set, userId, exerciseName, exerciseKey, displayNumber, total, targetText, timed, previous, historyStatus = 'ready', historyFromCache = false, target, locked = false, onRecord, onCancelEdit, onUndo, onSkip }: Props) {
  const cable = ['pallof_press', 'cable_hip_extension', 'lat_pulldown', 'seated_row', 'triceps_pushdown', 'cable_row'].includes(exerciseKey ?? '')
  const bodyweight = timed || ['knee_raise', 'plank', 'calf_raise'].includes(exerciseKey ?? '')
  const zeroLabel = bodyweight ? 'Свой вес' : '0 кг'
  const resultText = (value: WorkoutSetDraft) => !timed && value.weightKg === 0 ? `${zeroLabel} × ${value.reps ?? '—'}` : formatSetResult(value, timed)
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
    if (values.weightKg === null || values.reps === null) { setError('Укажи сопротивление или вес и повторы.'); return }
    if (cable && values.weightKg <= 0) { setError('Укажи сопротивление блока больше 0 по шкале тренажёра.'); return }
    submitted.current = true
    setSubmitting(true)
    try { if (onRecord(values) === false) { submitted.current = false; setSubmitting(false); return } } catch { submitted.current = false; setSubmitting(false); setError('Не удалось записать на устройство. Проверь доступность хранилища.'); return }
    try { localStorage.removeItem(key) } catch { /* confirmed fact already persisted */ }
  }
  return <section className="active-set" aria-label={name}>
    <div className="active-set-heading" ref={headingRef} tabIndex={-1}><strong>{set.done ? 'Исправление записи' : set.isWarmup ? 'Разминочный подход' : `Подход ${displayNumber} из ${total}`}</strong><span>{targetText}{timed ? '' : ' повторов'}</span></div>
    <div className="training-comparison"><div><span>Прошлый факт{historyFromCache?' · кэш':''}</span><strong>{historyStatus === 'loading' ? 'Загружаем…' : historyStatus === 'error' ? 'Недоступно' : previous ? resultText(previous) : 'Нет записи'}</strong></div><div><span>План{target?.optional ? ' · можно попробовать' : ''}</span><strong>{target ? formatSetTarget(target) : targetText}</strong></div></div>
    <p className="entry-caption entry-state">{set.done?'Исправь фактический результат':'Факт сегодня · подтвердится после записи'}</p>
    <div className={`active-set-inputs ${timed ? 'timed-entry' : ''}`}><label hidden={timed}>{cable ? 'Сопротивление, кг' : 'Вес, кг'}<input aria-label={`${name}, вес кг`} type="number" inputMode="decimal" min="0" max="1000" step="0.25" value={weight} placeholder={cable ? 'По шкале блока' : bodyweight ? '0 = свой вес' : 'Вес по шкале/снаряду'} onChange={(event) => change('weightKg', event.target.value)} /></label><label>{timed ? 'Время, сек' : 'Повторения'}<div className="training-stepper"><button type="button" aria-label={timed ? 'Уменьшить время' : 'Уменьшить повторы'} disabled={!reps || Number(reps) <= 1} onClick={() => change('reps', String(Math.max(1, Number(reps) - 1)))}>−</button><input aria-label={`${name}, ${timed ? 'секунды' : 'повторы'}`} type="number" inputMode="numeric" min="1" max="1000" step="1" value={reps} onChange={(event) => change('reps', event.target.value)} /><button type="button" aria-label={timed ? 'Добавить секунду' : 'Добавить повтор'} disabled={Number(reps) >= 1000} onClick={() => change('reps', String(Math.min(1000, Number(reps || 0) + 1)))}>+</button></div></label></div>

    {!timed && <p className="entry-caption">{cable ? 'Запиши сопротивление по шкале блока; сохраняй тот же тренажёр для сравнения.' : bodyweight ? '0 кг — работа с собственным весом.' : 'Укажи вес по шкале тренажёра или вес снаряда. 0 кг — только если внешней нагрузки действительно нет.'}</p>}
    {set.done && <p className="entry-caption">{set.done ? `Сохранённый факт: ${resultText(set)}` : ''}</p>}
    {error && <p className="error-card" role="alert">{error}</p>}
    <button type="button" className="primary-button training-record-button" disabled={!weight || !reps || submitting || (!set.done && locked)} aria-label={set.done ? `Сохранить исправление · ${name}` : `Записать подход ${displayNumber} · ${exerciseName}`} onClick={record}>{!weight && !timed ? (cable ? 'Укажи сопротивление блока' : 'Укажи вес · 0 допустимо') : !reps ? (timed ? 'Укажи время' : 'Укажи повторы') : `${set.done ? 'Исправить' : 'Записать'}: ${timed ? `${reps} сек` : `${Number(weight) === 0 ? zeroLabel : `${formatNumber(Number(weight))} кг`} × ${reps}`}`}</button>
    {!set.done && target?.optional && <button type="button" className="training-secondary" onClick={() => { change('weightKg', String(target.weightKg ?? 0)); change('reps', String(target.reps)); setEntry((current) => { const next = { ...current, weightKg: String(target.weightKg ?? 0), reps: String(target.reps) }; try { localStorage.setItem(key, JSON.stringify({ basis: set.completedAt, exerciseName, entry: next })) } catch { setError('Предложение применено только на экране; локальное хранение недоступно.') }; return next }) }}>Попробовать: {formatSetTarget(target)}</button>}
    {set.done && <button type="button" className="text-button" onClick={() => { localStorage.removeItem(key); onCancelEdit() }}>Отменить исправление</button>}
    <details className="training-extras set-advanced"><summary><span><strong>Запас повторов · необязательно</strong><small>Оценка нагрузки после подхода</small></span></summary><label>Запас повторов · необязательно<select aria-label={`${name}, запас повторов`} value={reserve} onChange={(event) => change('rir', event.target.value)}><option value="">Не оценивал</option>{[0, 1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value === 5 ? '5+' : value} {timed ? '· оценка запаса' : 'повторов ещё'}</option>)}</select></label><small>{timed ? 'Приблизительная оценка запаса для удержания.' : 'Сколько повторов смог бы сделать с чистой техникой, без отдыха.'}</small>{set.done ? <button type="button" className="text-button" onClick={onUndo}>Снять отметку выполнения</button> : null}</details>
    {!set.done && <button type="button" className="text-button set-skip-button" onClick={onSkip}>Пропустить этот подход</button>}
  </section>
}
