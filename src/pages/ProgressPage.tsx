import { Check, Flame, Pause, Pencil, Play, Plus, Search, Target } from 'lucide-react'
import { Fragment, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { HabitEditForm } from '../components/EditForms'
import { GoalCard } from '../components/GoalCard'
import { GoalForm } from '../components/GoalForm'
import { PageHeader } from '../components/PageHeader'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { localDate, startOfWeek, weekDates } from '../lib/date'
import { habitStreak, weeklyMetrics } from '../lib/progress'
import type { GoalStatus } from '../types'

const fullDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
})

type ProgressTab = 'goals' | 'habits'

export function ProgressPage() {
  const { user } = useAuth()
  const { data, addHabit, toggleHabitToday, setHabitActive, isMutating } = useData()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: ProgressTab = searchParams.get('tab') === 'habits' ? 'habits' : 'goals'
  const [goalFilter, setGoalFilter] = useState<'current' | 'completed'>('current')
  const [query, setQuery] = useState('')
  const [showGoalForm, setShowGoalForm] = useState(false)
  const [showHabitForm, setShowHabitForm] = useState(false)
  const [habitTitle, setHabitTitle] = useState('')
  const [habitTarget, setHabitTarget] = useState(5)
  const [habitAreaId, setHabitAreaId] = useState(data.areas[0]?.id ?? '')
  const [message, setMessage] = useState<string | null>(null)
  const [submittingHabit, setSubmittingHabit] = useState(false)
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null)
  const navigate = useNavigate()
  const today = localDate()
  const dates = weekDates()
  const goalAdding = isMutating('goal-add')
  const habitAdding = submittingHabit || isMutating('habit-add')
  const allowed: GoalStatus[] = goalFilter === 'current' ? ['active', 'paused'] : ['completed']
  const goals = data.goals.filter((goal) => allowed.includes(goal.status) && goal.title.toLowerCase().includes(query.toLowerCase()))

  const selectTab = (next: ProgressTab) => {
    setSearchParams(next === 'habits' ? { tab: 'habits' } : {}, { replace: true })
    setShowGoalForm(false)
    setShowHabitForm(false)
    setMessage(null)
  }

  const openCreate = () => {
    if (tab === 'goals') setShowGoalForm(true)
    else setShowHabitForm((value) => !value)
  }

  const submitHabit = async (event: FormEvent) => {
    event.preventDefault()
    setMessage(null)
    if (habitAdding) return
    setSubmittingHabit(true)
    try {
      await addHabit(habitTitle, habitTarget, habitAreaId || null)
      setHabitTitle('')
      setShowHabitForm(false)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Не удалось добавить привычку')
    } finally {
      setSubmittingHabit(false)
    }
  }

  return <div className="page progress-page">
    <PageHeader
      eyebrow="Движение вперёд"
      title="Прогресс"
      text="Результаты, к которым вы идёте, и действия, которые регулярно их поддерживают."
      action={<button className="icon-button accent" aria-label={tab === 'goals' ? 'Создать цель' : 'Добавить привычку'} disabled={tab === 'goals' ? goalAdding : habitAdding} aria-busy={tab === 'goals' ? goalAdding : habitAdding} onClick={openCreate}><Plus /></button>}
    />

    <div className="segmented wide progress-primary-tabs" aria-label="Раздел прогресса">
      <button type="button" aria-pressed={tab === 'goals'} className={tab === 'goals' ? 'active' : ''} onClick={() => selectTab('goals')}>Цели · {data.goals.length}</button>
      <button type="button" aria-pressed={tab === 'habits'} className={tab === 'habits' ? 'active' : ''} onClick={() => selectTab('habits')}>Привычки · {data.habits.length}</button>
    </div>

    {tab === 'goals' ? <>
      <div className="search-box"><Search /><input aria-label="Поиск целей" placeholder="Найти цель" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <div className="segmented wide progress-status-filter" aria-label="Фильтр целей"><button type="button" aria-pressed={goalFilter === 'current'} className={goalFilter === 'current' ? 'active' : ''} onClick={() => setGoalFilter('current')}>В работе</button><button type="button" aria-pressed={goalFilter === 'completed'} className={goalFilter === 'completed' ? 'active' : ''} onClick={() => setGoalFilter('completed')}>Достигнуты</button></div>
      {goals.length ? <div className="goal-list">{goals.map((goal) => <GoalCard key={goal.id} goal={goal} actions={data.actions} areas={data.areas} />)}</div> : <div className="empty-card large"><Target /><h2>{query ? 'Ничего не найдено' : goalFilter === 'completed' ? 'Здесь появятся достижения' : 'Создайте первую цель'}</h2><p>Опишите конкретный результат, а затем добавьте действия, которые к нему ведут.</p>{!query && goalFilter === 'current' && <button className="primary-button" disabled={goalAdding} aria-busy={goalAdding} onClick={() => setShowGoalForm(true)}>Создать цель</button>}</div>}
      {showGoalForm && <GoalForm onClose={() => setShowGoalForm(false)} onCreated={(id) => navigate(`/goals/${id}`)} />}
    </> : <>
      {showHabitForm && <form className="inline-create-card" aria-busy={habitAdding} onSubmit={submitHabit}><p className="eyebrow">Новое регулярное действие</p><h2>Что хотите повторять?</h2><label>Действие<input required disabled={habitAdding} maxLength={140} placeholder="Например, читать 20 минут" value={habitTitle} onChange={(event) => { if (!habitAdding) setHabitTitle(event.target.value) }} /></label><div className="form-row"><label>Раз в неделю<select disabled={habitAdding} value={habitTarget} onChange={(event) => { if (!habitAdding) setHabitTarget(Number(event.target.value)) }}>{[1,2,3,4,5,6,7].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label>Сфера<select disabled={habitAdding} value={habitAreaId} onChange={(event) => { if (!habitAdding) setHabitAreaId(event.target.value) }}><option value="">Без сферы</option>{data.areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label></div>{message && <p className="form-message" role="alert">{message}</p>}{habitAdding && <p className="visually-hidden" role="status" aria-live="polite">Добавляем привычку, дождитесь завершения.</p>}<button className="primary-button" disabled={habitAdding || !habitTitle.trim()} aria-busy={habitAdding}>{habitAdding ? 'Добавляем…' : 'Добавить привычку'}</button></form>}

      <div className="habit-list">{data.habits.map((habit) => {
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
      {!data.habits.length && !showHabitForm && <button className="empty-card large link-card" disabled={habitAdding} onClick={() => setShowHabitForm(true)}><Flame /><h2>Добавьте одну привычку</h2><p>Начните с действия, которое реально повторить несколько раз в неделю.</p></button>}
    </>}
  </div>
}
