import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionItem } from '../types'
import { ActionRow } from './ActionRow'

const mocks = vi.hoisted(() => ({
  toggleAction: vi.fn(),
  toggleFocus: vi.fn(),
  deleteAction: vi.fn(),
  busy: false,
  focusBusy: false,
}))

vi.mock('../context/DataContext', () => ({
  useData: () => ({
    toggleAction: mocks.toggleAction,
    toggleFocus: mocks.toggleFocus,
    deleteAction: mocks.deleteAction,
    isMutating: (scope: string) => scope === 'focus' ? mocks.focusBusy : mocks.busy,
  }),
}))

const action: ActionItem = {
  id: 'action-1', user_id: 'user-a', goal_id: 'goal-1', title: 'Позвонить мастеру', status: 'todo',
  due_date: null, focus_date: null, focus_position: null, result_note: '', completed_at: null,
  created_at: '2026-08-24T08:00:00.000Z', updated_at: '2026-08-24T08:00:00.000Z',
}

describe('ActionRow mutation controls', () => {
  afterEach(cleanup)

  beforeEach(() => {
    mocks.busy = false
    mocks.focusBusy = false
    mocks.toggleAction.mockReset().mockResolvedValue(undefined)
    mocks.toggleFocus.mockReset().mockResolvedValue(undefined)
    mocks.deleteAction.mockReset().mockResolvedValue(undefined)
  })

  it('disables only the controls for an in-flight action', () => {
    mocks.busy = true
    render(<MemoryRouter><ActionRow action={action} allowDelete /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Выполнить Позвонить мастеру' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Добавить «Позвонить мастеру» в фокус' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Добавить «Позвонить мастеру» в фокус' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Удалить Позвонить мастеру' })).toBeDisabled()
  })

  it('handles a rejected action promise without an unhandled rejection', async () => {
    mocks.toggleAction.mockRejectedValue(new Error('rolled back'))
    render(<MemoryRouter><ActionRow action={action} /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Выполнить Позвонить мастеру' }))
    expect(mocks.toggleAction).toHaveBeenCalledTimes(1)
  })

  it('gives each focus toggle an action-specific accessible name', () => {
    const second = { ...action, id: 'action-2', title: 'Купить материалы' }
    render(<MemoryRouter><ActionRow action={action} /><ActionRow action={second} /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Добавить «Позвонить мастеру» в фокус' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Добавить «Купить материалы» в фокус' })).toBeInTheDocument()
  })
})
