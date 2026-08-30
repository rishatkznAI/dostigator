import { BatteryCharging, Brain, ShieldAlert } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import type { WorkoutReadiness } from '../types/training'

type Props = { onComplete: (readiness: WorkoutReadiness) => void }

const Scale = ({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) => (
  <label className="readiness-scale"><span>{label}</span><input aria-label={label} type="range" min="1" max="5" step="1" value={value} onChange={(event) => onChange(Number(event.target.value))} /><strong>{value}/5</strong></label>
)

export function ReadinessCheck({ onComplete }: Props) {
  const [sleep, setSleep] = useState(3)
  const [energy, setEnergy] = useState(3)
  const [stress, setStress] = useState(3)
  const [discomfort, setDiscomfort] = useState(false)
  const [note, setNote] = useState('')
  const reduced = useMemo(() => sleep <= 2 || energy <= 2 || stress >= 4 || discomfort, [discomfort, energy, sleep, stress])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onComplete({ sleep, energy, stress, discomfort, note: note.trim(), mode: reduced ? 'reduced' : 'normal' })
  }

  return (
    <section className="readiness-card">
      <header><div><p className="eyebrow">Перед стартом</p><h2>Как вы сегодня?</h2></div><Brain /></header>
      <div className="warmup-note"><BatteryCharging /><p><strong>Разогрев 5–7 минут</strong><span>Спокойная дорожка или велосипед, затем 1–2 разминочных подхода первого упражнения.</span></p></div>
      <form onSubmit={submit}>
        <Scale label="Сон" value={sleep} onChange={setSleep} />
        <Scale label="Энергия" value={energy} onChange={setEnergy} />
        <Scale label="Стресс" value={stress} onChange={setStress} />
        <label className="check-row"><input type="checkbox" checked={discomfort} onChange={(event) => setDiscomfort(event.target.checked)} /><ShieldAlert /><span>Есть боль или необычный дискомфорт</span></label>
        <label>Комментарий, необязательно<textarea maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Например: плохо спал, напряжена поясница" /></label>
        <div className={`readiness-result ${reduced ? 'reduced' : 'normal'}`}><strong>{reduced ? 'Облегчённый режим' : 'Обычный режим'}</strong><span>{reduced ? 'Не стремитесь к рекорду, оставляйте 2–3 RIR и при необходимости уберите один рабочий подход.' : 'Работайте по плану и сохраняйте технику.'}</span></div>
        <button className="primary-button wide">Начать тренировку</button>
      </form>
    </section>
  )
}
