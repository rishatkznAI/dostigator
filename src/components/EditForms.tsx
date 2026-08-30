import { useRef, useState, type FormEvent } from 'react'
import { useData } from '../context/DataContext'
import type { ActionItem, Goal, GoalKind, Habit } from '../types'
import { DialogSheet } from './DialogSheet'

function FormActions({ busy, valid, onCancel }: { busy: boolean; valid: boolean; onCancel(): void }) {
  return <div className="edit-form-actions">
    <button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>Отмена</button>
    <button className="primary-button" disabled={busy || !valid} aria-busy={busy}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
  </div>
}

export function GoalEditForm({ goal, onClose }: { goal: Goal; onClose(): void }) {
  const { data, updateGoal, isMutating, clearMutationError } = useData()
  const [title, setTitle] = useState(goal.title)
  const [kind, setKind] = useState<GoalKind>(goal.kind)
  const [areaId, setAreaId] = useState(goal.area_id ?? '')
  const [targetDate, setTargetDate] = useState(goal.target_date ?? '')
  const [why, setWhy] = useState(goal.why)
  const [description, setDescription] = useState(goal.description)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const busy = saving || isMutating('goal', goal.id)
  const dirty = title !== goal.title || kind !== goal.kind || areaId !== (goal.area_id ?? '')
    || targetDate !== (goal.target_date ?? '') || why !== goal.why || description !== goal.description
  const requestClose = () => {
    if (busy) return
    if (dirty && !window.confirm('Закрыть без сохранения изменений?')) return
    onClose()
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (savingRef.current || busy) return
    savingRef.current = true; setSaving(true); setMessage(null)
    try {
      await updateGoal(goal.id, {
        title, kind, area_id: areaId || null, target_date: targetDate || null, why, description,
      })
      onClose()
    } catch (reason) {
      clearMutationError()
      setMessage(reason instanceof Error ? reason.message : 'Не удалось изменить цель')
    } finally {
      savingRef.current = false; setSaving(false)
    }
  }
  return <DialogSheet titleId="edit-goal-title" eyebrow="Редактирование" title="Параметры цели" busy={busy} dirty={dirty} onClose={onClose}>
    <form className="stack-form" onSubmit={submit}>
      <label>Название<input data-dialog-initial-focus required disabled={busy} maxLength={140} value={title} onChange={(event) => { if (!busy) setTitle(event.target.value) }} /></label>
      <div className="segmented" aria-label="Тип записи">
        <button type="button" disabled={busy} aria-pressed={kind === 'goal'} className={kind === 'goal' ? 'active' : ''} onClick={() => setKind('goal')}>Цель</button>
        <button type="button" disabled={busy} aria-pressed={kind === 'project'} className={kind === 'project' ? 'active' : ''} onClick={() => setKind('project')}>Проект</button>
      </div>
      <label>Сфера<select disabled={busy} value={areaId} onChange={(event) => { if (!busy) setAreaId(event.target.value) }}><option value="">Без сферы</option>{data.areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>
      <label>Желаемый срок<input disabled={busy} type="date" value={targetDate} onChange={(event) => { if (!busy) setTargetDate(event.target.value) }} /></label>
      <label>Зачем это вам?<textarea disabled={busy} maxLength={1000} value={why} onChange={(event) => { if (!busy) setWhy(event.target.value) }} /></label>
      <label>Описание<textarea disabled={busy} maxLength={2000} value={description} onChange={(event) => { if (!busy) setDescription(event.target.value) }} /></label>
      {message && <p className="form-message error" role="alert">{message}</p>}
      <FormActions busy={busy} valid={Boolean(title.trim())} onCancel={requestClose} />
    </form>
  </DialogSheet>
}

export function ActionEditForm({ action, onClose }: { action: ActionItem; onClose(): void }) {
  const { updateAction, isMutating, clearMutationError } = useData()
  const [title, setTitle] = useState(action.title)
  const [dueDate, setDueDate] = useState(action.due_date ?? '')
  const [resultNote, setResultNote] = useState(action.result_note)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const busy = saving || isMutating('action', action.id)
  const dirty = title !== action.title || dueDate !== (action.due_date ?? '') || resultNote !== action.result_note
  const requestClose = () => {
    if (busy) return
    if (dirty && !window.confirm('Закрыть без сохранения изменений?')) return
    onClose()
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (savingRef.current || busy) return
    savingRef.current = true; setSaving(true); setMessage(null)
    try {
      await updateAction(action.id, { title, due_date: dueDate || null, result_note: resultNote })
      onClose()
    } catch (reason) {
      clearMutationError()
      setMessage(reason instanceof Error ? reason.message : 'Не удалось изменить действие')
    } finally {
      savingRef.current = false; setSaving(false)
    }
  }
  return <DialogSheet titleId="edit-action-title" eyebrow="Редактирование" title="Параметры действия" busy={busy} dirty={dirty} onClose={onClose}>
    <form className="stack-form" onSubmit={submit}>
      <label>Название<input data-dialog-initial-focus required disabled={busy} maxLength={240} value={title} onChange={(event) => { if (!busy) setTitle(event.target.value) }} /></label>
      <label>Срок<input disabled={busy} type="date" value={dueDate} onChange={(event) => { if (!busy) setDueDate(event.target.value) }} /></label>
      <label>Комментарий к результату<textarea disabled={busy} maxLength={1500} value={resultNote} onChange={(event) => { if (!busy) setResultNote(event.target.value) }} placeholder="Что получилось или что важно сохранить" /></label>
      {message && <p className="form-message error" role="alert">{message}</p>}
      <FormActions busy={busy} valid={Boolean(title.trim())} onCancel={requestClose} />
    </form>
  </DialogSheet>
}

export function HabitEditForm({ habit, onClose }: { habit: Habit; onClose(): void }) {
  const { data, updateHabit, isMutating, clearMutationError } = useData()
  const [title, setTitle] = useState(habit.title)
  const [target, setTarget] = useState(habit.target_per_week)
  const [areaId, setAreaId] = useState(habit.area_id ?? '')
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const busy = saving || isMutating('habit', habit.id)
  const dirty = title !== habit.title || target !== habit.target_per_week || areaId !== (habit.area_id ?? '')
  const requestClose = () => {
    if (busy) return
    if (dirty && !window.confirm('Закрыть без сохранения изменений?')) return
    onClose()
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (savingRef.current || busy) return
    savingRef.current = true; setSaving(true); setMessage(null)
    try {
      await updateHabit(habit.id, { title, target_per_week: target, area_id: areaId || null })
      onClose()
    } catch (reason) {
      clearMutationError()
      setMessage(reason instanceof Error ? reason.message : 'Не удалось изменить привычку')
    } finally {
      savingRef.current = false; setSaving(false)
    }
  }
  return <DialogSheet titleId="edit-habit-title" eyebrow="Редактирование" title="Параметры привычки" busy={busy} dirty={dirty} onClose={onClose}>
    <form className="stack-form" onSubmit={submit}>
      <label>Название<input data-dialog-initial-focus required disabled={busy} maxLength={140} value={title} onChange={(event) => { if (!busy) setTitle(event.target.value) }} /></label>
      <label>Раз в неделю<select disabled={busy} value={target} onChange={(event) => { if (!busy) setTarget(Number(event.target.value)) }}>{[1,2,3,4,5,6,7].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Сфера<select disabled={busy} value={areaId} onChange={(event) => { if (!busy) setAreaId(event.target.value) }}><option value="">Без сферы</option>{data.areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>
      {message && <p className="form-message error" role="alert">{message}</p>}
      <FormActions busy={busy} valid={Boolean(title.trim())} onCancel={requestClose} />
    </form>
  </DialogSheet>
}
