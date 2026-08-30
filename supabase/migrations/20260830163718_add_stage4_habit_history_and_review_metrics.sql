-- Preserve habit activation history in the owner-scoped habit row so a pause
-- cannot rewrite earlier weekly commitments. Weekly review metrics are frozen
-- on first save and remain stable if actions are edited later.

alter table public.dostigator_habits
  add column activity_periods jsonb not null default '[]'::jsonb,
  add constraint dostigator_habits_activity_periods_array
    check (jsonb_typeof(activity_periods) = 'array');

update public.dostigator_habits
set activity_periods = jsonb_build_array(
  jsonb_build_object(
    'started_on', (created_at at time zone 'UTC')::date::text,
    'ended_on', case
      when active then null
      else (updated_at at time zone 'UTC')::date::text
    end
  )
)
where activity_periods = '[]'::jsonb;

alter table public.dostigator_weekly_reviews
  add column metrics_snapshot jsonb,
  add constraint dostigator_reviews_metrics_snapshot_object
    check (metrics_snapshot is null or jsonb_typeof(metrics_snapshot) = 'object');

-- Historical reviews predate event snapshots. Freeze them as explicitly
-- unavailable rather than recalculating history from mutable current rows.
update public.dostigator_weekly_reviews
set metrics_snapshot = jsonb_build_object(
  'score', null,
  'focus', null,
  'habits', null,
  'actions', null,
  'period', jsonb_build_object(
    'weekStart', week_start::text,
    'asOf', (week_start + 6)::text
  )
)
where metrics_snapshot is null;
