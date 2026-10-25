import { ArrowLeft, CheckCircle2, Cloud, CloudOff, HeartPulse, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { WorkoutResult } from '../components/WorkoutResult'
import { cacheTrainingHistory, cachedTrainingHistory, draftToHistory, mergeTrainingHistory } from '../lib/training-insights'
import { cardioClock } from '../lib/cardio-workout'
import { workoutCardio } from '../lib/cardio-receipts'
import { WorkoutSyncConflicts } from '../components/WorkoutSyncConflicts'
import { getSyncQueue } from '../lib/storage'
import { BottomSheet } from '../components/BottomSheet'
import { ExerciseCard } from '../components/ExerciseCard'
import { LoadingScreen } from '../components/LoadingScreen'
import { RestTimer } from '../components/RestTimer'
import { ReadinessCheck } from '../components/ReadinessCheck'
import { WorkoutTimer } from '../components/WorkoutTimer'
import { useAuth } from '../context/AuthContext'
import { useTemplates } from '../hooks/useTemplates'
import { deleteWorkoutSession, loadExerciseLibrary, loadPreviousResults, loadHistory, syncWorkoutDraft } from '../lib/trainingRepository'
import { formatRestDuration, getRestDurationSeconds, type RestDurationSeconds } from '../lib/rest-period'
import { primeRestAlert } from '../lib/rest-alert'
import { archiveCancelledDraft, clearActiveDraft, enqueueCancelledWorkout, enqueueDraft, getActiveDraft, removeCancelledWorkout, removeQueuedDraft, saveActiveDraft } from '../lib/storage'
import { createId, createWorkoutDraft, draftSummary, finishWorkoutTimer, elapsedClock, formatNumber, toggleWorkoutTimer, validateWorkoutSetValue, workoutDraftValidationError } from '../lib/workout'
import { createWorkoutSyncQueue } from '../lib/workout-sync'
import { recordSetAndPrepareNext, skipSet, undoSet } from '../lib/set-logging'
import { getWorkoutTargets, selectPreviousResults } from '../lib/workout-targets'
import { programV21Rules } from '../lib/program-v21'
import { FREE_WORKOUT_CODE, FREE_WORKOUT_TEMPLATE } from '../lib/free-workout'
import type { Exercise, PreviousResult, WorkoutDraft, WorkoutReadiness, WorkoutSetDraft } from '../types/training'

type SyncStatus = 'local' | 'syncing' | 'synced' | 'offline' | 'error'
export function WorkoutPage() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const userId = user?.id
  const { templates, loading, error } = useTemplates()
  const template = code === FREE_WORKOUT_CODE ? FREE_WORKOUT_TEMPLATE : templates.find((item) => item.code === code)
  const optionalDay = template?.programRevision && template.code === 'C'
  const [exercisePickerOpen, setExercisePickerOpen] = useState(false)
  const [prepared, setPrepared] = useState(false)
  const [optionalKeys, setOptionalKeys] = useState<string[]>([])
  const [preparationReadiness, setPreparationReadiness] = useState<WorkoutReadiness | null>(null)
  const currentActionRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<WorkoutDraft | null>(null)
  const [previous, setPrevious] = useState<Map<string, PreviousResult>>(new Map())
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [historyFromCache, setHistoryFromCache] = useState(false)
  const [historyRetry, setHistoryRetry] = useState(0)
  const [alternatives, setAlternatives] = useState<Exercise[]>([])
  const [now, setNow] = useState(0)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(navigator.onLine ? 'local' : 'offline')
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncRetry, setSyncRetry] = useState(0)
  const [cancelling, setCancelling] = useState(false)
  const cancelLock = useRef(false)
  const [storageFailed, setStorageFailed] = useState(false)
  const finishLock = useRef(false)
  const [finishOpen, setFinishOpen] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null)
  const [autoRest, setAutoRest] = useState(() => localStorage.getItem(`trainlog:auto-rest:${user?.id}`) === 'true')
  const [confirmation, setConfirmation] = useState<{ text: string; exerciseName: string; seconds: RestDurationSeconds; needsRest: boolean } | null>(null)
  const [lastRecordAt, setLastRecordAt] = useState(0)
  const recordLock = useRef(0)
  const [workoutSyncQueue] = useState(() => createWorkoutSyncQueue(syncWorkoutDraft))
  const autosaveTimerRef = useRef<number | null>(null)
  const syncGenerationRef = useRef(0)
  const draftId = draft?.id
  const draftUserId = draft?.userId
  const hasDraft = Boolean(draft)
  const timerPausedAt = draft?.timerPausedAt

  useEffect(() => {
    if (draftId && draftUserId) setSelectedExerciseId(localStorage.getItem(`trainlog:exercise-focus:${draftUserId}:${draftId}`))
  }, [draftId, draftUserId])

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
    setPrepared(true)
    if (stored) setDraft(stored)
    void loadExerciseLibrary().then(setAlternatives).catch(() => setAlternatives([]))
  }, [draft, navigate, template, user])

  const exerciseKeys = draft?.exercises.map((exercise) => exercise.exercise.key).join(',')
  const historyBefore = draft?.startedAt
  useEffect(() => {
    if (!exerciseKeys || !historyBefore) return
    let active = true
    setHistoryStatus('loading')
    void loadPreviousResults(exerciseKeys.split(','), historyBefore)
      .then((results) => { if (active) { setPrevious(results); setHistoryStatus('ready'); setHistoryFromCache(false) } })
      .catch(() => { if (active) { const cached = userId ? cachedTrainingHistory(userId) : []; setPrevious(selectPreviousResults(cached, exerciseKeys.split(','), historyBefore)); setHistoryStatus(cached.length ? 'ready' : 'error'); setHistoryFromCache(true) } })
    if (navigator.onLine) void loadHistory(500).then((history) => { if (active && userId) { cacheTrainingHistory(userId, history) } }).catch(() => undefined)
    return () => { active = false }
  }, [exerciseKeys, historyBefore, historyRetry, userId])

  useEffect(() => {
    const retry = () => setSyncRetry(value => value + 1)
    const visible = () => { if (document.visibilityState === 'visible') retry() }
    window.addEventListener('online', retry)
    window.addEventListener('offline', retry)
    window.addEventListener('focus', retry)
    document.addEventListener('visibilitychange', visible)
    return () => { window.removeEventListener('online', retry); window.removeEventListener('offline', retry); window.removeEventListener('focus', retry); document.removeEventListener('visibilitychange', visible) }
  }, [])

  useEffect(() => {
    if (!draft || cancelling) return
    const stored = getActiveDraft(draft.userId)
    if (!stored && !storageFailed) { navigate('/training/history', { replace: true }); return }
    if (stored?.id === draft.id && Date.parse(stored.updatedAt) > Date.parse(draft.updatedAt)) { setDraft(stored); return }
    const generation = ++syncGenerationRef.current
    try { saveActiveDraft(draft); setStorageFailed(false) } catch { setStorageFailed(true); setSyncStatus('error'); return }
    if (!navigator.onLine) {
      setSyncStatus('offline')
      return
    }
    setSyncError(null)
    setSyncStatus('local')
    const timer = window.setTimeout(() => {
      autosaveTimerRef.current = null
      if (generation === syncGenerationRef.current) setSyncStatus('syncing')
      void workoutSyncQueue.enqueue(draft)
        .then(() => {
          if (generation === syncGenerationRef.current) setSyncStatus('synced')
        })
        .catch((error: unknown) => {
          if (generation === syncGenerationRef.current) { setSyncStatus(navigator.onLine ? 'error' : 'offline'); setSyncError(error instanceof Error ? error.message : 'Облако не подтвердило сохранение. Черновик на устройстве.') }
        })
    }, 700)
    autosaveTimerRef.current = timer
    return () => {
      window.clearTimeout(timer)
      if (autosaveTimerRef.current === timer) autosaveTimerRef.current = null
    }
  }, [draft, navigate, workoutSyncQueue, storageFailed, syncRetry, cancelling])

  useEffect(() => {
    if (!user) return
    const changed = (event: StorageEvent) => {
      if (event.key !== `trainlog:active:${user.id}`) return
      const stored = getActiveDraft(user.id)
      if (!stored) { navigate('/training/history', { replace: true }); return }
      setDraft(stored)
      if (stored.templateCode !== code) navigate(`/training/workout/${stored.templateCode}`, { replace: true })
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [code, navigate, user])

  useEffect(() => {
    if (!hasDraft || timerPausedAt) return
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
  }, [hasDraft, timerPausedAt])

  const recordedCount=draft?.exercises.reduce((sum,exercise)=>sum+exercise.sets.filter(set=>set.done).length,0) ?? 0
  useEffect(() => {
    if (selectedExerciseId || recordedCount) currentActionRef.current?.scrollIntoView?.({ block: 'start', behavior: 'instant' })
  }, [selectedExerciseId,recordedCount])

  if (loading || (!draft && template && !prepared)) return <LoadingScreen label="Готовим тренировку" />
  if (error) return <div className="workout-error"><p>{error}</p><Link to="/training">К тренировкам</Link></div>
  if (!template) return <Navigate to="/training" replace />
  if (!draft && code === FREE_WORKOUT_CODE && prepared) return <Navigate to="/training/exercises" replace />
  if (!draft) return <main className="workout-page workout-preparation">
    <Link className="back-link" to="/training"><ArrowLeft />К тренировкам</Link>
    <p className="eyebrow">Тренировка {template.code} · подготовка</p><h1>{template.title}</h1>
    <p className="preparation-copy">{optionalDay ? '30–45 минут кардио · до 6 дополнительных подходов по желанию' : `${template.items.length} упражнений · ${template.items.reduce((n,item)=>n+item.setCount,0)} рабочих подходов · около 75 минут вместе с кардио`}</p>
    {template.programRevision && <section className="preparation-step"><strong>Программа V2.1 активна</strong><p>{optionalDay ? 'Основная часть — 30–45 минут умеренного кардио. C необязательна и не снижает дисциплину.' : 'После силовой — 20 минут умеренного кардио. Ориентир на всё занятие — около 75 минут.'}</p><details><summary>Правила выполнения</summary><p>{programV21Rules}</p></details></section>}
    {optionalDay ? <section className="preparation-step"><strong>Дополнительно при хорошем восстановлении</strong><p>Все упражнения по желанию; по 2 подхода. Отметь только то, что хочешь выполнить.</p>{template.items.map(item=><label className="check-row" key={item.exercise.key}><input type="checkbox" checked={optionalKeys.includes(item.exercise.key)} onChange={e=>setOptionalKeys(keys=>e.target.checked?[...keys,item.exercise.key]:keys.filter(k=>k!==item.exercise.key))}/>{item.exercise.name} · 2 × {item.repTarget}</label>)}<Link className="primary-button wide" to="/training/cardio?program=C">Перейти к кардио · 30–45 минут</Link></section> : <section className="preparation-step"><strong>Готов начать?</strong><p>Подготовь первое упражнение: {template.items[0]?.exercise.name}. Таймер начнётся после нажатия.</p></section>}
    <details className="training-extras"><summary>Упражнения и подходы</summary>{template.items.map(item=><p key={item.exercise.key}>{item.exercise.name} · {item.setCount} × {item.repTarget}</p>)}</details>
    <details className="training-extras"><summary>Проверить готовность · необязательно</summary><ReadinessCheck onComplete={(readiness)=>setPreparationReadiness(readiness)} submitLabel="Учесть самочувствие" />{preparationReadiness && <p role="status">Самочувствие учтено. {preparationReadiness.mode === 'reduced' ? 'Рекомендации без прибавки нагрузки.' : 'Обычный режим.'}</p>}</details>
    {message && <p role="alert">{message}</p>}
    <button type="button" disabled={Boolean(optionalDay && !optionalKeys.length)} className="primary-button wide" onClick={()=>{
      if (!user) return
      // Another tab may have started since preparation was opened. Reuse it.
      const stored=getActiveDraft(user.id)
      if (stored) { if(stored.templateCode!==template.code) navigate(`/training/workout/${stored.templateCode}`,{replace:true}); else setDraft(stored); return }
      const next={...createWorkoutDraft(optionalDay ? {...template,items:template.items.filter(item=>optionalKeys.includes(item.exercise.key))} : template,user.id),readiness:preparationReadiness}
      try {saveActiveDraft(next);setDraft(next)} catch {setMessage('Не удалось сохранить начало на устройстве. Освободи место и повтори.')}
    }}>{optionalDay ? "Начать выбранные упражнения" : "Начать тренировку"}</button><p className="entry-caption">До старта сессия не создаётся. Изменения состава программы здесь не применяются.</p>
  </main>

  const selectExercise = (id: string | null) => {
    setSelectedExerciseId(id)
    const key = `trainlog:exercise-focus:${draft.userId}:${draft.id}`
    try { if (id) localStorage.setItem(key, id); else localStorage.removeItem(key) } catch { /* focus is optional; workout facts have their own write check */ }
  }

  const recordSet = (exerciseId: string, target: WorkoutSetDraft) => {
    if (!target.done && new Date().getTime() < recordLock.current) return false
    const latest = getActiveDraft(draft.userId)
    if (latest && latest.id === draft.id && latest.updatedAt !== draft.updatedAt) { setDraft(latest); setMessage('Черновик обновился в другой вкладке. Проверь результат и повтори запись.'); return false }
    for (const field of ['weightKg', 'reps', 'rir'] as const) {
      const validation = validateWorkoutSetValue(field, target[field])
      if (!validation.valid) {
        setMessage(validation.message)
        return false
      }
    }
    if (target.weightKg === null || target.reps === null) {
      setMessage('Укажи фактический вес или сопротивление и повторы. Запас необязателен.')
      return false
    }
    const exercise = draft.exercises.find((item) => item.id === exerciseId)
    const stored = exercise?.sets.find((set) => set.id === target.id)
    if (!stored || stored.skipped || stored.done !== target.done || stored.completedAt !== target.completedAt) return false
    if (!target.done) { recordLock.current = new Date().getTime() + 650; setLastRecordAt(new Date().getTime()) }
    const plannedSeconds: RestDurationSeconds = target.isWarmup ? 90 : (exercise?.restSeconds ?? getRestDurationSeconds(exercise?.exercise.key ?? ''))
    const workSets = exercise!.sets.filter((set) => !set.isWarmup)
    const nextWork = workSets.slice(workSets.findIndex((set) => set.id === target.id) + 1).find((set) => !set.done && !set.skipped)
    const nextIndex = nextWork ? workSets.findIndex((set) => set.id === nextWork.id) : -1
    const plannedNext = getWorkoutTargets(exercise!.target, workSets.length, historyStatus === 'ready' ? previous.get(exercise!.exercise.key) : undefined, draft.readiness?.mode === 'reduced').targets[nextIndex]
    setMessage(null)
    const remaining = draft.exercises.some(item => !item.skipped && item.sets.some(set => set.id !== target.id && !set.done && !set.skipped && !set.isWarmup))
    const needsRest = !target.done && remaining
    const nextDraft: WorkoutDraft = { ...draft, updatedAt: new Date().toISOString(), syncState: 'pending', exercises: draft.exercises.map((item) => item.id !== exerciseId ? item : recordSetAndPrepareNext(item, target, draft.readiness?.mode === 'reduced', new Date(), plannedNext)), activeRest: needsRest && autoRest ? { until: new Date().getTime() + plannedSeconds * 1000, exerciseName: exercise!.exercise.name, plannedSeconds } : needsRest ? draft.activeRest : null }
    try { saveActiveDraft(nextDraft) } catch { setStorageFailed(true); setMessage('Подход не записан: хранилище устройства недоступно. Ввод оставлен на экране.'); return false }
    setStorageFailed(false)
    setDraft(nextDraft)
    if (needsRest && autoRest) primeRestAlert()
    const number = exercise!.sets.filter((set) => set.isWarmup === target.isWarmup).findIndex((set) => set.id === target.id) + 1
    setConfirmation({ text: target.done ? 'Исправление сохранено' : `${target.isWarmup ? 'Разминка' : 'Подход'} ${number} ${target.isWarmup ? 'сохранена' : 'сохранён'}`, exerciseName: exercise!.exercise.name, seconds: plannedSeconds, needsRest })
    if (!target.done) {
      const justRecorded=nextDraft.exercises.find(item=>item.id===exerciseId)!
      const stillCurrent=justRecorded.sets.some(set=>!set.done&&!set.skipped&&!set.isWarmup)
      selectExercise(stillCurrent ? exerciseId : nextDraft.exercises.find(item=>!item.skipped&&item.sets.some(set=>!set.done&&!set.skipped&&!set.isWarmup))?.id ?? exerciseId)
    }
    return true
  }

  const changeSetState = (exerciseId: string, set: WorkoutSetDraft, action: 'undo' | 'skip') => {
    setDraft((current) => current && ({ ...current, activeRest: null, updatedAt: new Date().toISOString(), syncState: 'pending', exercises: current.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : action === 'undo' ? undoSet(exercise, set.id) : skipSet(exercise, set.id)) }))
    setConfirmation(null)
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
      skipped: reason !== null && !exercise.sets.some((set) => set.done),
      skipReason: reason ?? '',
      sets: exercise.sets.map((set) => set.done ? set : { ...set, skipped: reason !== null }),
    }),
  }))

  const replaceExercise = (exerciseId: string, replacement: Exercise) => {
    const currentExercise = draft.exercises.find((item) => item.id === exerciseId)
    if (currentExercise?.sets.some((set) => set.done)) { setMessage('В упражнении уже есть записанные подходы. Замена недоступна, чтобы сохранить результаты.'); return }
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

  const linkedCardio=workoutCardio(draft.userId,draft.id)
  const finishSummary = draftSummary(draft, new Date(now))
  const nextExercise = draft.exercises.find((exercise) => !exercise.skipped && exercise.sets.some((set) => !set.done && !set.isWarmup && !set.skipped))
  const activeExerciseId = (draft.exercises.some(item=>item.id===selectedExerciseId) ? selectedExerciseId : null) ?? nextExercise?.id ?? draft.exercises[0]?.id
  const activeExerciseNumber = draft.exercises.findIndex(item=>item.id===activeExerciseId)+1
  const toggleTimer = () => setDraft((current) => current && toggleWorkoutTimer(current))
  const finish = async () => {
    if (finishLock.current) return
    const latest=getActiveDraft(draft.userId)
    if(latest && latest.id===draft.id && latest.updatedAt!==draft.updatedAt) {setDraft(latest);setMessage('Черновик обновился в другой вкладке. Проверь результат перед завершением.');setFinishOpen(false);return}
    finishLock.current = true
    const validationError = workoutDraftValidationError(draft)
    if (validationError) {
      finishLock.current = false
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
    try { enqueueDraft(completed) } catch { finishLock.current = false; setFinishing(false); setMessage('Не удалось сохранить результат на устройство. Тренировка остаётся открытой.'); return }
    // Local success is visible immediately, even if the server is slow or offline.
    clearActiveDraft(completed.userId,completed.id,draft.updatedAt)
    if (navigator.onLine) void workoutSyncQueue.enqueue(completed).then(()=>{
      removeQueuedDraft(completed.userId,completed.id,completed.updatedAt)
      window.dispatchEvent(new CustomEvent('dostigator:training-sync-completed',{detail:{userId:completed.userId}}))
    }).catch(()=>undefined)
    navigate(`/training/history?finished=${completed.id}`, { replace: true })
  }

  const cancelWorkout = async () => {
    if (cancelLock.current) return
    const latest=getActiveDraft(draft.userId)
    if(latest && (latest.id!==draft.id || latest.updatedAt!==draft.updatedAt)) {
      setMessage('Черновик обновился в другой вкладке. Проверь результат перед отменой.');setCancelOpen(false);return
    }
    if (linkedCardio.length) {
      setMessage('Кардио уже связано с этой тренировкой. Заверши силовую либо сначала удали связанное кардио.');setCancelOpen(false);return
    }
    syncGenerationRef.current += 1
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
    cancelLock.current = true
    setCancelling(true)
    try {
      archiveCancelledDraft(draft)
      if (navigator.onLine) await workoutSyncQueue.cancel(draft.userId, draft.id, () => deleteWorkoutSession(draft.id,draft.userId))
      else {
        // Durable intent precedes removing the active pointer. The full draft remains archived.
        enqueueCancelledWorkout(draft.userId, draft.id)
        await workoutSyncQueue.cancel(draft.userId, draft.id, async () => undefined)
      }
      const retained=getActiveDraft(draft.userId)
      if(retained?.id===draft.id) archiveCancelledDraft(retained)
      clearActiveDraft(draft.userId,draft.id,retained?.updatedAt)
      if (navigator.onLine) removeCancelledWorkout(draft.userId,draft.id)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Отмена не подтверждена. Черновик сохранён.')
      setCancelling(false); cancelLock.current = false; setCancelOpen(false); return
    }
    navigate('/training', { replace: true })
  }

  const syncCopy: Record<SyncStatus, string> = {
    local: 'Сохранено на устройстве',
    syncing: 'Синхронизация…',
    synced: 'Сохранено в облаке',
    offline: 'Офлайн · сохранено на устройстве',
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
        <div className="workout-session-title"><h1>{draft.title}</h1><button type="button" className="text-button" onClick={()=>setFinishOpen(true)}>Завершить</button></div>
        <WorkoutTimer draft={draft} now={now} onToggle={toggleTimer} />
      </header>

      {!draft.programRevision && template.programRevision && <p className="reduced-mode-banner">Продолжается прежний черновик. V2.1 будет использована при следующем старте.</p>}
      {storageFailed && <p className="error-card" role="alert">Не удалось сохранить черновик на устройстве. Не закрывай страницу.</p>}
      {syncStatus === 'error' && syncError && <section className="sync-error-detail" role="alert"><p>{syncError}</p><button type="button" className="training-secondary" onClick={() => setSyncRetry(value => value + 1)}>Повторить синхронизацию</button></section>}
      <WorkoutSyncConflicts userId={draft.userId} currentWorkoutId={draft.id} />
      {message && <div className="workout-message" role="alert">{message}</div>}
      {draft.readiness?.mode === 'reduced' && <div className="reduced-mode-banner"><strong>Облегчённый режим · без прибавки нагрузки</strong></div>}
      <section className="workout-progress-panel" aria-label="Прогресс тренировки">
        <div><strong>{finishSummary.sets} / {draft.exercises.filter((exercise) => !exercise.skipped).flatMap((exercise) => exercise.sets).filter((set) => !set.isWarmup).length}</strong><span>рабочих подходов</span></div>
        <progress aria-label="Выполненные рабочие подходы" value={finishSummary.sets} max={Math.max(1, draft.exercises.filter((exercise) => !exercise.skipped).flatMap((exercise) => exercise.sets).filter((set) => !set.isWarmup).length)} />
      </section>
      <div ref={currentActionRef} className="workout-current-action">
      {confirmation && <div className="training-confirmation" role="status"><CheckCircle2 size={18} /><span>{confirmation.text}</span><small>{confirmation.exerciseName}</small>{!autoRest && confirmation.needsRest && <button type="button" aria-label={`Начать отдых · ${formatRestDuration(confirmation.seconds)}`} onClick={() => { primeRestAlert(); setDraft((current) => current && ({ ...current, activeRest: { until: Date.now() + confirmation.seconds * 1000, exerciseName: confirmation.exerciseName, plannedSeconds: confirmation.seconds } })) }}>Отдых</button>}</div>}

      {historyStatus === 'error' && <button className="history-retry" type="button" onClick={()=>setHistoryRetry(value=>value+1)}>Прошлые результаты недоступны · повторить</button>}
      <div className="workout-focus-nav"><button type="button" className="training-secondary" onClick={event=>{event.currentTarget.focus({preventScroll:true});setExercisePickerOpen(true)}}>Упражнение {activeExerciseNumber} из {draft.exercises.length} <span>Список</span></button></div>
      {!nextExercise && finishSummary.sets > 0 && <section className="strength-complete" role="status"><CheckCircle2 /><h2>Силовая часть готова</h2><p>{finishSummary.sets} рабочих подходов записано.</p>{linkedCardio.length ? <><p>Кардио записано · {cardioClock(linkedCardio.reduce((sum,item)=>sum+item.receipt.durationSeconds,0)*1000)}</p><button type="button" className="primary-button wide" onClick={()=>setFinishOpen(true)}>Завершить тренировку</button></> : <><Link className="primary-button wide" to="/training/cardio">Перейти к кардио</Link><button type="button" className="text-button" onClick={()=>setFinishOpen(true)}>Завершить без кардио</button></>}</section>}
      {draft.activeRest !== null && (
        <RestTimer
          until={draft.activeRest.until}
          exerciseName={draft.activeRest.exerciseName}
          plannedSeconds={draft.activeRest.plannedSeconds}
          onChange={(until) => setDraft((current) => current && current.activeRest ? ({ ...current, activeRest: { ...current.activeRest, until } }) : current)}
          onSkip={() => setDraft((current) => current && ({ ...current, activeRest: null }))}
        />
      )}

      <div className="exercise-list">
        {draft.exercises.filter(exercise=>exercise.id===activeExerciseId).map((exercise) => (
          <ExerciseCard
            key={exercise.id}
            exercise={exercise}
            userId={draft.userId}
            previous={previous.get(exercise.exercise.key)}
            reduced={draft.readiness?.mode === 'reduced'}
            active={activeExerciseId === exercise.id}
            plannedSets={exercise.sets.filter(set=>!set.isWarmup).length}
            historyStatus={historyStatus}
            historyFromCache={historyFromCache}
            recordLocked={now < lastRecordAt + 650}
            onActivate={() => selectExercise(exercise.id)}
            onRecordSet={(set) => recordSet(exercise.id, set)}
            onUndoSet={(set) => changeSetState(exercise.id, set, 'undo')}
            onSkipSet={(set) => changeSetState(exercise.id, set, 'skip')}
            onAddSet={(warmup) => addSet(exercise.id, warmup)}
            onRemoveSet={(set) => removeSet(exercise.id, set)}
            onSkip={(reason) => skipExercise(exercise.id, reason)}
            onReplace={(replacement) => replaceExercise(exercise.id, replacement)}
            alternatives={alternatives}
          />
        ))}
      </div>
      </div>
      {exercisePickerOpen && <BottomSheet title="Упражнения тренировки" onClose={()=>setExercisePickerOpen(false)}><div className="choice-list workout-exercise-picker">{draft.exercises.map((exercise,index)=><button key={exercise.id} type="button" aria-current={exercise.id===activeExerciseId?'step':undefined} onClick={()=>{selectExercise(exercise.id);setExercisePickerOpen(false)}}><span><strong>{index+1}. {exercise.exercise.name}</strong><small>{exercise.skipped?'Пропущено':`${exercise.sets.filter(set=>set.done&&!set.isWarmup).length} из ${exercise.sets.filter(set=>!set.isWarmup).length} записано`}</small></span></button>)}</div></BottomSheet>}
      <details className="training-extras workout-options"><summary><span><strong>Автоотдых и самочувствие</strong><small>{autoRest ? 'Автоотдых включён' : 'Автоотдых выключен'} · оценка готовности</small></span></summary><label className="training-toggle"><input type="checkbox" checked={autoRest} onChange={(event) => { setAutoRest(event.target.checked); localStorage.setItem(`trainlog:auto-rest:${draft.userId}`, String(event.target.checked)) }} />Автоматически запускать отдых после подхода</label><details className="training-extras workout-readiness"><summary>Изменить оценку самочувствия</summary><ReadinessCheck submitLabel="Обновить самочувствие" onComplete={(readiness) => setDraft((current) => current && ({ ...current, readiness, updatedAt: new Date().toISOString(), syncState: 'pending' }))} /></details></details>

      <Link className="workout-cardio-link" to="/training/cardio"><HeartPulse /><span><strong>Добавить кардио</strong><small>Включить таймер или записать время вручную. Силовая тренировка останется сохранённой.</small></span></Link>
      <Link className="workout-cardio-link" to="/training/exercises"><span><strong>Добавить упражнения</strong><small>Выбрать из общего каталога или добавить своё в текущую тренировку.</small></span></Link>



      {finishOpen && (
        <BottomSheet title="Завершить тренировку" onClose={() => !finishing && setFinishOpen(false)}>
          <div className="finish-summary">
            <CheckCircle2 />
            <p className="eyebrow">Тренировка {template.code}</p>
            <h3>{draft.title}</h3>
            <div>
              <span><strong>{elapsedClock(draft,now)}</strong> время</span>
              <span><strong>{finishSummary.sets}</strong> подходы</span>
              <span><strong>{formatNumber(finishSummary.volume)}</strong> кг тоннажа</span>
            </div>

            <p className="finish-cardio-fact">{linkedCardio.length?`Кардио: ${cardioClock(linkedCardio.reduce((sum,item)=>sum+item.receipt.durationSeconds,0)*1000)} записано`:'Кардио не записано для этой тренировки'}</p>
            {draft.exercises.some(exercise=>exercise.skipped||exercise.sets.some(set=>!set.isWarmup&&set.skipped)) && <p className="finish-warning">Есть пропуски: упражнений {draft.exercises.filter(exercise=>exercise.skipped).length}, подходов {draft.exercises.flatMap(exercise=>exercise.sets).filter(set=>!set.isWarmup&&set.skipped).length}.</p>}
            <p className="muted">Сначала сохраняем результат на этом устройстве. До подтверждения синхронизации очистка данных браузера может его удалить.</p>
            {draft.exercises.flatMap((exercise) => exercise.skipped ? [] : exercise.sets).filter((set) => !set.isWarmup && !set.done && !set.skipped).length > 0 && (
              <p className="finish-warning">Не завершено рабочих подходов: {draft.exercises.flatMap((exercise) => exercise.skipped ? [] : exercise.sets).filter((set) => !set.isWarmup && !set.done && !set.skipped).length}. Можно вернуться или сохранить неполную тренировку.</p>
            )}
            <button className="primary-button wide" type="button" onClick={() => void finish()} disabled={finishing}>
              {finishing ? 'Сохраняем…' : draft.exercises.some((exercise) => !exercise.skipped && exercise.sets.some((set) => !set.isWarmup && !set.done && !set.skipped)) ? 'Сохранить неполную тренировку' : 'Сохранить тренировку'}
            </button>
            <details className="training-extras finish-comparison"><summary>Упражнения и сравнение с прошлым разом</summary>
            <WorkoutResult userId={draft.userId} workout={draftToHistory({ ...draft, finishedAt: new Date(now).toISOString() })} history={mergeTrainingHistory(cachedTrainingHistory(draft.userId), getSyncQueue(draft.userId))} />
            </details>
          </div>
        </BottomSheet>
      )}
      {cancelOpen && (
        <BottomSheet title="Отменить тренировку?" onClose={() => setCancelOpen(false)}>
          <div className="finish-summary cancel-summary">
            <Trash2 />
            <h3>Отменить эту тренировку</h3>
            <p className="muted">Уже синхронизированные строки этой незавершённой тренировки тоже будут удалены. Завершённая история не затрагивается. Локальная копия черновика останется на устройстве.</p>
            <button className="danger-button wide" type="button" disabled={cancelling} onClick={() => void cancelWorkout()}>{cancelling ? 'Отменяем…' : 'Отменить тренировку'}</button>
            <button className="text-button" type="button" onClick={() => setCancelOpen(false)}>Продолжить тренировку</button>
          </div>
        </BottomSheet>
      )}
    </main>
  )
}
