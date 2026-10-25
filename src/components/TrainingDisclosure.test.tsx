import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it } from 'vitest'
import { TrainingDisclosure } from './TrainingDisclosure'
import { visibleDialogControl } from '../lib/dialog-focus'

afterEach(cleanup)

it('announces expansion and keeps form values while the panel is collapsed', async () => {
  render(<TrainingDisclosure title="Готовность" description="Необязательная оценка"><input aria-label="Заметка" defaultValue="Мой ввод" /></TrainingDisclosure>)
  const trigger = screen.getByRole('button', { name: /Готовность/ })
  const input = document.querySelector('input')!
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(input.closest('[inert]')).not.toBeNull()
  expect(visibleDialogControl(input)).toBe(false)
  await userEvent.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText('Свернуть')).toBeVisible()
  fireEvent.change(input, { target: { value: 'Сохранённый ввод' } })
  await userEvent.click(trigger)
  expect(trigger).toHaveFocus()
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(input).toHaveValue('Сохранённый ввод')
  expect(screen.queryByRole('textbox', { name: 'Заметка' })).not.toBeInTheDocument()
  await userEvent.keyboard('{Enter}')
  expect(screen.getByRole('textbox', { name: 'Заметка' })).toHaveValue('Сохранённый ввод')
})
