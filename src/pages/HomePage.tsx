import { ArrowRight, Check, Flame, Plus, Sparkles, Target } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ActionRow } from '../components/ActionRow'
import { GoalForm } from '../components/GoalForm'
import { PageHeader } from '../components/PageHeader'
import { ProgressRing } from '../components/ProgressRing'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { localDate, startOfWeek } from '../lib/date'
import { disciplineScore, habitStreak } from '../lib/progress'

export function HomePage() {
  const { user } = useAuth()
  const { data, loading, toggleFocus, toggleHabitToday } = useData()
  const [showGoalForm, setShowGoalForm] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const navigate = useNavigate()
  const today = localDate()
  const activeGoals = data.goals.filter((goal) => goal.status === 'active')
  const focus = data.actions.filter((item) => item.focus_date === today && item.status !== 'cancelled').sort((a, b) => (a.focus_position ?? 9) - (b.focus_position ?? 9))
  const suggestions = data.actions.filter((item) => item.status === 'todo' && item.focus_date !== today).sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')).slice(0, 4)
  const habits = data.habits.filter((item) => item.active)
  const score = useMemo(() => disciplineScore(data.actions, data.habits, data.checkins, startOfWeek()), [data])
  const name = user?.email?.split('@')[0] ?? 'друг'
  const completedFocus = focus.filter((item) => item.status === 'done').length

  const addToFocus = async (id: string) => {
    setMessage(null)
    try { await toggleFocus(id) } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Не удалось изменить фокус') }
  }

  return <div className="page home-page">
    <PageHeader eyebrow="Достигатор" title={`Сегодня, ${name}`} text="Не нужно успеть всё. Доведите главное." action={<button className="icon-button accent" aria-label="Создать цель" onClick={() => setShowGoalForm(true)}><Plus /></button>} />

    <section className="score-card">
      <div><p className="eyebrow">Дисциплина недели</p><h2>{score >= 80 ? 'Сильный ритм' : score >= 50 ? 'Набираете темп' : 'Начните с одного шага'}</h2><p>Оценка складывается из фокуса дня, привычек и завершённых действий.</p></div>
      <ProgressRing value={score} label="из 100" />
    </section>

    <section className="section-block">
      <div className="section-heading"><div><p className="eyebrow">Главное на день</p><h2>Фокус 3</h2></div><span>{completedFocus}/{focus.length || 3}</span></div>
      {loading && !focus.length ? <div className="skeleton-card" /> : focus.length ? <div className="focus-list">{focus.map((action) => <ActionRow key={action.id} action={action} goal={data.goals.find((goal) => goal.id === action.goal_id)} />)}</div> : <div className="empty-card"><Target /><h3>Выберите до трёх действий</h3><p>Пусть день будет успешным ещё до того, как список станет бесконечным.</p></div>}
      {message && <p className="form-message" role="status">{message}</p>}
      {focus.filter((item) => item.status === 'todo').length < 3 && suggestions.length > 0 && <div className="suggestion-card"><div><Sparkles /><span>Следующие действия</span></div>{suggestions.map((action) => <button key={action.id} type="button" onClick={() => void addToFocus(action.id)}><span>{action.title}<small>{data.goals.find((goal) => goal.id === action.goal_id)?.title}</small></span><Plus /></button>)}</div>}
    </section>

    <section className="section-block">
      <div className="section-heading"><div><p className="eyebrow">Повторение создаёт результат</p><h2>Привычки сегодня</h2></div><Link to="/habits">Все <ArrowRight /></Link></div>
      {habits.length ? <div className="habit-quick-list">{habits.slice(0, 4).map((habit) => {
        const checked = data.checkins.some((item) => item.habit_id === habit.id && item.checked_on === today)
        const streak = habitStreak(habit.id, data.checkins)
        return <button key={habit.id} type="button" className={checked ? 'checked' : ''} onClick={() => void toggleHabitToday(habit.id)}><span className="habit-check">{checked && <Check />}</span><span><strong>{habit.title}</strong><small><Flame />{streak} дней · цель {habit.target_per_week}/нед.</small></span></button>
      })}</div> : <Link className="empty-card link-card" to="/habits"><Flame /><h3>Добавьте первую привычку</h3><p>Например, читать 20 минут или планировать следующий день.</p></Link>}
    </section>

    <section className="section-block">
      <div className="section-heading"><div><p className="eyebrow">Большая картина</p><h2>Активные цели</h2></div><Link to="/goals">Все <ArrowRight /></Link></div>
      {activeGoals.length ? <div className="goal-mini-grid">{activeGoals.slice(0, 3).map((goal) => <Link key={goal.id} to={`/goals/${goal.id}`}><span style={{ background: data.areas.find((area) => area.id === goal.area_id)?.color }} /><strong>{goal.title}</strong><small>{data.actions.filter((item) => item.goal_id === goal.id && item.status === 'todo').length} следующих действий</small></Link>)}</div> : <button className="empty-card link-card" onClick={() => setShowGoalForm(true)}><Target /><h3>Сформулируйте первый результат</h3><p>Книга, ремонт или вопрос по машине — начнём с конечной точки.</p></button>}
    </section>

    {showGoalForm && <GoalForm onClose={() => setShowGoalForm(false)} onCreated={(id) => navigate(`/goals/${id}`)} />}
  </div>
}
