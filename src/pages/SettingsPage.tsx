import { Download, KeyRound, LogOut, RefreshCw, ShieldCheck, Upload } from 'lucide-react'
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { PageHeader } from '../components/PageHeader'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { importBackup, isBackup, makeBackup } from '../lib/repository'

export function SettingsPage() {
  const { user, updatePassword, signOut } = useAuth()
  const { data, pending, refresh } = useData()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const changePassword = async (event: FormEvent) => {
    event.preventDefault(); setMessage(null)
    if (password.length < 12) return setMessage('Новый пароль должен содержать не меньше 12 символов')
    if (password !== confirm) return setMessage('Пароли не совпадают')
    try { await updatePassword(password); setPassword(''); setConfirm(''); setMessage('Пароль изменён') }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Не удалось изменить пароль') }
  }

  const downloadBackup = () => {
    const blob = new Blob([JSON.stringify(makeBackup(data), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = `dostigator-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click()
    URL.revokeObjectURL(url)
  }

  const restore = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setMessage(null)
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!isBackup(parsed)) throw new Error('Это не резервная копия Достигатора')
      await importBackup(parsed); await refresh(); setMessage('Данные объединены с текущими')
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Не удалось восстановить данные') }
    finally { event.target.value = '' }
  }

  return <div className="page settings-page">
    <PageHeader eyebrow="Аккаунт" title="Профиль" text={user?.email ?? ''} />
    <section className="settings-card"><div className="settings-title"><KeyRound /><div><p className="eyebrow">Безопасность</p><h2>Изменить пароль</h2></div></div><form className="stack-form" onSubmit={changePassword}><label>Новый пароль<input type="password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} /></label><label>Повторите пароль<input type="password" minLength={12} value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label><button className="primary-button" disabled={!password}>Изменить пароль</button></form></section>
    <section className="settings-card"><div className="settings-title"><ShieldCheck /><div><p className="eyebrow">Ваши данные</p><h2>Резервная копия</h2></div></div><p>JSON содержит цели, действия, привычки и недельные обзоры. Восстановление объединяет записи и ничего не удаляет.</p><div className="button-row"><button className="secondary-button" onClick={downloadBackup}><Download />Скачать JSON</button><button className="secondary-button" onClick={() => fileInput.current?.click()}><Upload />Восстановить</button><input ref={fileInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => void restore(event)} /></div></section>
    <section className="settings-card compact-card"><div><RefreshCw /><span><strong>Синхронизация</strong><small>{pending ? `Ожидают отправки: ${pending}` : 'Все изменения сохранены'}</small></span></div><button className="secondary-button" onClick={() => void refresh()}>Обновить</button></section>
    {message && <p className="form-message settings-message" role="status">{message}</p>}
    <button className="logout-button" onClick={() => void signOut()}><LogOut /><span><strong>Выйти</strong><small>Данные в Supabase сохранятся</small></span></button>
    <p className="version">Достигатор · версия 0.1</p>
  </div>
}
