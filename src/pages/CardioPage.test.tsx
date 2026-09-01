import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { CardioPage } from './CardioPage'

describe('cardio page', () => {
  it('shows a weekly plan, intensity target and exercise instructions', () => {
    render(<MemoryRouter><CardioPage /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'Выносливость без помех силе' })).toBeInTheDocument()
    expect(screen.getByText('2–3')).toBeInTheDocument()
    expect(screen.getByText('Тренировка A')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ходьба под уклоном' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Велотренажёр' })).toBeInTheDocument()
    expect(screen.getByText(/разговорный тест/i)).toBeInTheDocument()
  })
})
