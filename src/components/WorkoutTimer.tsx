import { Pause, Play } from 'lucide-react'
import { elapsedClock } from '../lib/workout'
import type { WorkoutDraft } from '../types/training'

type Props = {
  draft: WorkoutDraft
  now: number
  onToggle: () => void
}

export function WorkoutTimer({ draft, now, onToggle }: Props) {
  const paused = draft.timerPausedAt !== null

  return (
    <>
      <div className="workout-clock">
        <time>{elapsedClock(draft, now)}</time>
        <button
          className={`timer-toggle ${paused ? 'paused' : ''}`}
          type="button"
          aria-pressed={paused}
          aria-label={paused ? 'Продолжить таймер тренировки' : 'Остановить таймер тренировки'}
          onClick={onToggle}
        >
          {paused ? <Play /> : <Pause />}
          <span>{paused ? 'Продолжить' : 'Пауза'}</span>
        </button>
      </div>
      {paused && <p className="timer-paused-copy" role="status">Время остановлено</p>}
    </>
  )
}
