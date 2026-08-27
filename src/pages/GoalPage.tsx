import { ArrowLeft, CalendarDays, CheckCircle2, CirclePause, Focus, Plus, RotateCcw } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ActionRow } from '../components/ActionRow'
import { ProgressRing } from '../components/ProgressRing'
import { useData } from '../context/DataContext'
import { formatDate } from '../lib/date'
import { areaFor } from '../lib/repository'
import { goalProgress } from '../lib/progress'

export function GoalPage() {
  const { goalId } = useParams()
  const { data, addAction, updateGoal } = useData()
  const goal = data.goals.find((item) => item.id === goalId)
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  if (!goal) return <div className="page"><Link className="back-link" to="/goals"><ArrowLeft />К целям</Link><div className="empty-card large"><h1>Цель не найдена</h1><p>Возможно, она была удалена или ещё не синхронизировалась.</p></div></div>
  const actions = data.actions.filter((item) => item.goal_id === goal.id)
  const todo = actions.filter((item) => item.status === 'todo')
  const done = actions.filter((item) => item.status === 'done').sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
  const area = areaFor(data.areas, goal.area_id)
  const progress = goalProgress(goal, data.actions)

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setMessage(null)
    try { await addAction(goal.id, title, dueDate || null); setTitle(''); setDueDate('') }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Не удалось добавить действие') }
  }

  return <div className="page goal-page">
    <Link className="back-link" to="/goals"><ArrowLeft />Все цели</Link>
    <section className="goal-hero" style={{ '--area': area?.color ?? '#ffc857' } as React.CSSProperties}>
      <div><span className="area-pill">{area?.name ?? 'Без сферы'}</span><p className="eyebrow">{goal.kind === 'project' ? 'Проект' : 'Цель'}</p><h1>{goal.title}</h1>{goal.why && <blockquote>«{goal.why}»</blockquote>}<div className="goal-due"><CalendarDays />{formatDate(goal.target_date)}</div></div>
      <ProgressRing value={progress} label="готово" />
    </section>

    <section className="section-block">
      <div className="section-heading"><div><p className="eyebrow">Движение</p><h2>Следующие действия</h2></div><span>{todo.length}</span></div>
      {todo.length ? <div className="action-list">{todo.map((action) => <ActionRow key={action.id} action={action} allowDelete />)}</div> : <div className="empty-inline"><CheckCircle2 /><span>{done.length ? 'Все запланированные действия выполнены.' : 'Разбейте результат на первый небольшой шаг.'}</span></div>}
      <form className="new-action-form" onSubmit={submit}><input aria-label="Следующее действие" required maxLength={240} placeholder="Что конкретно сделать дальше?" value={title} onChange={(event) => setTitle(event.target.value)} /><input aria-label="Срок действия" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /><button className="primary-button" disabled={!title.trim()}><Plus />Добавить шаг</button></form>
      {message && <p className="form-message" role="status">{message}</p>}
      {todo.length > 0 && <p className="tip"><Focus />Нажмите прицел возле действия, чтобы поставить его в «Фокус 3» на сегодня.</p>}
    </section>

    {done.length > 0 && <section className="section-block"><div className="section-heading"><div><p className="eyebrow">Доказательства движения</p><h2>Сделано</h2></div><span>{done.length}</span></div><div className="action-list completed-list">{done.map((action) => <ActionRow key={action.id} action={action} />)}</div></section>}

    <section className="goal-status-card">
      <div><p className="eyebrow">Состояние</p><h2>{goal.status === 'completed' ? 'Результат достигнут' : goal.status === 'paused' ? 'Цель на паузе' : 'Цель в работе'}</h2><p>Завершайте цель только когда получили сам результат, а не просто сделали последний шаг.</p></div>
      <div>{goal.status === 'active' && <><button className="secondary-button" onClick={() => void updateGoal(goal.id, { status: 'paused' })}><CirclePause />Пауза</button><button className="primary-button" onClick={() => void updateGoal(goal.id, { status: 'completed', progress: 100 })}><CheckCircle2 />Цель достигнута</button></>}{goal.status !== 'active' && <button className="secondary-button" onClick={() => void updateGoal(goal.id, { status: 'active', progress: goal.status === 'completed' ? progress : goal.progress })}><RotateCcw />Вернуть в работу</button>}</div>
    </section>
  </div>
}
