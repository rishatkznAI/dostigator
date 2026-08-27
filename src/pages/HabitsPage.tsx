import { Check, Flame, Pause, Play, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { PageHeader } from '../components/PageHeader'
import { useData } from '../context/DataContext'
import { localDate, weekDates } from '../lib/date'
import { habitStreak } from '../lib/progress'

export function HabitsPage() {
  const { data, addHabit, toggleHabitToday, setHabitActive } = useData()
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState(5)
  const [areaId, setAreaId] = useState(data.areas[0]?.id ?? '')
  const [message, setMessage] = useState<string | null>(null)
  const today = localDate()
  const dates = weekDates()

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setMessage(null)
    try { await addHabit(title, target, areaId || null); setTitle(''); setShowForm(false) }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Не удалось добавить привычку') }
  }

  return <div className="page">
    <PageHeader eyebrow="Дисциплина" title="Привычки" text="Не идеальная серия, а устойчивое возвращение к нужному действию." action={<button className="icon-button accent" aria-label="Добавить привычку" onClick={() => setShowForm((value) => !value)}><Plus /></button>} />
    {showForm && <form className="inline-create-card" onSubmit={submit}><p className="eyebrow">Новая привычка</p><h2>Что хотите повторять?</h2><label>Действие<input required maxLength={140} placeholder="Например, читать 20 минут" value={title} onChange={(event) => setTitle(event.target.value)} /></label><div className="form-row"><label>Раз в неделю<select value={target} onChange={(event) => setTarget(Number(event.target.value))}>{[1,2,3,4,5,6,7].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label>Сфера<select value={areaId} onChange={(event) => setAreaId(event.target.value)}>{data.areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label></div>{message && <p className="form-message">{message}</p>}<button className="primary-button" disabled={!title.trim()}>Добавить привычку</button></form>}

    <div className="habit-list">{data.habits.map((habit) => {
      const checked = data.checkins.some((item) => item.habit_id === habit.id && item.checked_on === today)
      const weekCount = data.checkins.filter((item) => item.habit_id === habit.id && dates.includes(item.checked_on)).length
      const streak = habitStreak(habit.id, data.checkins)
      const area = data.areas.find((item) => item.id === habit.area_id)
      return <article key={habit.id} className={`habit-card ${habit.active ? '' : 'paused'}`}>
        <div className="habit-card-head"><span className="area-dot" style={{ background: area?.color }} /><div><small>{area?.name ?? 'Без сферы'}</small><h2>{habit.title}</h2></div><button className="mini-icon" onClick={() => void setHabitActive(habit.id, !habit.active)} aria-label={habit.active ? 'Поставить привычку на паузу' : 'Возобновить привычку'}>{habit.active ? <Pause /> : <Play />}</button></div>
        <div className="habit-stats"><span><Flame /><strong>{streak}</strong> серия</span><span><strong>{weekCount}/{habit.target_per_week}</strong> неделя</span></div>
        <div className="week-dots">{dates.map((date, index) => { const marked = data.checkins.some((item) => item.habit_id === habit.id && item.checked_on === date); return <span key={date} className={`${marked ? 'done' : ''} ${date === today ? 'today' : ''}`}><small>{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'][index]}</small>{marked ? <Check /> : null}</span> })}</div>
        {habit.active && <button className={`habit-today-button ${checked ? 'done' : ''}`} onClick={() => void toggleHabitToday(habit.id)}>{checked ? <><Check />Сегодня выполнено</> : 'Отметить сегодня'}</button>}
      </article>
    })}</div>
    {!data.habits.length && !showForm && <button className="empty-card large link-card" onClick={() => setShowForm(true)}><Flame /><h2>Добавьте одну привычку</h2><p>Начните с действия, которое реально повторить несколько раз в неделю.</p></button>}
  </div>
}
