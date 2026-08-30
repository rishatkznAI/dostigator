import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { SettingsPage } from './SettingsPage'

const mocks = vi.hoisted(() => ({
  authUser: { id: 'user-a', email: 'a@example.com', user_metadata: { display_name: 'Старый ник' } } as { id: string; email: string; user_metadata?: { display_name?: string } } | null,
  dataState: {
    data: { areas: [], goals: [], actions: [], habits: [], checkins: [], reviews: [] },
    pending: 0,
    failedSync: 0,
    quarantinedSync: 2,
    legacySyncQuarantine: false,
    syncing: false,
    online: true,
  },
  clearQuarantine: vi.fn(),
  readQuarantine: vi.fn(),
  retrySync: vi.fn(),
  refresh: vi.fn(),
  resolveFailedSync: vi.fn(),
  assertActiveOwner: vi.fn(),
  importBackup: vi.fn(),
  isBackup: vi.fn(),
  makeBackup: vi.fn(),
  previewBackup: vi.fn(),
  loadAllHistory: vi.fn(),
  updateDisplayName: vi.fn(),
  updatePassword: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: mocks.authUser, updateDisplayName: mocks.updateDisplayName, updatePassword: mocks.updatePassword, signOut: mocks.signOut }),
}))
vi.mock('../context/DataContext', () => ({
  useData: () => ({
    ...mocks.dataState,
    retrySync: mocks.retrySync,
    refresh: mocks.refresh,
    resolveFailedSync: mocks.resolveFailedSync,
  }),
}))
vi.mock('../context/OnboardingContext', () => ({ useOnboarding: () => ({ restart: vi.fn() }) }))
vi.mock('../lib/offline', () => ({
  clearQuarantine: mocks.clearQuarantine,
  readQuarantine: mocks.readQuarantine,
  queueStats: () => ({
    pending: mocks.dataState.pending,
    failed: mocks.dataState.failedSync,
    quarantined: mocks.dataState.quarantinedSync,
    legacyQuarantined: mocks.dataState.legacySyncQuarantine,
  }),
}))
vi.mock('../lib/repository', () => ({
  assertActiveOwner: mocks.assertActiveOwner,
  importBackup: mocks.importBackup,
  isBackup: mocks.isBackup,
  makeBackup: mocks.makeBackup,
  previewBackup: mocks.previewBackup,
  loadAllHistory: mocks.loadAllHistory,
}))

const page = () => <MemoryRouter><SettingsPage /></MemoryRouter>
const renderPage = () => render(page())

