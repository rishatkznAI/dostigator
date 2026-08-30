import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NutritionJournal } from '../src/components/NutritionJournal'
import type { DailyActivity, NutritionEntry } from '../src/types/training'
import { localDateKey } from '../src/lib/week'

const repositoryMocks = vi.hoisted(() => ({
  loadNutritionEntries: vi.fn(),
  loadDailyActivity: vi.fn(),
  saveNutritionEntry: vi.fn(),
  saveDailyActivity: vi.fn(),
  deleteNutritionEntry: vi.fn(),
}))

vi.mock('../src/lib/trainingRepository', () => repositoryMocks)

const meal: NutritionEntry = {
  id: 'meal-1', user_id: 'user-1', eaten_at: '2026-08-27T09:00:00Z', meal_type: 'breakfast',
  description: 'Каша и три яйца', calories: null, protein_g: 25, alcohol_units: null, created_at: '2026-08-27T09:00:00Z', updated_at: '2026-08-27T09:00:00Z',
}

const activity: DailyActivity = {
  id: 'activity-1', user_id: 'user-1', activity_date: localDateKey(new Date()), steps: 8500, note: '',
  created_at: '2026-08-27T20:00:00Z', updated_at: '2026-08-27T20:00:00Z',
}

describe('nutrition journal', () => {
  afterEach(cleanup)
  beforeEach(() => {
    repositoryMocks.loadNutritionEntries.mockResolvedValue([])
    repositoryMocks.loadDailyActivity.mockResolvedValue([])
    repositoryMocks.saveNutritionEntry.mockResolvedValue(meal)
    repositoryMocks.saveDailyActivity.mockResolvedValue(activity)
    repositoryMocks.deleteNutritionEntry.mockResolvedValue(undefined)
    repositoryMocks.saveNutritionEntry.mockImplementation(async () => meal)
  })

  it('saves a plain-language meal without requiring calories', async () => {
    repositoryMocks.loadNutritionEntries.mockResolvedValueOnce([]).mockResolvedValue([meal])
    render(<NutritionJournal />)
    await screen.findByRole('heading', { name: 'Что вы ели?' })
    fireEvent.change(screen.getByLabelText('Описание'), { target: { value: 'Каша и три яйца' } })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить приём пищи' }))

    await waitFor(() => expect(repositoryMocks.saveNutritionEntry).toHaveBeenCalledOnce())
    expect(repositoryMocks.saveNutritionEntry.mock.calls[0]?.[0]).toMatchObject({
      mealType: 'breakfast', description: 'Каша и три яйца', calories: null, proteinG: null, alcoholUnits: null,
    })
    expect(await screen.findByText('Приём пищи сохранён')).toBeInTheDocument()
    expect(screen.getByText('Каша и три яйца')).toBeInTheDocument()
  })

  it('saves daily steps using the existing activity id when present', async () => {
    repositoryMocks.loadDailyActivity.mockResolvedValue([activity])
    render(<NutritionJournal />)
    const input = await screen.findByLabelText('Шаги')
    await waitFor(() => expect(input).toHaveValue(8500))
    fireEvent.change(input, { target: { value: '9100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(repositoryMocks.saveDailyActivity).toHaveBeenCalledWith(expect.objectContaining({ id: 'activity-1', steps: 9100 })))
  })
})
