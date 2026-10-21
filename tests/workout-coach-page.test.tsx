import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkoutPage } from '../src/pages/WorkoutPage'
import { getActiveDraft, saveActiveDraft, getSyncQueue } from '../src/lib/storage'
import { createWorkoutDraft } from '../src/lib/workout'
import type { PreviousResult, WorkoutTemplate } from '../src/types/training'

const template: WorkoutTemplate = { code: 'A', title: 'Программа A', sortOrder: 1, items: [1, 2].map((position) => ({ exercise: { key: `press-${position}`, name: `Жим ${position}`, muscles: [], steps: [], mistakes: [], youtube_url: null }, sortOrder: position, setCount: 3, repTarget: '8–12' })) }
vi.mock('../src/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'coach-owner' } }) }))
vi.mock('../src/hooks/useTemplates', () => ({ useTemplates: () => ({ templates: [template], loading: false, error: null }) }))
vi.mock('../src/lib/trainingRepository', () => ({
  loadExerciseLibrary: vi.fn().mockResolvedValue([]),
  loadPreviousResults: vi.fn(async () => new Map(template.items.map((item) => [item.exercise.key, { sessionId: 'old', finishedAt: '2026-10-12T10:00:00Z', exerciseKey: item.exercise.key, sets: [1, 2, 3].map((number) => ({ id: `old-${number}`, setNumber: number, weightKg: 60, reps: 10, rir: 2, done: true, isWarmup: false, completedAt: null })) } satisfies PreviousResult]))),
  syncWorkoutDraft: vi.fn().mockResolvedValue(undefined),
  deleteWorkoutSession: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../src/lib/rest-alert', () => ({ primeRestAlert: vi.fn(), notifyRestComplete: vi.fn() }))

describe('workout coach persistence', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    localStorage.clear()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const draft = createWorkoutDraft(template, 'coach-owner')
    draft.readiness = { sleep: 3, energy: 3, stress: 3, discomfort: false, note: '', mode: 'normal' }
    saveActiveDraft(draft)
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })
  it('persists the fact and next draft offline while showing only the current exercise editor', async () => {
    render(<MemoryRouter initialEntries={['/training/workout/A']}><Routes><Route path="/training/workout/:code" element={<WorkoutPage />} /><Route path="/training/history" element={<p>История после сохранения</p>} /></Routes></MemoryRouter>)
    await screen.findByRole('button', { name: 'Как в прошлый раз' })
    expect(screen.getAllByRole('spinbutton')).toHaveLength(2)
    expect(screen.getAllByRole('spinbutton')[0]).toHaveAttribute('aria-label', expect.stringContaining('Жим 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Как в прошлый раз' }))
    fireEvent.click(screen.getByRole('button', { name: 'Записать подход 1' }))
    await waitFor(() => expect(getActiveDraft('coach-owner')?.exercises[0]?.sets[0]?.done).toBe(true))
    expect(getActiveDraft('coach-owner')?.exercises[0]?.sets[1]).toMatchObject({ weightKg: 60, reps: 10, done: false, rir: null })
    expect(getActiveDraft('coach-owner')?.exercises[1]?.sets.every((set) => !set.done && set.weightKg === null)).toBe(true)
    expect(screen.getByRole('button', { name: 'Записать подход 2' })).toBeEnabled()
    expect(screen.getByText('Сначала восстанови дыхание')).toBeInTheDocument()
    expect(getActiveDraft('coach-owner')?.exercises[0]?.sets[0]?.rir).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: /Рабочий подход 3 из 3/ })[0]!)
    expect(screen.getByRole('button', { name: 'Записать подход 3' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'К текущему упражнению' }))
    await screen.findByRole('button', { name: 'Записать подход 2' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Пропустить' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: /Не хватает времени/ }))
    await waitFor(() => expect(getActiveDraft('coach-owner')?.exercises[0]?.skipped).toBe(true))
    expect(getActiveDraft('coach-owner')?.exercises[0]?.sets[0]?.done).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Перейти к итогу' }))
    expect(screen.getByRole('button', { name: 'Сохранить неполную тренировку' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться к тренировке' }))
    expect(getActiveDraft('coach-owner')?.exercises[0]?.sets[0]?.done).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Перейти к итогу' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить неполную тренировку' }))
    await screen.findByText('История после сохранения')
    expect(getActiveDraft('coach-owner')).toBeNull()
    expect(getSyncQueue('coach-owner')[0]?.exercises[0]?.sets[0]).toMatchObject({ done: true, rir: null, weightKg: 60, reps: 10 })
  })
})
