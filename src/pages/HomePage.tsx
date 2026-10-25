import { ArrowRight, BarChart3, CalendarDays, Check, Dumbbell, Flame, NotebookPen, Plus, Search, Target, Utensils, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ActionRow } from '../components/ActionRow'
import { GoalForm } from '../components/GoalForm'
import { PageHeader } from '../components/PageHeader'
import { ProgressRing } from '../components/ProgressRing'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { localDate, startOfWeek } from '../lib/date'
import { FOCUS_LIMIT, dailyFocus } from '../lib/focus'
import { habitStreak, weeklyMetrics } from '../lib/progress'
import { getActiveDraft } from '../lib/storage'
import { loadNutritionEntries } from '../lib/trainingRepository'
import type { NutritionEntry, WorkoutDraft } from '../types/training'

export function HomePage() {
  const { user } = useAuth()
  const { data, loading, online, toggleFocus, toggleHabitToday, isMutating } = useData()
  const [activeDraft, setActiveDraft] = useState<WorkoutDraft | null>(null)
  const [nutrition, setNutrition] = useState<{ owner: string; day: string; entries: NutritionEntry[] } | null>(null)
  const [nutritionUnavailable, setNutritionUnavailable] = useState(false)
  const [showGoalForm, setShowGoalForm] = useState(false)
  const [showFocusChooser, setShowFocusChooser] = useState(false)
  const [focusQuery, setFocusQuery] = useState('')
  const navigate = useNavigate()
  const today = localDate()
  const owner = user?.id
  const activeWorkout = activeDraft?.userId === owner && !activeDraft?.finishedAt ? activeDraft : null
  const recordedSets = activeWorkout?.exercises.reduce((total, exercise) => total + exercise.sets.filter(set => set.done && !set.isWarmup).length, 0) ?? 0
  const todayNutrition = nutrition && nutrition.owner === owner && nutrition.day === today ? nutrition.entries : null
  const nutritionFacts = todayNutrition ? [
    todayNutrition.some(entry => entry.calories !== null) ? `${new Intl.NumberFormat('ru-RU').format(todayNutrition.reduce((total, entry) => total + (entry.calories ?? 0), 0))} ккал` : null,
    todayNutrition.some(entry => entry.protein_g !== null) ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(todayNutrition.reduce((total, entry) => total + (entry.protein_g ?? 0), 0))} г белка` : null,
  ].filter(Boolean).join(' · ') : ''
  const activeGoals = data.goals.filter((goal) => goal.status === 'active')
  const focusState = dailyFocus(data.actions, today)
  const focus = focusState.focusedToday
  const availableActions = data.actions
    .filter((action) => action.status === 'todo' && action.focus_date !== today)
    .sort((left, right) => (left.due_date ?? '9999-12-31').localeCompare(right.due_date ?? '9999-12-31'))
  const normalizedFocusQuery = focusQuery.trim().toLocaleLowerCase('ru-RU')
  const visibleFocusActions = availableActions.filter((action) => {
    if (!normalizedFocusQuery) return true
    const goalTitle = data.goals.find((goal) => goal.id === action.goal_id)?.title ?? ''
    return `${action.title} ${goalTitle}`.toLocaleLowerCase('ru-RU').includes(normalizedFocusQuery)
  })
  const habits = data.habits.filter((item) => item.active)
  const metrics = weeklyMetrics(data.actions, data.habits, data.checkins, startOfWeek(), today, user?.id, data.focusCommitments)
  const score = metrics.score
  const metadataName = user?.user_metadata?.display_name
  const name = typeof metadataName === 'string' && metadataName.trim()
    ? metadataName.trim()
    : user?.email?.split('@')[0] ?? 'друг'
  const completedFocus = focusState.completed
  const goalAdding = isMutating('goal-add')

  useEffect(() => {
    const refreshActive = () => {
      try { setActiveDraft(owner ? getActiveDraft(owner) : null) }
      catch { setActiveDraft(null) }
    }
    refreshActive()
    window.addEventListener('storage', refreshActive)
    window.addEventListener('focus', refreshActive)
    return () => { window.removeEventListener('storage', refreshActive); window.removeEventListener('focus', refreshActive) }
  }, [owner])

  useEffect(() => {
    let current = true
    setNutrition(null)
    setNutritionUnavailable(false)
    if (!owner || online === false) { setNutritionUnavailable(true); return }
    const from = new Date(`${today}T00:00:00`)
    const to = new Date(from)
    to.setDate(to.getDate() + 1)
    void loadNutritionEntries(from, to).then(entries => {
      if (current) setNutrition({ owner, day: today, entries: entries.filter(entry => entry.user_id === owner) })
    }).catch(() => { if (current) setNutritionUnavailable(true) })
    return () => { current = false }
  }, [owner, today, online])

  useEffect(() => {
    if (focusState.availableSlots === 0) {
      setShowFocusChooser(false)
      setFocusQuery('')
    }
  }, [focusState.availableSlots])

  return <div className="page home-page today-page">
    <PageHeader eyebrow="Достигатор" title={`Сегодня, ${name}`} text="Не нужно успеть всё. Доведите главное." action={<button className="icon-button accent" aria-label="Создать цель" disabled={goalAdding} aria-busy={goalAdding} onClick={() => setShowGoalForm(true)}><Plus /></button>} />

    {activeWorkout && <section className="today-active-workout" aria-labelledby="today-active-workout-title">
      <div><p className="eyebrow">Тренировка уже начата</p><h2 id="today-active-workout-title">{activeWorkout.title}</h2><p>Записано рабочих подходов: {recordedSets}. Продолжи с сохранённого места.</p></div>
      <Link className="primary-button" to={`/training/workout/${encodeURIComponent(activeWorkout.templateCode)}`} aria-label="Продолжить активную тренировку">Продолжить тренировку <ArrowRight /></Link>
    </section>}

    <nav className="today-daily-entries" aria-label="Зал и питание на сегодня">
      <Link to="/training" aria-label="Открыть зал"><Dumbbell aria-hidden="true" /><span><strong>Зал</strong><small>Программа, упражнения и история</small></span><ArrowRight aria-hidden="true" /></Link>
      <Link to="/nutrition" aria-label="Открыть питание за сегодня"><Utensils aria-hidden="true" /><span><strong>Питание сегодня</strong><small>{nutritionUnavailable ? 'Записи недоступны · открыть дневник' : todayNutrition === null ? 'Загружаем записи за сегодня…' : todayNutrition.length === 0 ? 'Пока нет записей · добавить приём пищи' : `Записей: ${todayNutrition.length}${nutritionFacts ? ` · ${nutritionFacts} по заполненным полям` : ' · калории и белок не указаны'}`}</small></span><ArrowRight aria-hidden="true" /></Link>
    </nav>

    <section className="section-block" aria-busy={loading}>
      <div className="section-heading"><div><p className="eyebrow">Главное на день</p><h2>Три главных действия</h2></div><span aria-label={`Выполнено ${completedFocus} из ${FOCUS_LIMIT}`}>{completedFocus}/{FOCUS_LIMIT}</span></div>
      <p className="focus-explainer"><strong>«Фокус 3»</strong> — максимум три приоритетных действия, которые сделают сегодняшний день успешным.</p>
      {loading ? <div className="skeleton-card" role="status"><span className="visually-hidden">Загружаем действия дня</span></div> : focus.length ? <div className="focus-list">{focus.map((action) => <ActionRow key={action.id} action={action} goal={data.goals.find((goal) => goal.id === action.goal_id)} />)}</div> : <div className="empty-card"><Target /><h3>Выберите до трёх действий</h3><p>Выполненное действие останется в этом списке до завтра, поэтому план не разрастается по ходу дня.</p>{availableActions.length ? <button className="primary-button" type="button" onClick={() => setShowFocusChooser(true)}>Выбрать действия</button> : activeGoals[0] ? <Link className="primary-button" to={`/goals/${activeGoals[0].id}`}>Добавить первый шаг</Link> : <button className="primary-button" disabled={goalAdding} onClick={() => setShowGoalForm(true)}>Создать первую цель</button>}</div>}
      {!loading && focusState.availableSlots > 0 && availableActions.length > 0 && focus.length > 0 && !showFocusChooser && <button className="secondary-button focus-chooser-trigger" type="button" onClick={() => setShowFocusChooser(true)}><Plus />Добавить в фокус · свободно {focusState.availableSlots}</button>}
      {!loading && showFocusChooser && focusState.availableSlots > 0 && availableActions.length > 0 && <section className="inline-create-card focus-chooser" aria-labelledby="focus-chooser-title">
        <div className="focus-chooser-head"><div><p className="eyebrow">Все доступные действия</p><h3 id="focus-chooser-title">Выберите главное на сегодня</h3></div><button className="mini-icon" type="button" aria-label="Закрыть выбор действий" onClick={() => { setShowFocusChooser(false); setFocusQuery('') }}><X /></button></div>
        <div className="search-box"><Search /><input aria-label="Поиск доступных действий" placeholder="Найти действие или цель" value={focusQuery} onChange={(event) => setFocusQuery(event.target.value)} /></div>
        <p className="focus-chooser-hint" role="status">Свободно мест: {focusState.availableSlots} из {FOCUS_LIMIT}</p>
        {visibleFocusActions.length ? <div className="focus-choice-list">{visibleFocusActions.map((action) => {
          const goal = data.goals.find((item) => item.id === action.goal_id)
          const busy = isMutating('focus') || isMutating('action', action.id)
          return <button key={action.id} type="button" disabled={busy} aria-busy={busy} onClick={() => void toggleFocus(action.id).catch(() => undefined)}>
            <span><strong>{action.title}</strong><small>{goal?.title ?? 'Без цели'}{goal?.status === 'paused' ? ' · цель на паузе' : goal?.status === 'completed' ? ' · цель завершена' : null}{action.due_date ? <><CalendarDays />{new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(`${action.due_date}T12:00:00`))}</> : null}</small></span><Plus />
          </button>
        })}</div> : <p className="empty-inline">По этому запросу действий нет.</p>}
      </section>}
    </section>

    <section className="score-card">
      <div><p className="eyebrow">Дисциплина недели</p><h2>{score === null ? 'Недостаточно данных' : score >= 80 ? 'Сильный ритм' : score >= 50 ? 'Набираете темп' : 'Начните с одного шага'}</h2><p>{score === null ? 'Выберите одно из трёх главных действий, добавьте привычку или первый шаг.' : '50% — выполненный фокус, 30% — привычки, 20% — недельная цель 5 действий. План растёт по дням; пустые категории не снижают максимум.'}</p></div>
      {score === null ? <div className="score-placeholder" aria-label="Индекс дисциплины: недостаточно данных"><strong>—</strong><span>нет данных</span></div> : <ProgressRing value={score} label="из 100" />}
    </section>

    <nav className="today-tool-links" aria-label="Записи и итоги"><Link to="/journal"><NotebookPen aria-hidden="true" />Дневник <ArrowRight aria-hidden="true" /></Link><Link to="/review"><BarChart3 aria-hidden="true" />Итоги недели <ArrowRight aria-hidden="true" /></Link></nav>

    <section className="section-block">
      <div className="section-heading"><div><p className="eyebrow">Повторение создаёт результат</p><h2>Привычки сегодня</h2></div><Link to="/progress?tab=habits">Все <ArrowRight /></Link></div>
      {habits.length ? <div className="habit-quick-list">{habits.slice(0, 4).map((habit) => {
        const checked = data.checkins.some((item) => item.habit_id === habit.id && item.checked_on === today && (!user || item.user_id === user.id))
        const streak = habitStreak(habit.id, data.checkins, new Date(), user?.id)
        const busy = isMutating('habit', habit.id)
        return <button key={habit.id} type="button" className={checked ? 'checked' : ''} disabled={busy} aria-busy={busy} aria-pressed={checked} aria-label={checked ? `Снять сегодняшнюю отметку привычки «${habit.title}»` : `Отметить привычку «${habit.title}» за сегодня`} onClick={() => void toggleHabitToday(habit.id).catch(() => undefined)}><span className="habit-check">{checked && <Check />}</span><span><strong>{habit.title}</strong><small><Flame />{streak} дней подряд · цель {habit.target_per_week}/нед.</small></span></button>
      })}</div> : <Link className="empty-card link-card" to="/progress?tab=habits"><Flame /><h3>Добавьте первую привычку</h3><p>Например, читать 20 минут или планировать следующий день.</p></Link>}
    </section>

    <section className="section-block">
      <div className="section-heading"><div><p className="eyebrow">Большая картина</p><h2>Активные цели</h2></div><Link to="/progress">Все <ArrowRight /></Link></div>
      {activeGoals.length ? <div className="goal-mini-grid">{activeGoals.slice(0, 3).map((goal) => <Link key={goal.id} to={`/goals/${goal.id}`}><span style={{ background: data.areas.find((area) => area.id === goal.area_id)?.color }} /><strong>{goal.title}</strong><small>{data.actions.filter((item) => item.goal_id === goal.id && item.status === 'todo').length} следующих действий</small></Link>)}</div> : <button className="empty-card link-card" disabled={goalAdding} onClick={() => setShowGoalForm(true)}><Target /><h3>Сформулируйте первый результат</h3><p>Книга, ремонт или вопрос по машине — начнём с конечной точки.</p></button>}
    </section>

    {showGoalForm && <GoalForm onClose={() => setShowGoalForm(false)} onCreated={(id) => navigate(`/goals/${id}`)} />}
  </div>
}
