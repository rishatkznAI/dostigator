import { Check, ChevronRight, CircleHelp, Plus, RefreshCw, SkipForward } from 'lucide-react'
import { useState } from 'react'
import { BottomSheet } from './BottomSheet'
import { ExerciseTechniqueImage } from './ExerciseTechniqueImage'
import { WeightGuide } from './WeightGuide'
import { SetRecorder } from './SetRecorder'
import { formatRestDuration, getRestDurationSeconds } from '../lib/rest-period'
import { getExerciseWeightGuide } from '../lib/weight-guide'
import { parseRepRange } from '../lib/workout'
import { getWorkoutTargets } from '../lib/workout-targets'
import { formatSetResult, getNextSetTarget } from '../lib/set-logging'
import type { Exercise, PreviousResult, WorkoutExerciseDraft, WorkoutSetDraft } from '../types/training'

type Props = {
  exercise: WorkoutExerciseDraft
  previous?: PreviousResult
  userId?: string
  reduced?: boolean
  active?: boolean
  plannedSets?: number
  historyFromCache?: boolean
  historyStatus?: 'loading' | 'ready' | 'error'
  recordLocked?: boolean
  onActivate?: () => void
  onRecordSet: (set: WorkoutSetDraft) => boolean | void
  onUndoSet: (set: WorkoutSetDraft) => void
  onSkipSet: (set: WorkoutSetDraft) => void
  onAddSet: (warmup: boolean) => void
  onRemoveSet: (set: WorkoutSetDraft) => void
  onSkip: (reason: string | null) => void
  onReplace: (exercise: Exercise) => void
  alternatives: Exercise[]
}

