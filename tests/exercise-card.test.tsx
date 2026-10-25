import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseCard } from '../src/components/ExerciseCard'
import type { PreviousResult, WorkoutExerciseDraft } from '../src/types/training'

const exercise: WorkoutExerciseDraft = {
  id: 'exercise-id',
  target: '8–12',
  sortOrder: 2,
  skipped: false,
  skipReason: '',
  exercise: {
    key: 'lat_pulldown',
    name: 'Тяга верхнего блока',
    muscles: ['широчайшие', 'бицепс'],
    steps: ['Опусти плечи', 'Тяни к груди'],
    mistakes: ['Не раскачивайся'],
    youtube_url: 'https://www.youtube.com/watch?v=test',
  },
  sets: [{ id: 'set-1', setNumber: 1, weightKg: null, reps: null, rir: null, done: false, isWarmup: false, completedAt: null }],
}

const previous: PreviousResult = {
  sessionId: 'previous', finishedAt: '2026-08-20T10:00:00Z', exerciseKey: 'lat_pulldown',
  sets: [{ id: 'old-set', setNumber: 1, weightKg: 60, reps: 12, rir: 2, done: true, isWarmup: false, completedAt: '2026-08-20T10:30:00Z' }],
}

describe('exercise card', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)
  it('shows previous result and database-backed instructions', async () => {
    render(<ExerciseCard exercise={exercise} previous={previous} onRecordSet={vi.fn()} onUndoSet={vi.fn()} onSkipSet={vi.fn()} onAddSet={vi.fn()} onRemoveSet={vi.fn()} onSkip={vi.fn()} onReplace={vi.fn()} alternatives={[]} />)
    expect(screen.getAllByText(/60 кг × 12/)[0]).toBeInTheDocument()
    fireEvent.click(screen.getByText('Разминка и замена упражнения'))
    expect(screen.getByText(/Отдых: 2 мин/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Стартовые ориентиры веса' })).toHaveTextContent(/25 кг.*40 кг.*50 кг/)
    const opener = screen.getByRole('button', { name: 'Как делать' })
    opener.focus()
    fireEvent.click(opener)
    const techniqueImage = screen.getByRole('img', { name: /Техника упражнения/ })
    expect(techniqueImage.getAttribute('src')).toMatch(/^data:image\/webp;base64,/)
    expect(techniqueImage).toHaveAttribute('loading', 'lazy')
    expect(screen.getByText('широчайшие')).toBeInTheDocument()
    expect(screen.getByText('Опусти плечи')).toBeInTheDocument()
    expect(screen.getByText('Не раскачивайся')).toBeInTheDocument()
    const youtubeLink = screen.getByRole('link', { name: /YouTube/ })
    expect(youtubeLink).toHaveAttribute('href', exercise.exercise.youtube_url)

    const closeButton = screen.getByRole('button', { name: 'Закрыть' })
    expect(closeButton).toHaveFocus()
    youtubeLink.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(closeButton).toHaveFocus()
    fireEvent.click(closeButton)
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('keeps work-set comparisons aligned when a warmup is inserted', () => {
    const warmed = { ...exercise, sets: [{ ...exercise.sets[0]!, id: 'warmup', isWarmup: true }, { ...exercise.sets[0]!, setNumber: 2 }] }
    render(<ExerciseCard exercise={warmed} previous={previous} onRecordSet={vi.fn()} onUndoSet={vi.fn()} onSkipSet={vi.fn()} onAddSet={vi.fn()} onRemoveSet={vi.fn()} onSkip={vi.fn()} onReplace={vi.fn()} alternatives={[]} />)
    expect(screen.getByRole('spinbutton', { name: /разминка 1, вес кг/ })).toHaveValue(null)
    fireEvent.click(screen.getByRole('button', { name: /Подход 1 · не выполнен/ }))
    const workInput = screen.getByRole('spinbutton', { name: /подход 1, вес кг/ })
    expect(workInput).toHaveValue(60)
    const comparison = workInput.closest('.active-set')!
    expect(within(comparison as HTMLElement).getAllByText('60 кг × 12')[0]).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: /разминка 1, вес кг/ })).not.toBeInTheDocument()
  })
})
