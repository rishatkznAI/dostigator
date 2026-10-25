import { useId, useState } from 'react'
import { parseRepRange } from '../lib/workout'
import type { HistoryWorkout } from '../types/training'
import './training-progress-charts.css'

type Point = { id: string; label: string; value: number | null; note?: string }
type ExerciseMetric = 'weight' | 'reps' | 'sets'
export type ExerciseProgressFact = {
  id: string
  finishedAt: string
  label: string
  target: string
  readinessMode: HistoryWorkout['readinessMode']
  timed: boolean | null
  weight: number | null
  reps: number | null
  sets: number
}

const shortDate = (stamp: string) => new Date(stamp).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
const chartNumber = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
const validNumber = (value: number | null) => value !== null && Number.isFinite(value) && value >= 0

// One point is one finished workout. Warm-ups, skipped and unfinished sets are
// excluded; zero additional weight is a recorded value, missing weight is not.
export function exerciseProgressFacts(history: HistoryWorkout[], exerciseKey: string): ExerciseProgressFact[] {
  const unique = new Map(history.map(workout => [workout.id, workout]))
  return [...unique.values()].flatMap(workout => {
    if (!Number.isFinite(Date.parse(workout.finishedAt))) return []
    const exercises = workout.exercises.filter(exercise => exercise.exerciseKey === exerciseKey && !exercise.skipped)
    const sets = exercises.flatMap(exercise => exercise.sets.filter(set => set.done && !set.isWarmup && !set.skipped))
    if (!sets.length) return []
    const targets = [...new Set(exercises.map(exercise => exercise.target.trim()))].sort()
    const timedValues = [...new Set(exercises.map(exercise => Boolean(parseRepRange(exercise.target)?.timed)))]
    const timed = timedValues.length === 1 ? timedValues[0] : null
    return [{ id: workout.id, finishedAt: workout.finishedAt, label: shortDate(workout.finishedAt),
      target: targets.join(' / '), readinessMode: workout.readinessMode, timed,
      weight: sets.every(set => validNumber(set.weightKg)) ? Math.max(...sets.map(set => set.weightKg!)) : null,
      reps: timed !== null && sets.every(set => validNumber(set.reps)) ? sets.reduce((sum, set) => sum + set.reps!, 0) : null,
      sets: sets.length }]
  }).sort((a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt))
}

export function comparableExerciseFacts(fact: ExerciseProgressFact, baseline: ExerciseProgressFact) {
  return fact.target === baseline.target && fact.readinessMode === baseline.readinessMode && fact.sets === baseline.sets && fact.timed === baseline.timed
}

export function exerciseMetricPoints(facts: ExerciseProgressFact[], metric: ExerciseMetric, comparableOnly: boolean): Point[] {
  const baseline = facts.at(-1)
  return facts.map(fact => {
    const comparable = baseline && comparableExerciseFacts(fact, baseline)
    const sameUnit = metric !== 'reps' || fact.timed === baseline?.timed
    const included = sameUnit && (!comparableOnly || comparable)
    return { id: fact.id, label: fact.label, value: included ? fact[metric] : null,
      note: !sameUnit ? 'Другая единица: повторы и секунды не объединяем' : !included ? 'Отличаются цель, режим или число подходов' : fact[metric] === null ? 'Значение записано не во всех рабочих подходах' : undefined }
  })
}

