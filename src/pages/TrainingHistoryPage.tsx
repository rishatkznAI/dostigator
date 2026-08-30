import { ChevronDown, CloudOff } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { loadHistory } from '../lib/trainingRepository'
import { getSyncQueue } from '../lib/storage'
import { formatNumber, formatSet, historySummary } from '../lib/workout'
import type { HistoryWorkout } from '../types/training'
import { TRAINING_SYNC_COMPLETED_EVENT } from '../hooks/useSyncQueue'

const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })

export function TrainingHistoryPage() {
  const { user } = useAuth()
  const [history, setHistory] = useState<HistoryWorkout[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const refreshGenerationRef = useRef(0)
  const pending = user ? getSyncQueue(user.id) : []

  const refresh = useCallback(() => {
    const generation = ++refreshGenerationRef.current
    setLoading(true)
    setError(null)
    return loadHistory()
      .then((nextHistory) => {
        if (generation === refreshGenerationRef.current) setHistory(nextHistory)
      })
      .catch((reason: Error) => {
        if (generation === refreshGenerationRef.current) setError(reason.message)
      })
      .finally(() => {
        if (generation === refreshGenerationRef.current) setLoading(false)
      })
  }, [])

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
      {pending.map((draft) => (
        <div className="pending-card" key={draft.id}><CloudOff /><div><strong>{draft.title}</strong><span>Сохранено на телефоне · ждёт сеть</span></div></div>
      ))}
      {error && <div className="error-card">{error}</div>}
      {!loading && !history.length && !pending.length && (
        <div className="empty-state"><span>01</span><h2>Здесь появится история</h2><p>Заверши первую тренировку, и TrainLog сохранит результат.</p></div>
      )}
      <div className="history-list">
        {history.map((workout) => {
          const summary = historySummary(workout)
          const open = openId === workout.id
          return (
            <article className="history-card" key={workout.id}>
              <button className="history-summary" type="button" onClick={() => setOpenId(open ? null : workout.id)} aria-expanded={open}>
                <div><time>{date.format(new Date(workout.finishedAt))}</time><h2>{workout.title}</h2></div>
                <ChevronDown className={open ? 'rotate' : ''} />
                <div className="history-metrics">
                  <span><strong>{summary.minutes}</strong> мин</span>
                  <span><strong>{summary.sets}</strong> подходов</span>
                  <span><strong>{formatNumber(summary.volume)}</strong> кг</span>
                </div>
              </button>
              {open && (
                <div className="history-detail">
                  {workout.exercises.map((exercise) => (
                    <div className="history-exercise" key={exercise.id}>
                      <div><strong>{exercise.sortOrder}. {exercise.exerciseName}</strong><span>{exercise.skipped ? `Пропущено · ${exercise.skipReason}` : exercise.target}</span></div>
                      {!exercise.skipped && <ul>{exercise.sets.filter((set) => set.done).map((set) => <li key={set.id}>{set.isWarmup ? 'Разминка' : set.setNumber}. {formatSet(set)}</li>)}</ul>}
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
