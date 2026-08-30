import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { TrainingPlanPage } from '../src/pages/TrainingPlanPage'

vi.mock('../src/lib/trainingRepository', () => ({
  loadNutritionEntries: vi.fn().mockResolvedValue([]),
  loadDailyActivity: vi.fn().mockResolvedValue([]),
  loadWeeklyReport: vi.fn().mockResolvedValue(null),
  saveNutritionEntry: vi.fn(),
  saveDailyActivity: vi.fn(),
  deleteNutritionEntry: vi.fn(),
}))

describe('personal recomposition plan', () => {
  it('shows nutrition targets, schedule and no-scale portions', () => {
    render(<MemoryRouter><TrainingPlanPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'План' }))

    expect(screen.getByRole('heading', { name: 'Рекомпозиция' })).toBeInTheDocument()
    expect(screen.getByText('2300–2400')).toBeInTheDocument()
    expect(screen.getByText('150–160 г')).toBeInTheDocument()
    expect(screen.getByText('Тренировка A')).toBeInTheDocument()
    expect(screen.getByText('C · дополнительно')).toBeInTheDocument()
    expect(screen.getByText('2 ладони')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Добавить вес и талию' })).toHaveAttribute('href', '/training/body')
  })
})
