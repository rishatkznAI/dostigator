import { useState, useSyncExternalStore } from 'react'
import type { PwaUpdateController } from '../lib/pwa-update'
import { getPendingWrites, subscribePendingWrites } from '../lib/update-safety'

export function PwaUpdateNotice({ controller }: { controller: PwaUpdateController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const pendingWrites = useSyncExternalStore(subscribePendingWrites, getPendingWrites)
  const [collapsed, setCollapsed] = useState(false)
  const [message, setMessage] = useState('')
  if (!state.available) return null
  const apply = () => {
    // Some forms mark themselves busy before their request reaches fetch.
    const busy = Array.from(document.querySelectorAll('[aria-busy="true"]')).some(element => !element.closest('.app-update-notice'))
    if (busy || getPendingWrites()) { setMessage('Дождись завершения текущей операции и повтори обновление.'); return }
    if (!window.confirm('Обновление перезагрузит приложение. Сначала сохрани введённые данные. Обновить сейчас?')) return
    setMessage('')
    void controller.apply()
  }
  return <aside className={`app-update-notice${collapsed ? ' app-update-notice--compact' : ''}`} aria-label="Обновление приложения">
    <div><strong role="status">Доступно обновление</strong>{!collapsed && <p>Сначала сохрани введённые данные. При обновлении приложение перезагрузится.</p>}
      {!collapsed && (pendingWrites > 0 || message || state.message) && <p role="status">{pendingWrites > 0 ? 'Дождись завершения сохранения.' : message || state.message}</p>}
    </div>
    <div className="app-update-actions">{collapsed ? <button type="button" onClick={() => setCollapsed(false)}>Показать</button> : <>
      <button type="button" disabled={state.applying || pendingWrites > 0} onClick={apply}>{state.applying ? 'Обновляем…' : 'Обновить приложение'}</button>
      <button type="button" onClick={() => { controller.defer(); setCollapsed(true) }}>Позже</button>
    </>}</div>
  </aside>
}
