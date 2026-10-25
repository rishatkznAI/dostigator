import { useRef, useState, type FormEvent } from 'react'
import { ArrowRight, KeyRound, Mail } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { isSupabaseConfigured } from '../lib/supabase'
import { buildInfo } from '../lib/build-info'

type Mode = 'password' | 'signup' | 'magic' | 'recovery'
type Message = { kind: 'success' | 'error'; text: string }

function friendlyAuthError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason)
  if (/invalid login credentials/i.test(message)) return 'Неверный email или пароль.'
  if (/already registered|already been registered|user already exists/i.test(message)) return 'Аккаунт с таким email уже существует.'
  if (/password.*(short|least|characters)/i.test(message)) return 'Пароль должен содержать не менее 8 символов.'
  if (/rate limit|too many/i.test(message)) return 'Слишком много попыток. Подождите немного и повторите.'
  return 'Не удалось выполнить запрос. Проверьте данные и попробуйте ещё раз.'
}

export function LoginPage() {
  const { signIn, signUp, sendMagicLink, sendPasswordRecovery } = useAuth()
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [message, setMessage] = useState<Message | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true); setMessage(null)
    try {
      if (mode === 'password') await signIn(email, password)
      if (mode === 'signup') {
        const result = await signUp(email, password)
        if (result.requiresEmailConfirmation) setMessage({ kind: 'success', text: 'Аккаунт создан. Подтвердите email по ссылке из письма.' })
      }
      if (mode === 'magic') { await sendMagicLink(email); setMessage({ kind: 'success', text: 'Ссылка отправлена. Проверьте входящие и папку «Спам».' }) }
      if (mode === 'recovery') { await sendPasswordRecovery(email); setMessage({ kind: 'success', text: 'Письмо для смены пароля отправлено.' }) }
    } catch (reason) {
      setMessage({ kind: 'error', text: friendlyAuthError(reason) })
    } finally { busyRef.current = false; setBusy(false) }
  }

  const changeMode = (next: Mode) => {
    if (busyRef.current) return
    setMode(next)
    setMessage(null)
  }

  return <main className="auth-page">
    <section className="auth-brand"><div className="brand-mark">Д</div><p className="eyebrow">Достигатор</p><h1>Не просто планируйте.<br />Доводите.</h1><p>Цели, проекты и дисциплина в одном спокойном ритме.</p></section>
    <section className="auth-card">
      <div className="auth-icon">{mode === 'password' || mode === 'signup' ? <KeyRound /> : <Mail />}</div>
      <h2>{mode === 'password' ? 'Продолжить путь' : mode === 'signup' ? 'Создать аккаунт' : mode === 'magic' ? 'Войти по ссылке' : 'Восстановить пароль'}</h2>
      {mode === 'signup' && <p className="auth-hint">После регистрации начнём с одной цели и первого действия — без пустого сложного интерфейса.</p>}
      {!isSupabaseConfigured && <p className="form-message error">Добавьте Supabase variables в `.env`.</p>}
      <form onSubmit={submit} className="stack-form">
        <label>Email<input aria-label="Email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        {(mode === 'password' || mode === 'signup') && <label>Пароль<input aria-label="Пароль" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={mode === 'signup' ? 8 : undefined} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
        {message && <p className={`form-message ${message.kind === 'error' ? 'error' : ''}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
        <button className="primary-button" disabled={busy || !isSupabaseConfigured} aria-busy={busy}>{busy ? 'Подождите…' : <>{mode === 'password' ? 'Войти' : mode === 'signup' ? 'Создать аккаунт' : 'Отправить письмо'}<ArrowRight /></>}</button>
      </form>
      <div className="auth-links">
        {mode !== 'password' && <button type="button" disabled={busy} onClick={() => changeMode('password')}>Войти с паролем</button>}
        {mode === 'password' && <><button type="button" disabled={busy} onClick={() => changeMode('signup')}>Создать аккаунт</button><button type="button" disabled={busy} onClick={() => changeMode('magic')}>Войти по ссылке</button><button type="button" disabled={busy} onClick={() => changeMode('recovery')}>Забыли пароль?</button></>}
      </div>
      <p className="version auth-version">Достигатор · версия {buildInfo.version}<br />Сборка {buildInfo.commit === 'local' ? 'локальная' : buildInfo.commit.slice(0, 7)}</p>
    </section>
  </main>
}
