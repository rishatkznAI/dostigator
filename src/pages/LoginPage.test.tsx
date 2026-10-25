import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage'
import { buildInfo } from '../lib/build-info'

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  sendMagicLink: vi.fn(),
  sendPasswordRecovery: vi.fn(),
}))

vi.mock('../context/AuthContext', () => ({ useAuth: () => mocks }))
vi.mock('../lib/supabase', () => ({ isSupabaseConfigured: true }))

describe('LoginPage open registration', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset().mockResolvedValue(undefined))
    mocks.signUp.mockResolvedValue({ requiresEmailConfirmation: true })
  })

  afterEach(cleanup)

  it('shows the actual bundled version before the user signs in', () => {
    render(<LoginPage />)
    expect(screen.getByText(`Достигатор · версия ${buildInfo.version}`, { exact: false })).toHaveTextContent(`Сборка ${buildInfo.commit === 'local' ? 'локальная' : buildInfo.commit.slice(0, 7)}`)
  })

  it('keeps the existing password-login path available', async () => {
    render(<LoginPage />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Email' }), 'existing@example.com')
    await userEvent.type(screen.getByLabelText('Пароль'), 'strong-password')
    await userEvent.click(screen.getByRole('button', { name: 'Войти' }))
    expect(mocks.signIn).toHaveBeenCalledWith('existing@example.com', 'strong-password')
  })

  it('exposes signup and keeps exactly one Russian alert with entered values on error', async () => {
    mocks.signUp.mockRejectedValueOnce(new Error('User already registered'))
    render(<LoginPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }))
    const email = screen.getByRole('textbox', { name: 'Email' })
    const password = screen.getByLabelText('Пароль')
    await userEvent.type(email, 'used@example.com')
    await userEvent.type(password, 'strong-password')
    await userEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Аккаунт с таким email уже существует')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(email).toHaveValue('used@example.com')
    expect(password).toHaveValue('strong-password')
  })

  it('blocks double submit and mode changes until signup resolves', async () => {
    let release: ((value: { requiresEmailConfirmation: boolean }) => void) | undefined
    mocks.signUp.mockReturnValue(new Promise((resolve) => { release = resolve }))
    render(<LoginPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Email' }), 'new@example.com')
    await userEvent.type(screen.getByLabelText('Пароль'), 'strong-password')
    const submit = screen.getByRole('button', { name: 'Создать аккаунт' })
    await userEvent.click(submit)

    expect(screen.getByRole('button', { name: 'Подождите…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Войти с паролем' })).toBeDisabled()
    expect(mocks.signUp).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Подождите…' }))
    expect(mocks.signUp).toHaveBeenCalledTimes(1)

    await act(async () => { release?.({ requiresEmailConfirmation: true }) })
    expect(await screen.findByRole('status')).toHaveTextContent('Подтвердите email')
  })

  it('keeps existing-user magic links non-registering at the UI contract level', async () => {
    render(<LoginPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Войти по ссылке' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Email' }), 'existing@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Отправить письмо' }))
    expect(mocks.sendMagicLink).toHaveBeenCalledWith('existing@example.com')
    expect(await screen.findByRole('status')).toHaveTextContent('Ссылка отправлена')
  })
})
