import { CheckCircle2, Pause, Play, Square } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { CARDIO_CHANGED_EVENT, cardioDuration, getCardioConflicts, resolveCardioConflict, cardioKinds, deleteCardio, getCardioDeletes, enqueueCardio, getCachedCardio, getCardioQueue, loadCardio, syncCardio, validateCardio, type CardioSession } from '../lib/cardio'
import { cardioClock, cardioDifference, cardioDraftKey, cardioElapsedMs, changeCardioTimer, getCardioGoal, loadCardioDraft, newCardioDraft, saveCardioDraft, type CardioDraft } from '../lib/cardio-workout'
import { loadCardioDetails, saveCardioDetails } from '../lib/cardio-details'
import { getActiveDraft } from '../lib/storage'
import { loadCardioReceipt, saveCardioReceipt } from '../lib/cardio-receipts'
import { weeklyProgress } from '../lib/training-insights'
import { Link, useSearchParams } from 'react-router-dom'
import { BottomSheet } from './BottomSheet'
import { localDate } from '../lib/date'
import { formatNumber } from '../lib/workout'
import { CardioBackup } from './CardioBackup'
import { TrainingDisclosure } from './TrainingDisclosure'
import './cardio-journal.css'

const noteHints: Record<CardioSession['kind'], string> = {
  walk: 'Заметка о занятии',
  bike: 'Заметка о занятии',
  elliptical: 'Заметка о занятии',
  outdoor: 'Маршрут, покрытие и условия',
  other: 'Настройки или особенности занятия',
}

function optionalDecimal(value: string, label: string, minimum: number, maximum: number) {
  const text = value.trim()
  if (!text) return null
  const number = /^-?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text) ? Number(text.replace(',', '.')) : NaN
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(`${label}: число от ${minimum} до ${maximum}. Дробную часть можно отделить запятой или точкой.`)
  return number
}

function sessionSettings(userId: string, session: CardioSession) {
  const local = loadCardioDetails(userId, session.id)
  // A revisioned server record is authoritative even when a metric was cleared.
  // Legacy records may still have settings in the device sidecar.
  const value = (cloud: number | null | undefined, fallback: string) => {
    if (session.revision || cloud != null) return cloud == null ? '' : String(cloud)
    return fallback
  }
  return {
    speed: value(session.speed_kmh, local.speed),
    incline: value(session.incline_percent, local.incline),
    resistance: value(session.resistance_level, local.resistance),
  }
}

const settingsNumber = (value: string) => {
  const number = Number(value.replace(',', '.'))
  return Number.isFinite(number) ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 20 }).format(number) : value
}

function CardioSettingsFacts({ userId, session }: { userId: string; session: CardioSession }) {
  const settings = sessionSettings(userId, session)
  const facts = [
    ...(session.kind === 'walk' ? [
      { label: 'Скорость', value: settings.speed, unit: 'км/ч' },
      { label: 'Наклон', value: settings.incline, unit: '%' },
    ] : []),
    ...(['bike', 'elliptical'].includes(session.kind) ? [{ label: 'Сопротивление', value: settings.resistance, unit: '' }] : []),
  ].filter(fact => fact.value !== '')
  return facts.length > 0 ? <dl className="cardio-settings-facts">{facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{settingsNumber(fact.value)} {fact.unit}</dd></div>)}</dl> : null
}

