import { useId } from 'react'
import { formatSet } from '../lib/workout'
import { formatSetTarget, type SetTarget } from '../lib/workout-targets'
import type { SetEntryValues } from '../lib/set-logging'
import type { WorkoutSetDraft } from '../types/training'

type Props = {
  set: WorkoutSetDraft
  exerciseName: string
  displayNumber: number
  targetText: string
  timed: boolean
  previous?: WorkoutSetDraft
  previousInSession?: WorkoutSetDraft
  target?: SetTarget
  onChange: (field: 'weightKg' | 'reps' | 'rir', value: number | null) => void
  onApply: (values: SetEntryValues) => void
  onComplete: () => void
}

export function SetRecorder({ set, exerciseName, displayNumber, targetText, timed, previous, previousInSession, target, onChange, onApply, onComplete }: Props) {
  const id = useId()
  const complete = set.weightKg !== null && set.reps !== null && set.rir !== null
  const entryName = `${exerciseName}, ${set.isWarmup ? 'разминка' : 'подход'} ${displayNumber}`
  const reserveLabels = timed ? ['На пределе', 'Минимум', 'Немного', 'Умеренно', 'Много', 'Очень много'] : ['Ни одного', 'Ещё 1', 'Ещё 2', 'Ещё 3', 'Ещё 4', '5 и больше']
  return (
    <div className="set-recorder">
      {!set.isWarmup && <div className="set-comparison"><div><span>Прошлый раз</span><strong>{previous ? timed ? `${previous.reps} сек · RIR ${previous.rir ?? '—'}` : formatSet(previous) : 'Нет записи'}</strong></div><div className="set-target"><span>Цель сегодня</span><strong>{target ? formatSetTarget(target) : targetText}</strong><small>{target ? `запас ${target.rir} RIR` : 'выбери уверенный вес'}</small></div></div>}
      {!set.done && <div className="set-fill-actions">
        {target && <button type="button" onClick={() => onApply({ weightKg: target.weightKg ?? 0, reps: target.reps })}>Подставить цель</button>}
        {previous && <button type="button" onClick={() => onApply({ weightKg: previous.weightKg ?? 0, reps: previous.reps })}>Как в прошлый раз</button>}
        {previousInSession && <button type="button" onClick={() => onApply({ weightKg: previousInSession.weightKg ?? 0, reps: previousInSession.reps })}>Как прошлый подход</button>}
      </div>}
      <p className="set-entry-label">Заготовка для ввода — проверь фактический результат после выполнения. Сама по себе она не записывает подход.</p>
      <div className="set-entry-fields">
        <label>Вес, кг<input aria-label={`${entryName}, вес кг`} type="number" inputMode="decimal" min="0" max="1000" step="0.5" value={set.weightKg ?? ''} placeholder={previous?.weightKg?.toString() ?? '—'} onChange={(event) => onChange('weightKg', event.target.value === '' ? null : Number(event.target.value))} /></label>
        <label>{timed ? 'Время, сек' : 'Повторения'}<div className="rep-stepper"><button type="button" aria-label={timed ? 'Уменьшить время на 5 секунд' : 'Уменьшить повторы на 1'} disabled={set.reps === null || set.reps <= 1} onClick={() => onChange('reps', Math.max(1, (set.reps ?? 1) - (timed ? 5 : 1)))}>−</button><input aria-label={`${entryName}, ${timed ? 'секунды' : 'повторы'}`} type="number" inputMode="numeric" min="1" max="1000" step="1" value={set.reps ?? ''} placeholder={previous?.reps?.toString() ?? '—'} onChange={(event) => onChange('reps', event.target.value === '' ? null : Number(event.target.value))} /><button type="button" aria-label={timed ? 'Добавить 5 секунд' : 'Добавить повтор'} disabled={set.reps !== null && set.reps >= 1000} onClick={() => onChange('reps', Math.min(1000, (set.reps ?? 0) + (timed ? 5 : 1)))}>+</button></div></label>
      </div>
      <button type="button" className="text-button bodyweight-button" onClick={() => onChange('weightKg', 0)}>Без дополнительного веса · 0 кг</button>
      <fieldset className="reserve-picker"><legend>{timed ? 'Какой запас усилия остался? · RIR' : 'Сколько ещё повторов смог бы сделать? · RIR'}</legend><p>{timed ? 'Для удержания оцени запас приблизительно по ощущениям. Фактическое время укажи в секундах.' : 'Представь, сколько повторов сделал бы с чистой техникой, не отдыхая. Оцени заново после каждого подхода.'}</p><div className="reserve-options" role="radiogroup" aria-label={`Запас после подхода ${set.setNumber}`}>{reserveLabels.map((label, reserve) => <label key={reserve} className={set.rir === reserve ? 'selected' : ''}><input type="radio" name={id} value={reserve} checked={set.rir === reserve} aria-label={`RIR ${reserve}: ${label}`} onChange={() => onChange('rir', reserve)} /><strong>{reserve === 5 ? '5+' : reserve}</strong><span>{label}</span></label>)}</div></fieldset>
      {set.rir !== null && set.rir <= 1 && <p className="set-feedback">Запас небольшой: следующий подход без прибавки веса, при необходимости снизь нагрузку.</p>}
      <button className="primary-button wide" type="button" disabled={!complete || set.done} onClick={onComplete}>{set.done ? 'Подход записан' : set.isWarmup ? 'Записать разминку' : `Записать подход ${displayNumber}`}</button>
      {!complete && <p className="set-entry-hint">{set.weightKg === null ? 'Укажи вес или выбери 0 кг. ' : ''}{set.reps === null ? `Укажи ${timed ? 'время' : 'повторения'}. ` : ''}{set.rir === null ? 'Выбери запас после выполнения.' : ''}</p>}
    </div>
  )
}
