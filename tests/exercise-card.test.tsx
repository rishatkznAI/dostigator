import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
  it('shows previous result and database-backed instructions', () => {
    render(<ExerciseCard exercise={exercise} previous={previous} onSetChange={vi.fn()} onToggleDone={vi.fn()} onAddSet={vi.fn()} onRemoveSet={vi.fn()} onSkip={vi.fn()} onReplace={vi.fn()} alternatives={[]} />)
    expect(screen.getByText(/60 кг × 12/)).toBeInTheDocument()
    expect(screen.getByText(/отдых 2 мин/)).toBeInTheDocument()
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
    expect(opener).toHaveFocus()
  })
})
