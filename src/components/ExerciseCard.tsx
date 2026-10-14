import { Check, ChevronRight, CircleHelp, Plus, RefreshCw, SkipForward, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { BottomSheet } from './BottomSheet'
import { ExerciseTechniqueImage } from './ExerciseTechniqueImage'
import { WeightGuide } from './WeightGuide'
import { formatRestDuration, getRestDurationSeconds } from '../lib/rest-period'
import { getExerciseWeightGuide } from '../lib/weight-guide'
import { formatSet, getCalibrationSuggestion, parseRepRange } from '../lib/workout'
import { formatSetTarget, getSetTargetStatus, getWorkoutTargets } from '../lib/workout-targets'
import type { Exercise, PreviousResult, WorkoutExerciseDraft, WorkoutSetDraft } from '../types/training'

type Props = {
  exercise: WorkoutExerciseDraft
  previous?: PreviousResult
  reduced?: boolean
  historyStatus?: 'loading' | 'ready' | 'error'
  onSetChange: (setId: string, field: 'weightKg' | 'reps' | 'rir', value: number | null) => void
  onToggleDone: (set: WorkoutSetDraft) => void
  onAddSet: (warmup: boolean) => void
  onRemoveSet: (set: WorkoutSetDraft) => void
  onSkip: (reason: string | null) => void
  onReplace: (exercise: Exercise) => void
  alternatives: Exercise[]
}

const numericValue = (value: number | null) => (value === null ? '' : value)

export function ExerciseCard({ exercise, previous, reduced = false, historyStatus = 'ready', onSetChange, onToggleDone, onAddSet, onRemoveSet, onSkip, onReplace, alternatives }: Props) {
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [skipOpen, setSkipOpen] = useState(false)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const recommendation = getWorkoutTargets(exercise.target, exercise.sets.filter((set) => !set.isWarmup).length, previous, reduced)
  const previousSets = previous?.sets.filter((set) => set.done && !set.isWarmup && set.reps !== null) ?? []
  const timed = parseRepRange(exercise.target)?.timed ?? false
  const restDuration = formatRestDuration(getRestDurationSeconds(exercise.exercise.key))
  const weightGuide = getExerciseWeightGuide(exercise.exercise.key)
  const lastDone = [...exercise.sets].reverse().find((set) => set.done)
  const calibration = previousSets.length ? null : getCalibrationSuggestion(exercise.target, lastDone)

  return (
    <article className={`exercise-card ${exercise.skipped ? 'skipped' : ''}`} data-exercise-key={exercise.exercise.key}>
      <header className="exercise-card-header">
        <div className="exercise-number">{String(exercise.sortOrder).padStart(2, '0')}</div>
        <div><h2>{exercise.exercise.name}</h2><p>{exercise.sets.length} подхода · цель {exercise.target} · отдых {restDuration}</p></div>
        <button className="how-button" type="button" onClick={() => setInstructionsOpen(true)}>
          <CircleHelp size={18} /><span>Как делать</span>
        </button>
      </header>

      {exercise.skipped ? (
        <div className="skipped-exercise">
          <SkipForward /><div><strong>Упражнение пропущено</strong><span>{exercise.skipReason}</span></div>
          <button type="button" onClick={() => onSkip(null)}>Вернуть</button>
        </div>
      ) : <>

      <div className={`recommendation ${recommendation.mode}`}>
        <div><span>{historyStatus === 'loading' ? 'Загружаем прошлый результат…' : historyStatus === 'error' ? 'История недоступна' : recommendation.mode === 'baseline' ? 'Первая точка' : 'Твоя цель сегодня'}</span><p>{historyStatus === 'ready' ? recommendation.message : 'Дождись истории, чтобы сравнить результат. Ориентируйся на диапазон программы и самочувствие.'}</p></div>
        <ChevronRight size={20} />
      </div>

      {weightGuide && <details className="weight-guide-details" open={!previousSets.length}><summary>Ориентиры для первого раза</summary><WeightGuide guide={weightGuide} /></details>}
      {calibration && <p className="calibration-tip" role="status">{calibration}</p>}

      <div className="previous-result">
        <span>Прошлый раз {previousSets.length && previous ? `· ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(previous.finishedAt))}` : ''}</span>
        <small>{historyStatus === 'ready' ? previousSets.length ? `${previousSets.length} рабочих подходов · сравнение ниже` : 'Первая запись станет твоим ориентиром' : 'Пока нельзя определить прошлый результат'}</small>
      </div>

      <p className="rir-explainer">RIR — сколько повторов осталось в запасе. Цель: {reduced ? '3' : '2'}. {timed ? 'В колонке времени указывай секунды удержания.' : 'Сначала техника, затем прибавка.'}</p>

      <div className="sets-table">
        {exercise.sets.map((set, index) => {
          const workIndex = exercise.sets.slice(0, index).filter((item) => !item.isWarmup).length
          const last = set.isWarmup || historyStatus !== 'ready' ? undefined : previousSets[workIndex]
          const target = set.isWarmup || historyStatus !== 'ready' ? undefined : recommendation.targets[workIndex]
          const status = getSetTargetStatus(set, target)
          return (
            <div className="set-block" key={set.id}>
              {!set.isWarmup && <div className="set-comparison">
                <div><span>Прошлый раз</span><strong>{last ? timed ? `${last.reps} сек · RIR ${last.rir ?? '—'}` : formatSet(last) : historyStatus === 'ready' ? 'Нет записи' : 'Недоступен'}</strong></div>
                <ChevronRight size={16} />
                <div className="set-target"><span>Цель сегодня</span><strong>{target ? formatSetTarget(target) : exercise.target}</strong><small>{target ? `запас ${target.rir} RIR` : 'подбери рабочий вес'}</small></div>
              </div>}
            <p className="set-entry-label">{set.isWarmup ? 'Разминочный подход' : 'Твой факт'}</p>
            <div className="set-row set-head" aria-hidden="true"><span>№</span><span>кг</span><span>{timed ? 'сек' : 'повт.'}</span><span>RIR</span><span>✓</span><span /></div>
            <div className={`set-row ${set.done ? 'complete' : ''}`} key={set.id}>
              <strong>{set.isWarmup ? 'Р' : set.setNumber}</strong>
              <input
                aria-label={`${exercise.exercise.name}, подход ${set.setNumber}, вес кг`}
                type="number"
                inputMode="decimal"
                min="0"
                max="1000"
                step="0.5"
                placeholder={last?.weightKg?.toString() ?? '—'}
                value={numericValue(set.weightKg)}
                onChange={(event) => onSetChange(set.id, 'weightKg', event.target.value === '' ? null : Number(event.target.value))}
              />
              <input
                aria-label={`${exercise.exercise.name}, подход ${set.setNumber}, ${timed ? 'секунды' : 'повторы'}`}
                type="number"
                inputMode="numeric"
                min="1"
                max="1000"
                step="1"
                placeholder={last?.reps?.toString() ?? '—'}
                value={numericValue(set.reps)}
                onChange={(event) => onSetChange(set.id, 'reps', event.target.value === '' ? null : Number(event.target.value))}
              />
              <input
                aria-label={`${exercise.exercise.name}, подход ${set.setNumber}, RIR`}
                type="number"
                inputMode="numeric"
                min="0"
                max="5"
                step="1"
                placeholder={last?.rir?.toString() ?? '—'}
                value={numericValue(set.rir)}
                onChange={(event) => onSetChange(set.id, 'rir', event.target.value === '' ? null : Number(event.target.value))}
              />
              <button type="button" className="set-check" aria-pressed={set.done} aria-label={`Подход ${set.setNumber} выполнен`} onClick={() => onToggleDone(set)}>
                <Check size={20} />
              </button>
              <button type="button" className="set-remove" aria-label={`Удалить подход ${set.setNumber}`} onClick={() => onRemoveSet(set)} disabled={exercise.sets.length <= 1}><Trash2 size={17} /></button>
            </div>
            {status && <p className={`set-feedback ${status === 'Цель выполнена' ? 'achieved' : ''}`} role="status">{status}</p>}
            </div>
          )
        })}
      </div>

      <div className="exercise-actions">
        <button type="button" onClick={() => onAddSet(true)}><Plus />Разминка</button>
        <button type="button" onClick={() => onAddSet(false)}><Plus />Рабочий подход</button>
        <button type="button" onClick={() => setReplaceOpen(true)}><RefreshCw />Заменить</button>
        <button type="button" onClick={() => setSkipOpen(true)}><SkipForward />Пропустить</button>
      </div>
      </>}

      {instructionsOpen && (
        <BottomSheet title={exercise.exercise.name} onClose={() => setInstructionsOpen(false)}>
          <ExerciseTechniqueImage exerciseKey={exercise.exercise.key} exerciseName={exercise.exercise.name} />
          <section className="instruction-section"><h3>Работающие мышцы</h3><div className="muscle-list">{exercise.exercise.muscles.map((muscle) => <span key={muscle}>{muscle}</span>)}</div></section>
          <section className="instruction-section"><h3>Как делать</h3><ol>{exercise.exercise.steps.map((step) => <li key={step}>{step}</li>)}</ol></section>
          <section className="instruction-section mistakes"><h3>Не делай</h3><ul>{exercise.exercise.mistakes.map((mistake) => <li key={mistake}>{mistake}</li>)}</ul></section>
          {exercise.exercise.youtube_url && <a className="youtube-link" href={exercise.exercise.youtube_url} target="_blank" rel="noreferrer">Смотреть технику на YouTube <ChevronRight /></a>}
        </BottomSheet>
      )}
      {skipOpen && (
        <BottomSheet title="Почему пропускаем?" onClose={() => setSkipOpen(false)}>
          <div className="choice-list">
            {['Тренажёр занят', 'Появился дискомфорт', 'Не хватает времени', 'Сегодня не подходит'].map((reason) => (
              <button type="button" key={reason} onClick={() => { onSkip(reason); setSkipOpen(false) }}>{reason}<ChevronRight /></button>
            ))}
          </div>
        </BottomSheet>
      )}
      {replaceOpen && (
        <BottomSheet title="Заменить упражнение" onClose={() => setReplaceOpen(false)}>
          <div className="choice-list exercise-choice-list">
            {alternatives.filter((item) => item.key !== exercise.exercise.key).map((item) => (
              <button type="button" key={item.key} onClick={() => { onReplace(item); setReplaceOpen(false) }}><span><strong>{item.name}</strong><small>{item.muscles.join(' · ')}</small></span><ChevronRight /></button>
            ))}
          </div>
        </BottomSheet>
      )}
    </article>
  )
}
