import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkoutSyncConflicts } from '../src/components/WorkoutSyncConflicts'
import { createWorkoutDraft } from '../src/lib/workout'
import { programV21Templates } from '../src/lib/program-v21'
import { storeWorkoutConflict } from '../src/lib/workout-conflicts'

describe('mobile workout UX regression', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)

  const seedConflict = () => {
    const a = createWorkoutDraft(programV21Templates[0]!, 'mobile-owner')
    const b = createWorkoutDraft(programV21Templates[1]!, 'mobile-owner')
    storeWorkoutConflict(b, JSON.stringify({
      session: { id: b.id, revision: 1, updated_at: b.updatedAt, finished_at: null, title: b.title },
      exercises: [], sets: [],
    }))
    return { a, b }
  }

  it('keeps conflict B out of the active workout A while preserving the recovery link', () => {
    const { a } = seedConflict()
    render(<MemoryRouter><WorkoutSyncConflicts userId="mobile-owner" currentWorkoutId={a.id} /></MemoryRouter>)
    expect(screen.getByRole('status')).toHaveTextContent('Другие конфликты синхронизации: 1')
    expect(screen.getByRole('link', { name: 'Открыть историю' })).toHaveAttribute('href', '/training/history')
    expect(screen.queryByRole('region', { name: 'Конфликт силовой тренировки' })).not.toBeInTheDocument()
  })

  it('shows one compact, expandable conflict card with all actions stacked inside it', () => {
    seedConflict()
    render(<MemoryRouter><WorkoutSyncConflicts userId="mobile-owner" /></MemoryRouter>)
    const card = screen.getByRole('region', { name: 'Конфликт силовой тренировки' })
    expect(card.classList.contains('error-card')).toBe(false)
    expect(card.classList.contains('workout-conflict')).toBe(true)
    const details = card.querySelector('details')
    expect(details).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('Сравнить версии и решить конфликт'))
    expect(details).toHaveAttribute('open')
    expect(screen.getByText('Моя версия · на устройстве')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить мою версию' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Оставить серверную версию' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Скачать резервную копию' })).toBeInTheDocument()
  })

  it('forces two stacked comparison columns to become one on a phone', () => {
    const css = readFileSync('src/training.css', 'utf8')
    expect(css).toMatch(/@media\s*\(max-width:\s*540px\)[\s\S]*?\.workout-conflict-versions\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/)
    const globalCss = readFileSync('src/styles.css', 'utf8')
    expect(globalCss).toContain('@media (min-width: 361px) and (max-width: 430px)')
  })
})
