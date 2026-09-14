export type GoalKind = 'goal' | 'project'
export type GoalStatus = 'active' | 'paused' | 'completed' | 'archived'
export type ActionStatus = 'todo' | 'done' | 'cancelled'

export interface RevisionedRow {
  revision?: number
  last_mutation_id?: string | null
}

export interface Area extends RevisionedRow {
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

export interface Goal extends RevisionedRow {
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

export interface ActionItem extends RevisionedRow {
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

/** Durable, one-per-day Focus 3 commitment. Action focus_* fields remain the current-day pointer. */
export interface FocusCommitment {
  id: string
  user_id: string
  action_id: string
  committed_on: string
  position: number
  source_mutation_id: string | null
  created_at: string
}

export type JournalEntryType = 'idea' | 'plan' | 'day-note'

export interface JournalEntry extends RevisionedRow {
  id: string
  user_id: string
  date: string
  entry_type: JournalEntryType
  title: string
  content: string
  created_at: string
  updated_at: string
}

export interface Habit extends RevisionedRow {
  id: string
  user_id: string
  area_id: string | null
  title: string
  target_per_week: number
  active: boolean
  activity_periods: HabitActivityPeriod[]
  created_at: string
  updated_at: string
}

export interface HabitActivityPeriod {
  started_on: string
  ended_on: string | null
}

export interface RateBreakdown {
  done: number
  rate: number
}

export interface WeeklyMetrics {
  score: number | null
  focus: (RateBreakdown & { committed: number }) | null
  habits: (RateBreakdown & { expected: number }) | null
  actions: (RateBreakdown & { target: number }) | null
  period: { weekStart: string; asOf: string }
}

export interface HabitCheckin extends RevisionedRow {
  id: string
  user_id: string
  habit_id: string
  checked_on: string
  note: string
  created_at: string
}

export interface WeeklyReview extends RevisionedRow {
  id: string
  user_id: string
  week_start: string
  wins: string
  blockers: string
  next_focus: string
  self_score: number | null
  metrics_snapshot: WeeklyMetrics | null
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
  journals?: JournalEntry[]
  /** Optional for caches/backups created before the durable Focus ledger existed. */
  focusCommitments?: FocusCommitment[]
}

export type BackupHistoryEvent = Omit<HistoryEvent, 'user_id'>

interface PersonalBackupBase {
  product: 'dostigator'
  exportedAt: string
  data: AppData
}

export type PersonalBackup =
  | (PersonalBackupBase & {
    version: 1 | 2
    /** Legacy archives may contain portable history, but it is never authoritative on import. */
    history?: BackupHistoryEvent[]
  })
  | (PersonalBackupBase & {
    version: 3
    /** Portable read-only audit archive. Import creates fresh authoritative import events. */
    history: BackupHistoryEvent[]
  })

export type TableName =
  | 'dostigator_areas'
  | 'dostigator_goals'
  | 'dostigator_actions'
  | 'dostigator_habits'
  | 'dostigator_habit_checkins'
  | 'dostigator_weekly_reviews'
  | 'dostigator_journals'

export type HistoryEntityType = 'goal' | 'action' | 'habit' | 'habit_checkin' | 'review' | 'journal'
export type HistoryOperation =
  | 'goal_create' | 'goal_edit' | 'goal_pause' | 'goal_resume' | 'goal_complete'
  | 'action_create' | 'action_edit' | 'action_complete' | 'action_reopen' | 'action_delete'
  | 'focus_add' | 'focus_remove'
  | 'habit_create' | 'habit_edit' | 'habit_pause' | 'habit_resume'
  | 'habit_check' | 'habit_uncheck'
  | 'journal_create' | 'journal_edit' | 'journal_delete'
  | 'review_create' | 'review_edit' | 'undo' | 'legacy_upsert' | 'legacy_delete'

export type MutationSource = 'ui' | 'offline' | 'undo' | 'import' | 'legacy'

export interface HistoryEvent {
  id: string
  user_id: string
  mutation_id: string
  entity_type: HistoryEntityType
  entity_id: string
  operation: HistoryOperation
  label: string
  before_data: Record<string, unknown> | null
  after_data: Record<string, unknown> | null
  base_revision: number
  result_revision: number
  source: MutationSource
  reverts_event_id: string | null
  created_at: string
}

export interface MutationDescriptor {
  mutationId: string
  entityType: HistoryEntityType
  entityId: string
  operation: Exclude<HistoryOperation, 'undo'>
  label: string
  baseRevision: number
  before: Record<string, unknown> | null
  source?: Exclude<MutationSource, 'undo'>
}

export interface PendingOperation {
  id: string
  ownerId: string
  type: 'mutation' | 'undo'
  table?: TableName
  payload?: Record<string, unknown>
  mutation?: MutationDescriptor
  originalMutationId?: string
  mutationId: string
  label: string
  createdAt: string
  state: 'pending' | 'failed'
  attempts: number
  lastError: string | null
}

type RowByTable = {
  dostigator_areas: Area
  dostigator_goals: Goal
  dostigator_actions: ActionItem
  dostigator_habits: Habit
  dostigator_habit_checkins: HabitCheckin
  dostigator_journals: JournalEntry
  dostigator_weekly_reviews: WeeklyReview
  dostigator_focus_commitments: FocusCommitment
  dostigator_history_events: HistoryEvent
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
    Functions: {
      dostigator_apply_mutation: {
        Args: {
          p_expected_owner: string
          p_mutation_id: string
          p_entity_type: HistoryEntityType
          p_entity_id: string
          p_operation: Exclude<HistoryOperation, 'undo'>
          p_label: string
          p_expected_revision: number
          p_after: Record<string, unknown>
          p_source?: MutationSource
        }
        Returns: { event: HistoryEvent; row: Record<string, unknown> | null; idempotent: boolean }
      }
      dostigator_undo_mutation: {
        Args: {
          p_expected_owner: string
          p_original_mutation_id: string
          p_mutation_id: string
          p_source?: MutationSource
        }
        Returns: { event: HistoryEvent; row: Record<string, unknown> | null; idempotent: boolean }
      }
      dostigator_history_page: {
        Args: { p_before_created_at?: string | null; p_before_id?: string | null; p_limit?: number }
        Returns: HistoryEvent[]
      }
      dostigator_import_backup: {
        Args: {
          p_expected_owner: string
          p_import_id: string
          p_payload: AppData
        }
        Returns: {
          idempotent: boolean
          counts: { areas: number; goals: number; actions: number; habits: number; checkins: number; reviews: number; focusCommitments: number; journals: number }
        }
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
