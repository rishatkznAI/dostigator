import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppData } from '../types'
import { writeOnboardingStatus } from '../lib/onboarding'
import { OnboardingGate, useOnboarding } from './OnboardingContext'

const empty: AppData = { areas: [], goals: [], actions: [], habits: [], checkins: [], reviews: [] }
const withGoal: AppData = { ...empty, goals: [{ id: 'goal-1', user_id: 'user-a', area_id: null, title: 'Цель', description: '', why: '', kind: 'goal', status: 'active', progress: 0, target_date: null, completed_at: null, created_at: 'now', updated_at: 'now' }] }

const mocks = vi.hoisted(() => ({
  user: { id: 'user-a' } as { id: string } | null,
  data: null as AppData | null,
  loading: false,
}))

vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('./DataContext', () => ({ useData: () => ({ data: mocks.data ?? empty, loading: mocks.loading }) }))

function GateLayout() {
  return <OnboardingGate fallback={<p>Загрузка владельца</p>}><Outlet /></OnboardingGate>
}

function HomeProbe() {
  const { restart } = useOnboarding()
  return <div><p>Главный экран</p><button onClick={restart}>Начать знакомство снова</button></div>
}

function OnboardingProbe() {
  const { skip, complete } = useOnboarding()
  const navigate = useNavigate()
  return <div><p>Экран знакомства</p><button onClick={() => { skip(); navigate('/') }}>Пропустить</button><button onClick={() => { complete(); navigate('/') }}>Завершить</button></div>
}

function renderGate(initialEntry = '/') {
  return render(<MemoryRouter initialEntries={[initialEntry]}><Routes><Route element={<GateLayout />}><Route index element={<HomeProbe />} /><Route path="onboarding" element={<OnboardingProbe />} /></Route></Routes></MemoryRouter>)
}

describe('owner-scoped onboarding gate', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.user = { id: 'user-a' }
    mocks.data = empty
    mocks.loading = false
  })

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

  it('redirects a resolved new empty account into onboarding', async () => {
    renderGate()
    expect(await screen.findByText('Экран знакомства')).toBeInTheDocument()
    expect(screen.queryByText('Главный экран')).not.toBeInTheDocument()
    expect(localStorage.getItem('dostigator:onboarding:v1:user-a')).toBe('active')
  })

  it('does not force an existing account with product data through onboarding', async () => {
    mocks.data = withGoal
    renderGate()
    expect(await screen.findByText('Главный экран')).toBeInTheDocument()
    expect(localStorage.getItem('dostigator:onboarding:v1:user-a')).toBe('completed')
  })

  it.each(['completed', 'skipped'] as const)('persists %s across reload for the same owner', async (status) => {
    writeOnboardingStatus('user-a', status)
    renderGate()
    expect(await screen.findByText('Главный экран')).toBeInTheDocument()
    expect(screen.queryByText('Экран знакомства')).not.toBeInTheDocument()
  })

  it('supports skip and resume without losing owner scope', async () => {
    renderGate('/onboarding')
    await userEvent.click(await screen.findByRole('button', { name: 'Пропустить' }))
    await waitFor(() => expect(screen.getByText('Главный экран')).toBeInTheDocument())
    expect(localStorage.getItem('dostigator:onboarding:v1:user-a')).toBe('skipped')
    await userEvent.click(screen.getByRole('button', { name: 'Начать знакомство снова' }))
    expect(await screen.findByText('Экран знакомства')).toBeInTheDocument()
    expect(localStorage.getItem('dostigator:onboarding:v1:user-a')).toBe('active')
  })

  it('keeps completion after a real complete action and remount', async () => {
    writeOnboardingStatus('user-a', 'active')
    const first = renderGate('/onboarding')
    await userEvent.click(await screen.findByRole('button', { name: 'Завершить' }))
    expect(await screen.findByText('Главный экран')).toBeInTheDocument()
    expect(localStorage.getItem('dostigator:onboarding:v1:user-a')).toBe('completed')
    first.unmount()

    renderGate()
    expect(await screen.findByText('Главный экран')).toBeInTheDocument()
    expect(screen.queryByText('Экран знакомства')).not.toBeInTheDocument()
  })

  it('shows only a loader before owner data resolves, then the correct flow', async () => {
    mocks.loading = true
    const view = renderGate()
    expect(screen.getByText('Загрузка владельца')).toBeInTheDocument()
    expect(screen.queryByText('Экран знакомства')).not.toBeInTheDocument()
    expect(screen.queryByText('Главный экран')).not.toBeInTheDocument()

    mocks.loading = false
    view.rerender(<MemoryRouter initialEntries={['/']}><Routes><Route element={<GateLayout />}><Route index element={<HomeProbe />} /><Route path="onboarding" element={<OnboardingProbe />} /></Route></Routes></MemoryRouter>)
    expect(await screen.findByText('Экран знакомства')).toBeInTheDocument()
  })

  it('keeps in-memory active status through optimistic data and rollback when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota exceeded', 'QuotaExceededError') })
    const view = renderGate('/onboarding')
    expect(await screen.findByText('Экран знакомства')).toBeInTheDocument()

    mocks.data = withGoal
    view.rerender(<MemoryRouter initialEntries={['/onboarding']}><Routes><Route element={<GateLayout />}><Route index element={<HomeProbe />} /><Route path="onboarding" element={<OnboardingProbe />} /></Route></Routes></MemoryRouter>)
    expect(screen.getByText('Экран знакомства')).toBeInTheDocument()
    expect(screen.queryByText('Главный экран')).not.toBeInTheDocument()

    mocks.data = empty
    view.rerender(<MemoryRouter initialEntries={['/onboarding']}><Routes><Route element={<GateLayout />}><Route index element={<HomeProbe />} /><Route path="onboarding" element={<OnboardingProbe />} /></Route></Routes></MemoryRouter>)
    expect(screen.getByText('Экран знакомства')).toBeInTheDocument()
    expect(screen.queryByText('Главный экран')).not.toBeInTheDocument()
  })

  it('never renders account A flow during a direct switch to account B', async () => {
    writeOnboardingStatus('user-a', 'completed')
    writeOnboardingStatus('user-b', 'active')
    mocks.data = withGoal
    const view = renderGate()
    expect(await screen.findByText('Главный экран')).toBeInTheDocument()

    mocks.user = { id: 'user-b' }
    mocks.data = empty
    mocks.loading = true
    view.rerender(<MemoryRouter initialEntries={['/']}><Routes><Route element={<GateLayout />}><Route index element={<HomeProbe />} /><Route path="onboarding" element={<OnboardingProbe />} /></Route></Routes></MemoryRouter>)
    expect(screen.getByText('Загрузка владельца')).toBeInTheDocument()
    expect(screen.queryByText('Главный экран')).not.toBeInTheDocument()

    mocks.loading = false
    view.rerender(<MemoryRouter initialEntries={['/']}><Routes><Route element={<GateLayout />}><Route index element={<HomeProbe />} /><Route path="onboarding" element={<OnboardingProbe />} /></Route></Routes></MemoryRouter>)
    expect(await screen.findByText('Экран знакомства')).toBeInTheDocument()
    expect(localStorage.getItem('dostigator:onboarding:v1:user-a')).toBe('completed')
  })
})
