import { ChevronDown, CloudOff } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { loadCardio } from '../lib/cardio'
import { loadHistory } from '../lib/trainingRepository'
import { WorkoutResult } from '../components/WorkoutResult'
import { cacheTrainingHistory, cachedTrainingHistory, mergeTrainingHistory } from '../lib/training-insights'
import { getSyncQueue } from '../lib/storage'
import { formatNumber, formatSet, historySummary, parseRepRange } from '../lib/workout'
import type { HistoryWorkout } from '../types/training'
import { TRAINING_SYNC_COMPLETED_EVENT } from '../hooks/useSyncQueue'
import { WorkoutSyncConflicts } from '../components/WorkoutSyncConflicts'

const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })

export function TrainingHistoryPage() {
  const { user } = useAuth()
  const userId = user?.id
  const [history, setHistory] = useState<HistoryWorkout[]>(() => user ? cachedTrainingHistory(user.id) : [])
  const [params] = useSearchParams()
  const [openId, setOpenId] = useState<string | null>(() => params.get('finished'))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cardioError,setCardioError]=useState<string|null>(null)
  const refreshGenerationRef = useRef(0)
  const pending = user ? getSyncQueue(user.id) : []

  const refresh = useCallback(() => {
    const generation = ++refreshGenerationRef.current
    setLoading(true)
    setError(null)
    if(!navigator.onLine) { if(userId)setHistory(cachedTrainingHistory(userId));setLoading(false);return Promise.resolve() }
    return Promise.all([loadHistory(),userId?loadCardio(userId).then(()=>setCardioError(null)).catch(()=>setCardioError('Кардио не удалось обновить. Показана доступная локальная копия.')):Promise.resolve()])
      .then(([nextHistory]) => {
        if (generation === refreshGenerationRef.current) { setHistory(nextHistory); if (userId) cacheTrainingHistory(userId, nextHistory) }
      })
      .catch((reason: Error) => {
        if (generation === refreshGenerationRef.current) setError(reason.message)
      })
      .finally(() => {
        if (generation === refreshGenerationRef.current) setLoading(false)
      })
  }, [userId])

  useEffect(() => {
    void refresh()
    return () => { refreshGenerationRef.current += 1 }
  }, [refresh])
  useEffect(() => {
    const handleSync = (event: Event) => {
      const syncedUserId = (event as CustomEvent<{ userId?: string }>).detail?.userId
      if (!user || syncedUserId !== user.id) return
      void refresh()
    }
    window.addEventListener(TRAINING_SYNC_COMPLETED_EVENT, handleSync)
    return () => window.removeEventListener(TRAINING_SYNC_COMPLETED_EVENT, handleSync)
  }, [refresh, user])

  return (
    <div className="page">
      <header className="page-header"><p className="eyebrow">Твой путь</p><h1>История</h1><p>Каждая тренировка — ещё одна точка прогресса.</p></header>
      {params.get('finished') && <p className="training-confirmation" role="status">Тренировка завершена. Ниже — результат и изменения.</p>}
      {pending.map((draft) => (
        <div className="pending-card" key={draft.id}><CloudOff /><div><strong>{draft.title}</strong><span>Локальный результат · ожидает синхронизации</span></div></div>
      ))}
      {cardioError && <p className="error-card">{cardioError}</p>}
      <WorkoutSyncConflicts userId={userId}/>
      {error && <div className="error-card">{error}</div>}
      {!loading && !history.length && !pending.length && (
        <div className="empty-state"><span>01</span><h2>Здесь появится история</h2><p>Заверши первую тренировку, и TrainLog сохранит результат.</p></div>
      )}
      <div className="history-list">
        {mergeTrainingHistory(history, pending).map((workout) => {
          const summary = historySummary(workout)
          const open = openId === workout.id
          return (
            <article className="history-card" key={workout.id}>
              <button className="history-summary" type="button" onClick={() => setOpenId(open ? null : workout.id)} aria-expanded={open}>
                <div><time>{date.format(new Date(workout.finishedAt))}</time><h2>{workout.title}</h2><small>{pending.some((item) => item.id === workout.id) ? 'Только на устройстве' : navigator.onLine && !error && !loading ? 'Синхронизировано с сервером' : 'Локальная копия истории · актуальность не проверена'}</small></div>
                <ChevronDown className={open ? 'rotate' : ''} />
                <div className="history-metrics">
                  <span><strong>{Math.floor(summary.durationSeconds/60)}:{String(summary.durationSeconds%60).padStart(2,'0')}</strong> время</span>
                  <span><strong>{summary.sets}</strong> подходов</span>
                  <span><strong>{formatNumber(summary.volume)}</strong> кг</span>
                </div>
              </button>
              {open && (
                <div className="history-detail"><WorkoutResult userId={userId} workout={workout} history={mergeTrainingHistory(history, pending)} />
                  {workout.exercises.map((exercise) => (
                    <div className="history-exercise" key={exercise.id}>
                      <div><strong>{exercise.sortOrder}. {exercise.exerciseName}</strong><span>{exercise.skipped ? `Пропущено · ${exercise.skipReason}` : exercise.target}</span></div>
                      {!exercise.skipped && <ul>{exercise.sets.filter((set) => set.done).map((set) => <li key={set.id}>{set.isWarmup ? 'Разминка' : set.setNumber}. {parseRepRange(exercise.target)?.timed ? `${set.reps} сек` : formatSet(set)}</li>)}</ul>}
                    </div>
                  ))}
                </div>
              )}
            </article>
          )
        })}
      </div>
      {loading && <div className="inline-loader">Загружаем историю…</div>}
    </div>
  )
}
