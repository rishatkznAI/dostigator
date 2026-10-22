import { workoutChanges, workFacts } from '../lib/training-insights'
import { workoutCardio } from '../lib/cardio-receipts'
import { cardioKinds } from '../lib/cardio'
import type { HistoryWorkout } from '../types/training'

export function WorkoutResult({ workout, history, userId }: { workout: HistoryWorkout; history: HistoryWorkout[]; userId?: string }) {
  const changes = workoutChanges(workout, history)
  const cardio=userId?workoutCardio(userId,workout.id):[]
  const skipped=workout.exercises.filter(exercise=>exercise.skipped)
  const incomplete=workout.exercises.flatMap(exercise=>exercise.skipped?[]:exercise.sets).filter(set=>!set.isWarmup&&!set.done)
  return <section className="workout-result" aria-label="Итог силовой тренировки"><h3>Что изменилось</h3><p>Упражнений: {changes.length} · рабочих подходов: {changes.reduce((sum, item) => sum + workFacts(item.exercise.sets).length, 0)}</p>{changes.map(({ exercise, text, previousWorkout }) => <div key={exercise.id}><strong>{exercise.exerciseName}</strong><p>{text}</p>{previousWorkout && <small>Сравнение с {new Date(previousWorkout.finishedAt).toLocaleDateString('ru-RU')}</small>}</div>)}{skipped.length>0 && <p>Пропущены: {skipped.map(exercise=>exercise.exerciseName).join(', ')}</p>}{incomplete.length>0 && <p>Невыполненные рабочие подходы: {incomplete.length}{incomplete.some(set=>set.skipped)?' (включая пропущенные)':''}</p>}<div><strong>Кардио</strong>{cardio.length?cardio.map(({session,receipt})=><p key={session.id}>{cardioKinds[session.kind]} · {Math.floor(receipt.durationSeconds/60)} мин {receipt.durationSeconds%60} сек</p>):<p>Связанное кардио не найдено в загруженной истории.</p>}<small>{cardio.some(item=>!item.session.revision)?'Есть локальный результат, ожидающий синхронизации.':'Связь и точное время входят в запись кардио.'}</small></div></section>
}
