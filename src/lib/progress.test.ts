import { describe, expect, it } from 'vitest'
import { goalProgress, habitStreak, weeklyMetrics } from './progress'
import { weekDates } from './date'
import type { ActionItem, FocusCommitment, Goal, Habit, HabitCheckin } from '../types'

const goal = { id: 'goal-1', user_id: 'user-a', status: 'active', progress: 10 } as Goal
const action = (id: string, status: ActionItem['status'], extras: Partial<ActionItem> = {}) => ({
  id, user_id: 'user-a', goal_id: 'goal-1', status, focus_date: null, completed_at: null, created_at: '2026-08-24T08:00:00Z', ...extras,
}) as ActionItem
const habit = { id: 'habit-1', user_id: 'user-a', active: true, target_per_week: 2, activity_periods: [{ started_on: '2026-08-24', ended_on: null }], created_at: '2026-08-24T08:00:00Z', updated_at: '2026-08-24T08:00:00Z' } as Habit
const checkin = (date: string, extras: Partial<HabitCheckin> = {}) => ({ id: `${date}-${Math.random()}`, user_id: 'user-a', habit_id: 'habit-1', checked_on: date, ...extras }) as HabitCheckin
const commitment = (date: string, extras: Partial<FocusCommitment> = {}): FocusCommitment => ({
  id: `focus-${date}`, user_id: 'user-a', action_id: 'repeated', committed_on: date,
  position: 1, source_mutation_id: null, created_at: `${date}T08:00:00Z`, ...extras,
})

