import { Check, Focus, Trash2, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useData } from '../context/DataContext'
import { localDate } from '../lib/date'
import type { ActionItem, Goal } from '../types'

export function ActionRow({ action, goal, compact = false, allowDelete = false }: { action: ActionItem; goal?: Goal; compact?: boolean; allowDelete?: boolean }) {
  const { toggleAction, toggleFocus, deleteAction } = useData()
  const focusedToday = action.focus_date === localDate()
  return <article className={`action-row ${action.status === 'done' ? 'done' : ''} ${compact ? 'compact' : ''}`}>
    <button className="check-button" type="button" onClick={() => void toggleAction(action.id)} aria-label={action.status === 'done' ? `Вернуть ${action.title}` : `Выполнить ${action.title}`}>
      {action.status === 'done' && <Check />}
    </button>
    <div className="action-copy">
      <strong>{action.title}</strong>
      {goal && <Link to={`/goals/${goal.id}`}>{goal.title}</Link>}
      {action.due_date && <span>Срок: {new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(`${action.due_date}T12:00:00`))}</span>}
      {action.result_note && <p>{action.result_note}</p>}
    </div>
    {action.status === 'todo' && <button className={`mini-icon ${focusedToday ? 'active' : ''}`} type="button" onClick={() => void toggleFocus(action.id)} aria-label={focusedToday ? 'Убрать из фокуса' : 'Добавить в фокус'}>{focusedToday ? <X /> : <Focus />}</button>}
    {allowDelete && <button className="mini-icon danger" type="button" onClick={() => void deleteAction(action.id)} aria-label={`Удалить ${action.title}`}><Trash2 /></button>}
  </article>
}
