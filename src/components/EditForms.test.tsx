import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useState, type ReactNode } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionItem, Goal, Habit } from '../types'
import { ActionEditForm, GoalEditForm, HabitEditForm } from './EditForms'

const mocks = vi.hoisted(() => ({
  updateGoal: vi.fn(),
  updateAction: vi.fn(),
  updateHabit: vi.fn(),
  clearMutationError: vi.fn(),
  busyScope: '',
}))

vi.mock('../context/DataContext', () => ({
  useData: () => ({
    data: { areas: [{ id: 'area-1', name: 'Здоровье' }] },
    updateGoal: mocks.updateGoal,
    updateAction: mocks.updateAction,
    updateHabit: mocks.updateHabit,
    clearMutationError: mocks.clearMutationError,
    isMutating: (scope: string) => scope === mocks.busyScope,
  }),
}))

const timestamp = '2026-08-28T08:00:00.000Z'
const goal: Goal = {
  id: 'goal-1', user_id: 'user-a', area_id: 'area-1', title: 'Исходная цель',
  description: 'Подробности', why: 'Важно', kind: 'project', status: 'active', progress: 0,
  target_date: '2026-12-01', completed_at: null, created_at: timestamp, updated_at: timestamp,
  revision: 4, last_mutation_id: null,
}
const action: ActionItem = {
  id: 'action-1', user_id: 'user-a', goal_id: 'goal-1', title: 'Позвонить',
  status: 'done', due_date: '2026-09-01', focus_date: null, focus_position: null,
  result_note: 'Договорились', completed_at: timestamp, created_at: timestamp, updated_at: timestamp,
  revision: 3, last_mutation_id: null,
}
const habit: Habit = {
  id: 'habit-1', user_id: 'user-a', area_id: 'area-1', title: 'Читать', target_per_week: 5,
  active: true, activity_periods: [{ started_on: '2026-08-24', ended_on: null }],
  created_at: timestamp, updated_at: timestamp, revision: 2, last_mutation_id: null,
}

let setGlobalError: ((message: string | null) => void) | null = null
function ErrorChannels({ children }: { children: ReactNode }) {
  const [globalError, setError] = useState<string | null>(null)
  useEffect(() => {
    setGlobalError = setError
    return () => { setGlobalError = null }
  }, [])
  return <>{globalError && <p data-testid="global-mutation-error" role="alert">{globalError}</p>}{children}</>
}

