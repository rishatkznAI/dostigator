import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CardioJournal } from '../src/components/CardioJournal'
import { getCachedCardio, getCardioQueue } from '../src/lib/cardio'

vi.mock('../src/lib/supabase', () => ({ supabase: { from: vi.fn() } }))

describe('cardio journal', () => {
  beforeEach(() => { localStorage.clear(); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false); Element.prototype.scrollIntoView = vi.fn() })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })
  it('saves, reloads and edits a cardio note without creating another session', async () => {
    const view = render(<MemoryRouter><CardioJournal userId="owner" /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Время, мин'), { target: { value: '25' } })
    fireEvent.change(screen.getByLabelText('Заметка по кардио'), { target: { value: 'Уклон 4%, комфортно' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить кардио' }))
    await waitFor(() => expect(getCachedCardio('owner')[0]?.note).toBe('Уклон 4%, комфортно'))
    const id = getCachedCardio('owner')[0]!.id
    view.unmount()
    render(<MemoryRouter><CardioJournal userId="owner" /></MemoryRouter>)
    expect(screen.getAllByText('Уклон 4%, комфортно')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: /Редактировать кардио/ }))
    expect(screen.getByLabelText('Время, мин')).toHaveValue(25)
    fireEvent.change(screen.getByLabelText('Заметка по кардио'), { target: { value: 'Уклон 6%, тяжело' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить изменения' }))
    await waitFor(() => expect(getCachedCardio('owner')[0]?.note).toBe('Уклон 6%, тяжело'))
    expect(getCardioQueue('owner')).toHaveLength(1)
    expect(getCardioQueue('owner')[0]?.id).toBe(id)
  })
})
