import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { SpaPage } from './SpaPage'

describe('spa page', () => {
  it('shows the recovery sequence, spa zones and safety guidance', () => {
    render(<MemoryRouter><SpaPage /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'Расслабление, а не ещё одна нагрузка' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Порядок действий' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Сауна' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Джакузи' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Ледяная ванна/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Не заходи в тепло через силу' })).toBeInTheDocument()
  })
})
