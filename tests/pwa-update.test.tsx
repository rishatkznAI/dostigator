import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPwaUpdateController } from '../src/lib/pwa-update'
import { PwaUpdateNotice } from '../src/components/PwaUpdateNotice'
import { AppUpdateCheck } from '../src/components/AppUpdateCheck'
import { getPendingWrites, trackedSupabaseFetch } from '../src/lib/update-safety'
import type { RegisterSWOptions } from 'vite-plugin-pwa/types'

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn() }))
const current = { version: '0.2.0', commit: 'a'.repeat(40), builtAt: '2026-10-25T10:00:00Z' }
const latest = { version: '0.2.1', commit: 'b'.repeat(40), builtAt: '2026-10-25T11:00:00Z' }
let options: RegisterSWOptions
let workerActivation: ReturnType<typeof vi.fn>
let navigate: ReturnType<typeof vi.fn>
let metadata: ReturnType<typeof vi.fn>
let controller: ReturnType<typeof createPwaUpdateController>
const make = () => createPwaUpdateController(value => { options = value!; return workerActivation }, navigate, { current, baseUrl: '/dostigator/', fetch: metadata as typeof fetch })
const announce = async () => { await act(async () => { options.onNeedRefresh?.(); await controller.checkForUpdates() }) }
const expand = () => fireEvent.click(screen.getByRole('button', { name: 'Подробнее' }))
beforeEach(() => {
  workerActivation = vi.fn().mockResolvedValue(undefined)
  navigate = vi.fn()
  metadata = vi.fn().mockImplementation(async () => Response.json(latest))
  controller = make()
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { cleanup(); controller.dispose(); vi.restoreAllMocks(); vi.useRealTimers(); expect(getPendingWrites()).toBe(0) })

it('announces checked current/available versions and SHA in a compact notice, with no automatic navigation', async () => {
  render(<PwaUpdateNotice controller={controller} />)
  expect(screen.queryByText('Доступно обновление')).not.toBeInTheDocument()
  await announce()
  expect(screen.getByTitle(current.commit).closest('p')).toHaveTextContent('Сейчас: 0.2.0 · aaaaaaa')
  expect(screen.getByTitle(latest.commit).closest('p')).toHaveTextContent('Новая: 0.2.1 · bbbbbbb')
  expect(screen.queryByRole('button', { name: 'Обновить приложение' })).not.toBeInTheDocument()
  expand(); fireEvent.click(screen.getByRole('button', { name: 'Позже' }))
  expect(screen.getByRole('button', { name: 'Подробнее' })).toBeVisible()
  expect(workerActivation).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled()
})

it('retains entered text when arrival or confirmation is cancelled', async () => {
  render(<><textarea aria-label="Черновик" defaultValue="Мой ввод" /><PwaUpdateNotice controller={controller} /></>)
  await announce(); expand()
  vi.mocked(window.confirm).mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: 'Обновить приложение' }))
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('несохранённый ввод может пропасть'))
  expect(screen.getByRole('textbox')).toHaveValue('Мой ввод')
  expect(navigate).not.toHaveBeenCalled(); expect(workerActivation).not.toHaveBeenCalled()
})

it('opens only this tab through the cache-busted fresh bridge after confirmation, without activating a shared worker', async () => {
  render(<PwaUpdateNotice controller={controller} />)
  await announce(); expand()
  fireEvent.click(screen.getByRole('button', { name: 'Обновить приложение' }))
  const destination = new URL(navigate.mock.calls[0][0])
  expect(destination.pathname).toBe('/dostigator/auth/v1/open.html')
  expect(destination.searchParams.get('check')).toMatch(/^\d+$/)
  expect(workerActivation).not.toHaveBeenCalled()
  await act(async () => { options.onNeedReload?.(); await controller.checkForUpdates() })
  expect(navigate).toHaveBeenCalledOnce()
})

it('does not reload when another tab activates the worker', async () => {
  await act(async () => { options.onNeedReload?.(); await controller.checkForUpdates() })
  expect(controller.getSnapshot()).toMatchObject({ available: true, latest })
  expect(navigate).not.toHaveBeenCalled(); expect(workerActivation).not.toHaveBeenCalled()
})

