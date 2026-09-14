import { Download, History, KeyRound, LogOut, RefreshCw, ShieldCheck, Sparkles, Upload, UserRound } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { useOnboarding } from '../context/OnboardingContext'
import { assertActiveOwner, importBackup, isBackup, loadAllHistory, makeBackup, previewBackup } from '../lib/repository'
import { clearQuarantine, queueStats, readQuarantine } from '../lib/offline'
import type { BackupPreview } from '../lib/repository'
import type { PersonalBackup } from '../types'

type Operation = 'profile' | 'password' | 'backup-download' | 'backup-preview' | 'backup-restore' | 'quarantine-download' | 'quarantine-delete' | 'sync-retry' | 'sync-resolve' | 'sync-refresh' | 'signout'
type Notice = { kind: 'success' | 'error'; text: string }
type RestoreCandidate = { backup: PersonalBackup; preview: BackupPreview; ownerId: string; fileName: string; importId: string }

function localizedError(reason: unknown, fallback: string) {
  return reason instanceof Error && /[А-Яа-яЁё]/.test(reason.message) ? reason.message : fallback
}

function normalizeDisplayName(displayName: string) {
  return displayName.trim().replace(/\s+/g, ' ')
}

export function SettingsPage() {
  const { user, updateDisplayName, updatePassword, signOut } = useAuth()
  const { data, pending, failedSync, quarantinedSync, legacySyncQuarantine, syncing, online, refresh, retrySync, resolveFailedSync } = useData()
  const { restart } = useOnboarding()
  const metadataName = user?.user_metadata?.display_name
  const savedDisplayName = typeof metadataName === 'string' && metadataName.trim()
    ? metadataName.trim()
    : user?.email?.split('@')[0] ?? ''
  const [displayName, setDisplayName] = useState(savedDisplayName)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState<Notice | null>(null)
  const [restoreCandidate, setRestoreCandidate] = useState<RestoreCandidate | null>(null)
  const [operation, setOperation] = useState<Operation | null>(null)
  const operationRef = useRef<Operation | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const restoreQueueBlocked = pending > 0 || failedSync > 0 || syncing || !online
  const restoreState = useRef<{ ownerId: string | null; blocked: boolean } | null>(null)
  const busy = operation !== null
  const restoreDisabled = busy || !user || restoreQueueBlocked

  useEffect(() => {
    setDisplayName(savedDisplayName)
  }, [savedDisplayName, user?.id])

  useLayoutEffect(() => {
    restoreState.current = { ownerId: user?.id ?? null, blocked: restoreQueueBlocked }
  }, [restoreQueueBlocked, user?.id])

  const assertRestoreReady = (expectedOwnerId: string) => {
    const current = restoreState.current
    if (!current || current.ownerId !== expectedOwnerId) throw new Error('Аккаунт изменился во время восстановления. Выберите файл ещё раз.')
    const liveQueue = queueStats(expectedOwnerId)
    if (current.blocked || liveQueue.pending > 0 || liveQueue.failed > 0) {
      throw new Error('Сначала завершите синхронизацию текущих изменений, затем повторите восстановление.')
    }
  }

  const runOperation = async (next: Operation, task: () => Promise<void>, fallback: string) => {
    if (operationRef.current) return
    operationRef.current = next
    setOperation(next)
    setMessage(null)
    try {
      await task()
    } catch (reason) {
      setMessage({ kind: 'error', text: localizedError(reason, fallback) })
    } finally {
      if (operationRef.current === next) {
        operationRef.current = null
        setOperation(null)
      }
    }
  }

  const changeDisplayName = async (event: FormEvent) => {
    event.preventDefault()
    if (operationRef.current) return
    const normalized = normalizeDisplayName(displayName)
    setMessage(null)
    if (!normalized) return setMessage({ kind: 'error', text: 'Введите ник' })
    if (Array.from(normalized).length > 40) return setMessage({ kind: 'error', text: 'Ник должен содержать не больше 40 символов' })
    if (normalized === savedDisplayName) return
    await runOperation('profile', async () => {
      await updateDisplayName(normalized)
      setDisplayName(normalized)
      setMessage({ kind: 'success', text: 'Ник изменён' })
    }, 'Не удалось изменить ник')
  }

  const changePassword = async (event: FormEvent) => {
    event.preventDefault()
    if (operationRef.current) return
    setMessage(null)
    if (password.length < 12) return setMessage({ kind: 'error', text: 'Новый пароль должен содержать не меньше 12 символов' })
    if (password !== confirm) return setMessage({ kind: 'error', text: 'Пароли не совпадают' })
    await runOperation('password', async () => {
      await updatePassword(password)
      setPassword('')
      setConfirm('')
      setMessage({ kind: 'success', text: 'Пароль изменён' })
    }, 'Не удалось изменить пароль')
  }

  const downloadBackup = async () => {
    if (!user || operationRef.current) return
    const expectedOwnerId = user.id
    await runOperation('backup-download', async () => {
      const history = await loadAllHistory(expectedOwnerId)
      await assertActiveOwner(expectedOwnerId)
      const blob = new Blob([JSON.stringify(makeBackup(data, history, expectedOwnerId), null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      try {
        await assertActiveOwner(expectedOwnerId)
        link.href = url; link.download = `dostigator-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click()
      } finally { URL.revokeObjectURL(url) }
    }, 'Не удалось подготовить резервную копию')
  }

  const downloadSyncQuarantine = async () => {
    if (!user || operationRef.current) return
    const expectedOwnerId = user.id
    await runOperation('quarantine-download', async () => {
      const quarantine = await readQuarantine(expectedOwnerId)
      await assertActiveOwner(expectedOwnerId)
      const blob = new Blob([JSON.stringify(quarantine, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      try {
        link.href = url
        link.download = `dostigator-sync-quarantine-${new Date().toISOString().slice(0, 10)}.json`
        link.click()
      } finally { URL.revokeObjectURL(url) }
    }, 'Не удалось скачать карантин синхронизации')
  }

  const discardSyncQuarantine = async () => {
    if (!user || operationRef.current || !window.confirm('Удалить карантин синхронизации? Сначала скачайте его, если данные могут быть важны.')) return
    const expectedOwnerId = user.id
    await runOperation('quarantine-delete', async () => {
      await assertActiveOwner(expectedOwnerId)
      await clearQuarantine(expectedOwnerId)
      setMessage({ kind: 'success', text: 'Карантин синхронизации удалён' })
    }, 'Не удалось удалить карантин синхронизации')
  }

  const resolveSyncConflict = async () => {
    if (operationRef.current || !window.confirm('Отменить все изменения, оставшиеся в заблокированной очереди? Они сохранятся в скачиваемом карантине, а приложение загрузит актуальные данные сервера.')) return
    await runOperation('sync-resolve', async () => {
      await resolveFailedSync()
      setMessage({ kind: 'success', text: 'Конфликт разрешён: локальная очередь сохранена в карантине' })
    }, 'Не удалось разрешить конфликт')
  }

  const restore = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = event.target.files?.[0]
    if (!file) return
    const expectedOwnerId = user?.id
    if (!expectedOwnerId) {
      input.value = ''
      return setMessage({ kind: 'error', text: 'Войдите в аккаунт перед восстановлением данных' })
    }
    if (operationRef.current) {
      input.value = ''
      return
    }
    await runOperation('backup-preview', async () => {
      assertRestoreReady(expectedOwnerId)
      const parsed: unknown = JSON.parse(await file.text())
      if (!isBackup(parsed)) throw new Error('Это не резервная копия Достигатора')
      assertRestoreReady(expectedOwnerId)
      setRestoreCandidate({ backup: parsed, preview: previewBackup(parsed, data), ownerId: expectedOwnerId, fileName: file.name || 'Резервная копия', importId: crypto.randomUUID() })
    }, 'Не удалось проверить резервную копию')
    input.value = ''
  }

  const confirmRestore = async () => {
    const candidate = restoreCandidate
    if (!candidate || operationRef.current) return
    await runOperation('backup-restore', async () => {
      assertRestoreReady(candidate.ownerId)
      if (user?.id !== candidate.ownerId) throw new Error('Аккаунт изменился во время восстановления. Выберите файл ещё раз.')
      await importBackup(candidate.backup, candidate.ownerId, () => assertRestoreReady(candidate.ownerId), candidate.importId)
      assertRestoreReady(candidate.ownerId)
      await refresh()
      setRestoreCandidate(null)
      setMessage({ kind: 'success', text: 'Данные восстановлены одной транзакцией' })
    }, 'Не удалось восстановить данные')
  }

  const retrySynchronization = () => runOperation('sync-retry', retrySync, 'Не удалось повторить синхронизацию')
  const refreshData = () => runOperation('sync-refresh', refresh, 'Не удалось обновить данные')
  const logOut = () => runOperation('signout', signOut, 'Не удалось выйти из аккаунта')
  const syncBusy = syncing || operation === 'sync-retry' || operation === 'sync-resolve' || operation === 'sync-refresh'
  const syncDescription = failedSync > 0
    ? `Конфликт: ${failedSync} · новые изменения заблокированы`
    : pending > 0
      ? online ? `Ожидают отправки: ${pending}` : `Нет сети · сохранено локально: ${pending}`
      : syncBusy ? 'Синхронизируем…' : 'Все изменения сохранены'
  const syncSummary = quarantinedSync > 0 ? `${syncDescription} · В карантине: ${quarantinedSync}` : syncDescription

  return <div className="page settings-page">
    <PageHeader eyebrow="Аккаунт" title="Профиль" text={user?.email ?? ''} />
    {message && <p className="form-message settings-message" role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
    <section className="settings-card"><div className="settings-title"><UserRound /><div><p className="eyebrow">Обращение</p><h2>Ник в приложении</h2></div></div><form className="stack-form" onSubmit={changeDisplayName} aria-busy={operation === 'profile'}><div className="form-field"><label htmlFor="profile-display-name">Ник</label><input id="profile-display-name" disabled={busy} type="text" autoComplete="nickname" maxLength={40} aria-describedby="profile-display-name-hint" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /><small id="profile-display-name-hint" className="field-hint">Показывается в приветствии на главной. От 1 до 40 символов.</small></div><button className="primary-button" disabled={busy || !normalizeDisplayName(displayName) || normalizeDisplayName(displayName) === savedDisplayName} aria-busy={operation === 'profile'}>{operation === 'profile' ? 'Сохраняем…' : 'Сохранить ник'}</button></form></section>
    <section className="settings-card"><div className="settings-title"><KeyRound /><div><p className="eyebrow">Безопасность</p><h2>Изменить пароль</h2></div></div><form className="stack-form" onSubmit={changePassword} aria-busy={operation === 'password'}><label>Новый пароль<input disabled={busy} type="password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} /></label><label>Повторите пароль<input disabled={busy} type="password" minLength={12} value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label><button className="primary-button" disabled={busy || !password} aria-busy={operation === 'password'}>{operation === 'password' ? 'Изменяем…' : 'Изменить пароль'}</button></form></section>
    <section className="settings-card">
      <div className="settings-title"><ShieldCheck /><div><p className="eyebrow">Ваши данные</p><h2>Резервная копия</h2></div></div>
      <p>JSON содержит цели, действия, привычки, обзоры, дневник и переносимый архив истории. Перед импортом приложение покажет состав файла; сервер применит все записи одной транзакцией или полностью откатит восстановление.</p>
      <div className="button-row">
        <button className="secondary-button" disabled={busy} aria-busy={operation === 'backup-download'} onClick={() => void downloadBackup()}><Download />{operation === 'backup-download' ? 'Готовим…' : 'Скачать JSON'}</button>
        <button className="secondary-button" disabled={restoreDisabled} aria-busy={operation === 'backup-preview'} onClick={() => fileInput.current?.click()}><Upload />{operation === 'backup-preview' ? 'Проверяем…' : 'Выбрать копию'}</button>
        <input ref={fileInput} className="visually-hidden" type="file" accept="application/json,.json" aria-label="Файл резервной копии Достигатора" disabled={restoreDisabled} onChange={(event) => void restore(event)} />
      </div>
      {restoreQueueBlocked && <p role="status">Восстановление станет доступно после завершения синхронизации и подключения к сети.</p>}
      {restoreCandidate && <div className="restore-preview" role="region" aria-labelledby="restore-preview-title">
        <p className="eyebrow">Проверка завершена</p>
        <h3 id="restore-preview-title">{restoreCandidate.fileName}</h3>
        <p>Всего записей: <strong>{restoreCandidate.preview.total}</strong> · совпадений по ID: <strong>{restoreCandidate.preview.idMatches}</strong> · сфер, сопоставленных по имени: <strong>{restoreCandidate.preview.areaNameMatches}</strong></p>
        {restoreCandidate.preview.conflicts > 0 && <p role="alert">
          {restoreCandidate.preview.areaIdentityConflicts > 0 && <>Конфликтов ID и имени сферы: <strong>{restoreCandidate.preview.areaIdentityConflicts}</strong>. </>}
          {restoreCandidate.preview.dependencyConflicts > 0 && <>Разорванных связей: <strong>{restoreCandidate.preview.dependencyConflicts}</strong>. </>}
          Восстановление будет отклонено без изменений.
        </p>}
        <ul>
          <li>Сферы: {restoreCandidate.preview.counts.areas}</li>
          <li>Цели: {restoreCandidate.preview.counts.goals}</li>
          <li>Действия: {restoreCandidate.preview.counts.actions}</li>
          <li>Привычки и отметки: {restoreCandidate.preview.counts.habits + restoreCandidate.preview.counts.checkins}</li>
          <li>Дневник: {restoreCandidate.preview.counts.journals}</li>
          <li>История трёх главных действий: {restoreCandidate.preview.counts.focusCommitments}</li>
          <li>Обзоры: {restoreCandidate.preview.counts.reviews}</li>
        </ul>
        <p>Совпадающие записи будут обновлены. При любой ошибке ни одна запись не изменится.</p>
        <div className="button-row">
          <button className="secondary-button" type="button" disabled={busy} onClick={() => setRestoreCandidate(null)}>Отмена</button>
          <button className="primary-button" type="button" disabled={busy || restoreQueueBlocked || restoreCandidate.preview.conflicts > 0} aria-busy={operation === 'backup-restore'} onClick={() => void confirmRestore()}>{operation === 'backup-restore' ? 'Восстанавливаем…' : 'Подтвердить восстановление'}</button>
        </div>
      </div>}
    </section>
    <Link className="settings-card compact-card settings-link" to="/history"><div><History /><span><strong>История изменений</strong><small>Подтверждённые события, различия и безопасный Undo</small></span></div><span aria-hidden="true">→</span></Link>
    <section className="settings-card compact-card"><div><Sparkles /><span><strong>Знакомство с приложением</strong><small>Цель → действие → три главных дела</small></span></div><button className="secondary-button" onClick={restart}>Пройти снова</button></section>
    <section className={`settings-card ${quarantinedSync > 0 || failedSync > 0 ? '' : 'compact-card'}`} aria-busy={syncBusy}><div><RefreshCw /><span><strong>Синхронизация</strong><small>{syncSummary}</small></span></div><div className="button-row">{(failedSync > 0 || pending > 0) && <button className="secondary-button" disabled={busy || syncing} aria-busy={operation === 'sync-retry'} onClick={() => void retrySynchronization()}>Повторить</button>}{failedSync > 0 && <button className="secondary-button" disabled={busy || syncing} aria-busy={operation === 'sync-resolve'} onClick={() => void resolveSyncConflict()}>Отменить локальные изменения</button>}{failedSync === 0 && pending === 0 && <button className="secondary-button" disabled={busy || syncing} aria-busy={operation === 'sync-refresh'} onClick={() => void refreshData()}>Обновить</button>}{quarantinedSync > 0 && <><button className="secondary-button" disabled={busy} aria-busy={operation === 'quarantine-download'} onClick={() => void downloadSyncQuarantine()}><Download />Скачать карантин</button><button className="secondary-button" disabled={busy} aria-busy={operation === 'quarantine-delete'} onClick={() => void discardSyncQuarantine()}>Удалить карантин</button></>}</div></section>
    {legacySyncQuarantine && <section className="settings-card"><div className="settings-title"><ShieldCheck /><div><p className="eyebrow">Защищённый карантин</p><h2>Старая очередь без владельца</h2></div></div><p>Эти данные сохранены локально, но приложение не может доказать, какому аккаунту они принадлежат. Поэтому их содержимое нельзя просмотреть, скачать, удалить или отправить из аккаунта.</p></section>}
    <button className="logout-button" disabled={busy} aria-busy={operation === 'signout'} onClick={() => void logOut()}><LogOut /><span><strong>{operation === 'signout' ? 'Выходим…' : 'Выйти'}</strong><small>Данные в Supabase сохранятся</small></span></button>
    <p className="version">Достигатор · версия 0.1</p>
  </div>
}
