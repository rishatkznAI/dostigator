import { useCallback, useEffect, useState } from 'react'
import { ExerciseProgressCharts, WeeklyProgressChart } from '../components/TrainingProgressCharts'
import { useAuth } from '../context/AuthContext'
import { loadHistory } from '../lib/trainingRepository'
import { getSyncQueue } from '../lib/storage'
import { CARDIO_CHANGED_EVENT, getCachedCardio, getCardioQueue, loadCardio, type CardioSession } from '../lib/cardio'
import { cacheTrainingHistory, cachedTrainingHistory, compareExercise, exerciseFactsText, mergeTrainingHistory, weeklyProgress } from '../lib/training-insights'
import { getWorkoutTargets, selectPreviousResults } from '../lib/workout-targets'
import { TRAINING_SYNC_COMPLETED_EVENT } from '../hooks/useSyncQueue'
import type { HistoryWorkout } from '../types/training'

export function TrainingProgressPage() {
  const { user } = useAuth()
  const userId = user?.id
  const [history, setHistory] = useState<HistoryWorkout[]>(() => user ? cachedTrainingHistory(user.id) : [])
  const [cardio, setCardio] = useState<CardioSession[]>(() => user ? getCachedCardio(userId!) : [])
  const [exerciseKey, setExerciseKey] = useState('')
  const [status, setStatus] = useState('Локальная копия · обновляем историю')
  const refresh = useCallback(async () => {
    if (!userId) return
    if (!navigator.onLine) { setStatus('Офлайн · локальная копия истории и ожидающие синхронизации результаты'); setCardio(getCachedCardio(userId!)); return }
    const [strength, endurance] = await Promise.allSettled([loadHistory(500), loadCardio(userId)])
    if (strength.status === 'fulfilled') { setHistory(strength.value); cacheTrainingHistory(userId, strength.value) }
    if (endurance.status === 'fulfilled') setCardio(endurance.value)
    else setCardio(getCachedCardio(userId!))
    setStatus(strength.status === 'fulfilled' && endurance.status === 'fulfilled' ? 'История обновлена; локальные записи включены один раз' : 'Не всё удалось обновить · показаны доступные записи и локальная копия')
  }, [userId])
  useEffect(() => {
    void refresh()
    window.addEventListener('online', refresh); window.addEventListener(CARDIO_CHANGED_EVENT, refresh); window.addEventListener(TRAINING_SYNC_COMPLETED_EVENT, refresh)
    return () => { window.removeEventListener('online', refresh); window.removeEventListener(CARDIO_CHANGED_EVENT, refresh); window.removeEventListener(TRAINING_SYNC_COMPLETED_EVENT, refresh) }
  }, [refresh])
  const pending = user ? getSyncQueue(user.id) : []
  const all = mergeTrainingHistory(history, pending)
  const exercises = (() => {
    const map = new Map<string, string>()
    all.flatMap((item) => item.exercises).forEach((e) => { if (e.exerciseKey && !e.skipped && e.sets.some(set => set.done && !set.isWarmup && !set.skipped)) map.set(e.exerciseKey, e.exerciseName) })
    return [...map]
  })()
  const selected = exercises.some(([key]) => key === exerciseKey) ? exerciseKey : exercises[0]?.[0] || ''
  const sessions = all.map((workout) => ({ workout, exercise: workout.exercises.find((e) => e.exerciseKey === selected && !e.skipped && e.sets.some(set => set.done && !set.isWarmup && !set.skipped)) })).filter((item): item is { workout: HistoryWorkout; exercise: HistoryWorkout['exercises'][number] } => !!item.exercise)
  const weeks = weeklyProgress(all, cardio)
  const latest = sessions[0], first = sessions.at(-1)
  const lastResult = selectPreviousResults(all, [selected]).get(selected)
  const recommendation = latest && getWorkoutTargets(latest.exercise.target, latest.exercise.sets.filter((set) => !set.isWarmup).length, lastResult, false, { today: new Date().toISOString(), weightStep: userId ? Number(localStorage.getItem(`trainlog:weight-step:${userId}:${selected}`)) : undefined })
  const localCardioCount = user ? getCardioQueue(user.id).length : 0
  return <div className="page training-progress-page">
    <header className="page-header"><p className="eyebrow">Динамика</p><h1>Прогресс по неделям</h1><p>Фактические веса, повторы и время кардио.</p></header>
    <p className="entry-caption" role="status">{status}</p>
    {(pending.length > 0 || localCardioCount > 0) && <p className="entry-caption">Только на устройстве: силовых {pending.length}, кардио {localCardioCount}. Очистка данных браузера может удалить эти записи.</p>}
    <section className="training-session-card"><h2>Последние 8 недель</h2><WeeklyProgressChart weeks={weeks} /><div className="weekly-overview">{weeks.map((week, index) => <div className="week-row" key={week.from}><strong>{index === 0 ? 'Эта неделя' : new Date(`${week.from}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</strong><span>{week.workouts} силовых · {week.sets} подходов</span><span>Кардио: <b>{week.cardioMinutes} мин {week.cardioSeconds%60} сек</b>{weeks[index + 1] && <small> · {week.cardioMinutes - weeks[index + 1].cardioMinutes > 0 ? '+' : ''}{week.cardioMinutes - weeks[index + 1].cardioMinutes} к прошлой неделе</small>}</span></div>)}</div><small>Текущая неделя ещё идёт. Минуты показывают время занятий; сами по себе они не доказывают изменение выносливости.</small></section>
    <section className="training-session-card"><h2>Вес и повторения</h2>{!exercises.length ? <p>Нет записанных рабочих подходов.</p> : <><label>Упражнение<select aria-label="Упражнение для сравнения" value={selected} onChange={(event) => setExerciseKey(event.target.value)}>{exercises.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><ExerciseProgressCharts key={selected} history={all} exerciseKey={selected} />{latest && first && sessions.length > 1 && <div className="workout-result"><strong>Изменение с {new Date(first.workout.finishedAt).toLocaleDateString('ru-RU')}</strong><p>{latest.workout.readinessMode === first.workout.readinessMode ? compareExercise(latest.exercise, first.exercise) : 'Режимы тренировок отличаются. Сравни фактические подходы ниже.'}</p></div>}{recommendation && <p className="recommendation-reason"><strong>Следующий шаг: </strong>{recommendation.message}</p>}{sessions.map(({ workout, exercise }) => <article className="week-row" key={workout.id}><strong>{new Date(workout.finishedAt).toLocaleDateString('ru-RU')}</strong><p>{exerciseFactsText(exercise) || 'В выполненных подходах не указаны повторы.'}</p><small>{pending.some((item) => item.id === workout.id) ? 'Локальный результат · ожидает синхронизации' : 'История'}</small></article>)}</>}</section>
    <button type="button" className="text-button" onClick={() => void refresh()}>Обновить историю</button>
  </div>
}
