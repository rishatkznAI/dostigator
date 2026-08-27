import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { localDate, startOfWeek } from '../lib/date'
import { cacheData, loadAppData, readCachedData, stripOwnership } from '../lib/repository'
import { deleteOrQueue, flushQueue, persistOrQueue, readQueue } from '../lib/offline'
import type { ActionItem, AppData, Goal, GoalKind, Habit, HabitCheckin, WeeklyReview } from '../types'

interface NewGoal {
  title: string
  kind: GoalKind
  areaId: string | null
  targetDate: string | null
  why: string
  description?: string
}

interface DataValue {
  data: AppData
  loading: boolean
  error: string | null
  pending: number
  refresh(): Promise<void>
  addGoal(input: NewGoal): Promise<Goal>
  updateGoal(id: string, updates: Partial<Pick<Goal, 'title' | 'description' | 'why' | 'status' | 'progress' | 'target_date'>>): Promise<void>
  addAction(goalId: string, title: string, dueDate?: string | null): Promise<ActionItem>
  toggleAction(id: string, resultNote?: string): Promise<void>
  deleteAction(id: string): Promise<void>
  toggleFocus(id: string): Promise<void>
  addHabit(title: string, targetPerWeek: number, areaId: string | null): Promise<Habit>
  toggleHabitToday(habitId: string): Promise<void>
  setHabitActive(id: string, active: boolean): Promise<void>
  saveReview(input: Pick<WeeklyReview, 'wins' | 'blockers' | 'next_focus' | 'self_score'>): Promise<void>
}

const empty: AppData = { areas: [], goals: [], actions: [], habits: [], checkins: [], reviews: [] }
const DataContext = createContext<DataValue | null>(null)

