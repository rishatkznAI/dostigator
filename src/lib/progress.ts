import type { ActionItem, FocusCommitment, Goal, Habit, HabitCheckin, WeeklyMetrics } from '../types'
import { localDate, localDateFromTimestamp, shiftDate, weekAsOf, weekDates } from './date'

export interface GoalStepProgress {
  done: number
  total: number
  percent: number | null
  resultReached: boolean
}

export function goalProgress(goal: Goal, actions: ActionItem[]): GoalStepProgress {
  const own = actions.filter((item) => item.goal_id === goal.id && item.user_id === goal.user_id && item.status !== 'cancelled')
  const done = own.filter((item) => item.status === 'done').length
  return {
    done,
    total: own.length,
    percent: own.length ? Math.round((done / own.length) * 100) : null,
    resultReached: goal.status === 'completed',
  }
}

export function habitStreak(habitId: string, checkins: HabitCheckin[], now = new Date(), ownerId?: string) {
  const today = localDate(now)
  const completed = new Set(checkins
    .filter((item) => item.habit_id === habitId && item.checked_on <= today && (!ownerId || item.user_id === ownerId))
    .map((item) => item.checked_on))
  let cursor = new Date(now)
  if (!completed.has(localDate(cursor))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (completed.has(localDate(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

function activeDates(habit: Habit, weekStart: string, asOf: string) {
  const periods = habit.activity_periods?.length
    ? habit.activity_periods
    : [{ started_on: localDateFromTimestamp(habit.created_at) ?? weekStart, ended_on: habit.active ? null : localDateFromTimestamp(habit.updated_at) }]
  const active = new Set<string>()
  for (const period of periods) {
    if (!period?.started_on || !/^\d{4}-\d{2}-\d{2}$/.test(period.started_on) || period.ended_on && !/^\d{4}-\d{2}-\d{2}$/.test(period.ended_on)) continue
    const from = period.started_on < weekStart ? weekStart : period.started_on
    const until = !period.ended_on || period.ended_on > asOf ? asOf : period.ended_on
    if (from > until) continue
    let cursor = from
    while (cursor <= until) {
      active.add(cursor)
      cursor = shiftDate(cursor, 1)
    }
  }
  return active
}

function metricRate(done: number, total: number) {
  return total ? Math.min(1, Math.max(0, done / total)) : 0
}

export function weeklyMetrics(
  actions: ActionItem[],
  habits: Habit[],
  checkins: HabitCheckin[],
  weekStart: string,
  today = localDate(),
  ownerId?: string,
  commitments: FocusCommitment[] = [],
): WeeklyMetrics {
  const asOf = weekAsOf(weekStart, today)
  const dates = new Set(weekDates(weekStart).filter((date) => date <= asOf))
  const ownedActions = actions.filter((item) => !ownerId || item.user_id === ownerId)
  const ownedHabits = habits.filter((item) => !ownerId || item.user_id === ownerId)
  const habitIds = new Set(ownedHabits.map((item) => item.id))

  const ownedCommitments = [...new Map(commitments
    .filter((item) => (!ownerId || item.user_id === ownerId) && dates.has(item.committed_on))
    .map((item) => [`${item.action_id}:${item.committed_on}`, item])).values()]
  const commitmentKeys = new Set(ownedCommitments.map((item) => `${item.action_id}:${item.committed_on}`))
  // A legacy/cache fallback preserves current focus data until the first refresh
  // after the ledger migration. A matching durable row always wins.
  const legacyCommitments = ownedActions
    .filter((item) => item.status !== 'cancelled' && !!item.focus_date && dates.has(item.focus_date))
    .filter((item) => !commitmentKeys.has(`${item.id}:${item.focus_date}`))
    .map((item) => ({ action_id: item.id, committed_on: item.focus_date! }))
  const focusCommitments = [...ownedCommitments, ...legacyCommitments]
  const actionsById = new Map(ownedActions.map((item) => [item.id, item]))
  const focusDone = focusCommitments.filter((commitment) => {
    const item = actionsById.get(commitment.action_id)
    if (!item || item.status !== 'done') return false
    const completedOn = localDateFromTimestamp(item.completed_at)
    return !!completedOn && dates.has(completedOn) && completedOn >= commitment.committed_on
  }).length
  const focus = focusCommitments.length
    ? { done: focusDone, committed: focusCommitments.length, rate: metricRate(focusDone, focusCommitments.length) }
    : null

  let expected = 0
  const habitExpectations = new Map<string, { expected: number; active: Set<string> }>()
  for (const habit of ownedHabits) {
    const active = activeDates(habit, weekStart, asOf)
    const target = Math.min(7, Math.max(1, Math.round(habit.target_per_week)))
    const habitExpected = active.size ? Math.min(target, Math.ceil((target * active.size) / 7)) : 0
    expected += habitExpected
    habitExpectations.set(habit.id, { expected: habitExpected, active })
  }
  const uniqueCheckins = new Set(checkins
    .filter((item) => habitIds.has(item.habit_id) && (!ownerId || item.user_id === ownerId) && dates.has(item.checked_on))
    .filter((item) => {
      const habit = ownedHabits.find((candidate) => candidate.id === item.habit_id)
      const createdOn = habit ? localDateFromTimestamp(habit.created_at) : null
      return (!createdOn || item.checked_on >= createdOn) && !!habitExpectations.get(item.habit_id)?.active.has(item.checked_on)
    })
    .map((item) => `${item.habit_id}:${item.checked_on}`))
  const habitDone = [...habitExpectations.entries()].reduce((sum, [habitId, expectation]) => {
    const done = [...uniqueCheckins].filter((key) => key.startsWith(`${habitId}:`)).length
    return sum + Math.min(done, expectation.expected)
  }, 0)
  const habitsMetric = expected
    ? { done: habitDone, expected, rate: metricRate(habitDone, expected) }
    : null

  const completed = new Set(ownedActions.filter((item) => {
    if (item.status !== 'done') return false
    const completedOn = localDateFromTimestamp(item.completed_at)
    return !!completedOn && dates.has(completedOn)
  }).map((item) => item.id)).size
  const hasActionCommitment = focusCommitments.length > 0 || ownedActions.some((item) => item.status !== 'cancelled' && (
    (!!item.focus_date && dates.has(item.focus_date))
    || ((localDateFromTimestamp(item.created_at) ?? '') >= weekStart && (localDateFromTimestamp(item.created_at) ?? '') <= asOf)
    || !!(item.status === 'done' && item.completed_at && dates.has(localDateFromTimestamp(item.completed_at) ?? ''))
  ))
  const actionTarget = Math.min(5, Math.ceil((5 * dates.size) / 7))
  const actionsMetric = hasActionCommitment
    ? { done: completed, target: actionTarget, rate: metricRate(completed, actionTarget) }
    : null

  const categories = [
    focus && { weight: 50, rate: focus.rate },
    habitsMetric && { weight: 30, rate: habitsMetric.rate },
    actionsMetric && { weight: 20, rate: actionsMetric.rate },
  ].filter((item): item is { weight: number; rate: number } => Boolean(item))
  const totalWeight = categories.reduce((sum, item) => sum + item.weight, 0)
  const score = totalWeight
    ? Math.max(0, Math.min(100, Math.round(categories.reduce((sum, item) => sum + item.rate * item.weight, 0) / totalWeight * 100)))
    : null

  return { score, focus, habits: habitsMetric, actions: actionsMetric, period: { weekStart, asOf } }
}

/** Compatibility wrapper. Product screens use weeklyMetrics and its breakdown. */
export function disciplineScore(actions: ActionItem[], habits: Habit[], checkins: HabitCheckin[], weekStart: string) {
  return weeklyMetrics(actions, habits, checkins, weekStart).score
}
