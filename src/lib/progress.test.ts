import { describe, expect, it } from 'vitest'
import { disciplineScore, goalProgress, habitStreak } from './progress'
import type { ActionItem, Goal, Habit, HabitCheckin } from '../types'

const goal = { id: 'goal-1', progress: 10 } as Goal
const action = (id: string, status: ActionItem['status'], extras: Partial<ActionItem> = {}) => ({
  id, goal_id: 'goal-1', status, focus_date: null, completed_at: null, ...extras,
}) as ActionItem
const habit = { id: 'habit-1', active: true, target_per_week: 2 } as Habit
const checkin = (date: string) => ({ id: date, habit_id: 'habit-1', checked_on: date }) as HabitCheckin

describe('progress rules', () => {
  it('derives goal progress from completed actions', () => {
    expect(goalProgress(goal, [action('1', 'done'), action('2', 'todo'), action('3', 'cancelled')])).toBe(50)
  })

  it('falls back to manual goal progress without actions', () => {
    expect(goalProgress(goal, [])).toBe(10)
  })

  it('counts a consecutive habit streak ending today', () => {
    const checkins = [checkin('2026-08-27'), checkin('2026-08-26'), checkin('2026-08-25')]
    expect(habitStreak('habit-1', checkins, new Date('2026-08-27T12:00:00'))).toBe(3)
  })

  it('calculates the transparent weekly discipline score', () => {
    const actions = [
      action('1', 'done', { focus_date: '2026-08-24', completed_at: '2026-08-24T12:00:00Z' }),
      action('2', 'done', { completed_at: '2026-08-25T12:00:00Z' }),
    ]
    expect(disciplineScore(actions, [habit], [checkin('2026-08-24')], '2026-08-24')).toBe(73)
  })
})
