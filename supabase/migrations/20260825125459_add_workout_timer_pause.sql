set lock_timeout = '5s';

alter table public.workout_sessions
  add column timer_paused_at timestamptz,
  add column timer_paused_duration_ms bigint not null default 0;

alter table public.workout_sessions
  add constraint workout_sessions_timer_paused_duration_nonnegative
  check (timer_paused_duration_ms >= 0) not valid;

alter table public.workout_sessions
  validate constraint workout_sessions_timer_paused_duration_nonnegative;

comment on column public.workout_sessions.timer_paused_at is
  'Client timestamp at which the active workout timer was paused.';

comment on column public.workout_sessions.timer_paused_duration_ms is
  'Accumulated paused time excluded from the active workout duration.';
