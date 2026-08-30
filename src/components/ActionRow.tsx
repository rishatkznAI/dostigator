import { Check, Focus, Pencil, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../context/DataContext'
import { localDate } from '../lib/date'
import type { ActionItem, Goal } from '../types'
import { ActionEditForm } from './EditForms'

export function ActionRow({ action, goal, compact = false, allowDelete = false, allowEdit = false }: { action: ActionItem; goal?: Goal; compact?: boolean; allowDelete?: boolean; allowEdit?: boolean }) {
  const { toggleAction, toggleFocus, deleteAction, isMutating } = useData()
  const [editing, setEditing] = useState(false)
  const focusedToday = action.focus_date === localDate()
  const actionBusy = isMutating('action', action.id)
  const focusBusy = actionBusy || isMutating('focus')
  return <><article className={`action-row ${action.status === 'done' ? 'done' : ''} ${compact ? 'compact' : ''}`}>
    <button className="check-button" type="button" disabled={actionBusy} aria-busy={actionBusy} onClick={() => void toggleAction(action.id).catch(() => undefined)} aria-label={action.status === 'done' ? `Вернуть ${action.title}` : `Выполнить ${action.title}`}>
      {action.status === 'done' && <Check />}
    </button>
    <div className="action-copy">
      <strong>{action.title}</strong>
      {goal && <Link to={`/goals/${goal.id}`}>{goal.title}</Link>}
      {action.due_date && <span>Срок: {new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(`${action.due_date}T12:00:00`))}</span>}
      {action.result_note && <p>{action.result_note}</p>}
    </div>
    {allowEdit && <button className="mini-icon" type="button" disabled={actionBusy} onClick={() => setEditing(true)} aria-label={`Изменить ${action.title}`}><Pencil /></button>}
    {action.status === 'todo' && <button className={`mini-icon ${focusedToday ? 'active' : ''}`} type="button" disabled={focusBusy} aria-busy={focusBusy} aria-pressed={focusedToday} onClick={() => void toggleFocus(action.id).catch(() => undefined)} aria-label={focusedToday ? `Убрать «${action.title}» из фокуса` : `Добавить «${action.title}» в фокус`}>{focusedToday ? <X /> : <Focus />}</button>}
    {allowDelete && <button className="mini-icon danger" type="button" disabled={actionBusy} aria-busy={actionBusy} onClick={() => void deleteAction(action.id).catch(() => undefined)} aria-label={`Удалить ${action.title}`}><Trash2 /></button>}
  </article>
  {editing && <ActionEditForm action={action} onClose={() => setEditing(false)} />}</>
}
