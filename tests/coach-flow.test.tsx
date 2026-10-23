import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExerciseCard } from '../src/components/ExerciseCard'
import { recordSetAndPrepareNext, skipSet, undoSet } from '../src/lib/set-logging'
import type { PreviousResult, WorkoutExerciseDraft } from '../src/types/training'

const exercise: WorkoutExerciseDraft = { id: 'exercise', target: '8–12', sortOrder: 1, skipped: false, skipReason: '', exercise: { key: 'press', name: 'Жим', muscles: [], steps: [], mistakes: [], youtube_url: null }, sets: [1, 2, 3].map((number) => ({ id: `set-${number}`, setNumber: number, weightKg: null, reps: null, rir: null, done: false, isWarmup: false, completedAt: null })) }
const previous: PreviousResult = { sessionId: 'old', finishedAt: '2026-10-12T10:00:00Z', exerciseKey: 'press', sets: exercise.sets.map((set) => ({ ...set, weightKg: 60, reps: 10, rir: null, done: true })) }

function Harness({history=previous}:{history?:PreviousResult}={}) {
  const [current, setCurrent] = useState(exercise)
  return <><output data-testid="facts">{JSON.stringify(current.sets)}</output><ExerciseCard exercise={current} previous={history} onRecordSet={(set) => setCurrent((state) => recordSetAndPrepareNext(state, set, false))} onUndoSet={(set) => setCurrent((state) => undoSet(state, set.id))} onSkipSet={(set) => setCurrent((state) => skipSet(state, set.id))} onAddSet={() => undefined} onRemoveSet={() => undefined} onSkip={() => undefined} onReplace={() => undefined} alternatives={[]} /></>
}
const facts = () => JSON.parse(screen.getByTestId('facts').textContent!)

describe('focused set entry', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)
  it('shows only the active editor and confirms each standard set in one click', () => {
    render(<Harness />)
    expect(screen.getAllByRole('spinbutton').filter((input) => input.closest('.active-set'))).toHaveLength(2)
    expect(facts().every((set: { done: boolean }) => !set.done)).toBe(true)
    for (const number of [1, 2, 3]) {
      expect(screen.getByRole('spinbutton', { name: new RegExp(`подход ${number}, вес`) })).toHaveValue(60)
      expect(screen.getByRole('spinbutton', { name: new RegExp(`подход ${number}, повторы`) })).toHaveValue(10)
      fireEvent.click(screen.getByRole('button', { name: `Записать подход ${number} · Жим` }))
      expect(facts().filter((set: { done: boolean }) => set.done)).toHaveLength(number)
    }
    expect(screen.queryAllByRole('spinbutton').filter((input) => input.closest('.active-set'))).toHaveLength(0)
    expect(screen.getByText('Упражнение выполнено')).toBeInTheDocument()
    expect(facts().every((set: { rir: null }) => set.rir === null)).toBe(true)
  })
  it('keeps a recorded fact unchanged until an edited value is explicitly confirmed', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Записать подход 1 · Жим' }))
    fireEvent.click(screen.getByRole('button', { name: 'Подход 1 · записан · Жим' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: /подход 1, повторы/ }), { target: { value: '9' } })
    expect(facts()[0]).toMatchObject({ reps: 10, done: true })
    fireEvent.click(screen.getByRole('button', { name: /Сохранить исправление/ }))
    expect(facts()[0]).toMatchObject({ reps: 9, done: true })
    expect(facts().filter((set: { done: boolean }) => set.done)).toHaveLength(1)
  })
  it('allows clearing an input and restores an unfinished entry without marking a fact', () => {
    const view = render(<Harness />)
    fireEvent.change(screen.getByRole('spinbutton', { name: /подход 1, повторы/ }), { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Записать подход 1 · Жим' })).toBeDisabled()
    fireEvent.change(screen.getByRole('spinbutton', { name: /подход 1, повторы/ }), { target: { value: '9' } })
    view.unmount()
    render(<Harness />)
    expect(screen.getByRole('spinbutton', { name: /подход 1, повторы/ })).toHaveValue(9)
    expect(facts()[0]).toMatchObject({ reps: null, done: false })
  })
  it('skips and restores an unperformed set without a fake completion', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Пропустить этот подход' }))
    expect(facts()[0]).toMatchObject({ skipped: true, done: false, completedAt: null })
    expect(screen.getByRole('spinbutton', { name: /подход 2, вес/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Подход 1 · пропущен · Жим' }))
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть подход' }))
    expect(facts()[0].skipped).toBe(false)
    expect(screen.getByRole('spinbutton', { name: /подход 1, вес/ })).toBeInTheDocument()
  })
})

describe('optional recommendation acceptance', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)
  it('keeps the previous fact in inputs until the recommendation is explicitly accepted', () => {
    render(<Harness />)
    expect(screen.getByRole('spinbutton', { name: /подход 1, повторы/ })).toHaveValue(10)
    const accept = screen.getByRole('button', { name: 'Попробовать: 60 кг × 11' })
    fireEvent.click(accept)
    expect(screen.getByRole('spinbutton', { name: /подход 1, повторы/ })).toHaveValue(11)
    expect(facts()[0]).toMatchObject({ done: false, reps: null })
    fireEvent.click(screen.getByRole('button', { name: 'Записать подход 1 · Жим' }))
    expect(facts()[0]).toMatchObject({ done: true, reps: 11 })
    expect(facts()[1]).toMatchObject({ done: false, reps: null, weightKg: null })
  })
})

it('does not invent a bodyweight fact from an unknown legacy load',()=>{
 localStorage.clear();render(<Harness history={{...previous,sets:previous.sets.map(set=>({...set,weightKg:null}))}}/>)
 expect(screen.getByRole('spinbutton',{name:/подход 1, вес/})).toHaveValue(null)
 expect(screen.getByRole('button',{name:'Записать подход 1 · Жим'})).toBeDisabled()
 expect(screen.getByText('Вес не задан × 10')).toBeInTheDocument()
 cleanup()
})
