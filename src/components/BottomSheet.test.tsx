import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BottomSheet } from './BottomSheet'
import { TrainingDisclosure } from './TrainingDisclosure'

function Harness({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false)
  return <><button type="button" onClick={() => setOpen(true)}>Открыть окно</button>{open && <BottomSheet title="Тестовое окно" busy={busy} onClose={() => setOpen(false)}><TrainingDisclosure title="Параметры"><input aria-label="Скрытое поле" /></TrainingDisclosure><button type="button">Последнее действие</button></BottomSheet>}</>
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('keeps focus and the inert background through the close animation, then restores the opener', () => {
  vi.useFakeTimers()
  const { container } = render(<Harness />)
  const opener = screen.getByRole('button', { name: 'Открыть окно' })
  opener.focus()
  fireEvent.click(opener)
  const close = screen.getByRole('button', { name: 'Закрыть' })
  const last = screen.getByRole('button', { name: 'Последнее действие' })
  expect(close).toHaveFocus()
  expect(container).toHaveAttribute('inert')
  last.focus(); fireEvent.keyDown(last, { key: 'Tab' }); expect(close).toHaveFocus()
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true }); expect(last).toHaveFocus()
  fireEvent.click(close)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(container).toHaveAttribute('inert')
  act(() => vi.advanceTimersByTime(160))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(container).not.toHaveAttribute('inert')
  expect(opener).toHaveFocus()
})

it('closes immediately with reduced motion and ignores dismissal during a busy operation', () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
  const view = render(<Harness busy />)
  const opener = screen.getByRole('button', { name: 'Открыть окно' })
  opener.focus(); fireEvent.click(opener)
  expect(screen.getByRole('button', { name: 'Закрыть' })).toBeDisabled()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  view.rerender(<Harness />)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Открыть окно' })).toHaveFocus()
})

it('keeps an operation mounted if it becomes busy during the close animation', () => {
  vi.useFakeTimers()
  const view = render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Открыть окно' }))
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
  view.rerender(<Harness busy />)
  act(() => vi.advanceTimersByTime(160))
  expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')
  expect(screen.getByRole('button', { name: 'Закрыть' })).toBeDisabled()
  view.rerender(<Harness />)
  fireEvent.keyDown(window, { key: 'Escape' })
  act(() => vi.advanceTimersByTime(160))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
