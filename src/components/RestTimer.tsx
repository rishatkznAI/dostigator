import { Plus, SkipForward } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatRestDuration, type RestDurationSeconds } from '../lib/rest-period'
import { notifyRestComplete } from '../lib/rest-alert'

type Props = {
  until: number
  exerciseName: string
  plannedSeconds: RestDurationSeconds
  onChange: (until: number) => void
  onSkip: () => void
}

export function RestTimer({ until, exerciseName, plannedSeconds, onChange, onSkip }: Props) {
  const [now, setNow] = useState(until - plannedSeconds * 1000)
  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.ceil((until - now) / 1000))

  useEffect(() => {
    if (seconds !== 0) return
    notifyRestComplete(exerciseName)
  }, [exerciseName, seconds])

  const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  return (
    <aside className={`rest-timer ${seconds === 0 ? 'done' : ''}`} aria-live="polite">
      <div>
        <span>{seconds === 0 ? 'Отдых закончен' : `После: ${exerciseName}`}</span>
        <strong>{clock}</strong>
        <small>план {formatRestDuration(plannedSeconds)}</small>
      </div>
      <button type="button" onClick={() => onChange(until + 30_000)}><Plus size={17} />30 сек</button>
      <button type="button" onClick={onSkip} aria-label={seconds === 0 ? 'Продолжить после отдыха' : 'Пропустить отдых'}><SkipForward size={18} />{seconds === 0 ? 'Продолжить' : 'Пропустить отдых'}</button>
    </aside>
  )
}
