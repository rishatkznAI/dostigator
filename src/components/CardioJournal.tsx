import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CARDIO_CHANGED_EVENT, cardioKinds, enqueueCardio, getCachedCardio, getCardioQueue, loadCardio, syncCardio, type CardioSession } from '../lib/cardio'
import { localDate, startOfWeek } from '../lib/date'
import { createId, formatNumber } from '../lib/workout'

const blankForm = () => ({ date: localDate(), kind: 'walk' as CardioSession['kind'], minutes: '', distance: '', effort: '', pulse: '', note: '' })

export function CardioJournal({ userId }: { userId: string }) {
  const [sessions, setSessions] = useState(() => getCachedCardio(userId))
  const [form, setForm] = useState(blankForm)
  const [editing, setEditing] = useState<CardioSession | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(() => getCardioQueue(userId))
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await syncCardio(userId)
      if (navigator.onLine) setSessions(await loadCardio(userId))
      else setSessions(getCachedCardio(userId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось обновить кардио')
      setSessions(getCachedCardio(userId))
    } finally {
      setPending(getCardioQueue(userId))
      setLoading(false)
    }
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
    return () => {
      window.removeEventListener(CARDIO_CHANGED_EVENT, changed)
      window.removeEventListener('online', refresh)
    }
  }, [refresh, userId])

  const previous = sessions.find((session) => session.kind === form.kind && session.id !== editing?.id && session.activity_date <= form.date)
  const week = sessions.filter((session) => session.activity_date >= startOfWeek() && session.activity_date <= localDate())
  const field = (name: keyof typeof form, value: string) => setForm((current) => ({ ...current, [name]: value }))
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    setMessage(null)
    const timestamp = new Date().toISOString()
    let queued = false
    try {
      const session: CardioSession = {
        id: editing?.id ?? createId(), user_id: userId, activity_date: form.date, kind: form.kind,
        duration_minutes: form.minutes.trim() ? Number(form.minutes) : 0,
        distance_km: form.distance.trim() ? Number(form.distance) : null,
        effort: form.effort.trim() ? Number(form.effort) : null,
        average_pulse: form.pulse.trim() ? Number(form.pulse) : null,
        note: form.note.trim(), created_at: editing?.created_at ?? timestamp, updated_at: timestamp,
      }
      enqueueCardio(session)
      queued = true
      setEditing(null)
      setForm(blankForm())
      await syncCardio(userId)
      setMessage(navigator.onLine && !getCardioQueue(userId).some((item) => item.id === session.id) ? 'Кардио и заметка сохранены в облаке' : 'Сохранено на устройстве · синхронизируем при подключении')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить кардио')
      if (queued) setMessage('Запись сохранена на устройстве и ждёт синхронизации')
    } finally {
      setSessions(getCachedCardio(userId))
      setPending(getCardioQueue(userId))
      setSaving(false)
    }
  }

  const edit = (session: CardioSession) => {
    setEditing(session)
    setForm({ date: session.activity_date, kind: session.kind, minutes: String(session.duration_minutes), distance: session.distance_km === null ? '' : String(session.distance_km), effort: session.effort === null ? '' : String(session.effort), pulse: session.average_pulse === null ? '' : String(session.average_pulse), note: session.note })
    setMessage(null)
    document.getElementById('cardio-journal-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <section className="cardio-journal section-block" aria-label="Журнал кардио">
      <div className="section-heading"><div><p className="eyebrow">Твои результаты</p><h2>Журнал кардио</h2></div><span className="cardio-week-total">{week.length} сессий · {week.reduce((sum, session) => sum + session.duration_minutes, 0)} мин за неделю</span></div>
      <form className="cardio-log-form" id="cardio-journal-form" onSubmit={(event) => void save(event)}>
        <h3>{editing ? 'Редактировать запись' : 'Записать кардио'}</h3>
        <div className="form-row"><label>Дата<input type="date" required value={form.date} max={localDate()} onChange={(event) => field('date', event.target.value)} /></label><label>Вид кардио<select value={form.kind} onChange={(event) => field('kind', event.target.value)}>{Object.entries(cardioKinds).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label></div>
        <div className="cardio-comparison">
          <div><span>Прошлый раз · {previous ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(`${previous.activity_date}T12:00:00`)) : 'первая запись'}</span><strong>{previous ? `${previous.duration_minutes} мин${previous.distance_km ? ` · ${formatNumber(previous.distance_km)} км` : ''}` : loading ? 'Загружаем…' : error ? 'История недоступна' : 'Пока нет результата'}</strong>{previous?.effort !== null && previous && <small>Усилие {previous.effort}/10{previous.average_pulse ? ` · пульс ${previous.average_pulse}` : ''}</small>}{previous?.note && <p>{previous.note}</p>}</div>
          <div><span>Ориентир сегодня</span><strong>{previous ? `${previous.duration_minutes} мин` : 'По плану и самочувствию'}</strong><small>Повтори время при сопоставимом темпе. Увеличение времени или скорости — отдельный выбор по самочувствию.</small></div>
        </div>
        <div className="form-row"><label>Время, мин<input type="number" inputMode="numeric" min="1" max="1440" step="1" required value={form.minutes} placeholder={previous ? String(previous.duration_minutes) : 'Например, 20'} onChange={(event) => field('minutes', event.target.value)} /></label><label>Дистанция, км<input type="number" inputMode="decimal" min="0.01" max="1000" step="0.01" value={form.distance} placeholder="Необязательно" onChange={(event) => field('distance', event.target.value)} /></label></div>
        <div className="form-row"><label>Усилие, 1–10<input type="number" inputMode="numeric" min="1" max="10" step="1" value={form.effort} placeholder="Как тяжело было" onChange={(event) => field('effort', event.target.value)} /></label><label>Средний пульс<input type="number" inputMode="numeric" min="30" max="250" step="1" value={form.pulse} placeholder="Если измерял" onChange={(event) => field('pulse', event.target.value)} /></label></div>
        <label>Заметка по кардио<textarea rows={3} maxLength={4000} value={form.note} placeholder="Скорость, уклон, сопротивление, дыхание и самочувствие…" onChange={(event) => field('note', event.target.value)} /></label>
        <button className="primary-button wide" type="submit" disabled={saving}>{saving ? 'Сохраняем…' : editing ? 'Сохранить изменения' : 'Сохранить кардио'}</button>
        {editing && <button className="text-button" type="button" onClick={() => { setEditing(null); setForm(blankForm()) }}>Отменить редактирование</button>}
        {message && <p className="form-message" role="status">{message}</p>}
      </form>
      {error && <div className="error-card" role="alert"><span>{error}</span><button className="text-button" type="button" onClick={() => void refresh()}>Повторить синхронизацию</button></div>}
      {pending.length > 0 && <p className="cardio-pending" role="status">На устройстве, ждут синхронизации: {pending.length}</p>}
      <div className="cardio-log-list" aria-busy={loading}>
        {!sessions.length && !loading && <p className="muted">Запиши первую сессию — в следующий раз увидишь свой результат и заметку.</p>}
        {sessions.map((session) => <article className="cardio-log-card" key={session.id}><header><div><time dateTime={session.activity_date}>{new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(`${session.activity_date}T12:00:00`))}</time><h3>{cardioKinds[session.kind]}</h3></div><button className="text-button" type="button" onClick={() => edit(session)} aria-label={`Редактировать кардио ${session.activity_date}`}>Изменить</button></header><div className="cardio-log-metrics"><strong>{session.duration_minutes} мин</strong>{session.distance_km !== null && <span>{formatNumber(session.distance_km)} км</span>}{session.effort !== null && <span>усилие {session.effort}/10</span>}{session.average_pulse !== null && <span>пульс {session.average_pulse}</span>}</div>{session.note && <p>{session.note}</p>}{pending.some((item) => item.id === session.id) && <small>Сохранено на устройстве</small>}</article>)}
      </div>
      <Link className="back-link" to="/training">К силовым тренировкам</Link>
    </section>
  )
}
