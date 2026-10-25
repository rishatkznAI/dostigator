import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPwaUpdateController } from '../src/lib/pwa-update'
import { PwaUpdateNotice } from '../src/components/PwaUpdateNotice'
import { getPendingWrites, trackedSupabaseFetch } from '../src/lib/update-safety'
import type { RegisterSWOptions } from 'vite-plugin-pwa/types'

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn() }))
let options: RegisterSWOptions
let update: ReturnType<typeof vi.fn>
let reload: ReturnType<typeof vi.fn>
let controller: ReturnType<typeof createPwaUpdateController>
beforeEach(() => {
  update = vi.fn().mockResolvedValue(undefined)
  reload = vi.fn()
  controller = createPwaUpdateController(value => { options = value!; return update }, reload)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { cleanup(); controller.dispose(); vi.restoreAllMocks(); vi.useRealTimers(); expect(getPendingWrites()).toBe(0) })

it('announces an update without activating or reloading, and permits postponing it', () => {
  render(<PwaUpdateNotice controller={controller} />)
  expect(screen.queryByText('Доступно обновление')).not.toBeInTheDocument()
  act(() => options.onNeedRefresh?.())
  expect(screen.getByText('Доступно обновление')).toBeVisible()
  expect(update).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Позже' }))
  expect(screen.queryByRole('button', { name: 'Обновить приложение' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Показать' }))
  expect(screen.getByRole('button', { name: 'Обновить приложение' })).toBeVisible()
})

it('keeps entered text when an update arrives or confirmation is cancelled', () => {
  render(<><textarea aria-label="Неотправленный текст" defaultValue="Черновик" /><PwaUpdateNotice controller={controller} /></>)
  act(() => options.onNeedRefresh?.())
  vi.mocked(window.confirm).mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: 'Обновить приложение' }))
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Сначала сохрани'))
  expect(screen.getByRole('textbox')).toHaveValue('Черновик')
  expect(update).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled()
})

it('reloads only after the user confirms and the new worker controls this tab', async () => {
  render(<PwaUpdateNotice controller={controller} />)
  act(() => options.onNeedRefresh?.())
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Обновить приложение' })))
  expect(update).toHaveBeenCalledOnce(); expect(reload).not.toHaveBeenCalled()
  act(() => options.onNeedReload?.())
  expect(reload).toHaveBeenCalledOnce()
})

it('does not reload when a different tab activates the worker', async () => {
  render(<PwaUpdateNotice controller={controller} />)
  act(() => options.onNeedReload?.())
  expect(reload).not.toHaveBeenCalled()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Обновить приложение' })))
  expect(reload).toHaveBeenCalledOnce(); expect(update).not.toHaveBeenCalled()
})

it('blocks activation while a real write is in flight, preserving fetch arguments and response', async () => {
  let finish!: (response: Response) => void
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { finish = resolve }))
  render(<PwaUpdateNotice controller={controller} />)
  act(() => options.onNeedRefresh?.())
  const init = { method: 'POST', body: '{"value":1}', headers: { 'x-test': 'unchanged' } }
  let request!: Promise<Response>
  act(() => { request = trackedSupabaseFetch('https://example.test/rest/v1/items', init) })
  expect(screen.getByRole('button', { name: 'Обновить приложение' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Позже' })).toBeEnabled()
  await act(async () => controller.apply())
  expect(update).not.toHaveBeenCalled()
  const response = new Response('{}')
  await act(async () => { finish(response); expect(await request).toBe(response) })
  expect(fetchMock).toHaveBeenCalledWith('https://example.test/rest/v1/items', init)
  expect(screen.getByRole('button', { name: 'Обновить приложение' })).toBeEnabled()
})

it('does not reload automatically after a write interrupts an explicitly requested update', async () => {
  let finish!: (response: Response) => void
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await controller.apply()
  const request = trackedSupabaseFetch(new Request('https://example.test/rest/v1/items', { method: 'PATCH' }))
  options.onNeedReload?.()
  expect(reload).not.toHaveBeenCalled()
  finish(new Response('{}')); await request
  expect(reload).not.toHaveBeenCalled()
  await controller.apply(); expect(reload).toHaveBeenCalledOnce()
})

it('releases the write count after rejection and does not count reads', async () => {
  const failure = new Error('Offline')
  vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(failure).mockResolvedValueOnce(new Response('{}'))
  await expect(trackedSupabaseFetch('https://example.test', { method: 'DELETE' })).rejects.toBe(failure)
  expect(getPendingWrites()).toBe(0)
  await trackedSupabaseFetch('https://example.test', { method: 'GET' })
  expect(getPendingWrites()).toBe(0)
})

it('keeps the guard until all concurrent writes finish and leaves reads uncounted', async () => {
  const finishes: Array<(response: Response) => void> = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => finishes.push(resolve)))
  const first = trackedSupabaseFetch('https://example.test/first', { method: 'POST' })
  const second = trackedSupabaseFetch('https://example.test/second', { method: 'PATCH' })
  const read = trackedSupabaseFetch('https://example.test/read')
  expect(getPendingWrites()).toBe(2)
  finishes[0](new Response('{}')); await first
  expect(getPendingWrites()).toBe(1)
  await controller.apply(); expect(update).not.toHaveBeenCalled()
  finishes[1](new Response('{}')); await second
  expect(getPendingWrites()).toBe(0)
  finishes[2](new Response('{}')); await read
  await controller.apply(); expect(update).toHaveBeenCalledOnce()
})

