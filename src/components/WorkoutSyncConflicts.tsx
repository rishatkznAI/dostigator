import { AlertTriangle, ChevronDown, Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { assertWorkoutConflictCurrent, clearWorkoutConflict, getWorkoutConflicts, rebaseWorkoutConflict, WORKOUT_CONFLICT_EVENT } from '../lib/workout-conflicts'
import { syncWorkoutDraft } from '../lib/trainingRepository'
import { createWorkoutSyncQueue } from '../lib/workout-sync'
import { clearActiveDraft, getActiveDraft, removeQueuedDraft } from '../lib/storage'

type Props = {
  userId?: string
  /** In an active workout, don't interrupt exercise A with a conflict from exercise B. */
  currentWorkoutId?: string
}

export function WorkoutSyncConflicts({ userId, currentWorkoutId }: Props) {
  const [values, setValues] = useState(() => userId ? getWorkoutConflicts(userId) : [])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    const refresh = () => setValues(userId ? getWorkoutConflicts(userId) : [])
    refresh()
    window.addEventListener(WORKOUT_CONFLICT_EVENT, refresh)
    return () => window.removeEventListener(WORKOUT_CONFLICT_EVENT, refresh)
  }, [userId])

  if (!userId || values.length === 0) return null
  const relevant = currentWorkoutId ? values.filter((item) => item.id === currentWorkoutId) : values
  const otherCount = values.length - relevant.length

  const download = (conflict: (typeof values)[number]) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(conflict, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'dostigator-workout-conflict-' + conflict.id + '.json'
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <>
      {otherCount > 0 && (
        <aside className="workout-conflict-notice" role="status">
          <div>
            <strong>Другие конфликты синхронизации: {otherCount}</strong>
            <p>Текущую тренировку можно продолжать. Разбор другой версии — в истории.</p>
          </div>
          <Link to="/training/history">Открыть историю</Link>
        </aside>
      )}
      {relevant.map((conflict) => (
        <section className="workout-conflict" key={conflict.id} aria-label="Конфликт силовой тренировки">
          <div className="workout-conflict-heading">
            <AlertTriangle size={22} aria-hidden="true" />
            <div>
              <h2>Тренировка не синхронизирована</h2>
              <p>{conflict.local.title}. Твой ввод сохранён на устройстве, но серверная версия изменилась. Ничего не удаляем без твоего выбора.</p>
            </div>
          </div>
          <details className="workout-conflict-details">
            <summary><span>Сравнить версии и решить конфликт</span><ChevronDown size={18} aria-hidden="true" /></summary>
            <div className="workout-conflict-versions">
              <section>
                <h3>Моя версия · на устройстве</h3>
                {conflict.local.exercises.map((exercise) => (
                  <div key={exercise.id} className="workout-conflict-exercise">
                    <strong>{exercise.exercise.name}</strong>
                    {exercise.sets.filter((set) => set.done).map((set) => <p key={set.id}>{set.weightKg ?? '—'} кг × {set.reps ?? '—'} · запас {set.rir ?? 'не оценён'}</p>)}
                  </div>
                ))}
              </section>
              {conflict.remote?.session && (
                <section>
                  <h3>На сервере · {conflict.remote.session.finished_at ? 'завершена' : 'активна'}</h3>
                  {conflict.remote.exercises.map((exercise) => (
                    <div key={exercise.id} className="workout-conflict-exercise">
                      <strong>{exercise.exercise_name}</strong>
                      {conflict.remote!.sets.filter((set) => set.done && set.session_exercise_id === exercise.id).map((set, index) => <p key={index}>{set.weight_kg ?? '—'} кг × {set.reps ?? '—'} · запас {set.rir ?? 'не оценён'}</p>)}
                    </div>
                  ))}
                </section>
              )}
            </div>
            {!conflict.remote?.session && <p className="workout-conflict-hint">Серверная версия пока недоступна. Скачай резервную копию и повтори проверку при наличии сети.</p>}
            {message && <p className="workout-conflict-feedback" role="status">{message}</p>}
            {conflict.remote?.session && (
              <div className="workout-conflict-actions">
                {!conflict.remote.session.finished_at && (
                  <button type="button" className="training-secondary" disabled={busy} onClick={() => {
                    if (busy) return
                    setBusy(true)
                    setMessage('')
                    void (async () => {
                      try {
                        const draft = rebaseWorkoutConflict(userId, conflict.id)
                        await createWorkoutSyncQueue(syncWorkoutDraft).enqueue(draft)
                        removeQueuedDraft(userId, draft.id, draft.updatedAt)
                        clearWorkoutConflict(userId, draft.id)
                        setMessage('Сервер подтвердил мою версию')
                      } catch (reason) {
                        setMessage(reason instanceof Error ? reason.message : 'Не удалось сохранить мою версию')
                      } finally {
                        setBusy(false)
                      }
                    })()
                  }}>Сохранить мою версию</button>
                )}
                <button type="button" className="training-secondary" disabled={busy} onClick={() => {
                  if (!window.confirm('Оставить серверную версию? Несинхронизированный ввод будет потерян, если ты заранее не скачал резервную копию.')) return
                  try {
                    assertWorkoutConflictCurrent(userId, conflict.id)
                    clearWorkoutConflict(userId, conflict.id)
                    removeQueuedDraft(userId, conflict.id, conflict.local.updatedAt)
                    if (getActiveDraft(userId)?.id === conflict.id) clearActiveDraft(userId)
                    navigate('/training/history')
                  } catch (reason) {
                    setMessage(reason instanceof Error ? reason.message : 'Ввод изменился')
                  }
                }}>Оставить серверную версию</button>
                <p>Перед выбором серверной версии скачай резервную копию, если хочешь сохранить свой ввод.</p>
              </div>
            )}
            <button type="button" className="training-secondary workout-conflict-backup" onClick={() => download(conflict)}><Download size={18} aria-hidden="true" />Скачать резервную копию</button>
          </details>
        </section>
      ))}
    </>
  )
}
