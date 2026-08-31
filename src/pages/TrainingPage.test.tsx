import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TrainingPage } from './TrainingPage'

const templates = ['A', 'B', 'C'].map((code, index) => ({
  code,
  title: `Программа ${code}`,
  sortOrder: index + 1,
  items: [{
    sortOrder: 1,
    setCount: 3,
    repTarget: '8–12',
    exercise: {
      key: `exercise-${code}`,
      name: `Упражнение ${code}`,
      muscles: ['мышцы'],
      steps: ['Выполнить'],
      mistakes: ['Не спешить'],
      youtube_url: null,
    },
  }],
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-a', email: 'fallback@example.com', user_metadata: { display_name: 'Ринат' } },
    signOut: vi.fn(),
  }),
}))
vi.mock('../hooks/useTemplates', () => ({
  useTemplates: () => ({ templates, loading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('../lib/trainingRepository', () => ({
  loadHistory: vi.fn().mockResolvedValue([]),
  loadMeasurements: vi.fn().mockResolvedValue([]),
}))
vi.mock('../lib/storage', () => ({ getActiveDraft: vi.fn(() => null) }))

describe('full training entry point', () => {
  afterEach(cleanup)

  it('shows the editable nickname, complete A/B/C program and training history navigation', async () => {
    render(<MemoryRouter><TrainingPage /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'Привет, Ринат' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'История' })).toHaveAttribute('href', '/training/history')
    expect(screen.getByRole('link', { name: 'Питание' })).toHaveAttribute('href', '/nutrition')
    expect(screen.getByRole('link', { name: 'Прогресс' })).toHaveAttribute('href', '/training/progress')
    expect(screen.getByRole('link', { name: 'Замеры' })).toHaveAttribute('href', '/training/body')
    for (const code of ['A', 'B', 'C']) {
      expect(screen.getByRole('link', { name: `Начать тренировку ${code}` })).toHaveAttribute('href', `/training/workout/${code}`)
    }
  })
})