describe('progress rules', () => {
  it('derives goal progress from completed actions', () => {
    expect(goalProgress(goal, [action('1', 'done'), action('2', 'todo'), action('3', 'cancelled'), action('foreign', 'done', { user_id: 'user-b' })])).toEqual({ done: 1, total: 2, percent: 50, resultReached: false })
  })

  it('does not expose stale manual progress without actions', () => {
    expect(goalProgress(goal, [])).toEqual({ done: 0, total: 0, percent: null, resultReached: false })
  })

  it('keeps result completion distinct from the step ratio', () => {
    expect(goalProgress({ ...goal, status: 'completed' }, [action('1', 'done'), action('2', 'todo')])).toEqual({ done: 1, total: 2, percent: 50, resultReached: true })
  })

  it('counts a consecutive habit streak ending today', () => {
    const checkins = [checkin('2026-08-27'), checkin('2026-08-26'), checkin('2026-08-25')]
    expect(habitStreak('habit-1', checkins, new Date('2026-08-27T12:00:00'))).toBe(3)
  })

  it('returns no false zero for an empty user', () => {
    expect(weeklyMetrics([], [], [], '2026-08-24', '2026-08-24', 'user-a')).toEqual({ score: null, focus: null, habits: null, actions: null, period: { weekStart: '2026-08-24', asOf: '2026-08-24' } })
  })

  it('does not penalize an ideal Monday for future days or missing habits', () => {
    const result = weeklyMetrics([action('1', 'done', { focus_date: '2026-08-24', completed_at: '2026-08-24T12:00:00Z' })], [], [], '2026-08-24', '2026-08-24', 'user-a')
    expect(result.score).toBe(100)
    expect(result.actions).toMatchObject({ done: 1, target: 1, rate: 1 })
    expect(result.habits).toBeNull()
  })

  it.each([
    ['Monday', '2026-08-24', 1],
    ['Friday', '2026-08-28', 4],
    ['Sunday', '2026-08-30', 5],
  ])('keeps a perfect pace-aware action score on %s', (_day, today, expectedTarget) => {
    const actions = Array.from({ length: expectedTarget }, (_, index) => action(String(index), 'done', { completed_at: `${today}T12:00:00Z` }))
    const result = weeklyMetrics(actions, [], [], '2026-08-24', today, 'user-a')
    expect(result.actions).toEqual({ done: expectedTarget, target: expectedTarget, rate: 1 })
    expect(result.score).toBe(100)
  })

  it('requires a matching completion timestamp for focus and action credit', () => {
    const result = weeklyMetrics([
      action('missing', 'done', { focus_date: '2026-08-24', completed_at: null }),
      action('todo-with-date', 'todo', { focus_date: '2026-08-24', completed_at: '2026-08-24T12:00:00Z' }),
      action('cancelled', 'cancelled', { focus_date: '2026-08-24', completed_at: '2026-08-24T12:00:00Z' }),
    ], [], [], '2026-08-24', '2026-08-30', 'user-a')
    expect(result.focus).toMatchObject({ done: 0, committed: 2, rate: 0 })
    expect(result.actions).toMatchObject({ done: 0, target: 5, rate: 0 })
  })

  it('does not retroactively credit focus completed in a later week', () => {
    const result = weeklyMetrics([action('late', 'done', { focus_date: '2026-08-24', completed_at: '2026-08-31T12:00:00Z' })], [], [], '2026-08-24', '2026-09-10', 'user-a')
    expect(result.focus).toMatchObject({ done: 0, committed: 1 })
    expect(result.actions?.done).toBe(0)
  })

  it('counts the same action as two durable commitments when selected on Monday and Tuesday', () => {
    const repeated = action('repeated', 'done', {
      focus_date: '2026-08-25', focus_position: 1, completed_at: '2026-08-25T12:00:00Z',
    })
    const result = weeklyMetrics(
      [repeated], [], [], '2026-08-24', '2026-08-25', 'user-a',
      [commitment('2026-08-24'), commitment('2026-08-25')],
    )
    expect(result.focus).toEqual({ done: 2, committed: 2, rate: 1 })
  })

  it('credits only commitments made no later than the action completion', () => {
    const repeated = action('repeated', 'done', {
      focus_date: '2026-08-25', focus_position: 1, completed_at: '2026-08-24T12:00:00Z',
    })
    const result = weeklyMetrics(
      [repeated], [], [], '2026-08-24', '2026-08-25', 'user-a',
      [commitment('2026-08-24'), commitment('2026-08-25')],
    )
    expect(result.focus).toEqual({ done: 1, committed: 2, rate: .5 })
  })

  it('credits a 23:30 UTC completion to the next Moscow local day', () => {
    const timezone = process.env.TZ
    process.env.TZ = 'Europe/Moscow'
    try {
      const result = weeklyMetrics([action('boundary', 'done', { focus_date: '2026-08-31', completed_at: '2026-08-30T23:30:00Z' })], [], [], '2026-08-31', '2026-08-31', 'user-a')
      expect(result.focus).toMatchObject({ done: 1, committed: 1 })
      expect(result.actions).toMatchObject({ done: 1, target: 1 })
    } finally {
      process.env.TZ = timezone
    }
  })

  it('deduplicates valid check-ins and ignores orphan, future, pre-creation and foreign-owner rows', () => {
    const sundayHabit = { ...habit, target_per_week: 5, activity_periods: [{ started_on: '2026-08-30', ended_on: null }], created_at: '2026-08-30T08:00:00Z' }
    const result = weeklyMetrics([], [sundayHabit], [
      checkin('2026-08-30', { id: 'one' }),
      checkin('2026-08-30', { id: 'duplicate' }),
      checkin('2026-08-29', { id: 'before' }),
      checkin('2026-08-31', { id: 'future' }),
      checkin('2026-08-30', { id: 'foreign', user_id: 'user-b' }),
      checkin('2026-08-30', { id: 'orphan', habit_id: 'missing' }),
    ], '2026-08-24', '2026-08-30', 'user-a')
    expect(result.habits).toEqual({ done: 1, expected: 1, rate: 1 })
  })

  it('uses durable activity periods so pause and resume do not rewrite the week', () => {
    const paused = { ...habit, target_per_week: 7, activity_periods: [{ started_on: '2026-08-24', ended_on: '2026-08-26' }, { started_on: '2026-08-29', ended_on: null }] }
    const result = weeklyMetrics([], [paused], [checkin('2026-08-27'), checkin('2026-08-29')], '2026-08-24', '2026-08-30', 'user-a')
    expect(result.habits).toMatchObject({ done: 1, expected: 5 })
  })

  it('keeps score inside 0…100 when imports contain excessive rows', () => {
    const rows = Array.from({ length: 20 }, (_, index) => checkin(`2026-08-${String(24 + index % 7).padStart(2, '0')}`, { id: String(index) }))
    expect(weeklyMetrics([], [habit], rows, '2026-08-24', '2026-08-30', 'user-a').score).toBe(100)
  })

  it('does not let excess check-ins for one habit satisfy another habit', () => {
    const first = { ...habit, id: 'habit-1', target_per_week: 1 }
    const second = { ...habit, id: 'habit-2', target_per_week: 5 }
    const excess = weekDates('2026-08-24').map((date) => checkin(date, { id: date, habit_id: 'habit-1' }))
    const result = weeklyMetrics([], [first, second], excess, '2026-08-24', '2026-08-30', 'user-a')
    expect(result.habits).toMatchObject({ done: 1, expected: 6, rate: 1 / 6 })
  })
})
