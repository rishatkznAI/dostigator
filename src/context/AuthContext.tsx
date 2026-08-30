import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface AuthValue {
  user: User | null
  loading: boolean
  sessionError: string | null
  retrySession(): Promise<void>
  signIn(email: string, password: string): Promise<void>
  signUp(email: string, password: string): Promise<{ requiresEmailConfirmation: boolean }>
  sendMagicLink(email: string): Promise<void>
  sendPasswordRecovery(email: string): Promise<void>
  updateDisplayName(displayName: string): Promise<void>
  updatePassword(password: string): Promise<void>
  signOut(): Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)
const SESSION_CHECK_TIMEOUT_MS = 7_000
const SESSION_CHECK_ERROR = 'Не удалось проверить сессию. Проверьте подключение и попробуйте снова.'

function normalizeDisplayName(displayName: string) {
  return displayName.trim().replace(/\s+/g, ' ')
}

function appRedirect(path = '') {
  const base = new URL(import.meta.env.BASE_URL, window.location.origin)
  return path ? new URL(path, base).toString() : base.toString()
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const mountedRef = useRef(false)
  const userRef = useRef<User | null>(null)
  const requestRef = useRef(0)
  const authRevisionRef = useRef(0)

  const checkSession = useCallback(async () => {
    const request = ++requestRef.current
    const authRevision = authRevisionRef.current
    if (!userRef.current) setLoading(true)
    let timeoutId: number | undefined
    try {
      const result = await Promise.race([
        supabase.auth.getSession().then((response) => ({ kind: 'session' as const, response })),
        new Promise<{ kind: 'timeout' }>((resolve) => {
          timeoutId = window.setTimeout(() => resolve({ kind: 'timeout' }), SESSION_CHECK_TIMEOUT_MS)
        }),
      ])
      if (!mountedRef.current || requestRef.current !== request) return
      if (result.kind === 'timeout') throw new Error(SESSION_CHECK_ERROR)
      if (result.response.error) throw result.response.error
      // An auth event received while getSession was in flight is newer and authoritative.
      if (authRevisionRef.current === authRevision) {
        userRef.current = result.response.data.session?.user ?? null
        setUser(userRef.current)
      }
      setSessionError(null)
    } catch {
      if (mountedRef.current && requestRef.current === request) setSessionError(SESSION_CHECK_ERROR)
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
      if (mountedRef.current && requestRef.current === request) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      authRevisionRef.current += 1
      requestRef.current += 1
      userRef.current = session?.user ?? null
      setUser(userRef.current)
      setLoading(false)
      setSessionError(null)
    })
    void checkSession()
    return () => {
      mountedRef.current = false
      requestRef.current += 1
      data.subscription.unsubscribe()
    }
  }, [checkSession])

  const value = useMemo<AuthValue>(() => ({
    user,
    loading,
    sessionError,
    retrySession: checkSession,
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw new Error(error.message)
    },
    async signUp(email, password) {
      const emailRedirectTo = appRedirect()
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo } })
      if (error) throw new Error(error.message)
      return { requiresEmailConfirmation: !data.session }
    },
    async sendMagicLink(email) {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: appRedirect() },
      })
      if (error) throw new Error(error.message)
    },
    async sendPasswordRecovery(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: appRedirect('reset-password'),
      })
      if (error) throw new Error(error.message)
    },
    async updateDisplayName(displayName) {
      const normalized = normalizeDisplayName(displayName)
      if (!normalized) throw new Error('Введите ник')
      if (Array.from(normalized).length > 40) throw new Error('Ник должен содержать не больше 40 символов')
      const { data, error } = await supabase.auth.updateUser({ data: { display_name: normalized } })
      if (error) throw new Error(error.message)
      if (data.user) {
        userRef.current = data.user
        setUser(data.user)
      }
    },
    async updatePassword(password) {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw new Error(error.message)
    },
    async signOut() {
      const { error } = await supabase.auth.signOut()
      if (error) throw new Error(error.message)
    },
  }), [checkSession, loading, sessionError, user])

  return <AuthContext.Provider value={value}><div className={`auth-provider-flow ${sessionError ? 'has-session-message' : ''}`}>
    {sessionError && <section className="banner-stack auth-session-banner" aria-label="Проверка сессии"><div className="sync-banner error" role={loading ? 'status' : 'alert'} aria-live={loading ? 'polite' : 'assertive'} aria-atomic="true" aria-busy={loading}><span>{loading ? 'Повторно проверяем сессию…' : sessionError}</span><button type="button" disabled={loading} aria-busy={loading} onClick={() => void checkSession()}>{loading ? 'Проверяем…' : 'Повторить проверку'}</button></div></section>}
    <div className="auth-provider-content">{children}</div>
  </div></AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
