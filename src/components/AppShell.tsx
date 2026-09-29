import { BarChart3, CircleUserRound, Dumbbell, Home, NotebookPen, TrendingUp, Utensils } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useData } from '../context/DataContext'
import { useOnboarding } from '../context/OnboardingContext'

const navigation = [
  { to: '/', label: 'Сегодня', shortLabel: 'День', icon: Home },
  { to: '/training', label: 'Тренировки', shortLabel: 'Зал', icon: Dumbbell },
  { to: '/nutrition', label: 'Питание', shortLabel: 'Еда', icon: Utensils },
  { to: '/progress', label: 'Прогресс', shortLabel: 'Рост', icon: TrendingUp },
  { to: '/review', label: 'Обзор', shortLabel: 'Итоги', icon: BarChart3 },
  { to: '/journal', label: 'Дневник', shortLabel: 'Записи', icon: NotebookPen },
  { to: '/settings', label: 'Профиль', shortLabel: 'Я', icon: CircleUserRound },
]

export function AppShell() {
  const { pending, failedSync, quarantinedSync, legacySyncQuarantine, syncing, online, error, mutationError, historyNotice, clearMutationError, dismissHistoryNotice, undoLastMutation, retrySync } = useData()
  const { status: onboardingStatus, skip: skipOnboarding } = useOnboarding()
  const leaveOnboarding = () => {
    if (onboardingStatus === 'active') skipOnboarding()
  }
  const hasBanner = pending > 0 || failedSync > 0 || quarantinedSync > 0 || legacySyncQuarantine || error
  const hasNotifications = Boolean(mutationError || historyNotice || hasBanner)
  const syncMessage = legacySyncQuarantine
    ? 'Найдены старые данные без подтверждённого владельца'
    : quarantinedSync > 0
    ? `Требуют восстановления: ${quarantinedSync}`
    : failedSync > 0
    ? `Не синхронизировано: ${failedSync}. Локальные изменения сохранены.`
    : syncing ? 'Синхронизируем изменения…'
    : error ? `Работаем с сохранёнными данными · ${error}`
    : online ? `Ожидают синхронизации: ${pending}` : `Нет сети · сохранено локально: ${pending}`
  const criticalSync = failedSync > 0 || quarantinedSync > 0 || legacySyncQuarantine || Boolean(error)
  const assertiveMessage = mutationError
    ?? (historyNotice?.status === 'failed' ? `${historyNotice.label}. Сервер отклонил синхронизацию.` : null)
    ?? (criticalSync ? syncMessage : null)
  return (
    <div className="app-frame">
      {assertiveMessage && <p className="visually-hidden" role="alert" aria-live="assertive" aria-atomic="true">{assertiveMessage}</p>}
      <div className="app-layout">
        <nav className="bottom-nav" aria-label="Основная навигация">
          <Link className="app-brand" to="/" aria-label="Достигатор — на главную" onClick={leaveOnboarding}><span aria-hidden="true">Д</span><strong>Достигатор</strong></Link>
          {navigation.map(({ to, label, shortLabel, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} aria-label={label} onClick={leaveOnboarding}><Icon aria-hidden="true" /><span className="nav-label" data-short-label={shortLabel}>{label}</span></NavLink>
          ))}
        </nav>
        <div className="shell-content">
          {hasNotifications && <section className="banner-stack" aria-label="Уведомления приложения">
            {mutationError && <div className="mutation-banner sync-banner error">
              <span>{mutationError}</span>
              <button type="button" onClick={clearMutationError} aria-label="Закрыть сообщение об ошибке">Закрыть</button>
            </div>}
            {historyNotice && <div className={`history-toast ${historyNotice.status}`} role={historyNotice.status === 'failed' ? undefined : 'status'} aria-live={historyNotice.status === 'failed' ? undefined : 'polite'}>
              <span><strong>{historyNotice.label}</strong><small>{historyNotice.status === 'synced' ? 'Сохранено и добавлено в историю' : historyNotice.status === 'pending' ? 'Сохранено локально, ожидает синхронизации' : 'Сохранено локально, сервер отклонил синхронизацию'}</small></span>
              {historyNotice.canUndo && <button type="button" disabled={historyNotice.undoing} onClick={() => void undoLastMutation().catch(() => undefined)}>{historyNotice.undoing ? 'Отменяем…' : 'Undo'}</button>}
              <button className="toast-close" type="button" onClick={dismissHistoryNotice} aria-label="Закрыть уведомление">×</button>
            </div>}
            {hasBanner && <div className={`sync-banner ${criticalSync ? 'error' : ''}`} role={criticalSync ? undefined : 'status'}>
              <span>{syncMessage}</span>
              {quarantinedSync > 0 || legacySyncQuarantine
                ? <Link to="/settings">Открыть</Link>
                : (failedSync > 0 || pending > 0) && online && <button type="button" disabled={syncing} onClick={() => void retrySync()}>{syncing ? 'Повторяем…' : 'Повторить'}</button>}
            </div>}
          </section>}
          <main className="app-main"><Outlet /></main>
        </div>
      </div>
    </div>
  )
}
