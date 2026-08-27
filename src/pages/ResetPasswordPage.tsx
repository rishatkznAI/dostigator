import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function ResetPasswordPage() {
  const { user, loading, updatePassword } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (password.length < 12) return setMessage('Используйте не меньше 12 символов')
    if (password !== confirm) return setMessage('Пароли не совпадают')
    try { await updatePassword(password); setDone(true) } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Не удалось изменить пароль') }
  }
  if (done) return <Navigate to="/" replace />
  if (!loading && !user) return <Navigate to="/login" replace />
  return <main className="auth-page compact"><section className="auth-card"><p className="eyebrow">Безопасность</p><h1>Новый пароль</h1><form className="stack-form" onSubmit={submit}><label>Новый пароль<input type="password" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} /></label><label>Повторите пароль<input type="password" required minLength={12} value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>{message && <p className="form-message" role="alert">{message}</p>}<button className="primary-button">Сохранить пароль</button></form></section></main>
}
