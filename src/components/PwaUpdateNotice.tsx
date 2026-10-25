import { useState, useSyncExternalStore } from 'react'
import type { PwaUpdateController } from '../lib/pwa-update'
import { getPendingWrites, subscribePendingWrites } from '../lib/update-safety'
import './app-updates.css'

export const shortBuild = (commit: string) => commit === 'local' ? 'локальная' : commit.slice(0, 7)

export function PwaUpdateNotice({ controller }: { controller: PwaUpdateController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const pendingWrites = useSyncExternalStore(subscribePendingWrites, getPendingWrites)
  const [expanded, setExpanded] = useState(false)
  if (!state.available) return null
  const verifiedLatest = state.checkStatus === 'available' ? state.latest : null
  const rebuilt = verifiedLatest?.version === state.current.version && verifiedLatest?.commit === state.current.commit
  return <aside className={`app-update-notice app-update-notice-v2${expanded ? '' : ' app-update-notice--compact'}`} aria-label="Обновление приложения">
    <div><strong role="status">Доступно обновление</strong>
      <p className="app-update-versions">Сейчас: {state.current.version} · <code title={state.current.commit}>{shortBuild(state.current.commit)}</code><br />{verifiedLatest ? <>Новая: {verifiedLatest.version} · <code title={verifiedLatest.commit}>{shortBuild(verifiedLatest.commit)}</code></> : state.checkStatus === 'checking' ? 'Проверяем версию на сервере…' : 'Номер новой версии пока не проверен'}</p>
      {expanded && rebuilt && verifiedLatest?.builtAt && <p>Новая сборка той же версии от {new Date(verifiedLatest.builtAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК.</p>}
      {expanded && <p>Сохрани открытые формы. Свежая версия откроется в этой вкладке.</p>}
      {expanded && (pendingWrites > 0 || state.message || state.checkError) && <p role="status">{pendingWrites > 0 ? 'Дождись завершения сохранения.' : state.message || state.checkError}</p>}
    </div>
    <div className="app-update-actions">{expanded ? <>
      <button type="button" disabled={state.applying || pendingWrites > 0} onClick={() => controller.apply()}>{state.applying ? 'Открываем…' : 'Обновить приложение'}</button>
      <button type="button" onClick={() => { controller.defer(); setExpanded(false) }}>Позже</button>
    </> : <button type="button" onClick={() => setExpanded(true)}>Подробнее</button>}</div>
  </aside>
}
