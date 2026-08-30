import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signInWithOtp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({ supabase: { auth: mocks } }))

let auth: ReturnType<typeof useAuth>

function Probe() {
  const value = useAuth()
  useLayoutEffect(() => { auth = value }, [value])
  return <output>{value.loading ? 'loading' : value.user?.id ?? 'anonymous'}</output>
}

describe('AuthProvider access contract', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
    mocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
    mocks.signUp.mockResolvedValue({ data: { session: null }, error: null })
    mocks.signInWithPassword.mockResolvedValue({ error: null })
    mocks.signInWithOtp.mockResolvedValue({ error: null })
    mocks.updateUser.mockResolvedValue({ data: { user: null }, error: null })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('always leaves loading state when getSession rejects', async () => {
    mocks.getSession.mockRejectedValueOnce(new Error('auth unavailable'))
    render(<AuthProvider><Probe /></AuthProvider>)
    expect(await screen.findByText('anonymous')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось проверить сессию')
  })

  it('ends the initial loader on deadline and ignores a stale late session result', async () => {
    vi.useFakeTimers()
    let release: ((value: { data: { session: { user: { id: string } } }; error: null }) => void) | undefined
    mocks.getSession.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    render(<AuthProvider><Probe /></AuthProvider>)
    expect(screen.getByText('loading')).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(7_000) })
    expect(screen.getByText('anonymous')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Проверьте подключение и попробуйте снова')

    await act(async () => { release?.({ data: { session: { user: { id: 'late-user' } } }, error: null }); await Promise.resolve() })
    expect(screen.getByText('anonymous')).toBeInTheDocument()
  })

  it('keeps a newer auth event when the initial session request resolves later', async () => {
    let release: ((value: { data: { session: null }; error: null }) => void) | undefined
    mocks.getSession.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    render(<AuthProvider><Probe /></AuthProvider>)
    const listener = mocks.onAuthStateChange.mock.calls[0]?.[0] as ((event: string, session: { user: { id: string } } | null) => void)

    act(() => listener('SIGNED_IN', { user: { id: 'current-user' } }))
    expect(screen.getByText('current-user')).toBeInTheDocument()
    await act(async () => { release?.({ data: { session: null }, error: null }); await Promise.resolve() })
    expect(screen.getByText('current-user')).toBeInTheDocument()
  })

  it('retries the session check after a deadline error', async () => {
    vi.useFakeTimers()
    mocks.getSession.mockReturnValueOnce(new Promise(() => undefined))
    render(<AuthProvider><Probe /></AuthProvider>)
    await act(async () => { await vi.advanceTimersByTimeAsync(7_000) })
    mocks.getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'retry-user' } } }, error: null })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Повторить проверку' })); await Promise.resolve() })
    expect(screen.getByText('retry-user')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps retry feedback in one viewport flow and announces its busy state', async () => {
    mocks.getSession.mockRejectedValueOnce(new Error('auth unavailable'))
    render(<AuthProvider><Probe /></AuthProvider>)
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось проверить сессию')
    expect(document.querySelector('.auth-provider-flow.has-session-message')).toBeInTheDocument()
    expect(document.querySelector('.auth-provider-content')).toContainElement(screen.getByText('anonymous'))

    let release: ((value: { data: { session: { user: { id: string } } }; error: null }) => void) | undefined
    mocks.getSession.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    fireEvent.click(screen.getByRole('button', { name: 'Повторить проверку' }))

    const retryStatus = screen.getByText('Повторно проверяем сессию…').closest('[role="status"]')
    expect(retryStatus).not.toBeNull()
    expect(retryStatus).toHaveTextContent('Повторно проверяем сессию')
    expect(retryStatus).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Проверяем…' })).toBeDisabled()

    await act(async () => { release?.({ data: { session: { user: { id: 'retry-user' } } }, error: null }); await Promise.resolve() })
    expect(screen.getByText('retry-user')).toBeInTheDocument()
    expect(document.querySelector('.auth-provider-flow.has-session-message')).not.toBeInTheDocument()
  })

  it('uses the fixed current origin for signup confirmation and reports confirmation requirement', async () => {
    render(<AuthProvider><Probe /></AuthProvider>)
    await screen.findByText('anonymous')
    let result: { requiresEmailConfirmation: boolean } | undefined
    await act(async () => { result = await auth.signUp('new@example.com', 'strong-password') })

    expect(mocks.signUp).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'strong-password',
      options: { emailRedirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).toString() },
    })
    expect(result).toEqual({ requiresEmailConfirmation: true })
  })

  it('reports no confirmation wait when signup immediately returns a session', async () => {
    mocks.signUp.mockResolvedValueOnce({ data: { session: { user: { id: 'new-user' } } }, error: null })
    render(<AuthProvider><Probe /></AuthProvider>)
    await screen.findByText('anonymous')
    await expect(auth.signUp('new@example.com', 'strong-password')).resolves.toEqual({ requiresEmailConfirmation: false })
  })

  it('keeps magic-link login for existing users and fixes its redirect to this origin', async () => {
    render(<AuthProvider><Probe /></AuthProvider>)
    await screen.findByText('anonymous')
    await auth.sendMagicLink('existing@example.com')
    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: 'existing@example.com',
      options: { shouldCreateUser: false, emailRedirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).toString() },
    })
  })

  it('normalizes and immediately exposes an updated display name', async () => {
    const currentUser = { id: 'user-a', email: 'a@example.com', user_metadata: {} }
    const updatedUser = { ...currentUser, user_metadata: { display_name: 'Ришат KZN' } }
    mocks.getSession.mockResolvedValueOnce({ data: { session: { user: currentUser } }, error: null })
    mocks.updateUser.mockResolvedValueOnce({ data: { user: updatedUser }, error: null })
    render(<AuthProvider><Probe /></AuthProvider>)
    await screen.findByText('user-a')

    await act(async () => { await auth.updateDisplayName('  Ришат   KZN  ') })

    expect(mocks.updateUser).toHaveBeenCalledWith({ data: { display_name: 'Ришат KZN' } })
    expect(auth.user?.user_metadata.display_name).toBe('Ришат KZN')
  })

  it('rejects an empty display name before contacting Supabase', async () => {
    render(<AuthProvider><Probe /></AuthProvider>)
    await screen.findByText('anonymous')

    await expect(auth.updateDisplayName('   ')).rejects.toThrow('Введите ник')
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })
})
