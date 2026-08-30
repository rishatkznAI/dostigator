import { localDate } from './date'
import type { ActionItem } from '../types'

export const FOCUS_LIMIT = 3

export function dailyFocus(actions: ActionItem[], date = localDate()) {
  const focusedToday = actions
    .filter((item) => item.focus_date === date && item.status !== 'cancelled')
    .sort((a, b) => (a.focus_position ?? FOCUS_LIMIT + 1) - (b.focus_position ?? FOCUS_LIMIT + 1))
  const usedSlots = focusedToday.length
  const availableSlots = Math.max(0, FOCUS_LIMIT - usedSlots)
  const suggestions = actions
    .filter((item) => item.status === 'todo' && item.focus_date !== date)
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
    .slice(0, availableSlots)
  return {
    focusedToday,
    usedSlots,
    availableSlots,
    suggestions,
    completed: focusedToday.filter((item) => item.status === 'done').length,
  }
}