export function ExerciseCard({ exercise, previous, userId = 'local', reduced = false, active = true, plannedSets, historyStatus = 'ready', historyFromCache = false, recordLocked = false, onActivate, onRecordSet, onUndoSet, onSkipSet, onAddSet, onRemoveSet, onSkip, onReplace, alternatives }: Props) {
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [skipOpen, setSkipOpen] = useState(false)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const focusKey = `trainlog:set-focus:${userId}:${exercise.id}`
  const [selectedSetId, setSelectedSetId] = useState<string | null>(() => localStorage.getItem(focusKey))
  const working = exercise.sets.filter((set) => !set.isWarmup)
  const completed = working.filter((set) => set.done).length
  const selected = exercise.sets.find((set) => set.id === selectedSetId)
  const current = selected ?? exercise.sets.find((set) => !set.done && !set.skipped)
  const timed = parseRepRange(exercise.target)?.timed ?? false
  const history = historyStatus === 'ready' ? previous : undefined
  const stepKey = `trainlog:weight-step:${userId}:${exercise.exercise.key}`
  const [weightStep, setWeightStep] = useState(() => localStorage.getItem(stepKey) ?? '')
  const recommendation = getWorkoutTargets(exercise.target, plannedSets ?? working.length, history, reduced, { weightStep: Number(weightStep), today: new Date().toISOString() })
  const previousSets = history?.sets.filter((set) => !set.isWarmup) ?? []
  const workIndex = current ? working.findIndex((set) => set.id === current.id) : -1
  const last = workIndex >= 0 && previousSets[workIndex]?.done ? previousSets[workIndex] : undefined
  const previousInSession = current ? [...exercise.sets.slice(0, exercise.sets.indexOf(current))].reverse().find((set) => set.done && !set.isWarmup) : undefined
  const target = current?.isWarmup ? undefined : getNextSetTarget(exercise.target, previousInSession, recommendation.targets[workIndex], reduced)
  const weightGuide = getExerciseWeightGuide(exercise.exercise.key)
  const chooseSet = (setId: string | null) => {
    setSelectedSetId(setId)
    try { if (setId) localStorage.setItem(focusKey,setId); else localStorage.removeItem(focusKey) } catch { /* optional focus preference */ }
  }
  return <article id={`exercise-${exercise.id}`} className={`exercise-card focused-exercise ${active ? 'active' : 'compact'} ${exercise.skipped ? 'skipped' : ''}`} data-exercise-key={exercise.exercise.key}>
    <header className="focused-exercise-header"><button type="button" className="exercise-open-button" onClick={onActivate} aria-label={`Открыть упражнение · ${exercise.exercise.name}`} aria-expanded={active}><span className="exercise-number">{exercise.sortOrder}</span><span><h2>{exercise.exercise.name}</h2><small>{exercise.skipped ? 'Пропущено' : `${completed} из ${working.length} записано`} · {exercise.target}{timed ? '' : ' повторов'}</small></span></button>{active && <button className="icon-button" type="button" aria-label="Как делать" onClick={(event) => { event.currentTarget.focus({preventScroll:true}); setInstructionsOpen(true) }}><CircleHelp size={20} /></button>}</header>
    {active && (exercise.skipped ? <div className="skipped-exercise"><span>{exercise.skipReason}</span><button type="button" onClick={() => onSkip(null)}>Вернуть упражнение</button></div> : <>

      {current?.skipped ? <div className="skipped-exercise"><strong>Подход пропущен</strong><button type="button" onClick={() => { onSkipSet(current); chooseSet(null) }}>Вернуть подход</button></div> : current ? <SetRecorder key={`${current.id}:${current.completedAt ?? 'draft'}`} set={current} userId={userId} exerciseName={exercise.exercise.name} exerciseKey={exercise.exercise.key} displayNumber={current.isWarmup ? exercise.sets.filter((set) => set.isWarmup).findIndex((set) => set.id === current.id) + 1 : workIndex + 1} total={working.length} targetText={exercise.target} timed={timed} previous={last} historyStatus={historyStatus} historyFromCache={historyFromCache} target={target} locked={recordLocked} onRecord={(values) => { if (onRecordSet({ ...current, ...values }) === false) return false; chooseSet(null); return true }} onCancelEdit={() => chooseSet(null)} onUndo={() => { onUndoSet(current); chooseSet(null) }} onSkip={() => { onSkipSet(current); chooseSet(null) }} /> : <p className="exercise-complete" role="status"><Check size={18} />{completed === working.length ? 'Упражнение выполнено' : 'Оставшиеся подходы пропущены'}</p>}
      {["pallof_press","cable_hip_extension"].includes(exercise.exercise.key) && <p className="entry-caption">Один подход — обе стороны. Сначала выполни правую и левую, затем запиши число повторов на одну сторону; при разнице — меньшее.</p>}
      <nav className="set-strip" aria-label={`Все подходы · ${exercise.exercise.name}`}>{exercise.sets.map((set) => {
        const number = set.isWarmup ? exercise.sets.filter((item) => item.isWarmup).findIndex((item) => item.id === set.id) + 1 : working.findIndex((item) => item.id === set.id) + 1
        return <button type="button" key={set.id} className={`${set.done ? 'recorded' : ''} ${set.skipped ? 'excluded' : ''}`} aria-current={current?.id === set.id ? 'step' : undefined} aria-label={`${set.isWarmup ? 'Разминка' : 'Подход'} ${number} · ${set.done ? 'записан' : set.skipped ? 'пропущен' : 'не выполнен'} · ${exercise.exercise.name}`} onClick={() => chooseSet(set.id)}><strong>{set.done && <Check size={14} />}{set.isWarmup ? 'Р' : ''}{number}</strong><small>{set.done ? `Факт: ${formatSetResult(set, timed)}` : set.skipped ? 'Пропущен' : 'Не выполнен'}</small></button>
      })}</nav>
      <details className="training-extras exercise-tools"><summary><span><strong>Разминка и замена упражнения</strong><small>Добавить подход или пропустить упражнение</small></span></summary><p>Отдых: {formatRestDuration((exercise.restSeconds ?? getRestDurationSeconds(exercise.exercise.key)))}</p><label>Шаг оборудования, кг · для следующего веса<input aria-label="Шаг оборудования, кг" type="number" min="0.25" max="50" step="0.25" placeholder="Укажи доступный шаг" value={weightStep} onChange={(event) => { setWeightStep(event.target.value); localStorage.setItem(stepKey, event.target.value) }} /></label><p>{historyStatus === 'ready' ? recommendation.message : historyStatus === 'loading' ? 'Прошлые результаты загружаются.' : 'История недоступна. План программы показан без прибавки.'}</p>{weightGuide && <WeightGuide guide={weightGuide} />}<div className="exercise-actions"><button type="button" onClick={() => onAddSet(true)}><Plus />Разминка</button><button type="button" onClick={() => onAddSet(false)}><Plus />Подход</button><button type="button" onClick={(event) => { event.currentTarget.focus({preventScroll:true}); setReplaceOpen(true) }}><RefreshCw />Заменить</button><button type="button" onClick={(event) => { event.currentTarget.focus({preventScroll:true}); setSkipOpen(true) }}><SkipForward />Пропустить упражнение</button></div>{exercise.sets.filter((set) => !set.done).map((set) => <button type="button" className="text-button" key={set.id} disabled={exercise.sets.length <= 1} onClick={() => onRemoveSet(set)}>Удалить незаписанный подход {set.setNumber}</button>)}</details>
    </>)}
    {instructionsOpen && <BottomSheet title={exercise.exercise.name} onClose={() => setInstructionsOpen(false)}><ExerciseTechniqueImage exerciseKey={exercise.exercise.key} exerciseName={exercise.exercise.name} /><section className="instruction-section"><h3>Работающие мышцы</h3><div className="muscle-list">{exercise.exercise.muscles.map((muscle) => <span key={muscle}>{muscle}</span>)}</div></section><section className="instruction-section"><h3>Как делать</h3><ol>{exercise.exercise.steps.map((step) => <li key={step}>{step}</li>)}</ol></section><section className="instruction-section mistakes"><h3>Не делай</h3><ul>{exercise.exercise.mistakes.map((mistake) => <li key={mistake}>{mistake}</li>)}</ul></section>{exercise.exercise.key === 'pallof_press' && <a href="https://www.seattleymca.org/blog/how-pallof-press" target="_blank" rel="noreferrer">Техника · YMCA</a>}{exercise.exercise.key === 'cable_hip_extension' && <a href="https://www.puregym.com/exercises/glutes/glute-kickbacks/cable-kickbacks/" target="_blank" rel="noreferrer">Техника · PureGym</a>}{exercise.exercise.youtube_url && <a className="youtube-link" href={exercise.exercise.youtube_url} target="_blank" rel="noreferrer">Смотреть технику на YouTube <ChevronRight /></a>}</BottomSheet>}
    {skipOpen && <BottomSheet title="Почему пропускаем?" onClose={() => setSkipOpen(false)}><div className="choice-list">{['Тренажёр занят', 'Появился дискомфорт', 'Не хватает времени', 'Сегодня не подходит'].map((reason) => <button type="button" key={reason} onClick={() => { onSkip(reason); setSkipOpen(false) }}>{reason}<ChevronRight /></button>)}</div></BottomSheet>}
    {replaceOpen && <BottomSheet title="Заменить упражнение" onClose={() => setReplaceOpen(false)}><div className="choice-list exercise-choice-list">{alternatives.filter((item) => item.key !== exercise.exercise.key).map((item) => <button type="button" key={item.key} onClick={() => { onReplace(item); setReplaceOpen(false) }}><span><strong>{item.name}</strong><small>{item.muscles.join(' · ')}</small></span><ChevronRight /></button>)}</div></BottomSheet>}
  </article>
}