function now() { return new Date().toISOString() }

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [data, setData] = useState<AppData>(() => user ? readCachedData(user.id) : empty)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(readQueue().length)

  const refresh = useCallback(async () => {
    if (!user) return
    setError(null)
    try {
      const remote = await loadAppData()
      setData(remote)
      cacheData(user.id, remote)
    } catch (reason) {
      const cached = readCachedData(user.id)
      setData(cached)
      setError(navigator.onLine ? (reason instanceof Error ? reason.message : 'Не удалось загрузить данные') : null)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (user) cacheData(user.id, data)
  }, [user, data])

  useEffect(() => {
    const updatePending = () => setPending(readQueue().length)
    const sync = () => { void flushQueue().then(() => { updatePending(); return refresh() }) }
    window.addEventListener('online', sync)
    window.addEventListener('dostigator:queue', updatePending)
    if (navigator.onLine) sync()
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('dostigator:queue', updatePending)
    }
  }, [refresh])

  const requireUser = () => {
    if (!user) throw new Error('Сессия входа завершилась')
    return user
  }

  const addGoal = async (input: NewGoal) => {
    const currentUser = requireUser()
    const timestamp = now()
    const goal: Goal = {
      id: crypto.randomUUID(), user_id: currentUser.id, area_id: input.areaId,
      title: input.title.trim(), description: input.description?.trim() ?? '', why: input.why.trim(),
      kind: input.kind, status: 'active', progress: 0, target_date: input.targetDate,
      completed_at: null, created_at: timestamp, updated_at: timestamp,
    }
    setData((current) => ({ ...current, goals: [goal, ...current.goals] }))
    await persistOrQueue('dostigator_goals', stripOwnership(goal))
    return goal
  }

  const updateGoal = async (id: string, updates: Partial<Pick<Goal, 'title' | 'description' | 'why' | 'status' | 'progress' | 'target_date'>>) => {
    const goal = data.goals.find((item) => item.id === id)
    if (!goal) return
    let completedAt = goal.completed_at
    if (updates.status === 'completed') completedAt = now()
    else if (updates.status !== undefined) completedAt = null
    const next = { ...goal, ...updates, completed_at: completedAt, updated_at: now() }
    setData((current) => ({ ...current, goals: current.goals.map((item) => item.id === id ? next : item) }))
    await persistOrQueue('dostigator_goals', stripOwnership(next))
  }

  const addAction = async (goalId: string, title: string, dueDate: string | null = null) => {
    const currentUser = requireUser()
    const timestamp = now()
    const item: ActionItem = {
      id: crypto.randomUUID(), user_id: currentUser.id, goal_id: goalId, title: title.trim(),
      status: 'todo', due_date: dueDate, focus_date: null, focus_position: null,
      result_note: '', completed_at: null, created_at: timestamp, updated_at: timestamp,
    }
    setData((current) => ({ ...current, actions: [...current.actions, item] }))
    await persistOrQueue('dostigator_actions', stripOwnership(item))
    return item
  }

  const toggleAction = async (id: string, resultNote = '') => {
    const item = data.actions.find((action) => action.id === id)
    if (!item) return
    const done = item.status !== 'done'
    const next: ActionItem = {
      ...item, status: done ? 'done' : 'todo', completed_at: done ? now() : null,
      result_note: done ? resultNote.trim() || item.result_note : '', updated_at: now(),
    }
    setData((current) => ({ ...current, actions: current.actions.map((action) => action.id === id ? next : action) }))
    await persistOrQueue('dostigator_actions', stripOwnership(next))
  }

  const deleteAction = async (id: string) => {
    setData((current) => ({ ...current, actions: current.actions.filter((item) => item.id !== id) }))
    await deleteOrQueue('dostigator_actions', id)
  }

  const toggleFocus = async (id: string) => {
    const item = data.actions.find((action) => action.id === id)
    if (!item || item.status !== 'todo') return
    const today = localDate()
    const alreadyFocused = item.focus_date === today
    const used = new Set(data.actions.filter((action) => action.id !== id && action.focus_date === today && action.status !== 'cancelled').map((action) => action.focus_position))
    const position = alreadyFocused ? null : [1, 2, 3].find((candidate) => !used.has(candidate)) ?? null
    if (!alreadyFocused && position === null) throw new Error('На сегодня уже выбраны три главных действия')
    const next = { ...item, focus_date: alreadyFocused ? null : today, focus_position: position, updated_at: now() }
    setData((current) => ({ ...current, actions: current.actions.map((action) => action.id === id ? next : action) }))
    await persistOrQueue('dostigator_actions', stripOwnership(next))
  }

  const addHabit = async (title: string, targetPerWeek: number, areaId: string | null) => {
    const currentUser = requireUser()
    const timestamp = now()
    const habit: Habit = {
      id: crypto.randomUUID(), user_id: currentUser.id, area_id: areaId, title: title.trim(),
      target_per_week: targetPerWeek, active: true, created_at: timestamp, updated_at: timestamp,
    }
    setData((current) => ({ ...current, habits: [...current.habits, habit] }))
    await persistOrQueue('dostigator_habits', stripOwnership(habit))
    return habit
  }

  const toggleHabitToday = async (habitId: string) => {
    const currentUser = requireUser()
    const today = localDate()
    const existing = data.checkins.find((item) => item.habit_id === habitId && item.checked_on === today)
    if (existing) {
      setData((current) => ({ ...current, checkins: current.checkins.filter((item) => item.id !== existing.id) }))
      await deleteOrQueue('dostigator_habit_checkins', existing.id)
      return
    }
    const checkin: HabitCheckin = {
      id: crypto.randomUUID(), user_id: currentUser.id, habit_id: habitId,
      checked_on: today, note: '', created_at: now(),
    }
    setData((current) => ({ ...current, checkins: [checkin, ...current.checkins] }))
    await persistOrQueue('dostigator_habit_checkins', stripOwnership(checkin))
  }

  const setHabitActive = async (id: string, active: boolean) => {
    const habit = data.habits.find((item) => item.id === id)
    if (!habit) return
    const next = { ...habit, active, updated_at: now() }
    setData((current) => ({ ...current, habits: current.habits.map((item) => item.id === id ? next : item) }))
    await persistOrQueue('dostigator_habits', stripOwnership(next))
  }

  const saveReview = async (input: Pick<WeeklyReview, 'wins' | 'blockers' | 'next_focus' | 'self_score'>) => {
    const currentUser = requireUser()
    const week = startOfWeek()
    const existing = data.reviews.find((item) => item.week_start === week)
    const timestamp = now()
    const review: WeeklyReview = {
      id: existing?.id ?? crypto.randomUUID(), user_id: currentUser.id, week_start: week,
      ...input, created_at: existing?.created_at ?? timestamp, updated_at: timestamp,
    }
    setData((current) => ({ ...current, reviews: [review, ...current.reviews.filter((item) => item.week_start !== week)] }))
    await persistOrQueue('dostigator_weekly_reviews', stripOwnership(review))
  }

  const value: DataValue = {
    data, loading, error, pending, refresh, addGoal, updateGoal, addAction, toggleAction,
    deleteAction, toggleFocus, addHabit, toggleHabitToday, setHabitActive, saveReview,
  }

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData() {
  const value = useContext(DataContext)
  if (!value) throw new Error('useData must be used inside DataProvider')
  return value
}
