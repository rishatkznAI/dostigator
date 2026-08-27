export type GoalKind = 'goal' | 'project'
export type GoalStatus = 'active' | 'paused' | 'completed' | 'archived'
export type ActionStatus = 'todo' | 'done' | 'cancelled'

export interface Area {
  id: string
  user_id: string
  name: string
  color: string
  icon: string
  position: number
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface Goal {
  id: string
  user_id: string
  area_id: string | null
  title: string
  description: string
  why: string
  kind: GoalKind
  status: GoalStatus
  progress: number
  target_date: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface ActionItem {
  id: string
  user_id: string
  goal_id: string
  title: string
  status: ActionStatus
  due_date: string | null
  focus_date: string | null
  focus_position: number | null
  result_note: string
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface Habit {
  id: string
  user_id: string
  area_id: string | null
  title: string
  target_per_week: number
  active: boolean
  created_at: string
  updated_at: string
}

export interface HabitCheckin {
  id: string
  user_id: string
  habit_id: string
  checked_on: string
  note: string
  created_at: string
}

export interface WeeklyReview {
  id: string
  user_id: string
  week_start: string
  wins: string
  blockers: string
  next_focus: string
  self_score: number | null
  created_at: string
  updated_at: string
}

export interface AppData {
  areas: Area[]
  goals: Goal[]
  actions: ActionItem[]
  habits: Habit[]
  checkins: HabitCheckin[]
  reviews: WeeklyReview[]
}

export interface PersonalBackup {
  product: 'dostigator'
  version: 1
  exportedAt: string
  data: AppData
}

export type TableName =
  | 'dostigator_areas'
  | 'dostigator_goals'
  | 'dostigator_actions'
  | 'dostigator_habits'
  | 'dostigator_habit_checkins'
  | 'dostigator_weekly_reviews'

export interface PendingOperation {
  id: string
  table: TableName
  type: 'upsert' | 'delete'
  payload?: Record<string, unknown>
  rowId?: string
  createdAt: string
}

type RowByTable = {
  dostigator_areas: Area
  dostigator_goals: Goal
  dostigator_actions: ActionItem
  dostigator_habits: Habit
  dostigator_habit_checkins: HabitCheckin
  dostigator_weekly_reviews: WeeklyReview
}

type InsertRow<T extends { user_id: string; created_at: string }> = Omit<T, 'user_id' | 'created_at'> & {
  user_id?: string
  created_at?: string
}

type UpdateRow<T> = Partial<Omit<T, 'id' | 'user_id' | 'created_at'>>

export type Database = {
  public: {
    Tables: {
      [K in keyof RowByTable]: {
        Row: RowByTable[K]
        Insert: InsertRow<RowByTable[K]>
        Update: UpdateRow<RowByTable[K]>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
