import { describe, expect, it } from 'vitest'
import type { ActionItem } from '../types'
import { dailyFocus } from './focus'

const date = '2026-08-27'
const action = (id: string, extras: Partial<ActionItem> = {}): ActionItem => ({
  id, user_id: 'user-a', goal_id: 'goal-1', title: id, status: 'todo', due_date: null,
  focus_date: null, focus_position: null, result_note: '', completed_at: null,
  created_at: '2026-08-20T08:00:00.000Z', updated_at: '2026-08-20T08:00:00.000Z', ...extras,
})

describe('canonical Focus 3 model', () => {
  it('counts completed actions as occupied slots', () => {
    const state = dailyFocus([
      action('done', { status: 'done', focus_date: date, focus_position: 1 }),
      action('todo', { focus_date: date, focus_position: 2 }),
      action('available'),
    ], date)
    expect(state).toMatchObject({ usedSlots: 2, availableSlots: 1, completed: 1 })
    expect(state.suggestions.map((item) => item.id)).toEqual(['available'])
  })

  it('offers no fourth action when three slots include a completed one', () => {
    const state = dailyFocus([
      action('done', { status: 'done', focus_date: date, focus_position: 1 }),
      action('two', { focus_date: date, focus_position: 2 }),
      action('three', { focus_date: date, focus_position: 3 }),
      action('four'),
    ], date)
    expect(state.availableSlots).toBe(0)
    expect(state.suggestions).toEqual([])
  })

  it('limits suggestions to available slots and releases exactly one removed slot', () => {
    const actions = [
      action('one', { focus_date: date, focus_position: 1 }),
      action('two', { focus_date: date, focus_position: 2 }),
      action('early', { due_date: '2026-08-28' }),
      action('late', { due_date: '2026-09-01' }),
    ]
    expect(dailyFocus(actions, date).suggestions.map((item) => item.id)).toEqual(['early'])
    const removed = actions.map((item) => item.id === 'two' ? { ...item, focus_date: null, focus_position: null } : item)
    expect(dailyFocus(removed, date).availableSlots).toBe(2)
    expect(dailyFocus(removed, date).suggestions.map((item) => item.id)).toEqual(['early', 'late'])
  })
})