it('uses a network cache-busted request and confirms current only for matching version AND full SHA', async () => {
  expect(controller.getSnapshot().checkStatus).toBe('unverified')
  metadata.mockImplementation(async () => Response.json(current))
  await controller.checkForUpdates()
  expect(metadata).toHaveBeenCalledWith(expect.stringMatching(/\/dostigator\/build-info.json\?check=/), expect.objectContaining({ cache: 'no-store', credentials: 'omit', signal: expect.any(AbortSignal) }))
  expect(controller.getSnapshot()).toMatchObject({ checkStatus: 'current', latest: current, available: false, checkedAt: expect.any(String) })
  const firstUrl = metadata.mock.calls[0][0]
  metadata.mockImplementation(async () => Response.json({ ...current, commit: latest.commit }))
  await controller.checkForUpdates()
  expect(metadata.mock.calls[1][0]).not.toBe(firstUrl)
  expect(controller.getSnapshot()).toMatchObject({ checkStatus: 'available', available: true })
  expect(navigate).not.toHaveBeenCalled(); expect(workerActivation).not.toHaveBeenCalled()
})

it('does not declare an older artifact current when the same version and SHA were rebuilt', async () => {
  metadata.mockImplementation(async () => Response.json({ ...current, builtAt: latest.builtAt }))
  await controller.checkForUpdates()
  expect(controller.getSnapshot()).toMatchObject({ checkStatus: 'available', available: true })
})

it('never confirms current offline, and invalidates a previous current result on an offline event', async () => {
  metadata.mockImplementation(async () => Response.json(current))
  await controller.checkForUpdates()
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
  fireEvent(window, new Event('offline'))
  expect(controller.getSnapshot()).toMatchObject({ checkStatus: 'offline', checkError: expect.stringContaining('не проверена') })
  await controller.checkForUpdates()
  expect(metadata).toHaveBeenCalledOnce()
  expect(controller.apply()).toBe(false); expect(navigate).not.toHaveBeenCalled()
})

it('shows a current-version confirmation in Settings only after an exact successful check, then removes it offline', async () => {
  metadata.mockImplementation(async () => Response.json(current))
  render(<AppUpdateCheck controller={controller} />)
  expect(screen.queryByText(/Установлена актуальная версия/)).not.toBeInTheDocument()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Проверить обновление' })))
  expect(screen.getByText('Установлена актуальная версия. Подтверждено сервером.')).toBeVisible()
  expect(screen.getByTitle(current.commit)).toHaveTextContent('aaaaaaa')
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
  fireEvent(window, new Event('offline'))
  expect(screen.queryByText(/Установлена актуальная версия/)).not.toBeInTheDocument()
  expect(screen.getByText(/Нет сети/)).toBeVisible()
})

it('removes an earlier current confirmation if a later server check fails', async () => {
  metadata.mockImplementationOnce(async () => Response.json(current)).mockRejectedValueOnce(new Error('Network'))
  render(<AppUpdateCheck controller={controller} />)
  await act(async () => controller.checkForUpdates())
  expect(screen.getByText(/Установлена актуальная версия/)).toBeVisible()
  await act(async () => controller.checkForUpdates())
  expect(screen.queryByText(/Установлена актуальная версия/)).not.toBeInTheDocument()
  expect(screen.getByText(/Не удалось проверить версию/)).toBeVisible()
})

it.each([
  ['HTTP error', () => Promise.resolve(new Response('{}', { status: 503 }))],
  ['invalid JSON', () => Promise.resolve(new Response('<html>offline</html>'))],
  ['invalid metadata', () => Promise.resolve(Response.json({ version: '0.2.0', commit: 'local', builtAt: null }))],
  ['network rejection', () => Promise.reject(new Error('Network'))],
])('leaves freshness unconfirmed after %s', async (_name, response) => {
  metadata.mockImplementation(response)
  await controller.checkForUpdates()
  expect(controller.getSnapshot()).toMatchObject({ checkStatus: 'error', checkedAt: null, latest: null })
})

it('bounds a hung network check, aborts it, and permits retry without showing current', async () => {
  vi.useFakeTimers()
  metadata.mockImplementation(() => new Promise(() => {}))
  const checking = controller.checkForUpdates()
  expect(controller.getSnapshot().checkStatus).toBe('checking')
  await vi.advanceTimersByTimeAsync(8_000); await checking
  expect(metadata.mock.calls[0][1].signal.aborted).toBe(true)
  expect(controller.getSnapshot().checkStatus).toBe('error')
  metadata.mockImplementation(async () => Response.json(current))
  await controller.checkForUpdates()
  expect(controller.getSnapshot().checkStatus).toBe('current')
})

it('deduplicates concurrent checks and rejects obsolete success if the device went offline', async () => {
  let finish!: (response: Response) => void
  metadata.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const first = controller.checkForUpdates(), second = controller.checkForUpdates()
  expect(first).toBe(second); expect(metadata).toHaveBeenCalledOnce()
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
  finish(Response.json(current)); await first
  expect(controller.getSnapshot().checkStatus).toBe('offline')
})

