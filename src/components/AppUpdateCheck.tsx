import { useSyncExternalStore } from 'react'
import { getPwaUpdateController } from '../lib/pwa-update'
import type { PwaUpdateController } from '../lib/pwa-update'
import { shortBuild } from './PwaUpdateNotice'

export function AppUpdateCheck({ controller: provided }: { controller?: PwaUpdateController }) {
  const controller = provided ?? getPwaUpdateController()
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const checked = state.checkStatus === 'current' || state.checkStatus === 'available'
  return <div className="app-update-check" aria-busy={state.checkStatus === 'checking'}>
    <div role={state.checkStatus === 'unverified' ? undefined : 'status'} aria-label="Проверка версии" aria-live="polite">
      {state.checkStatus === 'unverified' && <p>Актуальность версии ещё не проверена.</p>}
      {state.checkStatus === 'checking' && <p>Проверяем опубликованную версию…</p>}
      {state.checkStatus === 'current' && <p className="app-update-current">Установлена актуальная версия. Подтверждено сервером.</p>}
      {state.checkStatus === 'available' && <p>На сервере доступна новая сборка.</p>}
      {(state.checkStatus === 'offline' || state.checkStatus === 'error') && <p>{state.checkError}</p>}
      {checked && state.latest && <p>На сервере: <strong>{state.latest.version}</strong> · сборка <code title={state.latest.commit}>{shortBuild(state.latest.commit)}</code></p>}
      {checked && state.latest?.builtAt && <p className="app-update-checked-at">Выпуск от <time dateTime={state.latest.builtAt}>{new Date(state.latest.builtAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК</time></p>}
      {checked && state.checkedAt && <p className="app-update-checked-at">Проверено: <time dateTime={state.checkedAt}>{new Date(state.checkedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })} МСК</time></p>}
    </div>
    <button className="secondary-button" type="button" disabled={state.checkStatus === 'checking'} onClick={() => void controller.checkForUpdates()}>{state.checkStatus === 'checking' ? 'Проверяем…' : 'Проверить обновление'}</button>
  </div>
}
