import { ArrowRight, Check, Dumbbell, Flame, Pause, Pencil, Play, Plus } from 'lucide-react'
import { Fragment, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { HabitEditForm } from '../components/EditForms'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { localDate, startOfWeek, weekDates } from '../lib/date'
import { habitStreak, weeklyMetrics } from '../lib/progress'

const fullDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
})

export function HabitsPage() {
  const { user } = useAuth()
  const { data, addHabit, toggleHabitToday, setHabitActive, isMutating } = useData()
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState(5)
  const [areaId, setAreaId] = useState(data.areas[0]?.id ?? '')
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null)
  const today = localDate()
  const dates = weekDates()
  const adding = submitting || isMutating('habit-add')
  const habits = data.habits

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setMessage(null)
    if (adding) return
    setSubmitting(true)
    try { await addHabit(title, target, areaId || null); setTitle(''); setShowForm(false) }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Не удалось добавить привычку') }
    finally { setSubmitting(false) }
  }

  return <div className="page">
    <PageHeader eyebrow="Дисциплина" title="Привычки" text="Не идеальная серия, а устойчивое возвращение к нужному действию." action={<button className="icon-button accent" aria-label="Добавить привычку" disabled={adding} aria-busy={adding} onClick={() => setShowForm((value) => !value)}><Plus /></button>} />
    <Link className="workouts-entry-card" to="/training"><span><Dumbbell /></span><div><strong>Тренировки</strong><small>Программа A/B/C, упражнения, подходы и история</small></div><ArrowRight /></Link>
    {showForm && <form className="inline-create-card" aria-busy={adding} onSubmit={submit}><p className="eyebrow">Новая привычка</p><h2>Что хотите повторять?</h2><label>Действие<input required disabled={adding} maxLength={140} placeholder="Например, читать 20 минут" value={title} onChange={(event) => { if (!adding) setTitle(event.target.value) }} /></label><div className="form-row"><label>Раз в неделю<select disabled={adding} value={target} onChange={(event) => { if (!adding) setTarget(Number(event.target.value)) }}>{[1,2,3,4,5,6,7].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label>Сфера<select disabled={adding} value={areaId} onChange={(event) => { if (!adding) setAreaId(event.target.value) }}><option value="">Без сферы</option>{data.areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label></div>{message && <p className="form-message" role="alert">{message}</p>}{adding && <p className="visually-hidden" role="status" aria-live="polite">Добавляем привычку, дождитесь завершения.</p>}<button className="primary-button" disabled={adding || !title.trim()} aria-busy={adding}>{adding ? 'Добавляем…' : 'Добавить привычку'}</button></form>}

    <div className="habit-list">{habits.map((habit) => {
      const checked = data.checkins.some((item) => item.habit_id === habit.id && item.checked_on === today && (!user || item.user_id === user.id))
      const habitMetric = weeklyMetrics([], [habit], data.checkins, startOfWeek(), today, user?.id).habits
      const weekCount = habitMetric?.done ?? 0
      const expected = habitMetric?.expected ?? 0
      const streak = habitStreak(habit.id, data.checkins, new Date(), user?.id)
      const area = data.areas.find((item) => item.id === habit.area_id)
      const busy = isMutating('habit', habit.id)
      return <Fragment key={habit.id}><article className={`habit-card ${habit.active ? '' : 'paused'}`} aria-busy={busy}>
        <div className="habit-card-head"><span className="area-dot" style={{ background: area?.color }} /><div><small>{habit.active ? area?.name ?? 'Без сферы' : `На паузе · ${area?.name ?? 'Без сферы'}`}</small><h2>{habit.title}</h2></div><button className="mini-icon" type="button" disabled={busy} onClick={() => setEditingHabitId(habit.id)} aria-label={`Изменить «${habit.title}»`}><Pencil /></button><button className="mini-icon" type="button" disabled={busy} aria-busy={busy} aria-pressed={!habit.active} onClick={() => void setHabitActive(habit.id, !habit.active).catch(() => undefined)} aria-label={habit.active ? `Поставить привычку «${habit.title}» на паузу` : `Возобновить привычку «${habit.title}»`}>{habit.active ? <Pause /> : <Play />}</button></div>
        <div className="habit-stats"><span><Flame /><strong>{streak}</strong> дней подряд</span><span><strong>{weekCount}/{expected}</strong> план к сегодня <small>(цель {habit.target_per_week}/нед.)</small></span></div>
        <div className="week-dots" role="list" aria-label={`Неделя привычки «${habit.title}»`}>{dates.map((date, index) => {
          const marked = data.checkins.some((item) => item.habit_id === habit.id && item.checked_on === date && (!user || item.user_id === user.id))
          const scheduled = habit.activity_periods.some((period) => date >= period.started_on && (!period.ended_on || date <= period.ended_on))
          const status = marked ? 'выполнено' : date > today ? 'день ещё не наступил' : scheduled ? 'не выполнено' : 'не запланировано'
          const accessibleDay = `${fullDateFormatter.format(new Date(`${date}T12:00:00`))}: ${status}`
          return <span key={date} role="listitem" aria-label={accessibleDay} title={accessibleDay} className={`${marked ? 'done' : ''} ${date === today ? 'today' : ''} ${date > today ? 'future' : ''}`}><small aria-hidden="true">{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'][index]}</small>{marked ? <Check aria-hidden="true" /> : null}</span>
        })}</div>
        {habit.active && <button type="button" className={`habit-today-button ${checked ? 'done' : ''}`} disabled={busy} aria-busy={busy} aria-pressed={checked} aria-label={checked ? `Снять сегодняшнюю отметку привычки «${habit.title}»` : `Отметить привычку «${habit.title}» за сегодня`} onClick={() => void toggleHabitToday(habit.id).catch(() => undefined)}>{checked ? <><Check />Сегодня выполнено</> : 'Отметить сегодня'}</button>}
      </article>
      {editingHabitId === habit.id && <HabitEditForm habit={habit} onClose={() => setEditingHabitId(null)} />}</Fragment>
    })}</div>
    {!habits.length && !showForm && <button className="empty-card large link-card" disabled={adding} onClick={() => setShowForm(true)}><Flame /><h2>Добавьте одну привычку</h2><p>Начните с действия, которое реально повторить несколько раз в неделю.</p></button>}
  </div>
}
