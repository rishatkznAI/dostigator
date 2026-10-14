import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ExerciseCard } from '../src/components/ExerciseCard'
import { EffortPicker } from '../src/components/EffortPicker'
import { applySetEntry, toggleSetAndPrepareNext } from '../src/lib/set-logging'
import type { PreviousResult, WorkoutExerciseDraft } from '../src/types/training'

const exercise: WorkoutExerciseDraft = { id: 'exercise', target: '8–12', sortOrder: 1, skipped: false, skipReason: '', exercise: { key: 'press', name: 'Жим', muscles: [], steps: [], mistakes: [], youtube_url: null }, sets: [1, 2, 3].map((number) => ({ id: `set-${number}`, setNumber: number, weightKg: null, reps: null, rir: null, done: false, isWarmup: false, completedAt: null })) }
const previous: PreviousResult = { sessionId: 'old', finishedAt: '2026-10-12T10:00:00Z', exerciseKey: 'press', sets: exercise.sets.map((set) => ({ ...set, weightKg: 60, reps: 10, rir: 2, done: true })) }

function CoachHarness() {
  const [current, setCurrent] = useState(exercise)
  return <ExerciseCard exercise={current} previous={previous} onSetChange={(setId, field, value) => setCurrent((state) => ({ ...state, sets: state.sets.map((set) => set.id === setId ? { ...set, [field]: value, done: false, completedAt: null } : set) }))} onApplyValues={(id, values) => setCurrent((state) => applySetEntry(state, id, values))} onToggleDone={(set) => setCurrent((state) => toggleSetAndPrepareNext(state, set.id, false))} onAddSet={() => undefined} onRemoveSet={() => undefined} onSkip={() => undefined} onReplace={() => undefined} alternatives={[]} />
}

describe('guided workout entry', () => {
  afterEach(cleanup)
  it('shows one editor, records three planned sets in order and asks for effort on every set', () => {
    render(<CoachHarness />)
    expect(screen.getAllByRole('spinbutton')).toHaveLength(2)
    expect(screen.getByText(/Рабочие подходы: 0 из 3/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Как в прошлый раз' }))
    expect(screen.getByRole('spinbutton', { name: /подход 1, вес/ })).toHaveValue(60)
    expect(screen.getByRole('button', { name: 'Записать подход 1' })).toBeDisabled()
    for (const number of [1, 2, 3]) {
      expect(screen.getByRole('spinbutton', { name: new RegExp(`подход ${number}, вес`) })).toHaveValue(60)
      expect(screen.getByRole('radio', { name: 'RIR 2: Ещё 2' })).not.toBeChecked()
      fireEvent.click(screen.getByRole('radio', { name: 'RIR 2: Ещё 2' }))
      fireEvent.click(screen.getByRole('button', { name: `Записать подход ${number}` }))
    }
    expect(screen.getByText(/Рабочие подходы: 3 из 3/)).toBeInTheDocument()
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0)
    expect(screen.getByText('Упражнение выполнено')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Рабочий подход 2 из 3/ }))
    fireEvent.change(screen.getByRole('spinbutton', { name: /подход 2, повторы/ }), { target: { value: '9' } })
    expect(screen.getByText(/Рабочие подходы: 2 из 3/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Записать подход 2' })).toBeEnabled()
  })
  it('offers a goal as a draft and allows changing actual repetitions without a keyboard', () => {
    render(<CoachHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Подставить цель' }))
    expect(screen.getByRole('spinbutton', { name: /подход 1, повторы/ })).toHaveValue(11)
    fireEvent.click(screen.getByRole('button', { name: 'Уменьшить повторы на 1' }))
    expect(screen.getByRole('spinbutton', { name: /подход 1, повторы/ })).toHaveValue(10)
    expect(screen.getByText(/Рабочие подходы: 0 из 3/)).toBeInTheDocument()
  })
})

describe('cardio effort guidance', () => {
  afterEach(cleanup)
  it('explains breathing for the selected score and permits leaving the rating unset', () => {
    function EffortHarness() {
      const [value, setValue] = useState<number | null>(null)
      return <EffortPicker value={value} onChange={setValue} />
    }
    render(<EffortHarness />)
    expect(screen.getByRole('status')).toHaveTextContent('Выбери ощущение')
    fireEvent.click(screen.getByRole('radio', { name: '6 из 10 — Умеренно' }))
    expect(screen.getByRole('status')).toHaveTextContent('6/10 · Умеренно')
    expect(screen.getByRole('status')).toHaveTextContent('петь уже трудно')
    fireEvent.click(screen.getByRole('radio', { name: '8 из 10 — Тяжело' }))
    expect(screen.getByRole('status')).toHaveTextContent('пауза на вдох')
    fireEvent.click(screen.getByRole('button', { name: 'Не оценивал' }))
    expect(screen.getByRole('radio', { name: '8 из 10 — Тяжело' })).not.toBeChecked()
  })
})