describe('backup and sync controls', () => {
  beforeEach(() => {
    mocks.authUser = { id: 'user-a', email: 'a@example.com', user_metadata: { display_name: 'Старый ник' } }
    Object.assign(mocks.dataState, {
      data: { areas: [], goals: [], actions: [], habits: [], checkins: [], reviews: [] },
      pending: 0,
      failedSync: 0,
      quarantinedSync: 2,
      legacySyncQuarantine: false,
      syncing: false,
      online: true,
    })
    mocks.clearQuarantine.mockReset()
    mocks.readQuarantine.mockReset().mockReturnValue({ product: 'dostigator-sync-quarantine', corrupt: 'owner-a-data' })
    mocks.loadAllHistory.mockReset().mockResolvedValue([])
    mocks.assertActiveOwner.mockReset().mockResolvedValue(undefined)
    mocks.makeBackup.mockReset().mockReturnValue({})
    mocks.previewBackup.mockReset().mockReturnValue({
      counts: { areas: 1, goals: 2, actions: 3, habits: 1, checkins: 4, reviews: 1, focusCommitments: 4 },
      total: 16,
      idMatches: 2,
      areaNameMatches: 1,
      areaIdentityConflicts: 0,
      dependencyConflicts: 0,
      conflicts: 0,
    })
    mocks.isBackup.mockReset().mockReturnValue(true)
    mocks.importBackup.mockReset().mockResolvedValue(undefined)
    mocks.refresh.mockReset().mockResolvedValue(undefined)
    mocks.resolveFailedSync.mockReset().mockResolvedValue(undefined)
    mocks.retrySync.mockReset().mockResolvedValue(undefined)
    mocks.updateDisplayName.mockReset().mockResolvedValue(undefined)
    mocks.updatePassword.mockReset().mockResolvedValue(undefined)
    mocks.signOut.mockReset().mockResolvedValue(undefined)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:quarantine')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('changes the nickname used by the application greeting', async () => {
    const user = userEvent.setup()
    renderPage()
    const input = screen.getByRole('textbox', { name: 'Ник' })
    expect(input).toHaveValue('Старый ник')

    await user.clear(input)
    await user.type(input, '  Ришат   KZN  ')
    await user.click(screen.getByRole('button', { name: 'Сохранить ник' }))

    expect(mocks.updateDisplayName).toHaveBeenCalledWith('Ришат KZN')
    expect(await screen.findByRole('status')).toHaveTextContent('Ник изменён')
  })

  it('downloads only the active owner quarantine', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /Скачать карантин/ }))
    expect(mocks.readQuarantine).toHaveBeenCalledWith('user-a')
    expect(mocks.readQuarantine).not.toHaveBeenCalledWith('user-b')
  })

  it('loads complete history and binds the backup to the expected owner', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Скачать JSON' }))
    expect(mocks.loadAllHistory).toHaveBeenCalledWith('user-a')
    expect(mocks.makeBackup).toHaveBeenCalledWith(mocks.dataState.data, [], 'user-a')
    expect(mocks.assertActiveOwner).toHaveBeenCalledWith('user-a')
  })

  it('does not download a prepared backup after an owner race is detected', async () => {
    mocks.assertActiveOwner
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Аккаунт изменился'))
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Скачать JSON' }))

    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent('Аккаунт изменился')
  })

  it.each([
    ['pending mutations', { pending: 1 }],
    ['failed mutations', { failedSync: 1 }],
    ['active synchronization', { syncing: true }],
    ['offline mode', { online: false }],
  ])('disables restore for %s', (_label, state) => {
    Object.assign(mocks.dataState, state)
    renderPage()
    expect(screen.getByRole('button', { name: 'Выбрать копию' })).toBeDisabled()
    expect(screen.getByLabelText('Файл резервной копии Достигатора')).toBeDisabled()
  })

  it('passes an owner and live mutation guard into import', async () => {
    renderPage()
    const file = { name: 'backup.json', text: vi.fn().mockResolvedValue('{}') }
    fireEvent.change(screen.getByLabelText('Файл резервной копии Достигатора'), { target: { files: [file] } })

    const preview = await screen.findByRole('region', { name: 'backup.json' })
    expect(preview).toHaveTextContent('Всего записей: 16')
    expect(preview).toHaveTextContent('совпадений по ID: 2')
    expect(preview).toHaveTextContent('сфер, сопоставленных по имени: 1')
    expect(preview).toHaveTextContent('История трёх главных действий: 4')
    expect(mocks.importBackup).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить восстановление' }))
    await waitFor(() => expect(mocks.importBackup).toHaveBeenCalledTimes(1))
    expect(mocks.importBackup).toHaveBeenCalledWith(expect.anything(), 'user-a', expect.any(Function), expect.any(String))
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it('blocks a restore whose area ID and name resolve to different current areas', async () => {
    mocks.previewBackup.mockReturnValue({
      counts: { areas: 1, goals: 0, actions: 0, habits: 0, checkins: 0, reviews: 0, focusCommitments: 0 },
      total: 1,
      idMatches: 1,
      areaNameMatches: 1,
      areaIdentityConflicts: 1,
      dependencyConflicts: 0,
      conflicts: 1,
    })
    renderPage()
    const file = { name: 'conflict.json', text: vi.fn().mockResolvedValue('{}') }
    fireEvent.change(screen.getByLabelText('Файл резервной копии Достигатора'), { target: { files: [file] } })

    expect(await screen.findByRole('alert')).toHaveTextContent('Конфликтов ID и имени сферы: 1')
    expect(screen.getByRole('button', { name: 'Подтвердить восстановление' })).toBeDisabled()
    expect(mocks.importBackup).not.toHaveBeenCalled()
  })

  it('blocks a restore with orphaned backup relationships and explains the dependency conflict', async () => {
    mocks.previewBackup.mockReturnValue({
      counts: { areas: 0, goals: 1, actions: 1, habits: 0, checkins: 0, reviews: 0, focusCommitments: 1 },
      total: 3,
      idMatches: 0,
      areaNameMatches: 0,
      areaIdentityConflicts: 0,
      dependencyConflicts: 1,
      conflicts: 1,
    })
    renderPage()
    const file = { name: 'orphan.json', text: vi.fn().mockResolvedValue('{}') }
    fireEvent.change(screen.getByLabelText('Файл резервной копии Достигатора'), { target: { files: [file] } })

    expect(await screen.findByRole('alert')).toHaveTextContent('Разорванных связей: 1')
    expect(screen.getByRole('button', { name: 'Подтвердить восстановление' })).toBeDisabled()
    expect(mocks.importBackup).not.toHaveBeenCalled()
  })

  it('reuses one import id when a committed restore response is lost and the user retries', async () => {
    mocks.importBackup.mockRejectedValueOnce(new Error('Ответ сервера потерян')).mockResolvedValueOnce(undefined)
    renderPage()
    const file = { name: 'retry.json', text: vi.fn().mockResolvedValue('{}') }
    fireEvent.change(screen.getByLabelText('Файл резервной копии Достигатора'), { target: { files: [file] } })
    await screen.findByRole('region', { name: 'retry.json' })

    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить восстановление' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ответ сервера потерян')
    const firstImportId = mocks.importBackup.mock.calls[0][3]
    expect(firstImportId).toEqual(expect.any(String))

    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить восстановление' }))
    expect(mocks.importBackup).toHaveBeenCalledTimes(2)
    expect(mocks.importBackup.mock.calls[1][3]).toBe(firstImportId)
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it('does not start import if the mutation queue becomes active while reading the file', async () => {
    let resolveText: ((value: string) => void) | undefined
    const file = { text: vi.fn(() => new Promise<string>((resolve) => { resolveText = resolve })) }
    const view = renderPage()
    fireEvent.change(screen.getByLabelText('Файл резервной копии Достигатора'), { target: { files: [file] } })
    await waitFor(() => expect(file.text).toHaveBeenCalledTimes(1))

    mocks.dataState.pending = 1
    view.rerender(page())
    resolveText?.('{}')

    await waitFor(() => expect(screen.getByText(/Сначала завершите синхронизацию/)).toBeInTheDocument())
    expect(mocks.importBackup).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('keeps quarantine when deletion confirmation is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Удалить карантин' }))
    expect(mocks.clearQuarantine).not.toHaveBeenCalled()
  })

  it('clears only the active owner quarantine after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Удалить карантин' }))
    expect(mocks.clearQuarantine).toHaveBeenCalledWith('user-a')
    expect(mocks.clearQuarantine).not.toHaveBeenCalledWith('user-b')
  })

  it('does not render a stray zero when all sync counters are empty', () => {
    mocks.dataState.quarantinedSync = 0
    renderPage()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.getByText('Все изменения сохранены')).toBeInTheDocument()
  })

  it('runs backup preparation single-flight and exposes its busy state', async () => {
    let release: ((value: unknown[]) => void) | undefined
    mocks.loadAllHistory.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    renderPage()
    const download = screen.getByRole('button', { name: 'Скачать JSON' })

    fireEvent.click(download)
    fireEvent.click(download)
    expect(mocks.loadAllHistory).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Готовим…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Готовим…' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Выбрать копию' })).toBeDisabled()

    release?.([])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Скачать JSON' })).toBeEnabled())
  })

  it('runs password updates single-flight and keeps a localized failure', async () => {
    let reject: ((reason: Error) => void) | undefined
    mocks.updatePassword.mockReturnValueOnce(new Promise((_, rejectPromise) => { reject = rejectPromise }))
    renderPage()
    const password = 'длинный-пароль-123'
    await userEvent.type(screen.getByLabelText('Новый пароль'), password)
    await userEvent.type(screen.getByLabelText('Повторите пароль'), password)
    const form = screen.getByRole('button', { name: 'Изменить пароль' }).closest('form') as HTMLFormElement

    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(mocks.updatePassword).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Изменяем…' })).toHaveAttribute('aria-busy', 'true')
    reject?.(new Error('Сервис временно недоступен'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Сервис временно недоступен')
  })

  it('reports refresh failures and prevents other settings operations while syncing', async () => {
    let reject: ((reason: unknown) => void) | undefined
    mocks.refresh.mockReturnValueOnce(new Promise((_, rejectPromise) => { reject = rejectPromise }))
    renderPage()
    const refresh = screen.getByRole('button', { name: 'Обновить' })
    fireEvent.click(refresh)
    fireEvent.click(refresh)

    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: /Выйти/ })).toBeDisabled()
    reject?.('network')
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось обновить данные')
  })

  it('runs sign-out single-flight and shows a localized error', async () => {
    let reject: ((reason: unknown) => void) | undefined
    mocks.signOut.mockReturnValueOnce(new Promise((_, rejectPromise) => { reject = rejectPromise }))
    renderPage()
    const button = screen.getByRole('button', { name: /Выйти/ })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /Выходим/ })).toHaveAttribute('aria-busy', 'true')
    reject?.('network')
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось выйти из аккаунта')
  })
})
