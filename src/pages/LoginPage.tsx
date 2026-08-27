import { useState, type FormEvent } from 'react'
import { ArrowRight, KeyRound, Mail } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { isSupabaseConfigured } from '../lib/supabase'

type Mode = 'password' | 'magic' | 'recovery'

export function LoginPage() {
  const { signIn, sendMagicLink, sendPasswordRecovery } = useAuth()
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage(null)
    try {
      if (mode === 'password') await signIn(email, password)
      if (mode === 'magic') { await sendMagicLink(email); setMessage('Ссылка отправлена. Проверьте входящие и папку «Спам».') }
      if (mode === 'recovery') { await sendPasswordRecovery(email); setMessage('Письмо для смены пароля отправлено.') }
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Не удалось выполнить вход')
    } finally { setBusy(false) }
  }

  return <main className="auth-page">
    <section className="auth-brand"><div className="brand-mark">Д</div><p className="eyebrow">Достигатор</p><h1>Не просто планируйте.<br />Доводите.</h1><p>Цели, проекты и дисциплина в одном спокойном ритме.</p></section>
    <section className="auth-card">
      <div className="auth-icon">{mode === 'password' ? <KeyRound /> : <Mail />}</div>
      <h2>{mode === 'password' ? 'Продолжить путь' : mode === 'magic' ? 'Войти по ссылке' : 'Восстановить пароль'}</h2>
      {!isSupabaseConfigured && <p className="form-message error">Добавьте Supabase variables в `.env`.</p>}
      <form onSubmit={submit} className="stack-form">
        <label>Email<input aria-label="Email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        {mode === 'password' && <label>Пароль<input aria-label="Пароль" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
        {message && <p className="form-message" role="status">{message}</p>}
        <button className="primary-button" disabled={busy || !isSupabaseConfigured}>{busy ? 'Подождите…' : <>{mode === 'password' ? 'Войти' : 'Отправить письмо'}<ArrowRight /></>}</button>
      </form>
      <div className="auth-links">
        {mode !== 'password' && <button type="button" onClick={() => setMode('password')}>Войти с паролем</button>}
        {mode === 'password' && <><button type="button" onClick={() => setMode('magic')}>Войти по ссылке</button><button type="button" onClick={() => setMode('recovery')}>Забыли пароль?</button></>}
      </div>
    </section>
  </main>
}