it('respects an existing busy form before its request reaches fetch', () => {
  render(<><form aria-busy="true"><input aria-label="Сохраняется" /></form><PwaUpdateNotice controller={controller} /></>)
  act(() => options.onNeedRefresh?.())
  fireEvent.click(screen.getByRole('button', { name: 'Обновить приложение' }))
  expect(window.confirm).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled()
  expect(screen.getByText('Дождись завершения текущей операции и повтори обновление.')).toBeVisible()
})

it('shows registration update errors and recovers from an activation that never finishes', async () => {
  update.mockRejectedValueOnce(new Error('Network'))
  await controller.apply()
  expect(controller.getSnapshot()).toMatchObject({ applying: false, message: expect.stringContaining('Не удалось') })
  vi.useFakeTimers()
  await controller.apply()
  vi.advanceTimersByTime(15_000)
  expect(controller.getSnapshot()).toMatchObject({ applying: false, message: expect.stringContaining('повторить позже') })
  options.onNeedReload?.()
  expect(reload).not.toHaveBeenCalled()
})

it('checks for a new worker on return to the app without activating it or losing text', async () => {
  vi.useFakeTimers()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  render(<><input aria-label="Черновик" defaultValue="Мой ввод" /><PwaUpdateNotice controller={controller} /></>)
  const check = vi.fn().mockResolvedValue(undefined)
  options.onRegisteredSW?.('/sw.js', { update: check } as unknown as ServiceWorkerRegistration)
  fireEvent.focus(window)
  expect(check).not.toHaveBeenCalled()
  vi.advanceTimersByTime(60_000)
  await act(async () => fireEvent(document, new Event('visibilitychange')))
  expect(check).toHaveBeenCalledOnce()
  fireEvent.focus(window); fireEvent(window, new Event('online'))
  expect(check).toHaveBeenCalledOnce()
  act(() => options.onNeedRefresh?.())
  expect(screen.getByRole('textbox', { name: 'Черновик' })).toHaveValue('Мой ввод')
  expect(screen.getByText('Доступно обновление')).toBeVisible()
  expect(update).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled()
})

it('skips background and offline checks, recovers after a network error, and removes listeners', async () => {
  vi.useFakeTimers()
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  const check = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(undefined)
  options.onRegisteredSW?.('/sw.js', { update: check } as unknown as ServiceWorkerRegistration)
  vi.advanceTimersByTime(60_000)
  fireEvent.focus(window)
  visibility.mockReturnValue('visible')
  fireEvent.focus(window)
  expect(check).not.toHaveBeenCalled()
  online.mockReturnValue(true)
  await act(async () => fireEvent(window, new Event('online')))
  expect(check).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(60_000)
  await act(async () => fireEvent.focus(window))
  expect(check).toHaveBeenCalledTimes(2)
  expect(update).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled()
  controller.dispose()
  vi.advanceTimersByTime(60_000)
  fireEvent.focus(window); fireEvent(document, new Event('visibilitychange')); fireEvent(window, new Event('online'))
  expect(check).toHaveBeenCalledTimes(2)
})
