import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { useData } from './DataContext'
import { hasExistingProductData, readOnboardingStatus, writeOnboardingStatus, type OnboardingStatus } from '../lib/onboarding'

interface OnboardingValue {
  status: OnboardingStatus
  complete(): void
  skip(): void
  restart(): void
}

const OnboardingContext = createContext<OnboardingValue | null>(null)

export function OnboardingGate({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const { user } = useAuth()
  const { data, loading } = useData()
  const location = useLocation()
  const activeOwner = useRef(user?.id ?? null)
  const [resolved, setResolved] = useState<{ ownerId: string; status: OnboardingStatus } | null>(null)

  useLayoutEffect(() => { activeOwner.current = user?.id ?? null }, [user])

  useEffect(() => {
    if (!user || loading) return
    const ownerId = user.id
    if (resolved?.ownerId === ownerId) return
    const stored = readOnboardingStatus(ownerId)
    const status = stored ?? (hasExistingProductData(data) ? 'completed' : 'active')
    if (!stored) writeOnboardingStatus(ownerId, status)
    if (activeOwner.current === ownerId) setResolved({ ownerId, status })
  }, [data, loading, resolved?.ownerId, user])

  if (!user || loading || resolved?.ownerId !== user.id) return fallback

  const update = (status: OnboardingStatus) => {
    const ownerId = user.id
    if (activeOwner.current !== ownerId) return
    writeOnboardingStatus(ownerId, status)
    setResolved({ ownerId, status })
  }
  const value: OnboardingValue = {
    status: resolved.status,
    complete: () => update('completed'),
    skip: () => update('skipped'),
    restart: () => update('active'),
  }
  const isOnboardingRoute = location.pathname === '/onboarding'
  if (resolved.status === 'active' && !isOnboardingRoute) return <Navigate to="/onboarding" replace />
  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>
}

export function useOnboarding() {
  const value = useContext(OnboardingContext)
  if (!value) throw new Error('useOnboarding must be used inside OnboardingGate')
  return value
}
