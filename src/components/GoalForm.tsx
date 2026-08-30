import { useRef, useState, type FormEvent } from 'react'
import { useData } from '../context/DataContext'
import type { GoalKind } from '../types'
import { DialogSheet } from './DialogSheet'

export function GoalForm({ onClose, onCreated }: { onClose(): void; onCreated?(id: string): void }) {
  const { data, addGoal, isMutating } = useData()
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<GoalKind>('goal')
  const [initialAreaId] = useState(() => data.areas[0]?.id ?? '')
  const [areaId, setAreaId] = useState(initialAreaId)
  const [targetDate, setTargetDate] = useState('')
  const [why, setWhy] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [message, setMessage] = useState<string | null>(null)
  const busy = saving || isMutating('goal-add')
  const dirty = Boolean(title || kind !== 'goal' || areaId !== initialAreaId || targetDate || why)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (savingRef.current || isMutating('goal-add')) return
    savingRef.current = true
    setSaving(true); setMessage(null)
    try {
      const goal = await addGoal({ title, kind, areaId: areaId || null, targetDate: targetDate || null, why })
      onCreated?.(goal.id)
      onClose()
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Не удалось сохранить цель')
    } finally { savingRef.current = false; setSaving(false) }
  }

  return <DialogSheet titleId="new-goal-title" eyebrow="Новый результат" title="Что хотите довести?" busy={busy} dirty={dirty} onClose={onClose}>
      <form onSubmit={submit} className="stack-form" aria-busy={busy}>
        <label>Название<input data-dialog-initial-focus required disabled={busy} maxLength={140} placeholder="Например, закончить ремонт кухни" value={title} onChange={(event) => { if (!busy) setTitle(event.target.value) }} /></label>
        <div className="segmented" aria-label="Тип записи">
          <button type="button" disabled={busy} aria-pressed={kind === 'goal'} className={kind === 'goal' ? 'active' : ''} onClick={() => setKind('goal')}>Цель</button>
          <button type="button" disabled={busy} aria-pressed={kind === 'project'} className={kind === 'project' ? 'active' : ''} onClick={() => setKind('project')}>Проект</button>
        </div>
        <label>Сфера<select disabled={busy} value={areaId} onChange={(event) => { if (!busy) setAreaId(event.target.value) }}><option value="">Без сферы</option>{data.areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>
        <label>Желаемый срок<input disabled={busy} type="date" value={targetDate} onChange={(event) => { if (!busy) setTargetDate(event.target.value) }} /></label>
        <label>Зачем это вам?<textarea disabled={busy} maxLength={1000} placeholder="Причина, которая поможет не бросить" value={why} onChange={(event) => { if (!busy) setWhy(event.target.value) }} /></label>
        {message && <p className="form-message" role="alert">{message}</p>}
        <button className="primary-button" disabled={busy || !title.trim()} aria-busy={busy}>{busy ? 'Сохраняем…' : 'Создать и начать'}</button>
      </form>
  </DialogSheet>
}
