import { Plus, Search, Target } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GoalCard } from '../components/GoalCard'
import { GoalForm } from '../components/GoalForm'
import { PageHeader } from '../components/PageHeader'
import { useData } from '../context/DataContext'
import type { GoalStatus } from '../types'

export function GoalsPage() {
  const { data } = useData()
  const [filter, setFilter] = useState<'current' | 'completed'>('current')
  const [query, setQuery] = useState('')
  const [showForm, setShowForm] = useState(false)
  const navigate = useNavigate()
  const allowed: GoalStatus[] = filter === 'current' ? ['active', 'paused'] : ['completed']
  const goals = data.goals.filter((goal) => allowed.includes(goal.status) && goal.title.toLowerCase().includes(query.toLowerCase()))
  return <div className="page">
    <PageHeader eyebrow="Направление" title="Цели и проекты" text="Каждый результат должен иметь понятный следующий шаг." action={<button className="icon-button accent" aria-label="Создать цель" onClick={() => setShowForm(true)}><Plus /></button>} />
    <div className="search-box"><Search /><input aria-label="Поиск целей" placeholder="Найти цель" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    <div className="segmented wide" aria-label="Фильтр целей"><button className={filter === 'current' ? 'active' : ''} onClick={() => setFilter('current')}>В работе</button><button className={filter === 'completed' ? 'active' : ''} onClick={() => setFilter('completed')}>Достигнуты</button></div>
    {goals.length ? <div className="goal-list">{goals.map((goal) => <GoalCard key={goal.id} goal={goal} actions={data.actions} areas={data.areas} />)}</div> : <div className="empty-card large"><Target /><h2>{query ? 'Ничего не найдено' : filter === 'completed' ? 'Здесь появятся достижения' : 'Создайте первую цель'}</h2><p>Превратите намерение в конкретный результат и несколько небольших действий.</p>{!query && filter === 'current' && <button className="primary-button" onClick={() => setShowForm(true)}>Создать цель</button>}</div>}
    {showForm && <GoalForm onClose={() => setShowForm(false)} onCreated={(id) => navigate(`/goals/${id}`)} />}
  </div>
}