function ProgressPlot({ title, unit, points, bars = false, formatValue }: { title: string; unit: string; points: Point[]; bars?: boolean; formatValue?: (value: number) => string }) {
  const captionId = useId()
  const known = points.filter((point): point is Point & { value: number } => point.value !== null && Number.isFinite(point.value))
  const max = Math.max(1, ...known.map(point => point.value))
  const width = 320, height = 152, inset = 12
  const x = (index: number) => points.length === 1 ? width / 2 : inset + index * (width - inset * 2) / Math.max(1, points.length - 1)
  const y = (value: number) => height - inset - value / max * (height - inset * 2)
  const path = points.map((point, index) => {
    if (point.value === null) return ''
    const command = index > 0 && points[index - 1].value !== null ? 'L' : 'M'
    return `${command}${x(index)},${y(point.value)}`
  }).join(' ')
  const latest = known.at(-1)
  const display = (value: number) => formatValue ? formatValue(value) : `${chartNumber(value)} ${unit}`
  return <figure className="training-metric-plot" aria-labelledby={captionId}>
    <figcaption id={captionId}><strong>{title}</strong><span>{latest ? `${display(latest.value)} · ${latest.label}` : 'Нет записанных значений'}</span></figcaption>
    {known.length ? <>
      <div className="training-metric-canvas"><div className="training-metric-y" aria-hidden="true"><span>{chartNumber(max)}</span><span>{chartNumber(max / 2)}</span><span>0</span></div>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}, ${unit}. Точек: ${known.length}. Значения доступны в списке под графиком.`} preserveAspectRatio="none">
          {[inset, height / 2, height - inset].map(line => <path key={line} className="training-metric-grid" d={`M0,${line}H${width}`} />)}
          {!bars && <path className="training-metric-line" d={path} />}
          {points.map((point, index) => point.value === null ? null : bars
            ? <rect key={point.id} className="training-metric-bar" x={x(index) - 8} y={y(point.value)} width="16" height={height - inset - y(point.value)} rx="4"><title>{point.label}: {display(point.value)}</title></rect>
            : <circle key={point.id} className="training-metric-dot" cx={x(index)} cy={y(point.value)} r="4"><title>{point.label}: {display(point.value)}</title></circle>)}
        </svg>
      </div>
      <div className="training-metric-x" aria-hidden="true"><span>{points[0]?.label}</span><span>{points.at(-1)?.label}</span></div>
    </> : <p className="training-metric-empty">График появится после записи подходов с этими значениями.</p>}
    <details className="training-metric-values"><summary>Значения графика</summary><ol>{points.map(point => <li key={point.id}><time>{point.label}</time><span>{point.value === null ? 'Нет точки' : display(point.value)}{point.note && <small>{point.note}</small>}</span></li>)}</ol></details>
  </figure>
}

export function ExerciseProgressCharts({ history, exerciseKey }: { history: HistoryWorkout[]; exerciseKey: string }) {
  const [metric, setMetric] = useState<ExerciseMetric>('weight')
  const [comparableOnly, setComparableOnly] = useState(true)
  const facts = exerciseProgressFacts(history, exerciseKey).slice(-12)
  const timed = facts.at(-1)?.timed === true
  const points = exerciseMetricPoints(facts, metric, comparableOnly)
  const baseline = facts.at(-1)
  const title = metric === 'weight' ? 'Максимальный записанный вес' : metric === 'sets' ? 'Выполненные рабочие подходы' : timed ? 'Время во всех рабочих подходах' : 'Повторы во всех рабочих подходах'
  const unit = metric === 'weight' ? 'кг' : metric === 'sets' ? 'подх.' : timed ? 'сек' : 'повт.'
  return <div className="training-progress-charts">
    <div className="training-metric-switch" role="group" aria-label="Показатель упражнения">
      {(['weight', 'reps', 'sets'] as const).map(value => <button key={value} type="button" aria-pressed={metric === value} onClick={() => setMetric(value)}>{value === 'weight' ? 'Вес' : value === 'sets' ? 'Подходы' : timed ? 'Время' : 'Повторы'}</button>)}
    </div>
    <p className="training-chart-context">Тренировок на графике: {facts.length}, максимум 12 последних. Каждая точка — одна тренировка.</p>
    <label className="training-comparable-toggle"><input type="checkbox" checked={comparableOnly} onChange={event => setComparableOnly(event.target.checked)} /><span>Сопоставимые условия</span></label>
    <p className="training-chart-context">{comparableOnly && baseline ? `Как в последней записи: ${baseline.sets} раб. подх. · ${baseline.target} · ${baseline.readinessMode === 'reduced' ? 'облегчённый режим' : baseline.readinessMode === 'normal' ? 'обычный режим' : 'режим не оценён'}.` : 'Все записанные факты. Цель, режим и число подходов могут отличаться.'} Пропущенные значения показаны разрывом, а не нулём.</p>
    <ProgressPlot title={title} unit={unit} points={points} />
    <p className="training-chart-context">{metric === 'weight' ? 'Максимум среди рабочих подходов, не оценка силы. 0 кг — записанный подход без дополнительного веса.' : metric === 'sets' ? 'Только выполненные рабочие подходы. Разминка и пропуски не включены.' : 'Сумма по рабочим подходам; при другом числе подходов она может измениться.'}</p>
  </div>
}

type Week = { from: string; workouts: number; sets: number; cardioSeconds: number }
export function WeeklyProgressChart({ weeks }: { weeks: Week[] }) {
  const [metric, setMetric] = useState<'workouts' | 'sets' | 'cardioSeconds'>('workouts')
  const title = metric === 'workouts' ? 'Силовые тренировки по неделям' : metric === 'sets' ? 'Рабочие подходы по неделям' : 'Время кардио по неделям'
  const points = [...weeks].reverse().map(week => ({ id: week.from, label: shortDate(`${week.from}T12:00:00`), value: metric === 'cardioSeconds' ? week.cardioSeconds / 60 : week[metric] }))
  return <div className="training-progress-charts">
    <div className="training-metric-switch" role="group" aria-label="Показатель недели">{(['workouts', 'sets', 'cardioSeconds'] as const).map(value => <button key={value} type="button" aria-pressed={metric === value} onClick={() => setMetric(value)}>{value === 'workouts' ? 'Силовые' : value === 'sets' ? 'Подходы' : 'Кардио'}</button>)}</div>
    <ProgressPlot title={title} unit={metric === 'cardioSeconds' ? 'мин' : metric === 'sets' ? 'подх.' : 'трен.'} points={points} bars formatValue={metric === 'cardioSeconds' ? value => { const seconds = Math.round(value * 60); return `${Math.floor(seconds / 60)} мин ${seconds % 60} сек` } : undefined} />
    <p className="training-chart-context">Недели начинаются в понедельник. {weeks[0] && `Текущая — с ${shortDate(`${weeks[0].from}T12:00:00`)}.`} Количество занятий и подходов показывает объём записей, а не изменение силы.</p>
  </div>
}