it('blocks fresh navigation while a write is in flight, then preserves fetch arguments and response', async () => {
  let finish!: (response: Response) => void
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { finish = resolve }))
  render(<PwaUpdateNotice controller={controller} />)
  await announce(); expand()
  const init = { method: 'POST', body: '{"value":1}', headers: { 'x-test': 'unchanged' } }
  let request!: Promise<Response>
  act(() => { request = trackedSupabaseFetch('https://example.test/rest/v1/items', init) })
  expect(screen.getByRole('button', { name: 'Обновить приложение' })).toBeDisabled()
  expect(controller.apply()).toBe(false)
  expect(navigate).not.toHaveBeenCalled(); expect(window.confirm).not.toHaveBeenCalled()
  const response = new Response('{}')
  await act(async () => { finish(response); expect(await request).toBe(response) })
  expect(fetchMock).toHaveBeenCalledWith('https://example.test/rest/v1/items', init)
  expect(screen.getByRole('button', { name: 'Обновить приложение' })).toBeEnabled()
})

it('rechecks the write guard after confirmation, covering a write started while the dialog was open', async () => {
  let finish!: (response: Response) => void
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { finish = resolve }))
  let request!: Promise<Response>
  vi.mocked(window.confirm).mockImplementation(() => { request = trackedSupabaseFetch('https://example.test/write', { method: 'PATCH' }); return true })
  expect(controller.apply()).toBe(false); expect(navigate).not.toHaveBeenCalled()
  finish(new Response('{}')); await request
})

it('keeps the write guard until concurrent writes finish, releases failures, and excludes reads', async () => {
  const finishes: Array<(response: Response) => void> = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => finishes.push(resolve)))
  const first = trackedSupabaseFetch('https://example.test/first', { method: 'POST' })
  const second = trackedSupabaseFetch(new Request('https://example.test/second', { method: 'PATCH' }))
  const read = trackedSupabaseFetch('https://example.test/read')
  expect(getPendingWrites()).toBe(2)
  finishes[0](new Response('{}')); await first; expect(getPendingWrites()).toBe(1)
  expect(controller.apply()).toBe(false)
  finishes[1](new Response('{}')); await second; expect(getPendingWrites()).toBe(0)
  finishes[2](new Response('{}')); await read
  vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('Offline'))
  await expect(trackedSupabaseFetch('https://example.test', { method: 'DELETE' })).rejects.toThrow('Offline')
  expect(getPendingWrites()).toBe(0)
})

it('respects a busy form and recovers from a cancelled or failed navigation without automatic reload', () => {
  render(<form aria-busy="true"><input aria-label="Сохраняется" /></form>)
  expect(controller.apply()).toBe(false); expect(window.confirm).not.toHaveBeenCalled()
  cleanup(); vi.useFakeTimers(); navigate.mockImplementationOnce(() => { throw new Error('Blocked') })
  expect(controller.apply()).toBe(false)
  expect(controller.getSnapshot()).toMatchObject({ applying: false, message: expect.stringContaining('Не удалось') })
  expect(controller.apply()).toBe(true)
  vi.advanceTimersByTime(8_000)
  expect(controller.getSnapshot()).toMatchObject({ applying: false, message: expect.stringContaining('ещё не открылась') })
  expect(workerActivation).not.toHaveBeenCalled()
})

it('checks metadata and the worker on return, with a cooldown and no activation or loss of input', async () => {
  vi.useFakeTimers()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  render(<><input aria-label="Черновик" defaultValue="Мой ввод" /><PwaUpdateNotice controller={controller} /></>)
  const checkWorker = vi.fn().mockResolvedValue(undefined)
  options.onRegisteredSW?.('/sw.js', { update: checkWorker } as unknown as ServiceWorkerRegistration)
  fireEvent.focus(window); expect(checkWorker).not.toHaveBeenCalled()
  vi.advanceTimersByTime(60_000)
  await act(async () => { fireEvent(document, new Event('visibilitychange')); await controller.checkForUpdates() })
  expect(checkWorker).toHaveBeenCalledOnce(); expect(metadata).toHaveBeenCalledOnce()
  fireEvent.focus(window); fireEvent(window, new Event('online'))
  expect(checkWorker).toHaveBeenCalledOnce()
  expect(screen.getByRole('textbox')).toHaveValue('Мой ввод')
  expect(workerActivation).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled()
  controller.dispose(); vi.advanceTimersByTime(60_000); fireEvent.focus(window)
  expect(checkWorker).toHaveBeenCalledOnce()
})
