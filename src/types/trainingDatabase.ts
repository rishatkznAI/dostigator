export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      exercise_library: {
        Row: {
          key: string
          name: string
          muscles: string[]
          steps: string[]
          mistakes: string[]
          youtube_url: string | null
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          key: string
          name: string
          muscles?: string[]
          steps?: string[]
          mistakes?: string[]
          youtube_url?: string | null
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['exercise_library']['Insert']>
        Relationships: []
      }
      workout_templates: {
        Row: { code: string; title: string; sort_order: number; active: boolean; created_at: string }
        Insert: { code: string; title: string; sort_order: number; active?: boolean; created_at?: string }
        Update: Partial<Database['public']['Tables']['workout_templates']['Insert']>
        Relationships: []
      }
      workout_template_items: {
        Row: { template_code: string; exercise_key: string; sort_order: number; set_count: number; rep_target: string }
        Insert: { template_code: string; exercise_key: string; sort_order: number; set_count: number; rep_target: string }
        Update: Partial<Database['public']['Tables']['workout_template_items']['Insert']>
        Relationships: []
      }
      workout_sessions: {
        Row: {
          revision: number
          id: string
          user_id: string
          template_code: string | null
          title: string
          started_at: string
          finished_at: string | null
          timer_paused_at: string | null
          timer_paused_duration_ms: number
          readiness_sleep: number | null
          readiness_energy: number | null
          readiness_stress: number | null
          readiness_discomfort: boolean
          readiness_mode: string | null
          readiness_note: string
          note: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string
          template_code?: string | null
          title: string
          started_at?: string
          finished_at?: string | null
          timer_paused_at?: string | null
          timer_paused_duration_ms?: number
          readiness_sleep?: number | null
          readiness_energy?: number | null
          readiness_stress?: number | null
          readiness_discomfort?: boolean
          readiness_mode?: string | null
          readiness_note?: string
          note?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['workout_sessions']['Insert']>
        Relationships: []
      }
      workout_session_exercises: {
        Row: {
          id: string
          user_id: string
          session_id: string
          exercise_key: string | null
          exercise_name: string
          target: string
          sort_order: number
          skipped: boolean
          skip_reason: string
          note: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string
          session_id: string
          exercise_key?: string | null
          exercise_name: string
          target: string
          sort_order: number
          skipped?: boolean
          skip_reason?: string
          note?: string
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['workout_session_exercises']['Insert']>
        Relationships: []
      }
      workout_sets: {
        Row: {
          id: string
          user_id: string
          session_id: string
          session_exercise_id: string
          set_number: number
          weight_kg: number | null
          reps: number | null
          rir: number | null
          done: boolean
          is_warmup: boolean
          completed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string
          session_id: string
          session_exercise_id: string
          set_number: number
          weight_kg?: number | null
          reps?: number | null
          rir?: number | null
          done?: boolean
          is_warmup?: boolean
          completed_at?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['workout_sets']['Insert']>
        Relationships: []
      }
      body_measurements: {
        Row: {
          id: string
          user_id: string
          measured_at: string
          weight_kg: number | null
          waist_cm: number | null
          chest_cm: number | null
          photo_front_path: string | null
          photo_side_path: string | null
          photo_back_path: string | null
          note: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string
          measured_at?: string
          weight_kg?: number | null
          waist_cm?: number | null
          chest_cm?: number | null
          photo_front_path?: string | null
          photo_side_path?: string | null
          photo_back_path?: string | null
          note?: string
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['body_measurements']['Insert']>
        Relationships: []
      }
      nutrition_entries: {
        Row: {
          id: string
          user_id: string
          eaten_at: string
          meal_type: string
          description: string
          calories: number | null
          protein_g: number | null
          alcohol_units: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string
          eaten_at?: string
          meal_type?: string
          description: string
          calories?: number | null
          protein_g?: number | null
          alcohol_units?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['nutrition_entries']['Insert']>
        Relationships: []
      }
      cardio_sessions: {
        Row: {
          id: string
          user_id: string
          activity_date: string
          kind: 'walk' | 'bike' | 'elliptical' | 'outdoor' | 'other'
          duration_minutes: number
          distance_km: number | null
          effort: number | null
          average_pulse: number | null
          note: string
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['cardio_sessions']['Row'], 'created_at'> & { created_at?: string }
        Update: Partial<Database['public']['Tables']['cardio_sessions']['Insert']>
        Relationships: []
      }
      cardio_facts: {
        Row: Database['public']['Tables']['cardio_sessions']['Row'] & {
          duration_seconds: number | null
          workout_session_id: string | null
          speed_kmh: number | null
          incline_percent: number | null
          resistance_level: number | null
          revision: number
          deleted_at: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      daily_activity: {
        Row: {
          id: string
          user_id: string
          activity_date: string
          steps: number
          note: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string
          activity_date?: string
          steps?: number
          note?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['daily_activity']['Insert']>
        Relationships: []
      }
      dostigator_areas: {
        Row: { id: string; user_id: string; name: string; color: string; icon: string; position: number; archived_at: string | null; created_at: string; updated_at: string }
        Insert: { id: string; user_id?: string; name: string; color?: string; icon?: string; position?: number; archived_at?: string | null; created_at?: string; updated_at?: string }
        Update: Partial<Database['public']['Tables']['dostigator_areas']['Insert']>
        Relationships: []
      }
      dostigator_goals: {
        Row: {
          id: string; user_id: string; area_id: string | null; title: string; description: string; why: string
          kind: 'goal' | 'project' | 'book'; status: 'active' | 'paused' | 'completed' | 'archived'; progress: number
          target_date: string | null; completed_at: string | null; book_format: 'paper' | 'ebook' | 'audio' | null
          metric_label: string | null; target_value: number | null; initial_value: number; created_at: string; updated_at: string
        }
        Insert: {
          id: string; user_id?: string; area_id?: string | null; title: string; description?: string; why?: string
          kind?: 'goal' | 'project' | 'book'; status?: 'active' | 'paused' | 'completed' | 'archived'; progress?: number
          target_date?: string | null; completed_at?: string | null; book_format?: 'paper' | 'ebook' | 'audio' | null
          metric_label?: string | null; target_value?: number | null; initial_value?: number; created_at?: string; updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['dostigator_goals']['Insert']>
        Relationships: []
      }
      dostigator_actions: {
        Row: {
          id: string; user_id: string; goal_id: string; title: string; status: 'todo' | 'done' | 'cancelled'
          due_date: string | null; focus_date: string | null; focus_position: number | null; result_note: string
          completed_at: string | null; created_at: string; updated_at: string
        }
        Insert: {
          id: string; user_id?: string; goal_id: string; title: string; status?: 'todo' | 'done' | 'cancelled'
          due_date?: string | null; focus_date?: string | null; focus_position?: number | null; result_note?: string
          completed_at?: string | null; created_at?: string; updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['dostigator_actions']['Insert']>
        Relationships: []
      }
      dostigator_habits: {
        Row: { id: string; user_id: string; area_id: string | null; title: string; target_per_week: number; active: boolean; created_at: string; updated_at: string }
        Insert: { id: string; user_id?: string; area_id?: string | null; title: string; target_per_week?: number; active?: boolean; created_at?: string; updated_at?: string }
        Update: Partial<Database['public']['Tables']['dostigator_habits']['Insert']>
        Relationships: []
      }
      dostigator_habit_checkins: {
        Row: { id: string; user_id: string; habit_id: string; checked_on: string; note: string; created_at: string }
        Insert: { id: string; user_id?: string; habit_id: string; checked_on: string; note?: string; created_at?: string }
        Update: Partial<Database['public']['Tables']['dostigator_habit_checkins']['Insert']>
        Relationships: []
      }
      dostigator_weekly_reviews: {
        Row: { id: string; user_id: string; week_start: string; wins: string; blockers: string; next_focus: string; self_score: number | null; created_at: string; updated_at: string }
        Insert: { id: string; user_id?: string; week_start: string; wins?: string; blockers?: string; next_focus?: string; self_score?: number | null; created_at?: string; updated_at?: string }
        Update: Partial<Database['public']['Tables']['dostigator_weekly_reviews']['Insert']>
        Relationships: []
      }
      dostigator_progress_entries: {
        Row: { id: string; user_id: string; goal_id: string; recorded_on: string; amount: number; note: string; created_at: string }
        Insert: { id: string; user_id?: string; goal_id: string; recorded_on?: string; amount: number; note?: string; created_at?: string }
        Update: Partial<Database['public']['Tables']['dostigator_progress_entries']['Insert']>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type TableRow<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
