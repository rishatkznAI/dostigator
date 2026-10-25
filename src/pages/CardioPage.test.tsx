import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { CardioPage } from './CardioPage'

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))

describe('cardio page', () => {
  it('keeps guidance out of the primary recording flow', () => {
    render(<MemoryRouter><CardioPage /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'Кардио' })).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Темп и безопасность' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: 'Интенсивность · CDC' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Темп и безопасность'))
    expect(screen.getByRole('link', { name: 'Интенсивность · CDC' })).toBeInTheDocument()
  })
})
