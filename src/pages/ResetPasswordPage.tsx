import { useRef, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

type Message = { kind: 'success' | 'error'; text: string }

function resetPasswordError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason)
  if (/session|jwt|token|expired/i.test(message)) return 'Ссылка для смены пароля устарела. Запросите новое письмо.'
  if (/same|different|new password/i.test(message)) return 'Новый пароль должен отличаться от текущего.'
  if (/password.*(short|least|characters)/i.test(message)) return 'Используйте не меньше 12 символов.'
  return 'Не удалось изменить пароль. Проверьте подключение и попробуйте ещё раз.'
}

export function ResetPasswordPage() {
  const { user, loading, updatePassword } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState<Message | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const busyRef = useRef(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busyRef.current || done) return
    if (password.length < 12) return setMessage({ kind: 'error', text: 'Используйте не меньше 12 символов.' })
    if (password !== confirm) return setMessage({ kind: 'error', text: 'Пароли не совпадают.' })
    busyRef.current = true
    setBusy(true)
    setMessage(null)
    try {
      await updatePassword(password)
      setDone(true)
      setMessage({ kind: 'success', text: 'Пароль изменён. Теперь можно продолжить работу.' })
    } catch (reason) {
      setMessage({ kind: 'error', text: resetPasswordError(reason) })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  if (!loading && !user) return <Navigate to="/login" replace />
  return <main className="auth-page compact"><section className="auth-card"><p className="eyebrow">Безопасность</p><h1>Новый пароль</h1>{done
    ? <div className="stack-form"><p className="form-message" role="status" aria-live="polite">{message?.text}</p><Link className="primary-button" to="/">Перейти в приложение</Link></div>
    : <form className="stack-form" onSubmit={submit} aria-busy={busy}><label>Новый пароль<input type="password" autoComplete="new-password" required minLength={12} disabled={busy} value={password} onChange={(event) => setPassword(event.target.value)} /></label><label>Повторите пароль<input type="password" autoComplete="new-password" required minLength={12} disabled={busy} value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>{message && <p className={`form-message ${message.kind === 'error' ? 'error' : ''}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}<button className="primary-button" disabled={busy} aria-busy={busy}>{busy ? 'Сохраняем…' : 'Сохранить пароль'}</button></form>}</section></main>
}
