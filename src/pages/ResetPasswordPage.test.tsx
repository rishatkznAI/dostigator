import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResetPasswordPage } from './ResetPasswordPage'

const mocks = vi.hoisted(() => ({
  updatePassword: vi.fn(),
  user: { id: 'user-a' },
  loading: false,
}))

vi.mock('../context/AuthContext', () => ({ useAuth: () => mocks }))

function renderPage() {
  return render(<MemoryRouter><ResetPasswordPage /></MemoryRouter>)
}

describe('ResetPasswordPage', () => {
  beforeEach(() => mocks.updatePassword.mockReset().mockResolvedValue(undefined))
  afterEach(cleanup)

  it('synchronously blocks a rapid double submit and exposes the busy state', async () => {
    let release: (() => void) | undefined
    mocks.updatePassword.mockReturnValue(new Promise<void>((resolve) => { release = resolve }))
    renderPage()
    const password = 'a-strong-password'
    await userEvent.type(screen.getByLabelText('Новый пароль'), password)
    await userEvent.type(screen.getByLabelText('Повторите пароль'), password)
    const form = screen.getByRole('button', { name: 'Сохранить пароль' }).closest('form') as HTMLFormElement

    fireEvent.submit(form)
    fireEvent.submit(form)

    expect(mocks.updatePassword).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Сохраняем…' })).toBeDisabled()
    expect(form).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByLabelText('Новый пароль')).toBeDisabled()

    await act(async () => { release?.() })
    expect(await screen.findByRole('status')).toHaveTextContent('Пароль изменён')
    expect(screen.getByRole('link', { name: 'Перейти в приложение' })).toBeInTheDocument()
  })

  it('keeps entered values and a stable Russian alert after an update failure', async () => {
    mocks.updatePassword.mockRejectedValueOnce(new Error('network request failed'))
    renderPage()
    const password = 'a-strong-password'
    const passwordInput = screen.getByLabelText('Новый пароль')
    const confirmationInput = screen.getByLabelText('Повторите пароль')
    await userEvent.type(passwordInput, password)
    await userEvent.type(confirmationInput, password)
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить пароль' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Проверьте подключение')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(passwordInput).toHaveValue(password)
    expect(confirmationInput).toHaveValue(password)
    expect(screen.getByRole('button', { name: 'Сохранить пароль' })).toBeEnabled()
  })
})