export function CardioJournal({ userId, renderResultPhoto }: { userId: string; renderResultPhoto?: (id: string) => ReactNode }) {
  const [searchParams] = useSearchParams()
  const optionalC = searchParams.get('program') === 'C'
  const [sessions, setSessions] = useState(() => getCachedCardio(userId))
  const [draft, setDraftState] = useState(() => { const stored=loadCardioDraft(userId);const active=getActiveDraft(userId); if(optionalC && !active && stored.phase==='saved' && !stored.editing)return newCardioDraft(userId,stored.kind); if(active&&stored.phase==='saved'&&!stored.editing&&stored.workoutId!==active.id)return newCardioDraft(userId,stored.kind,active.id);return stored.phase==='ready' ? {...stored,workoutId:active?.id ?? null} : stored })
  const activeWorkout=getActiveDraft(userId)
  const [now, setNow] = useState(Date.now)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [draftStorageError, setDraftStorageError] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [replaceTarget, setReplaceTarget] = useState<CardioSession | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CardioSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(() => getCardioQueue(userId))
  const setDraft = (update: CardioDraft | ((current: CardioDraft) => CardioDraft)) => {
    const latest = loadCardioDraft(userId)
    if (latest.updatedAt !== draft.updatedAt) { setDraftState(latest); setError('Черновик обновился в другой вкладке. Проверь состояние.'); return }
    setDraftState((current) => ({ ...(typeof update === 'function' ? update(current) : update), updatedAt: Math.max(new Date().getTime(), current.updatedAt + 1) }))
  }
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await syncCardio(userId)
      setSessions(navigator.onLine ? await loadCardio(userId) : getCachedCardio(userId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось обновить кардио')
      setSessions(getCachedCardio(userId))
    } finally { setPending(getCardioQueue(userId)); setLoading(false) }
  }, [userId])
  useEffect(() => {
    void refresh()
    const changed = (event: Event) => {
      if ((event as CustomEvent<{ userId: string }>).detail.userId !== userId) return
      setSessions(getCachedCardio(userId))
      setPending(getCardioQueue(userId))
    }
    window.addEventListener(CARDIO_CHANGED_EVENT, changed)
    window.addEventListener('online', refresh)
    return () => { window.removeEventListener(CARDIO_CHANGED_EVENT, changed); window.removeEventListener('online', refresh) }
  }, [refresh, userId])
  useEffect(() => { try { if (!saveCardioDraft(draft)) setDraftState(loadCardioDraft(userId)); setDraftStorageError(false) } catch { setDraftStorageError(true) } }, [draft, userId])
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key === cardioDraftKey(userId)) setDraftState(loadCardioDraft(userId)) }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [userId])
  useEffect(() => {
    if (draft.phase !== 'running') return
    const interval = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(interval)
  }, [draft.phase])

  const { previous, minutes: proposed, reason } = getCardioGoal(sessions, draft.kind, draft.date, draft.id, draft.createdAt ?? undefined)
  const dayPlan=activeWorkout && ['A','B'].includes(activeWorkout.templateCode) && draft.workoutId===activeWorkout.id && !draft.editing
  const cPlan = !draft.editing && (optionalC || activeWorkout?.templateCode === 'C')
  const defaultGoal=dayPlan?20:cPlan?30:proposed
  const goal = draft.goalMinutes ?? defaultGoal
  const elapsedMs = cardioElapsedMs(draft, now)
  const saved = draft.phase === 'saved' ? sessions.find((session) => session.id === draft.id) : undefined
  const timerActive = draft.phase === 'running' || draft.phase === 'paused'
  const recording = draft.phase === 'manual' || draft.phase === 'review'
  const field = (name: keyof CardioDraft, value: string) => setDraft((current) => ({ ...current, [name]: value, ...(['minutes','seconds'].includes(name)?{precisionKnown:true}:{}) }))
  const timer = (action: 'start' | 'pause' | 'resume' | 'finish') => {
    setNow(Date.now())
    setDraft((current) => changeCardioTimer({ ...current, goalMinutes: current.goalMinutes ?? defaultGoal }, action))
  }
  const performReset = () => { setDraft(newCardioDraft(userId, draft.kind, getActiveDraft(userId)?.id ?? null)); setError(null); setResetOpen(false) }
  const reset = () => { if (!['ready', 'saved'].includes(draft.phase)) setResetOpen(true); else performReset() }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (savingRef.current || !recording) return
    const latest = loadCardioDraft(userId)
    if (latest.updatedAt !== draft.updatedAt) { setDraftState(latest); setError('Черновик обновился в другой вкладке. Проверь результат перед записью.'); return }
    savingRef.current = true
    setSaving(true)
    setError(null)
    const timestamp = new Date().toISOString()
    try {
      const speed = draft.kind === 'walk' ? optionalDecimal(draft.speed, 'Скорость, км/ч', 0.1, 50) : null
      const incline = draft.kind === 'walk' ? optionalDecimal(draft.incline, 'Наклон, %', -20, 40) : null
      const session: CardioSession = {
        id: draft.id, user_id: userId, activity_date: draft.date, kind: draft.kind,
        duration_minutes: draft.minutes.trim() ? Number(draft.minutes) : 0,
        duration_seconds: draft.editing && draft.precisionKnown===false ? null : Number(draft.minutes || 0)*60+Number(draft.seconds || 0),
        workout_session_id:draft.workoutId, revision:draft.baseRevision ?? 0, legacy_updated_at:draft.baseUpdatedAt ?? null,
        speed_kmh: speed,
        incline_percent: incline,
        resistance_level:['elliptical','bike'].includes(draft.kind) && draft.resistance.trim()?Number(draft.resistance):null,
        distance_km: draft.distance.trim() ? Number(draft.distance) : null,
        effort: draft.effort.trim() ? Number(draft.effort) : null,
        average_pulse: draft.pulse.trim() ? Number(draft.pulse) : null,
        note: draft.note.trim(), created_at: draft.createdAt ?? timestamp, updated_at: timestamp,
      }
      const seconds=Number(draft.seconds || 0)
      if(!Number.isInteger(seconds) || seconds<0 || seconds>59) throw new Error('Секунды: целое число от 0 до 59')
      const validationError = validateCardio(session)
      if (validationError) throw new Error(validationError)
      if(session.duration_seconds!=null) saveCardioReceipt(userId,session,{durationSeconds:session.duration_seconds,workoutId:draft.workoutId,updatedAt:session.updated_at})
      saveCardioDetails(userId, session.id, { speed: speed == null ? '' : String(speed), incline: incline == null ? '' : String(incline), resistance: ['elliptical', 'bike'].includes(draft.kind) ? draft.resistance : '' })
      enqueueCardio(session)
      setDraft((current) => ({ ...current, phase: 'saved', createdAt: session.created_at, savedAt: timestamp }))
      await syncCardio(userId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить кардио')
      // The queued result was already persisted before the await. Reusing the old
      // render's setter here would report a false other-tab conflict.
    } finally {
      setSessions(getCachedCardio(userId)); setPending(getCardioQueue(userId)); setSaving(false); savingRef.current = false
    }
  }
  const openEdit = (session: CardioSession) => {
    setDraft({ ...newCardioDraft(userId, session.kind), id: session.id, baseRevision:session.revision??0, baseUpdatedAt:session.updated_at, precisionKnown:loadCardioReceipt(userId,session)!==null, phase: 'manual', date: session.activity_date, minutes: String(session.duration_minutes), seconds: String((loadCardioReceipt(userId,session)?.durationSeconds ?? session.duration_minutes*60)%60), workoutId: loadCardioReceipt(userId,session)?.workoutId ?? null, distance: session.distance_km === null ? '' : String(session.distance_km), pulse: session.average_pulse === null ? '' : String(session.average_pulse), effort: session.effort === null ? '' : String(session.effort), note: session.note, ...sessionSettings(userId, session), editing: true, createdAt: session.created_at })
    setError(null)
    document.getElementById('cardio-workout')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const edit = (session: CardioSession) => { if (!['ready', 'saved'].includes(draft.phase)) setReplaceTarget(session); else openEdit(session) }

  return <section className="cardio-workout" id="cardio-workout" aria-label="Кардиотренировка">
    {activeWorkout && draft.workoutId && draft.workoutId!==activeWorkout.id && !draft.editing && draft.phase!=='saved' && <p className="error-card" role="status">Открыт незавершённый ввод кардио другой тренировки. Он сохранится для неё, к текущей силовой не привязан. Можно закончить запись или сбросить ввод отдельно.</p>}
    <div className="training-session-card">
      <label className="cardio-activity-label">Активность<select aria-label="Вид кардио" disabled={timerActive || draft.phase === 'saved'} value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as CardioSession['kind'], goalMinutes: null }))}>{Object.entries(cardioKinds).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>
      <div className="training-comparison"><div><span>Прошлый факт{previous ? ` · ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(`${previous.activity_date}T12:00:00`))}` : ''}</span><strong>{previous ? cardioDuration(previous) : loading ? 'Загружаем…' : error ? 'История недоступна' : 'Нет записи'}</strong>{previous && <CardioSettingsFacts userId={userId} session={previous} />}</div><div><span>{draft.editing ? 'Дата записи' : 'Цель сегодня'}</span><strong>{draft.editing ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(`${draft.date}T12:00:00`)) : `${goal} мин`}</strong></div></div>
      {draft.phase === 'ready' && <><p className="entry-caption">{dayPlan?'План этого тренировочного дня — 20 минут. Прошлая запись не меняет его.':cPlan?'C · по желанию: 30–45 минут умеренного кардио. На дисциплину отсутствие C не влияет.':reason}</p><button type="button" className="training-secondary" onClick={() => timer('start')}><Play size={20} />Запустить таймер</button><button type="button" className="training-secondary" onClick={() => setDraft((current) => ({ ...current, phase: 'manual', goalMinutes: goal }))}>Уже сделал · записать время</button><TrainingDisclosure className="training-extras" title="Изменить цель"><label>План, мин<input type="number" inputMode="numeric" min="1" max="1440" value={goal} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= 1440) setDraft((current) => ({ ...current, goalMinutes: value })) }} /></label></TrainingDisclosure></>}
      {timerActive && <div className="cardio-timer"><p className="eyebrow">{draft.phase === 'paused' ? 'Пауза' : 'Тренировка идёт'}</p><time aria-label="Таймер кардио">{cardioClock(elapsedMs)}</time><p className="entry-caption">Пока не сохранено в историю</p>{draft.phase === 'paused' ? <button type="button" className="primary-button training-record-button" onClick={() => timer('resume')}><Play size={20} />Продолжить кардио</button> : <button type="button" className="primary-button training-record-button" onClick={() => timer('finish')}><Square size={18} />Завершить кардио</button>}<button type="button" className="training-secondary" onClick={() => timer(draft.phase === 'paused' ? 'finish' : 'pause')}>{draft.phase === 'paused' ? <><Square size={18} />Завершить кардио</> : <><Pause size={18} />Пауза</>}</button></div>}
      {recording && <form className="cardio-record-form" onSubmit={(event) => void save(event)}><h2>{draft.editing ? 'Исправить факт' : 'Записать результат'}</h2>{draft.phase === 'review' && <p className="cardio-timer-result">По таймеру: <strong>{cardioClock(draft.elapsedMs)}</strong></p>}<label>Фактическое время, мин<input aria-label="Фактическое время, мин" autoFocus={draft.phase === 'manual'} type="number" inputMode="numeric" min="0" max="1440" step="1" required value={draft.minutes} placeholder="Введи реальное время" onChange={(event) => field('minutes', event.target.value)} /></label><label>Дополнительные секунды<input aria-label="Фактическое время, секунды" type="number" inputMode="numeric" min="0" max="59" step="1" value={draft.seconds} onChange={event=>field('seconds',event.target.value)} /></label><p className="entry-caption">Сохраняются фактические минуты и секунды, включая занятия короче минуты.{draft.editing && draft.precisionKnown===false ? ' У старой записи секунды неизвестны. Измени время только если знаешь точный результат.' : ''}</p>{draft.kind === 'walk' && <fieldset className="cardio-treadmill-settings"><legend>Настройки дорожки · необязательно</legend><p className="entry-caption" id="cardio-treadmill-hint">Укажи значения на тренажёре. Можно оставить пустыми; запятая и точка подходят.</p><div className="cardio-treadmill-inputs"><label>Скорость, км/ч<input aria-label="Скорость, км/ч" aria-describedby="cardio-treadmill-hint" type="text" inputMode="decimal" autoComplete="off" maxLength={16} placeholder="Например, 6,5" value={draft.speed} onChange={event => field('speed', event.target.value)} /></label><label>Наклон, %<input aria-label="Наклон, %" aria-describedby="cardio-treadmill-hint" type="text" inputMode="decimal" autoComplete="off" maxLength={16} placeholder="Например, 2,5" value={draft.incline} onChange={event => field('incline', event.target.value)} /></label></div></fieldset>}<p className="entry-caption">После сохранения результата можно прикрепить фото.</p><button type="submit" className="primary-button training-record-button" disabled={saving || !draft.minutes}>{saving ? 'Сохраняем…' : draft.editing ? 'Сохранить исправление' : 'Сохранить кардио'}</button><button type="button" className="text-button" onClick={() => draft.phase === 'review' ? setDraft((current) => ({ ...current, phase: 'paused' })) : reset()}>{draft.phase === 'review' ? 'Вернуться к таймеру' : draft.editing ? 'Сбросить исправления' : 'Сбросить несохранённый ввод'}</button><TrainingDisclosure className="training-extras" title="Детали занятия · необязательно"><label>Дата<input aria-label="Дата кардио" type="date" max={localDate()} required value={draft.date} onChange={(event) => field('date', event.target.value)} /></label>{(['walk', 'bike', 'elliptical', 'outdoor'].includes(draft.kind) || draft.distance) && <label>Дистанция, км<input aria-label="Дистанция, км" type="number" inputMode="decimal" min="0.01" max="1000" step="0.01" value={draft.distance} onChange={(event) => field('distance', event.target.value)} /></label>}{['elliptical', 'bike'].includes(draft.kind) && <label>Уровень сопротивления<input aria-label="Уровень сопротивления" type="number" min="0" max="100" step="0.5" value={draft.resistance} onChange={(event) => field('resistance', event.target.value)} /></label>}{['walk', 'elliptical', 'bike'].includes(draft.kind) && <small>Настройки сохраняются вместе с результатом.</small>}{(draft.workoutId || activeWorkout) && <label><input type="checkbox" checked={Boolean(draft.workoutId)} onChange={event=>setDraft(current=>({...current,workoutId:event.target.checked?activeWorkout?.id??current.workoutId:null}))} />Часть силовой тренировки</label>}<label>Средний пульс<input aria-label="Средний пульс" type="number" inputMode="numeric" min="30" max="250" step="1" value={draft.pulse} onChange={(event) => field('pulse', event.target.value)} /></label><label>{noteHints[draft.kind]}<textarea aria-label="Заметка по кардио" rows={2} maxLength={4000} value={draft.note} onChange={(event) => field('note', event.target.value)} /></label><label>Усилие, 1–10 · если оценивал<input aria-label="Оценка усилия кардио" type="number" min="1" max="10" step="1" value={draft.effort} onChange={(event) => field('effort', event.target.value)} /></label><small>Эти данные не повышают цель автоматически.</small></TrainingDisclosure></form>}
      {draft.phase === 'saved' && <div className="cardio-saved"><CheckCircle2 size={30} /><h2>{draft.editing ? 'Исправление сохранено' : 'Кардио сохранено'}</h2><strong className="saved-duration">{saved?cardioDuration(saved):`${draft.minutes} мин ${draft.seconds||0} сек`}</strong>{saved && <CardioSettingsFacts userId={userId} session={saved} />}<p role="status">{pending.some((session) => session.id === draft.id) ? 'На устройстве · ждёт синхронизации' : saved?.revision ? 'Кардио синхронизировано с сервером' : 'Сохранено на устройстве'}</p><p>{cardioDifference(saved?.duration_minutes ?? Number(draft.minutes), previous, saved?.duration_seconds ?? Number(draft.minutes)*60+Number(draft.seconds||0))}</p>{draft.goalMinutes !== null && !draft.editing && <p className="entry-caption">План: {draft.goalMinutes} мин · факт: {draft.minutes} мин {draft.seconds || 0} сек</p>}<p>Кардио за эту неделю: <strong>{Math.floor(weeklyProgress([], sessions)[0].cardioSeconds/60)} мин {weeklyProgress([], sessions)[0].cardioSeconds%60} сек</strong></p><p className="entry-caption">{saved?.workout_session_id ? 'Связано с силовой тренировкой' : draft.workoutId ? 'Связь с силовой ожидает синхронизации' : 'Отдельное кардио'}</p>{renderResultPhoto?.(draft.id)}{activeWorkout && <Link className="primary-button wide" to={`/training/workout/${activeWorkout.templateCode}`}>Вернуться к силовой и завершить</Link>}<Link className="text-button" to="/training/progress">Прогресс по неделям</Link><button type="button" className={activeWorkout?'training-secondary':'primary-button training-record-button'} onClick={reset}>Новое кардио</button></div>}
    </div>
    {draftStorageError && <p role="alert" className="error-card">Черновик не сохранён на устройстве. Не закрывай страницу.</p>}
    {timerActive && <button type="button" className="text-button" onClick={reset}>Сбросить несохранённый таймер</button>}
    {error && <div className="error-card" role="alert"><span>{error}</span>{pending.length > 0 && <span>Локальная очередь ожидает синхронизации.</span>}<button type="button" className="text-button" onClick={() => void refresh()}>Повторить синхронизацию</button></div>}
    <TrainingDisclosure className="training-extras cardio-history" title={`История кардио · ${sessions.length}`}><div className="cardio-log-list" aria-busy={loading}>{!sessions.length && !loading && <p className="muted">Пока нет записей</p>}{sessions.map((session) => <article className="cardio-log-card" key={session.id}><header><div><time dateTime={session.activity_date}>{new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(`${session.activity_date}T12:00:00`))}</time><h3>{cardioKinds[session.kind]}</h3></div><button type="button" className="text-button" aria-label={`Редактировать кардио ${session.activity_date}`} onClick={() => edit(session)}>Изменить</button><button type="button" className="text-button" aria-label={`Удалить сохранённое кардио ${session.activity_date}`} onClick={() => setDeleteTarget(session)}>Удалить</button></header><div className="cardio-log-metrics"><strong>{cardioDuration(session)}</strong>{session.distance_km !== null && <span>{formatNumber(session.distance_km)} км</span>}{session.average_pulse !== null && <span>пульс {session.average_pulse}</span>}{session.effort !== null && <span>усилие {session.effort}/10</span>}</div>{session.note && <p>{session.note}</p>}{loadCardioReceipt(userId,session) && <small>{session.revision ? 'Точное время с сервера:' : 'Точное время на устройстве:'} {Math.floor(loadCardioReceipt(userId,session)!.durationSeconds/60)} мин {loadCardioReceipt(userId,session)!.durationSeconds%60} сек</small>}<CardioSettingsFacts userId={userId} session={session} />{renderResultPhoto?.(session.id)}{pending.some((item) => item.id === session.id) && <small>На устройстве, ждёт синхронизации</small>}</article>)}</div></TrainingDisclosure>
    {resetOpen && <BottomSheet title="Сбросить несохранённый ввод?" onClose={() => setResetOpen(false)}><p>Несохранённый таймер и ввод будут сброшены. Сохранённые тренировки и текущая запись в истории останутся.</p><button type="button" className="training-secondary" onClick={() => setResetOpen(false)}>Продолжить ввод</button><button type="button" className="danger-button" onClick={performReset}>Сбросить только ввод</button></BottomSheet>}
    {replaceTarget && <BottomSheet title="Заменить несохранённый ввод?" onClose={() => setReplaceTarget(null)}><p>Текущий ввод будет заменён сохранённой записью за {replaceTarget.activity_date}. История пока не изменится.</p><button type="button" className="training-secondary" onClick={() => setReplaceTarget(null)}>Продолжить ввод</button><button type="button" className="danger-button" onClick={() => { openEdit(replaceTarget); setReplaceTarget(null) }}>Открыть сохранённую запись</button></BottomSheet>}
    {deleteTarget && <BottomSheet title="Удалить сохранённую тренировку?" onClose={() => setDeleteTarget(null)}><div className="training-session-card"><p>{cardioKinds[deleteTarget.kind]} · {deleteTarget.activity_date} · {deleteTarget.duration_minutes} мин</p><button type="button" className="danger-button" onClick={async () => { try { deleteCardio(userId, deleteTarget.id); if (deleteTarget.id === draft.id) setDraft(newCardioDraft(userId, draft.kind, getActiveDraft(userId)?.id ?? null)); setDeleteTarget(null); setSessions(getCachedCardio(userId)); await syncCardio(userId) } catch { setError('Удаление не синхронизировано. Проверь соединение и локальное хранилище.') } }}>Удалить эту тренировку</button><button type="button" className="training-secondary" onClick={() => setDeleteTarget(null)}>Оставить в истории</button></div></BottomSheet>}
    {getCardioConflicts(userId).map(conflict=><section className="error-card cardio-conflict" key={conflict.id} aria-label="Конфликт кардио"><h3>Кардио изменилось на другом устройстве</h3><p>На устройстве: {conflict.deleting?'удаление':conflict.local?cardioDuration(conflict.local):'нет записи'} · {conflict.local?.note}</p><p>На сервере: {conflict.remote && !conflict.remote.deleted_at?cardioDuration(conflict.remote):'запись удалена'} · {conflict.remote?.note}</p><p>Локальная копия останется доступна для восстановления.</p><button type="button" className="training-secondary" onClick={()=>{resolveCardioConflict(userId,conflict.id,'server');void refresh()}}>Оставить серверную версию</button>{(!conflict.remote || conflict.remote.deleted_at) && Boolean(conflict.local?.duration_seconds) && <button type="button" className="training-secondary" onClick={()=>{resolveCardioConflict(userId,conflict.id,'copy');void refresh()}}>Записать мою версию как новое кардио</button>}{conflict.remote && !conflict.remote.deleted_at && <button type="button" className="training-secondary" onClick={()=>{resolveCardioConflict(userId,conflict.id,'local');void refresh()}}>Сохранить мою версию</button>}</section>)}
    <CardioBackup userId={userId} onRestore={refresh}/>
    {getCardioDeletes(userId).length > 0 && <p className="entry-caption">Удаление ожидает синхронизации: {getCardioDeletes(userId).length}. До неё облачная копия может сохраняться.</p>}
  </section>
}
