import { TrendingUp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { LineChart } from '../components/LineChart'
import { useTemplates } from '../hooks/useTemplates'
import { loadHistory } from '../lib/trainingRepository'
import { estimatedOneRepMax, formatNumber, parseRepRange, workoutVolume } from '../lib/workout'
import type { HistoryWorkout } from '../types/training'

const shortDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })

export function TrainingProgressPage() {
  const { templates } = useTemplates()
  const [history, setHistory] = useState<HistoryWorkout[]>([])
  const [exerciseKey, setExerciseKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadHistory(250)
      .then(setHistory)
      .catch((reason: Error) => setError(reason.message))
  }, [])
  const exercises = useMemo(() => {
    const map = new Map<string, string>()
    templates.flatMap((template) => template.items).forEach(({ exercise }) => map.set(exercise.key, exercise.name))
    history.flatMap((workout) => workout.exercises).forEach((exercise) => {
      if (exercise.exerciseKey) map.set(exercise.exerciseKey, exercise.exerciseName)
    })
    return [...map].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [history, templates])

  useEffect(() => {
    if (!exerciseKey && exercises[0]) setExerciseKey(exercises[0].key)
  }, [exerciseKey, exercises])

  const sessions = useMemo(
    () => history
      .map((workout) => ({ workout, exercise: workout.exercises.find((item) => item.exerciseKey === exerciseKey) }))
      .filter((item): item is { workout: HistoryWorkout; exercise: HistoryWorkout['exercises'][number] } => !!item.exercise)
      .reverse(),
    [exerciseKey, history],
  )
  const weighted = sessions.some(({ exercise }) => exercise.sets.some((set) => set.done && !set.isWarmup && (set.weightKg ?? 0) > 0))
  const timed = parseRepRange(sessions.at(-1)?.exercise.target ?? '')?.timed ?? false
  const points = sessions.map(({ workout, exercise }) => ({
    label: shortDate.format(new Date(workout.finishedAt)),
    value: Math.max(0, ...exercise.sets.filter((set) => set.done && !set.isWarmup).map((set) => weighted
      ? estimatedOneRepMax(set.weightKg ?? 0, set.reps ?? 0)
      : set.reps ?? 0)),
  }))
  const best = Math.max(0, ...points.map((point) => point.value))
  const metricLabel = weighted ? 'Расчётная сила' : timed ? 'Лучшее время' : 'Лучший результат'
  const unit = weighted ? 'кг' : timed ? 'сек' : 'повт.'
  const previousBest = Math.max(0, ...points.slice(0, -1).map((point) => point.value))
  const latestValue = points.at(-1)?.value ?? 0
  const volume = sessions.reduce((total, { exercise }) => total + workoutVolume(exercise.sets), 0)

  return (
    <div className="page">
      <header className="page-header"><p className="eyebrow">Динамика</p><h1>Прогресс</h1><p>Смотри, как рабочий вес растёт от тренировки к тренировке.</p></header>
      {error && <div className="error-card">{error}</div>}
      <label className="select-label" htmlFor="exercise">Упражнение</label>
      <select id="exercise" className="exercise-select" value={exerciseKey} onChange={(event) => setExerciseKey(event.target.value)}>
        {exercises.map((exercise) => <option key={exercise.key} value={exercise.key}>{exercise.name}</option>)}
      </select>
      <section className="chart-card">
        <div className="chart-heading"><div><span>{metricLabel}</span><strong>{formatNumber(best)} {unit}</strong></div><TrendingUp /></div>
        <LineChart points={points} unit={unit} />
      </section>
      {points.length > 1 && latestValue > previousBest && <div className="pr-banner"><TrendingUp /><div><strong>Новый личный рекорд</strong><span>Предыдущий лучший результат: {formatNumber(previousBest)} {unit}</span></div></div>}
      <div className="progress-stats">
        <div><span>Выполнений</span><strong>{sessions.length}</strong></div>
        <div><span>Общий тоннаж</span><strong>{formatNumber(volume)} кг</strong></div>
      </div>
      {!sessions.length && <div className="empty-state compact"><h2>Нужна первая тренировка</h2><p>График строится только по завершённым подходам.</p></div>}
    </div>
  )
}
