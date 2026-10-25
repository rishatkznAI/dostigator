import { useRef, useState, type FormEvent } from 'react'
import { DialogSheet } from './DialogSheet'
import { correctWorkoutSet } from '../lib/workout-corrections'
import { parseRepRange } from '../lib/workout'
import type { HistoryWorkout, WorkoutSetDraft } from '../types/training'

export function CorrectWorkoutSet({ owner, workout, exercise, set, onClose, onSaved }: {
  owner: string; workout: HistoryWorkout; exercise: HistoryWorkout['exercises'][number]; set: WorkoutSetDraft;
  onClose(): void; onSaved(workout: HistoryWorkout): void;
}) {
  const key = `trainlog:history-entry:${owner}:${set.id}`
  const [entry, setEntry] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(key) ?? 'null'); if (saved) return saved as {weight:string;reps:string;rir:string} } catch { /* use saved fact */ }
    return { weight: String(set.weightKg ?? 0), reps: String(set.reps ?? ''), rir: set.rir == null ? '' : String(set.rir) }
  })
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState('')
  const timed = parseRepRange(exercise.target)?.timed
  const change = (field: keyof typeof entry, value: string) => {
    const next = {...entry,[field]:value};setEntry(next);setError('')
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { setError('Не удалось сохранить ввод на устройстве. Оставь окно открытым.') }
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault();if(lock.current)return
    lock.current=true;setBusy(true);setError('')
    try {
      const corrected = await correctWorkoutSet(owner,workout,set,{weightKg:Number(entry.weight),reps:Number(entry.reps),rir:entry.rir===''?null:Number(entry.rir)})
      localStorage.removeItem(key);onSaved(corrected)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить исправление. Ввод сохранён.') }
    finally { lock.current=false;setBusy(false) }
  }
  return <DialogSheet titleId="correct-set-title" eyebrow="История тренировки" title="Исправить подход" busy={busy} dirty={false} onClose={onClose}>
    <p>{exercise.exerciseName} · {set.isWarmup ? 'разминка' : 'подход'} {set.setNumber}</p>
    <p className="history-correction-caption">Исходный результат: {set.weightKg ?? 0} кг × {set.reps} {timed?'сек.':'повт.'} Ввод сохраняется на устройстве до отправки.</p>
    <form className="stack-form history-correction-form" onSubmit={event=>void submit(event)}>
      <label>Вес, кг<input aria-label="Исправленный вес, кг" type="number" inputMode="decimal" min="0" max="1000" step="0.25" required value={entry.weight} disabled={busy} onChange={e=>change('weight',e.target.value)}/></label>
      <label>{timed?'Время, сек':'Повторения'}<input aria-label={timed?'Исправленное время, сек':'Исправленные повторы'} type="number" inputMode="numeric" min="1" max="1000" step="1" required value={entry.reps} disabled={busy} onChange={e=>change('reps',e.target.value)}/></label>
      <label>Запас повторов · необязательно<select aria-label="Исправленный запас повторов" value={entry.rir} disabled={busy} onChange={e=>change('rir',e.target.value)}><option value="">Не оценивал</option>{[0,1,2,3,4,5].map(v=><option key={v} value={v}>{v===5?'5+':v}</option>)}</select></label>
      {error && <p className="form-message error" role="alert">{error}</p>}
      <button type="submit" className="primary-button" disabled={busy||entry.weight===''||entry.reps===''}>{busy?'Сохраняем…':'Сохранить исправление'}</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Закрыть</button>
    </form>
  </DialogSheet>
}
