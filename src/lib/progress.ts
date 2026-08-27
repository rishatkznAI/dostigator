import type { ActionItem, Goal, Habit, HabitCheckin } from '../types'
import { localDate, weekDates } from './date'

export function goalProgress(goal: Goal, actions: ActionItem[]) {
  const own = actions.filter((item) => item.goal_id === goal.id && item.status !== 'cancelled')
  if (!own.length) return goal.progress
  return Math.round((own.filter((item) => item.status === 'done').length / own.length) * 100)
}

export function habitStreak(habitId: string, checkins: HabitCheckin[], now = new Date()) {
  const completed = new Set(checkins.filter((item) => item.habit_id === habitId).map((item) => item.checked_on))
  let cursor = new Date(now)
  if (!completed.has(localDate(cursor))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (completed.has(localDate(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

export function disciplineScore(
  actions: ActionItem[],
  habits: Habit[],
  checkins: HabitCheckin[],
  weekStart: string,
) {
  const dates = new Set(weekDates(weekStart))
  const focus = actions.filter((item) => item.focus_date && dates.has(item.focus_date))
  const focusRate = focus.length ? focus.filter((item) => item.status === 'done').length / focus.length : 0
  const completedSteps = actions.filter((item) => item.completed_at && dates.has(item.completed_at.slice(0, 10))).length
  const activeHabits = habits.filter((item) => item.active)
  const expected = activeHabits.reduce((sum, item) => sum + item.target_per_week, 0)
  const actual = checkins.filter((item) => dates.has(item.checked_on) && activeHabits.some((habit) => habit.id === item.habit_id)).length
  const habitRate = expected ? Math.min(1, actual / expected) : 0
  return Math.round(focusRate * 50 + habitRate * 30 + Math.min(1, completedSteps / 5) * 20)
}
