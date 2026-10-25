import { beforeEach, expect, it } from 'vitest'
import { appendExercisesToWorkout, createPersonalExercise, decodePersonalExercise, encodePersonalExercise, personalExercisesFromHistory, readPersonalExercises, savePersonalExercise, startFreeWorkout } from '../src/lib/free-workout'
import { getActiveDraft, saveActiveDraft } from '../src/lib/storage'
import { createWorkoutDraft, getCompletedTemplateCodesThisWeek, getWeeklyStats } from '../src/lib/workout'
import { draftToHistory } from '../src/lib/training-insights'
import { programV21Templates } from '../src/lib/program-v21'
const selection = () => [{ exercise: createPersonalExercise('Жим одной рукой', 'Плечи', 'Моя заметка'), setCount: 2, repTarget: '8–12', sortOrder: 7 }]
beforeEach(() => localStorage.clear())

it('preserves custom identity and description through a bounded cloud snapshot', () => {
  const exercise = selection()[0].exercise
  const note = encodePersonalExercise(exercise)
  expect(note.length).toBeLessThanOrEqual(1000)
  expect(decodePersonalExercise(note, exercise.name)).toEqual(exercise)
  expect(decodePersonalExercise(note, 'Другое имя')).toBeUndefined()
  expect(decodePersonalExercise('обычная заметка', exercise.name)).toBeUndefined()
  expect(encodePersonalExercise(programV21Templates[0].items[0].exercise)).toBe('')
})

it('isolates unused personal definitions by owner and recovers used ones from history', () => {
  const item = selection()[0]
  savePersonalExercise('first', { exercise: item.exercise, target: item.repTarget })
  expect(readPersonalExercises('second')).toEqual([])
  expect(readPersonalExercises('first')[0].exercise).toEqual(item.exercise)
  expect(() => savePersonalExercise('first', { exercise: item.exercise, target: item.repTarget })).toThrow('уже есть')
  const draft = startFreeWorkout('first', 'Вне расписания', [item]); draft.finishedAt = draft.updatedAt
  expect(personalExercisesFromHistory([draftToHistory(draft)])[0].exercise).toEqual(item.exercise)
})

it('starts a free snapshot and includes its facts without completing A or B', () => {
  const templates = JSON.stringify(programV21Templates)
  const draft = startFreeWorkout('owner', 'Вечером дома', selection())
  expect(draft.templateCode).toBe('free')
  expect(draft.title).toBe('Вечером дома')
  expect(draft.exercises[0].sortOrder).toBe(1)
  draft.exercises[0].sets[0] = { ...draft.exercises[0].sets[0], weightKg: 12.5, reps: 10, done: true, completedAt: draft.updatedAt }
  draft.finishedAt = draft.updatedAt
  const history = [draftToHistory(draft)]
  expect(getCompletedTemplateCodesThisWeek(history).has('A')).toBe(false)
  expect(getCompletedTemplateCodesThisWeek(history).has('B')).toBe(false)
  expect(getWeeklyStats(history)).toMatchObject({ workouts: 1, sets: 1, volume: 125 })
  expect(JSON.stringify(programV21Templates)).toBe(templates)
})

it('never overwrites an active draft and appends after the latest saved facts', () => {
  const current = createWorkoutDraft(programV21Templates[0], 'owner')
  current.exercises[0].sets[0] = { ...current.exercises[0].sets[0], weightKg: 42.5, reps: 10, done: true, completedAt: current.updatedAt }
  saveActiveDraft(current)
  const before = JSON.stringify(getActiveDraft('owner'))
  expect(() => startFreeWorkout('owner', 'Другая', selection())).toThrow('активная')
  expect(JSON.stringify(getActiveDraft('owner'))).toBe(before)
  const item = selection()[0]
  const added = appendExercisesToWorkout('owner', [item], current.id)
  expect(added.id).toBe(current.id)
  expect(added.templateCode).toBe('A')
  expect(added.exercises.slice(0, current.exercises.length)).toEqual(current.exercises)
  expect(Date.parse(added.updatedAt)).toBeGreaterThan(Date.parse(current.updatedAt))
  expect(() => appendExercisesToWorkout('owner', [item], current.id)).toThrow('уже есть')
})

it('rejects invalid composition and keeps corrupt local definitions out of the catalog', () => {
  expect(() => startFreeWorkout('owner', '', [])).toThrow('от 1 до 30')
  expect(() => startFreeWorkout('owner', '', [{ ...selection()[0], setCount: 0 }])).toThrow('подходов')
  expect(() => startFreeWorkout('owner', '', [{ ...selection()[0], repTarget: '12–8' }])).toThrow('диапазон')
  expect(() => createPersonalExercise('   ', '')).toThrow('Название')
  localStorage.setItem('trainlog:personal-exercises:owner', JSON.stringify([{ exercise: { custom: true, key: 'custom:invalid', name: 'Bad' }, target: '10' }]))
  expect(readPersonalExercises('owner')).toEqual([])
  expect(getActiveDraft('owner')).toBeNull()
})

it('does not append to a different session opened in another tab', () => {
  const seen = createWorkoutDraft(programV21Templates[0], 'owner')
  const latest = createWorkoutDraft(programV21Templates[1], 'owner')
  saveActiveDraft(latest)
  const before = JSON.stringify(getActiveDraft('owner'))
  expect(() => appendExercisesToWorkout('owner', selection(), seen.id)).toThrow('изменилась')
  expect(JSON.stringify(getActiveDraft('owner'))).toBe(before)
})
