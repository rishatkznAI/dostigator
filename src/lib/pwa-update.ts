import { registerSW } from 'virtual:pwa-register'
import { getPendingWrites } from './update-safety'

type UpdateState = { available: boolean; applying: boolean; message: string }
const savingMessage = 'Дождись завершения сохранения и повтори обновление.'

export function createPwaUpdateController(register = registerSW, reload = () => window.location.reload()) {
  let state: UpdateState = { available: false, applying: false, message: '' }
  let reloadReady = false
  let explicitlyRequested = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<() => void>()
  const publish = (next: UpdateState) => { state = next; listeners.forEach(listener => listener()) }
  const stopWaiting = () => { clearTimeout(timeout); timeout = undefined; explicitlyRequested = false }
  const update = register({
    immediate: true,
    onNeedRefresh: () => publish({ ...state, available: true }),
    // A different tab can activate the worker too. Never let that reload this tab.
    onNeedReload: () => {
      reloadReady = true
      if (explicitlyRequested && getPendingWrites() === 0) reload()
      else {
        stopWaiting()
        publish({ available: true, applying: false, message: getPendingWrites() ? savingMessage : '' })
      }
    },
  })
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => state,
    defer() { stopWaiting(); publish({ ...state, applying: false, message: '' }) },
    async apply() {
      if (state.applying) return
      if (getPendingWrites()) { publish({ ...state, message: savingMessage }); return }
      explicitlyRequested = true
      publish({ ...state, applying: true, message: '' })
      timeout = setTimeout(() => {
        stopWaiting()
        publish({ available: true, applying: false, message: 'Обновление ещё не завершилось. Можно повторить позже.' })
      }, 15_000)
      if (reloadReady) { reload(); return }
      try { await update(true) }
      catch {
        stopWaiting()
        publish({ available: true, applying: false, message: 'Не удалось обновить приложение. Проверь подключение и повтори.' })
      }
    },
    dispose() { stopWaiting(); listeners.clear() },
  }
}

export type PwaUpdateController = ReturnType<typeof createPwaUpdateController>
