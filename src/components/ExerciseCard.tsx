import { Check, ChevronDown, ChevronRight, CircleHelp, Plus, RefreshCw, SkipForward, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { BottomSheet } from './BottomSheet'
import { ExerciseTechniqueImage } from './ExerciseTechniqueImage'
import { WeightGuide } from './WeightGuide'
import { SetRecorder } from './SetRecorder'
import { formatRestDuration, getRestDurationSeconds } from '../lib/rest-period'
import { getExerciseWeightGuide } from '../lib/weight-guide'
import { formatSet, getCalibrationSuggestion, parseRepRange } from '../lib/workout'
import { getSetTargetStatus, getWorkoutTargets } from '../lib/workout-targets'
import { getNextSetTarget, getSetCoachMessage, type SetEntryValues } from '../lib/set-logging'
import type { Exercise, PreviousResult, WorkoutExerciseDraft, WorkoutSetDraft } from '../types/training'

type Props = {
  exercise: WorkoutExerciseDraft
  previous?: PreviousResult
  reduced?: boolean
  active?: boolean
  historyStatus?: 'loading' | 'ready' | 'error'
  onSetChange: (setId: string, field: 'weightKg' | 'reps' | 'rir', value: number | null) => void
  onApplyValues: (setId: string, values: SetEntryValues) => void
  onToggleDone: (set: WorkoutSetDraft) => void
  onAddSet: (warmup: boolean) => void
  onRemoveSet: (set: WorkoutSetDraft) => void
  onSkip: (reason: string | null) => void
  onReplace: (exercise: Exercise) => void
  alternatives: Exercise[]
}

export function ExerciseCard({ exercise, previous, reduced = false, active = true, historyStatus = 'ready', onSetChange, onApplyValues, onToggleDone, onAddSet, onRemoveSet, onSkip, onReplace, alternatives }: Props) {
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [skipOpen, setSkipOpen] = useState(false)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null)
  const recommendation = getWorkoutTargets(exercise.target, exercise.sets.filter((set) => !set.isWarmup).length, previous, reduced)
  const previousSets = previous?.sets.filter((set) => set.done && !set.isWarmup && set.reps !== null) ?? []
  const timed = parseRepRange(exercise.target)?.timed ?? false
  const restDuration = formatRestDuration(getRestDurationSeconds(exercise.exercise.key))
  const weightGuide = getExerciseWeightGuide(exercise.exercise.key)
  const lastDone = [...exercise.sets].reverse().find((set) => set.done)
  const calibration = previousSets.length ? null : getCalibrationSuggestion(exercise.target, lastDone)
  const workingSets = exercise.sets.filter((set) => !set.isWarmup)
  const completedSets = workingSets.filter((set) => set.done).length
  const openSetId = selectedSetId && exercise.sets.some((set) => set.id === selectedSetId) ? selectedSetId : active ? exercise.sets.find((set) => !set.done)?.id : undefined
  const lastWorkingSet = [...workingSets].reverse().find((set) => set.done)

  return (
    <article id={`exercise-${exercise.id}`} className={`exercise-card ${exercise.skipped ? 'skipped' : ''}`} data-exercise-key={exercise.exercise.key}>
      <header className="exercise-card-header">
        <div className="exercise-number">{String(exercise.sortOrder).padStart(2, '0')}</div>
        <div><h2>{exercise.exercise.name}</h2><p>Рабочие подходы: {completedSets} из {workingSets.length} · цель {exercise.target} · отдых {restDuration}</p></div>
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
      <div className="set-coach-tip"><strong>{completedSets === workingSets.length ? 'Упражнение выполнено' : 'Тренер · следующий шаг'}</strong><p>{completedSets === workingSets.length ? 'Все рабочие подходы записаны. После отдыха переходи к следующему упражнению.' : getSetCoachMessage(exercise.target, lastWorkingSet, reduced)}</p></div>

      <div className="previous-result">
        <span>Прошлый раз {previousSets.length && previous ? `· ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(previous.finishedAt))}` : ''}</span>
        <small>{historyStatus === 'ready' ? previousSets.length ? `${previousSets.length} рабочих подходов · сравнение ниже` : 'Первая запись станет твоим ориентиром' : 'Пока нельзя определить прошлый результат'}</small>
      </div>

      <p className="rir-explainer">Количество подходов уже задано программой. Записывай их по очереди. Запас выбирай кнопкой после выполнения — вводить его вручную не нужно.</p>

      <div className="sets-table">
        {exercise.sets.map((set, index) => {
          const workIndex = exercise.sets.slice(0, index).filter((item) => !item.isWarmup).length
          const displayNumber = set.isWarmup ? exercise.sets.slice(0, index).filter((item) => item.isWarmup).length + 1 : workIndex + 1
          const last = set.isWarmup || historyStatus !== 'ready' ? undefined : previousSets[workIndex]
          const previousInSession = [...exercise.sets.slice(0, index)].reverse().find((item) => item.done && !item.isWarmup)
          const target = set.isWarmup ? undefined : getNextSetTarget(exercise.target, previousInSession, historyStatus === 'ready' ? recommendation.targets[workIndex] : undefined, reduced)
          const status = getSetTargetStatus(set, target)
          const open = set.id === openSetId
          const label = set.isWarmup ? 'Разминочный подход' : `Рабочий подход ${workIndex + 1} из ${workingSets.length}`
          return (
            <div className={`set-block ${set.done ? 'recorded' : ''}`} key={set.id}>
              <div className="set-summary-row"><button type="button" className="set-summary-button" aria-expanded={open} aria-controls={`set-${set.id}`} onClick={() => setSelectedSetId(set.id)}><span className="set-step-mark">{set.done ? <Check size={16} /> : set.isWarmup ? 'Р' : workIndex + 1}</span><span><strong>{label}</strong><small>{set.done ? timed ? `${set.reps} сек · RIR ${set.rir ?? '—'}` : formatSet(set) : open ? 'Выполни и запиши результат' : 'Ожидает выполнения'}</small></span><ChevronDown size={18} /></button><button type="button" className="set-remove" aria-label={`Удалить подход ${set.setNumber}`} onClick={() => onRemoveSet(set)} disabled={exercise.sets.length <= 1}><Trash2 size={17} /></button></div>
              {open && <div id={`set-${set.id}`}><SetRecorder set={set} exerciseName={exercise.exercise.name} displayNumber={displayNumber} targetText={exercise.target} timed={timed} previous={last} previousInSession={previousInSession} target={target} onChange={(field, value) => onSetChange(set.id, field, value)} onApply={(values) => onApplyValues(set.id, values)} onComplete={() => { onToggleDone(set); setSelectedSetId(null) }} />{set.done && <button type="button" className="text-button undo-set-button" onClick={() => onToggleDone(set)}>Снять отметку выполнения</button>}</div>}
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
