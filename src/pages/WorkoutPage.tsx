import { ArrowLeft, CheckCircle2, Cloud, CloudOff, Flag, HeartPulse, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { BottomSheet } from '../components/BottomSheet'
import { ExerciseCard } from '../components/ExerciseCard'
import { LoadingScreen } from '../components/LoadingScreen'
import { RestTimer } from '../components/RestTimer'
import { ReadinessCheck } from '../components/ReadinessCheck'
import { WorkoutTimer } from '../components/WorkoutTimer'
import { useAuth } from '../context/AuthContext'
import { useTemplates } from '../hooks/useTemplates'
import { deleteWorkoutSession, loadExerciseLibrary, loadPreviousResults, syncWorkoutDraft } from '../lib/trainingRepository'
import { getRestDurationSeconds, type RestDurationSeconds } from '../lib/rest-period'
import { primeRestAlert } from '../lib/rest-alert'
import { clearActiveDraft, enqueueCancelledWorkout, enqueueDraft, getActiveDraft, removeCancelledWorkout, removeQueuedDraft, saveActiveDraft } from '../lib/storage'
import { createId, createWorkoutDraft, draftSummary, finishWorkoutTimer, formatNumber, toggleWorkoutTimer, validateWorkoutSetValue, workoutDraftValidationError } from '../lib/workout'
import { createWorkoutSyncQueue } from '../lib/workout-sync'
import type { Exercise, PreviousResult, WorkoutDraft, WorkoutSetDraft } from '../types/training'

type SyncStatus = 'local' | 'syncing' | 'synced' | 'offline' | 'error'
export function WorkoutPage() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { templates, loading, error } = useTemplates()
  const template = templates.find((item) => item.code === code)
  const [draft, setDraft] = useState<WorkoutDraft | null>(null)
  const [previous, setPrevious] = useState<Map<string, PreviousResult>>(new Map())
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [historyRetry, setHistoryRetry] = useState(0)
  const [alternatives, setAlternatives] = useState<Exercise[]>([])
  const [now, setNow] = useState(0)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(navigator.onLine ? 'local' : 'offline')
  const [finishOpen, setFinishOpen] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [workoutSyncQueue] = useState(() => createWorkoutSyncQueue(syncWorkoutDraft))
  const autosaveTimerRef = useRef<number | null>(null)
  const syncGenerationRef = useRef(0)

  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!user || !template || draft) return
    const stored = getActiveDraft(user.id)
    if (stored && stored.templateCode !== template.code) {
      navigate(`/training/workout/${stored.templateCode}`, { replace: true })
      return
    }
    const next = stored ?? createWorkoutDraft(template, user.id)
    saveActiveDraft(next)
    setDraft(next)
    void loadExerciseLibrary().then(setAlternatives).catch(() => setAlternatives([]))
  }, [draft, navigate, template, user])

  const exerciseKeys = draft?.exercises.map((exercise) => exercise.exercise.key).join(',')
  const historyBefore = draft?.startedAt
  useEffect(() => {
    if (!exerciseKeys || !historyBefore) return
    let active = true
    setHistoryStatus('loading')
    void loadPreviousResults(exerciseKeys.split(','), historyBefore)
      .then((results) => { if (active) { setPrevious(results); setHistoryStatus('ready') } })
      .catch(() => { if (active) setHistoryStatus('error') })
    return () => { active = false }
  }, [exerciseKeys, historyBefore, historyRetry])

  useEffect(() => {
    if (!draft) return
    const generation = ++syncGenerationRef.current
    saveActiveDraft(draft)
    if (!navigator.onLine) {
      setSyncStatus('offline')
      return
    }
    setSyncStatus('local')
    const timer = window.setTimeout(() => {
      autosaveTimerRef.current = null
      if (generation === syncGenerationRef.current) setSyncStatus('syncing')
      void workoutSyncQueue.enqueue(draft)
        .then(() => {
          if (generation === syncGenerationRef.current) setSyncStatus('synced')
        })
        .catch(() => {
          if (generation === syncGenerationRef.current) setSyncStatus(navigator.onLine ? 'error' : 'offline')
        })
    }, 700)
    autosaveTimerRef.current = timer
    return () => {
      window.clearTimeout(timer)
      if (autosaveTimerRef.current === timer) autosaveTimerRef.current = null
    }
  }, [draft, workoutSyncQueue])

  useEffect(() => {
    if (!draft?.readiness || draft.timerPausedAt) return
    type WakeLockHandle = { release: () => Promise<void> }
    const manager = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockHandle> } }).wakeLock
    if (!manager) return
    let lock: WakeLockHandle | null = null
    let active = true
    const request = async () => {
      if (!active || document.visibilityState !== 'visible') return
      try { lock = await manager.request('screen') } catch { /* optional browser capability */ }
    }
    const visibility = () => { if (document.visibilityState === 'visible' && !lock) void request() }
    void request()
    document.addEventListener('visibilitychange', visibility)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', visibility)
      if (lock) void lock.release()
    }
  }, [draft?.readiness, draft?.timerPausedAt])

  if (loading || (!draft && template)) return <LoadingScreen label="Готовим тренировку" />
  if (error) return <div className="workout-error"><p>{error}</p><Link to="/training">К тренировкам</Link></div>
  if (!template) return <Navigate to="/training" replace />
  if (!draft) return null

  const updateSet = (exerciseId: string, setId: string, field: 'weightKg' | 'reps' | 'rir', value: number | null) => {
    const validation = validateWorkoutSetValue(field, value)
    if (!validation.valid) {
      setMessage(validation.message)
      return
    }
    setMessage(null)
    setDraft((current) => current && ({
      ...current,
      updatedAt: new Date().toISOString(),
      syncState: 'pending',
      exercises: current.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : {
        ...exercise,
        sets: exercise.sets.map((set) => set.id === setId ? { ...set, [field]: validation.value, done: false, completedAt: null } : set),
      }),
    }))
  }

  const toggleDone = (exerciseId: string, target: WorkoutSetDraft) => {
    if (!target.done) {
      for (const field of ['weightKg', 'reps', 'rir'] as const) {
        const validation = validateWorkoutSetValue(field, target[field])
        if (!validation.valid) {
          setMessage(validation.message)
          return
        }
      }
    }
    if (!target.done && (target.reps === null || target.rir === null)) {
      setMessage('Для завершения подхода укажи повторы и RIR')
      return
    }
    const nextDone = !target.done
    setMessage(null)
    setDraft((current) => current && ({
      ...current,
      updatedAt: new Date().toISOString(),
      syncState: 'pending',
      exercises: current.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : {
        ...exercise,
        sets: exercise.sets.map((set) => set.id === target.id ? {
          ...set,
          done: nextDone,
          completedAt: nextDone ? new Date().toISOString() : null,
        } : set),
      }),
    }))
    if (nextDone) {
      primeRestAlert()
      const exercise = draft.exercises.find((item) => item.id === exerciseId)
      const plannedSeconds: RestDurationSeconds = target.isWarmup ? 90 : getRestDurationSeconds(exercise?.exercise.key ?? '')
      setDraft((current) => current && ({
        ...current,
        activeRest: { until: Date.now() + plannedSeconds * 1000, exerciseName: exercise?.exercise.name ?? 'подхода', plannedSeconds },
      }))
    }
  }

  const addSet = (exerciseId: string, isWarmup: boolean) => setDraft((current) => current && ({
    ...current,
    updatedAt: new Date().toISOString(),
    syncState: 'pending',
    exercises: current.exercises.map((exercise) => {
      if (exercise.id !== exerciseId) return exercise
      const next: WorkoutSetDraft = { id: createId(), setNumber: exercise.sets.length + 1, weightKg: null, reps: null, rir: null, done: false, isWarmup, completedAt: null }
      return { ...exercise, sets: isWarmup ? [next, ...exercise.sets] : [...exercise.sets, next] }
    }),
  }))

  const removeSet = (exerciseId: string, target: WorkoutSetDraft) => setDraft((current) => current && ({
    ...current,
    updatedAt: new Date().toISOString(),
    syncState: 'pending',
    deletedSetIds: [...new Set([...current.deletedSetIds, target.id])],
    exercises: current.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : {
      ...exercise,
      sets: exercise.sets.filter((set) => set.id !== target.id).map((set, index) => ({ ...set, setNumber: index + 1 })),
    }),
  }))

  const skipExercise = (exerciseId: string, reason: string | null) => setDraft((current) => current && ({
    ...current,
    activeRest: null,
    updatedAt: new Date().toISOString(),
    syncState: 'pending',
    exercises: current.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : {
      ...exercise,
      skipped: reason !== null,
      skipReason: reason ?? '',
      sets: reason === null ? exercise.sets : exercise.sets.map((set) => ({ ...set, done: false, completedAt: null })),
    }),
  }))

  const replaceExercise = (exerciseId: string, replacement: Exercise) => {
    const currentExercise = draft.exercises.find((item) => item.id === exerciseId)
    if (currentExercise?.sets.some((set) => set.done) && !window.confirm('Завершённые подходы этого упражнения будут очищены. Продолжить?')) return
    setDraft((current) => current && ({
      ...current,
      updatedAt: new Date().toISOString(),
      syncState: 'pending',
      exercises: current.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : {
        ...exercise,
        exercise: replacement,
        sets: exercise.sets.map((set) => ({ ...set, weightKg: null, reps: null, rir: null, done: false, completedAt: null })),
      }),
    }))
  }

  const finishSummary = draftSummary(draft, new Date(now))
  const toggleTimer = () => setDraft((current) => current && toggleWorkoutTimer(current))
  const finish = async () => {
    const validationError = workoutDraftValidationError(draft)
    if (validationError) {
      setMessage(validationError)
      setFinishOpen(false)
      return
    }
    const completed: WorkoutDraft = { ...finishWorkoutTimer(draft), activeRest: null }
    syncGenerationRef.current += 1
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
    setFinishing(true)
    enqueueDraft(completed)
    try {
      if (navigator.onLine) {
        await workoutSyncQueue.enqueue(completed)
        removeQueuedDraft(completed.userId, completed.id)
      }
      clearActiveDraft(completed.userId)
      navigate('/training/history', { replace: true })
    } catch {
      clearActiveDraft(completed.userId)
      navigate('/training/history', { replace: true })
    }
  }

  const cancelWorkout = async () => {
    syncGenerationRef.current += 1
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
    enqueueCancelledWorkout(draft.userId, draft.id)
    clearActiveDraft(draft.userId)
    if (navigator.onLine) {
      try {
        await workoutSyncQueue.drain()
        await deleteWorkoutSession(draft.id)
        removeCancelledWorkout(draft.userId, draft.id)
      } catch { /* retry from queue */ }
    }
    navigate('/training', { replace: true })
  }

  const syncCopy: Record<SyncStatus, string> = {
    local: 'Сохранено на телефоне',
    syncing: 'Синхронизация…',
    synced: 'Синхронизировано',
    offline: 'Офлайн · черновик сохранён',
    error: 'Не удалось синхронизировать',
  }

  return (
    <main className="workout-page">
      <header className="workout-header">
        <div className="workout-toolbar">
          <Link className="icon-button" to="/training" aria-label="К тренировкам"><ArrowLeft /></Link>
          <div className={`sync-status ${syncStatus}`}>{syncStatus === 'offline' ? <CloudOff /> : <Cloud />}<span>{syncCopy[syncStatus]}</span></div>
          <button className="icon-button danger-icon" type="button" onClick={() => setCancelOpen(true)} aria-label="Отменить тренировку"><Trash2 /></button>
        </div>
        <p className="eyebrow">Тренировка {template.code}</p>
        <h1>{template.title}</h1>
        <WorkoutTimer draft={draft} now={now} onToggle={toggleTimer} />
      </header>

      {message && <div className="workout-message" role="alert">{message}</div>}
      {draft.readiness === null ? (
        <ReadinessCheck onComplete={(readiness) => setDraft((current) => current && ({ ...current, readiness, updatedAt: new Date().toISOString(), syncState: 'pending' }))} />
      ) : <>
      {draft.readiness.mode === 'reduced' && <div className="reduced-mode-banner"><strong>Облегчённый режим</strong><span>Сегодня достаточно чистой техники и 2–3 RIR.</span></div>}
      <section className="workout-progress-panel" aria-label="Прогресс тренировки">
        <div><strong>{finishSummary.sets} / {draft.exercises.filter((exercise) => !exercise.skipped).flatMap((exercise) => exercise.sets).filter((set) => !set.isWarmup).length}</strong><span>рабочих подходов</span></div>
        <progress aria-label="Выполненные рабочие подходы" value={finishSummary.sets} max={Math.max(1, draft.exercises.filter((exercise) => !exercise.skipped).flatMap((exercise) => exercise.sets).filter((set) => !set.isWarmup).length)} />
        <p>Прошлый результат → цель сегодня → твой факт. Отмечай подход после выполнения.</p>
      </section>
      {historyStatus === 'error' && <button className="error-card" type="button" onClick={() => setHistoryRetry((value) => value + 1)}>Не удалось загрузить прошлые результаты. Нажми, чтобы повторить.</button>}
      <div className="exercise-list">
        {draft.exercises.map((exercise) => (
          <ExerciseCard
            key={exercise.id}
            exercise={exercise}
            previous={previous.get(exercise.exercise.key)}
            reduced={draft.readiness?.mode === 'reduced'}
            historyStatus={historyStatus}
            onSetChange={(setId, field, value) => updateSet(exercise.id, setId, field, value)}
            onToggleDone={(set) => toggleDone(exercise.id, set)}
            onAddSet={(warmup) => addSet(exercise.id, warmup)}
            onRemoveSet={(set) => removeSet(exercise.id, set)}
            onSkip={(reason) => skipExercise(exercise.id, reason)}
            onReplace={(replacement) => replaceExercise(exercise.id, replacement)}
            alternatives={alternatives}
          />
        ))}
      </div>

      <Link className="workout-cardio-link" to="/training/cardio"><HeartPulse /><span><strong>Кардио и заметки</strong><small>Запиши время, дистанцию и самочувствие. Силовой черновик сохранён.</small></span></Link>

      <section className="finish-panel">
        <Flag />
        <div><strong>Все подходы готовы?</strong><span>Проверь результат перед сохранением.</span></div>
        <button className="primary-button" type="button" onClick={() => setFinishOpen(true)} disabled={finishSummary.sets === 0}>Завершить</button>
      </section>
      </>}

      {draft.activeRest !== null && (
        <RestTimer
          until={draft.activeRest.until}
          exerciseName={draft.activeRest.exerciseName}
          plannedSeconds={draft.activeRest.plannedSeconds}
          onChange={(until) => setDraft((current) => current && current.activeRest ? ({ ...current, activeRest: { ...current.activeRest, until } }) : current)}
          onSkip={() => setDraft((current) => current && ({ ...current, activeRest: null }))}
        />
      )}

      {finishOpen && (
        <BottomSheet title="Завершить тренировку" onClose={() => !finishing && setFinishOpen(false)}>
          <div className="finish-summary">
            <CheckCircle2 />
            <p className="eyebrow">Тренировка {template.code}</p>
            <h3>{template.title}</h3>
            <div>
              <span><strong>{finishSummary.minutes}</strong> минут</span>
              <span><strong>{finishSummary.sets}</strong> подходов</span>
              <span><strong>{formatNumber(finishSummary.volume)}</strong> кг</span>
            </div>
            <p className="muted">Если сеть пропадёт, результат останется на телефоне и синхронизируется позже без дублей.</p>
            {draft.exercises.flatMap((exercise) => exercise.skipped ? [] : exercise.sets).filter((set) => !set.isWarmup && !set.done).length > 0 && (
              <p className="finish-warning">Не завершено рабочих подходов: {draft.exercises.flatMap((exercise) => exercise.skipped ? [] : exercise.sets).filter((set) => !set.isWarmup && !set.done).length}. Можно вернуться или сохранить неполную тренировку.</p>
            )}
            <button className="primary-button wide" type="button" onClick={() => void finish()} disabled={finishing}>
              {finishing ? 'Сохраняем…' : draft.exercises.some((exercise) => !exercise.skipped && exercise.sets.some((set) => !set.isWarmup && !set.done)) ? 'Сохранить неполную тренировку' : 'Сохранить тренировку'}
            </button>
          </div>
        </BottomSheet>
      )}
      {cancelOpen && (
        <BottomSheet title="Отменить тренировку?" onClose={() => setCancelOpen(false)}>
          <div className="finish-summary cancel-summary">
            <Trash2 />
            <h3>Черновик будет удалён</h3>
            <p className="muted">Уже синхронизированные строки этой незавершённой тренировки тоже будут удалены. Завершённая история не затрагивается.</p>
            <button className="danger-button wide" type="button" onClick={() => void cancelWorkout()}>Отменить тренировку</button>
            <button className="text-button" type="button" onClick={() => setCancelOpen(false)}>Продолжить тренировку</button>
          </div>
        </BottomSheet>
      )}
    </main>
  )
}
