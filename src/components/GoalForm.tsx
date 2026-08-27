import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useData } from '../context/DataContext'
import type { GoalKind } from '../types'

export function GoalForm({ onClose, onCreated }: { onClose(): void; onCreated?(id: string): void }) {
  const { data, addGoal } = useData()
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<GoalKind>('goal')
  const [areaId, setAreaId] = useState(data.areas[0]?.id ?? '')
  const [targetDate, setTargetDate] = useState('')
  const [why, setWhy] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true); setMessage(null)
    try {
      const goal = await addGoal({ title, kind, areaId: areaId || null, targetDate: targetDate || null, why })
      onCreated?.(goal.id)
      onClose()
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Не удалось сохранить цель')
    } finally { setSaving(false) }
  }

  return <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="new-goal-title">
      <div className="sheet-handle" />
      <button className="icon-button sheet-close" type="button" onClick={onClose} aria-label="Закрыть"><X /></button>
      <p className="eyebrow">Новый результат</p><h2 id="new-goal-title">Что хотите довести?</h2>
      <form onSubmit={submit} className="stack-form">
        <label>Название<input autoFocus required maxLength={140} placeholder="Например, закончить ремонт кухни" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <div className="segmented" aria-label="Тип записи">
          <button type="button" className={kind === 'goal' ? 'active' : ''} onClick={() => setKind('goal')}>Цель</button>
          <button type="button" className={kind === 'project' ? 'active' : ''} onClick={() => setKind('project')}>Проект</button>
        </div>
        <label>Сфера<select value={areaId} onChange={(event) => setAreaId(event.target.value)}>{data.areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>
        <label>Желаемый срок<input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label>
        <label>Зачем это вам?<textarea maxLength={1000} placeholder="Причина, которая поможет не бросить" value={why} onChange={(event) => setWhy(event.target.value)} /></label>
        {message && <p className="form-message" role="alert">{message}</p>}
        <button className="primary-button" disabled={saving || !title.trim()}>{saving ? 'Сохраняем…' : 'Создать и начать'}</button>
      </form>
    </section>
  </div>
}