describe('edit sheets', () => {
  beforeEach(() => {
    mocks.busyScope = ''
    mocks.updateGoal.mockReset().mockResolvedValue(undefined)
    mocks.updateAction.mockReset().mockResolvedValue(undefined)
    mocks.updateHabit.mockReset().mockResolvedValue(undefined)
    mocks.clearMutationError.mockReset()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('prefills every editable goal field and saves the complete form', async () => {
    const onClose = vi.fn()
    render(<GoalEditForm goal={goal} onClose={onClose} />)
    expect(screen.getByLabelText('Название')).toHaveValue('Исходная цель')
    expect(screen.getByLabelText('Сфера')).toHaveValue('area-1')
    expect(screen.getByLabelText('Желаемый срок')).toHaveValue('2026-12-01')
    expect(screen.getByLabelText('Зачем это вам?')).toHaveValue('Важно')
    expect(screen.getByLabelText('Описание')).toHaveValue('Подробности')
    expect(screen.getByRole('button', { name: 'Проект' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Цель' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.clear(screen.getByLabelText('Название'))
    await userEvent.type(screen.getByLabelText('Название'), 'Новая цель')
    await userEvent.click(screen.getByRole('button', { name: 'Цель' }))
    expect(screen.getByRole('button', { name: 'Цель' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(mocks.updateGoal).toHaveBeenCalledWith('goal-1', expect.objectContaining({
      title: 'Новая цель', kind: 'goal', area_id: 'area-1', target_date: '2026-12-01',
      why: 'Важно', description: 'Подробности',
    }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('retains action inputs and error when save fails', async () => {
    mocks.updateAction.mockImplementationOnce(async () => {
      setGlobalError?.('Глобально: конфликт ревизии')
      throw new Error('Конфликт ревизии')
    })
    mocks.clearMutationError.mockImplementation(() => { setGlobalError?.(null) })
    render(<ErrorChannels><ActionEditForm action={action} onClose={vi.fn()} /></ErrorChannels>)
    await userEvent.clear(screen.getByLabelText('Название'))
    await userEvent.type(screen.getByLabelText('Название'), 'Новый шаг')
    await userEvent.type(screen.getByLabelText('Комментарий к результату'), ' — уточнение')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Конфликт ревизии')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.queryByTestId('global-mutation-error')).not.toBeInTheDocument()
    expect(mocks.clearMutationError).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Название')).toHaveValue('Новый шаг')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it.each([
    ['goal', () => mocks.updateGoal, () => <GoalEditForm goal={goal} onClose={vi.fn()} />],
    ['habit', () => mocks.updateHabit, () => <HabitEditForm habit={habit} onClose={vi.fn()} />],
  ])('keeps %s update failure in the local error channel', async (_name, mutation, form) => {
    mutation().mockRejectedValueOnce(new Error('Локальная ошибка'))
    render(form())
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Локальная ошибка')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(mocks.clearMutationError).toHaveBeenCalledTimes(1)
  })

  it('asks before discarding a dirty form and keeps it open when declined', async () => {
    const onClose = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<HabitEditForm habit={habit} onClose={onClose} />)
    await userEvent.clear(screen.getByLabelText('Название'))
    await userEvent.type(screen.getByLabelText('Название'), 'Гулять')
    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(window.confirm).toHaveBeenCalledWith('Закрыть без сохранения изменений?')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Название')).toHaveValue('Гулять')
  })

  it('blocks close, backdrop and submit controls while the entity is saving', () => {
    mocks.busyScope = 'action'
    const onClose = vi.fn()
    render(<ActionEditForm action={action} onClose={onClose} />)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Отмена' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Сохраняем…' })).toBeDisabled()
    expect(screen.getAllByRole('textbox').every((field) => (field as HTMLInputElement).disabled)).toBe(true)
    fireEvent.mouseDown(screen.getByRole('presentation'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('traps focus, makes the background inert, locks scroll and restores the opener', async () => {
    function Host() {
      const [open, setOpen] = useState(false)
      return <main data-testid="background"><button type="button" onClick={() => setOpen(true)}>Открыть редактор</button>{open && <ActionEditForm action={action} onClose={() => setOpen(false)} />}</main>
    }
    const { container } = render(<Host />)
    const opener = screen.getByRole('button', { name: 'Открыть редактор' })
    await userEvent.click(opener)

    expect(screen.getByLabelText('Название')).toHaveFocus()
    expect(container).toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('hidden')

    const first = screen.getByRole('button', { name: 'Закрыть' })
    const last = screen.getByRole('button', { name: 'Сохранить' })
    first.focus()
    await userEvent.tab({ shift: true })
    expect(last).toHaveFocus()
    await userEvent.tab()
    expect(first).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(container).not.toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('')
    expect(opener).toHaveFocus()
  })

  it('freezes every edit value until a controlled save promise settles', async () => {
    let release: (() => void) | undefined
    mocks.updateAction.mockReturnValueOnce(new Promise<void>((resolve) => { release = resolve }))
    const onClose = vi.fn()
    render(<ActionEditForm action={action} onClose={onClose} />)
    const title = screen.getByLabelText('Название')
    await userEvent.clear(title)
    await userEvent.type(title, 'Зафиксированный шаг')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    const fields = Array.from(screen.getByRole('dialog').querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'))
    expect(fields.every((field) => field.disabled)).toBe(true)
    fireEvent.change(title, { target: { value: 'Поздний ввод' } })
    expect(title).toHaveValue('Зафиксированный шаг')
    expect(mocks.updateAction).toHaveBeenCalledWith('action-1', expect.objectContaining({ title: 'Зафиксированный шаг' }))

    await act(async () => { release?.() })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('saves every editable habit field without touching activity history', async () => {
    render(<HabitEditForm habit={habit} onClose={vi.fn()} />)
    await userEvent.selectOptions(screen.getByLabelText('Раз в неделю'), '3')
    await userEvent.selectOptions(screen.getByLabelText('Сфера'), '')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(mocks.updateHabit).toHaveBeenCalledWith('habit-1', {
      title: 'Читать', target_per_week: 3, area_id: null,
    })
  })
})
