import { ArrowUpRight, CalendarDays } from 'lucide-react'
import { Link } from 'react-router-dom'
import { areaFor } from '../lib/repository'
import { goalProgress } from '../lib/progress'
import { formatDate } from '../lib/date'
import type { ActionItem, Area, Goal } from '../types'

export function GoalCard({ goal, actions, areas }: { goal: Goal; actions: ActionItem[]; areas: Area[] }) {
  const area = areaFor(areas, goal.area_id)
  const progress = goalProgress(goal, actions)
  const remaining = actions.filter((item) => item.goal_id === goal.id && item.status === 'todo').length
  return <Link to={`/goals/${goal.id}`} className={`goal-card ${goal.status}`}>
    <div className="goal-card-top"><span className="area-pill" style={{ '--area': area?.color ?? '#ffc857' } as React.CSSProperties}>{area?.name ?? 'Без сферы'}</span>{goal.status === 'paused' && <span className="goal-status-pill">На паузе</span>}<ArrowUpRight /></div>
    <h2>{goal.title}</h2>
    {goal.why && <p>{goal.why}</p>}
    <div className="progress-line"><span style={{ width: `${progress.resultReached ? 100 : progress.percent ?? 0}%` }} /></div>
    <div className="goal-card-meta"><strong>{progress.resultReached ? 'Цель достигнута' : progress.percent === null ? 'Шаги ещё не добавлены' : `${progress.done}/${progress.total} шагов · ${progress.percent}%`}</strong><span>{progress.resultReached ? 'Результат подтверждён' : remaining ? `${remaining} следующих действий` : progress.total ? 'Все шаги сделаны — подтвердите результат' : 'Добавьте первый шаг'}</span><span><CalendarDays />{formatDate(goal.target_date)}</span></div>
  </Link>
}
