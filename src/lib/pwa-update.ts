import type { RegisterSWOptions } from 'vite-plugin-pwa/types'
import { buildInfo, type AppBuildInfo } from './build-info'
import { getPendingWrites } from './update-safety'

export type UpdateCheckStatus = 'unverified' | 'checking' | 'current' | 'available' | 'offline' | 'error'
export type PwaUpdateState = {
  current: AppBuildInfo; latest: AppBuildInfo | null; checkStatus: UpdateCheckStatus;
  checkedAt: string | null; checkError: string; available: boolean; applying: boolean; message: string;
}
export interface PwaUpdateController {
  subscribe(listener: () => void): () => void
  getSnapshot(): PwaUpdateState
  checkForUpdates(): Promise<void>
  apply(): boolean
  defer(): void
  dispose(): void
}
type Configuration = { current?: AppBuildInfo; baseUrl?: string; fetch?: typeof fetch; timeoutMs?: number }
type RegisterWorker = (options?: RegisterSWOptions) => (reloadPage?: boolean) => Promise<void>
const withoutServiceWorker: RegisterWorker = () => async () => {}
const savingMessage = 'Дождись завершения сохранения и повтори переход к свежей версии.'
const offlineMessage = 'Нет сети. Актуальность версии не проверена. Подключись и повтори проверку.'
let sharedController: PwaUpdateController | undefined

export function hasBusyAppOperation() {
  return Array.from(document.querySelectorAll('[aria-busy="true"]')).some(element => !element.closest('.app-update-notice, .app-update-check'))
}

function parseBuild(value: unknown): AppBuildInfo {
  if (!value || typeof value !== 'object') throw new Error('Invalid build metadata')
  const { version, commit, builtAt } = value as Record<string, unknown>
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)
    || typeof commit !== 'string' || !/^[a-f\d]{7,40}$/i.test(commit)
    || (builtAt !== null && (typeof builtAt !== 'string' || !Number.isFinite(Date.parse(builtAt))))) throw new Error('Invalid build metadata')
  return { version, commit: commit.toLowerCase(), builtAt: builtAt as string | null }
}

export function createPwaUpdateController(
  register: RegisterWorker = withoutServiceWorker,
  navigate = (url: string) => window.location.assign(url),
  configuration: Configuration = {},
): PwaUpdateController {
  const current = configuration.current ?? buildInfo
  const base = new URL(configuration.baseUrl ?? import.meta.env.BASE_URL, window.location.origin)
  let state: PwaUpdateState = { current, latest: null, checkStatus: 'unverified', checkedAt: null, checkError: '', available: false, applying: false, message: '' }
  let registration: ServiceWorkerRegistration | undefined
  let lastCheckedAt = 0
  let checkNumber = 0
  let checkPromise: Promise<void> | undefined
  let request: AbortController | undefined
  let navigationTimeout: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<PwaUpdateState>) => {
    if (disposed) return
    state = { ...state, ...patch }
    listeners.forEach(listener => listener())
  }
  const checkForUpdates = () => {
    if (disposed) return Promise.resolve()
    if (!navigator.onLine) { publish({ checkStatus: 'offline', checkError: offlineMessage }); return Promise.resolve() }
    if (checkPromise) return checkPromise
    lastCheckedAt = Date.now()
    publish({ checkStatus: 'checking', checkError: '' })
    request = new AbortController()
    const abort = request
    const url = new URL('build-info.json', base)
    url.searchParams.set('check', `${Date.now()}-${++checkNumber}`)
    let timeout: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      const response = await (configuration.fetch ?? globalThis.fetch)(url.href, { cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json' }, signal: abort.signal })
      if (!response.ok) throw new Error('Metadata request failed')
      return parseBuild(await response.json())
    }
    checkPromise = (async () => {
      try {
        const latest = await Promise.race([load(), new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => { abort.abort(); reject(new Error('Update check timed out')) }, configuration.timeoutMs ?? 8_000)
        })])
        if (!navigator.onLine) { publish({ checkStatus: 'offline', checkError: offlineMessage }); return }
        const same = latest.version === current.version && latest.commit === current.commit.toLowerCase() && latest.builtAt === current.builtAt
        publish({ latest, checkedAt: new Date().toISOString(), checkStatus: same ? 'current' : 'available', available: !same, checkError: '' })
      } catch {
        publish({ checkStatus: navigator.onLine ? 'error' : 'offline', checkError: navigator.onLine ? 'Не удалось проверить версию на сервере. Проверь подключение и повтори.' : offlineMessage })
      } finally {
        clearTimeout(timeout)
        checkPromise = undefined
        request = undefined
      }
    })()
    return checkPromise
  }
  const checkWhenVisible = () => {
    if (disposed || document.visibilityState !== 'visible' || !navigator.onLine || checkPromise || Date.now() - lastCheckedAt < 60_000) return
    // Discover a waiting worker, but never activate it from this or another tab.
    void registration?.update().catch(() => undefined)
    void checkForUpdates()
  }
  const markOffline = () => { publish({ checkStatus: 'offline', checkError: offlineMessage }) }
  document.addEventListener('visibilitychange', checkWhenVisible)
  window.addEventListener('focus', checkWhenVisible)
  window.addEventListener('online', checkWhenVisible)
  window.addEventListener('offline', markOffline)
  register({
    immediate: true,
    onRegisteredSW: (_url, nextRegistration) => { registration = nextRegistration; lastCheckedAt = Date.now() },
    onNeedRefresh: () => { publish({ available: true }); void checkForUpdates() },
    // Never send SKIP_WAITING: a legacy tab may still reload on activation.
    onNeedReload: () => { publish({ available: true }); void checkForUpdates() },
  })
  const controller: PwaUpdateController = {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => state,
    checkForUpdates,
    defer() { clearTimeout(navigationTimeout); publish({ applying: false, message: '' }) },
    apply() {
      if (state.applying) return false
      if (!navigator.onLine) { publish({ message: 'Подключись к сети перед открытием свежей версии.' }); return false }
      if (getPendingWrites() || hasBusyAppOperation()) { publish({ message: savingMessage }); return false }
      if (!window.confirm('Сначала сохрани открытые формы. Переход закроет текущую страницу, несохранённый ввод может пропасть. Открыть свежую версию?')) return false
      if (getPendingWrites() || hasBusyAppOperation()) { publish({ message: savingMessage }); return false }
      publish({ applying: true, message: '' })
      navigationTimeout = setTimeout(() => publish({ applying: false, message: 'Свежая версия ещё не открылась. Проверь подключение и повтори.' }), 8_000)
      try {
        const destination = new URL('auth/v1/open.html', base)
        destination.searchParams.set('check', String(Date.now()))
        navigate(destination.href)
        return true
      } catch {
        clearTimeout(navigationTimeout)
        publish({ applying: false, message: 'Не удалось открыть свежую версию. Проверь подключение и повтори.' })
        return false
      }
    },
    dispose() {
      disposed = true
      request?.abort()
      clearTimeout(navigationTimeout)
      document.removeEventListener('visibilitychange', checkWhenVisible)
      window.removeEventListener('focus', checkWhenVisible)
      window.removeEventListener('online', checkWhenVisible)
      window.removeEventListener('offline', markOffline)
      listeners.clear()
      if (sharedController === controller) sharedController = undefined
    },
  }
  return controller
}

export function getPwaUpdateController(register: RegisterWorker = withoutServiceWorker) {
  sharedController ??= createPwaUpdateController(register)
  return sharedController
}
