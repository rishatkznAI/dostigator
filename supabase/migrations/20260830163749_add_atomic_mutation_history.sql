-- Stage 5: server-authoritative, append-only mutation history and revision-safe Undo.
-- Domain writes are routed through RPCs so a row change and its history event
-- commit in the same PostgreSQL transaction.

alter table public.dostigator_areas
  add column revision bigint not null default 0,
  add column last_mutation_id uuid;
alter table public.dostigator_goals
  add column revision bigint not null default 0,
  add column last_mutation_id uuid;
alter table public.dostigator_actions
  add column revision bigint not null default 0,
  add column last_mutation_id uuid;
alter table public.dostigator_habits
  add column revision bigint not null default 0,
  add column last_mutation_id uuid;
alter table public.dostigator_habit_checkins
  add column revision bigint not null default 0,
  add column last_mutation_id uuid;
alter table public.dostigator_weekly_reviews
  add column revision bigint not null default 0,
  add column last_mutation_id uuid;

create table public.dostigator_history_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  entity_type text not null check (entity_type in ('goal', 'action', 'habit', 'habit_checkin', 'review')),
  entity_id uuid not null,
  operation text not null check (operation in (
    'goal_create', 'goal_edit', 'goal_pause', 'goal_resume', 'goal_complete',
    'action_create', 'action_edit', 'action_complete', 'action_reopen', 'action_delete', 'focus_add', 'focus_remove',
    'habit_create', 'habit_edit', 'habit_pause', 'habit_resume',
    'habit_check', 'habit_uncheck',
    'review_create', 'review_edit', 'undo', 'legacy_upsert', 'legacy_delete'
  )),
  label text not null check (char_length(label) between 1 and 180),
  before_data jsonb,
  after_data jsonb,
  base_revision bigint not null check (base_revision >= 0),
  result_revision bigint not null check (result_revision = base_revision + 1),
  source text not null default 'ui' check (source in ('ui', 'offline', 'undo', 'import', 'legacy')),
  reverts_event_id uuid references public.dostigator_history_events(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (user_id, mutation_id)
);

create unique index dostigator_history_one_undo_idx
  on public.dostigator_history_events (reverts_event_id)
  where reverts_event_id is not null;
create index dostigator_history_owner_cursor_idx
  on public.dostigator_history_events (user_id, created_at desc, id desc);
create index dostigator_history_entity_idx
  on public.dostigator_history_events (user_id, entity_type, entity_id, created_at desc);

alter table public.dostigator_history_events enable row level security;
create policy "dostigator history select own" on public.dostigator_history_events
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.dostigator_history_events from anon, authenticated;
grant select on table public.dostigator_history_events to authenticated;

-- Exact request envelopes are kept outside the user-readable history table.
-- They make mutation IDs true idempotency keys: a retry is accepted only when
-- every input is identical to the original request. No client role can read or
-- forge these envelopes.
create table public.dostigator_mutation_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  request_envelope jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, mutation_id)
);

alter table public.dostigator_mutation_requests enable row level security;
revoke all on table public.dostigator_mutation_requests from public, anon, authenticated;

-- Explicit field allowlists keep ownership, timestamps, mutation markers and
-- revisions out of before/after snapshots supplied to the History UI.
create or replace function public.dostigator_history_snapshot(p_entity_type text, p_row jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_entity_type
    when 'goal' then jsonb_build_object(
      'id', p_row->'id', 'area_id', p_row->'area_id', 'title', p_row->'title',
      'description', p_row->'description', 'why', p_row->'why', 'kind', p_row->'kind',
      'status', p_row->'status', 'progress', p_row->'progress', 'target_date', p_row->'target_date',
      'completed_at', p_row->'completed_at'
    )
    when 'action' then jsonb_build_object(
      'id', p_row->'id', 'goal_id', p_row->'goal_id', 'title', p_row->'title',
      'status', p_row->'status', 'due_date', p_row->'due_date', 'focus_date', p_row->'focus_date',
      'focus_position', p_row->'focus_position', 'result_note', p_row->'result_note',
      'completed_at', p_row->'completed_at'
    )
    when 'habit' then jsonb_build_object(
      'id', p_row->'id', 'area_id', p_row->'area_id', 'title', p_row->'title',
      'target_per_week', p_row->'target_per_week', 'active', p_row->'active',
      'activity_periods', p_row->'activity_periods'
    )
    when 'habit_checkin' then jsonb_build_object(
      'id', p_row->'id', 'habit_id', p_row->'habit_id', 'checked_on', p_row->'checked_on',
      'note', p_row->'note'
    )
    when 'review' then jsonb_build_object(
      'id', p_row->'id', 'week_start', p_row->'week_start', 'wins', p_row->'wins',
      'blockers', p_row->'blockers', 'next_focus', p_row->'next_focus',
      'self_score', p_row->'self_score', 'metrics_snapshot', p_row->'metrics_snapshot'
    )
    else null
  end
$$;

-- Habit periods are inclusive calendar ranges. Adjacent ranges may touch on
-- the same transition day, but they may never move backwards or overlap past
-- that boundary. An active habit has exactly one open, final range; a paused
-- habit has none.
create or replace function public.dostigator_valid_activity_periods(p_periods jsonb, p_active boolean)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_index integer;
  v_period jsonb;
  v_started_text text;
  v_ended_text text;
  v_started date;
  v_ended date;
  v_previous_end date;
  v_open_count integer := 0;
begin
  if p_active is null or p_periods is null or jsonb_typeof(p_periods) <> 'array'
    or jsonb_array_length(p_periods) = 0 then
    return false;
  end if;

  for v_index in 0..jsonb_array_length(p_periods) - 1 loop
    v_period := p_periods->v_index;
    if jsonb_typeof(v_period) <> 'object'
      or not (v_period ? 'started_on') or jsonb_typeof(v_period->'started_on') <> 'string'
      or not (v_period ? 'ended_on') then
      return false;
    end if;

    v_started_text := v_period->>'started_on';
    if v_started_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
    v_started := v_started_text::date;
    if v_started::text <> v_started_text then return false; end if;
    if v_previous_end is not null and v_started < v_previous_end then return false; end if;

    if v_period->'ended_on' = 'null'::jsonb then
      v_open_count := v_open_count + 1;
      if v_index <> jsonb_array_length(p_periods) - 1 then return false; end if;
    elsif jsonb_typeof(v_period->'ended_on') = 'string' then
      v_ended_text := v_period->>'ended_on';
      if v_ended_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
      v_ended := v_ended_text::date;
      if v_ended::text <> v_ended_text or v_ended < v_started then return false; end if;
      v_previous_end := v_ended;
    else
      return false;
    end if;
  end loop;

  return (p_active and v_open_count = 1) or (not p_active and v_open_count = 0);
exception when others then
  return false;
end
$$;

-- Weekly reviews are keyed by a canonical ISO Monday.
create or replace function public.dostigator_valid_iso_monday(p_value text)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_date date;
begin
  if p_value is null or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
  v_date := p_value::date;
  return v_date::text = p_value and extract(isodow from v_date) = 1;
exception when others then
  return false;
end
$$;

-- Mirrors the client-side WeeklyMetrics validator. The whole snapshot may be
-- null for pre-Stage4 data; every non-null snapshot and section is canonical.
create or replace function public.dostigator_valid_weekly_metrics(p_metrics jsonb, p_week_start_text text)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_week_start date;
  v_as_of_text text;
  v_as_of date;
  v_section_name text;
  v_extra_key text;
  v_section jsonb;
  v_number numeric;
begin
  if public.dostigator_valid_iso_monday(p_week_start_text) is not true then return false; end if;
  v_week_start := p_week_start_text::date;

  if p_metrics is null or p_metrics = 'null'::jsonb then return true; end if;
  if jsonb_typeof(p_metrics) <> 'object' or not (p_metrics ? 'score') then return false; end if;
  if p_metrics->'score' <> 'null'::jsonb then
    if jsonb_typeof(p_metrics->'score') <> 'number' then return false; end if;
    v_number := (p_metrics->>'score')::numeric;
    if v_number < 0 or v_number > 100 then return false; end if;
  end if;

  for v_section_name, v_extra_key in
    select * from (values
      ('focus', 'committed'), ('habits', 'expected'), ('actions', 'target')
    ) as sections(section_name, extra_key)
  loop
    if not (p_metrics ? v_section_name) then return false; end if;
    v_section := p_metrics->v_section_name;
    if v_section = 'null'::jsonb then continue; end if;
    if jsonb_typeof(v_section) <> 'object'
      or not (v_section ? 'done') or jsonb_typeof(v_section->'done') <> 'number'
      or not (v_section ? v_extra_key) or jsonb_typeof(v_section->v_extra_key) <> 'number'
      or not (v_section ? 'rate') or jsonb_typeof(v_section->'rate') <> 'number' then
      return false;
    end if;
    v_number := (v_section->>'done')::numeric;
    if v_number <> trunc(v_number) or v_number < 0 or v_number > 9007199254740991 then return false; end if;
    v_number := (v_section->>v_extra_key)::numeric;
    if v_number <> trunc(v_number) or v_number < 0 or v_number > 9007199254740991 then return false; end if;
    v_number := (v_section->>'rate')::numeric;
    if v_number < 0 or v_number > 1 then return false; end if;
  end loop;

  if not (p_metrics ? 'period') or jsonb_typeof(p_metrics->'period') <> 'object'
    or not (p_metrics->'period' ? 'weekStart')
    or jsonb_typeof(p_metrics->'period'->'weekStart') <> 'string'
    or p_metrics->'period'->>'weekStart' is distinct from p_week_start_text
    or not (p_metrics->'period' ? 'asOf')
    or jsonb_typeof(p_metrics->'period'->'asOf') <> 'string' then
    return false;
  end if;
  v_as_of_text := p_metrics->'period'->>'asOf';
  if v_as_of_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
  v_as_of := v_as_of_text::date;
  if v_as_of::text <> v_as_of_text or v_as_of < v_week_start or v_as_of > v_week_start + 6 then
    return false;
  end if;
  return true;
exception when others then
  return false;
end
$$;

drop function if exists public.dostigator_undo_mutation(uuid, uuid, text);
drop function if exists public.dostigator_apply_mutation(uuid, text, uuid, text, text, bigint, jsonb, text);
create or replace function public.dostigator_apply_mutation(
  p_expected_owner uuid,
  p_mutation_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_operation text,
  p_label text,
  p_expected_revision bigint,
  p_after jsonb,
  p_source text default 'ui'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_existing public.dostigator_history_events%rowtype;
  v_event public.dostigator_history_events%rowtype;
  v_goal public.dostigator_goals%rowtype;
  v_action public.dostigator_actions%rowtype;
  v_habit public.dostigator_habits%rowtype;
  v_checkin public.dostigator_habit_checkins%rowtype;
  v_review public.dostigator_weekly_reviews%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result_row jsonb;
  v_reverts_event_id uuid;
  v_focus_count bigint;
  v_payload_number numeric;
  v_focus_date date;
  v_checkin_habit_id uuid;
  v_checked_on date;
  v_is_undo boolean := p_operation = 'undo';
  v_trusted_import_token text;
  v_request_envelope jsonb;
  v_stored_request_envelope jsonb;
begin
  if v_owner is null or p_expected_owner is null or v_owner is distinct from p_expected_owner then
    raise exception 'expected owner does not match authenticated user' using errcode = '42501';
  end if;
  if p_mutation_id is null or p_entity_id is null or p_expected_revision < 0 then
    raise exception 'invalid mutation envelope' using errcode = '22023';
  end if;
  if p_source not in ('ui', 'offline', 'undo', 'import', 'legacy') then
    raise exception 'invalid mutation source' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_label, ''))) not between 1 and 180 then
    raise exception 'invalid mutation label' using errcode = '22023';
  end if;
  if p_source = 'import' then
    v_trusted_import_token := nullif(current_setting('dostigator.trusted_backup_import_token', true), '');
    if v_trusted_import_token is null or not exists (
      select 1
      from public.dostigator_mutation_requests request
      where request.user_id = v_owner
        and request.request_envelope->>'rpc' = 'backup_import'
        and request.request_envelope->>'trusted_context' = v_trusted_import_token
    ) then
      raise exception 'untrusted import source' using errcode = '42501';
    end if;
  end if;

  -- Serialize all attempts that share an idempotency key. The lock is scoped
  -- to this transaction and the owner, so different users and mutation IDs do
  -- not block each other. Taking it before the history lookup closes the race
  -- where two concurrent creates could both observe a missing event.
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':' || p_mutation_id::text, 0));

  if v_is_undo then
    begin
      v_reverts_event_id := nullif(current_setting('dostigator.reverts_event_id', true), '')::uuid;
    exception when others then
      v_reverts_event_id := null;
    end;
    if v_reverts_event_id is null then
      raise exception 'undo must use dostigator_undo_mutation' using errcode = '42501';
    end if;
  end if;

  v_request_envelope := jsonb_build_object(
    'rpc', 'apply',
    'expected_owner', p_expected_owner,
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'operation', p_operation,
    'label', trim(p_label),
    'expected_revision', p_expected_revision,
    'after', p_after,
    'source', p_source
  );

  select * into v_existing from public.dostigator_history_events
  where user_id = v_owner and mutation_id = p_mutation_id;
  if found then
    select request_envelope into v_stored_request_envelope
    from public.dostigator_mutation_requests
    where user_id = v_owner and mutation_id = p_mutation_id;
    if not found or v_stored_request_envelope <> v_request_envelope then
      raise exception 'mutation id was reused with a different request envelope' using errcode = '22023';
    end if;
    return jsonb_build_object('event', to_jsonb(v_existing), 'row', v_existing.after_data, 'idempotent', true);
  end if;

  -- Undo's public RPC owns its envelope. Its internal apply call must not
  -- replace it with the implementation-level request.
  if not v_is_undo then
    insert into public.dostigator_mutation_requests (user_id, mutation_id, request_envelope)
    values (v_owner, p_mutation_id, v_request_envelope);
  end if;

  if p_entity_type = 'goal' then
    if not (p_operation in ('goal_create', 'goal_edit', 'goal_pause', 'goal_resume', 'goal_complete', 'legacy_upsert') or v_is_undo) then
      raise exception 'operation is not allowed for goal' using errcode = '22023';
    end if;
    if not v_is_undo and p_operation = 'legacy_upsert' then
      if not (p_after ? 'status') or jsonb_typeof(p_after->'status') <> 'string'
        or p_after->>'status' not in ('active', 'paused', 'completed', 'archived')
        or not (p_after ? 'progress') or jsonb_typeof(p_after->'progress') <> 'number'
        or not (p_after ? 'completed_at')
        or jsonb_typeof(p_after->'completed_at') not in ('null', 'string') then
        raise exception 'goal payload does not match operation' using errcode = '22023';
      end if;
      v_payload_number := (p_after->>'progress')::numeric;
      if v_payload_number <> trunc(v_payload_number) or v_payload_number < 0 or v_payload_number > 100
        or (p_after->>'status' = 'completed' and (
          v_payload_number <> 100 or nullif(p_after->>'completed_at', '') is null
        ))
        or (p_after->>'status' <> 'completed' and nullif(p_after->>'completed_at', '') is not null) then
        raise exception 'goal payload does not match operation' using errcode = '22023';
      end if;
    end if;
    select * into v_goal from public.dostigator_goals where id = p_entity_id and user_id = v_owner for update;
    if not found then
      if p_operation not in ('goal_create', 'legacy_upsert') or p_expected_revision <> 0 then
        raise exception 'goal is missing or stale' using errcode = '40001';
      end if;
      if p_operation = 'goal_create' and (
        coalesce(p_after->>'status', 'active') <> 'active'
        or nullif(p_after->>'completed_at', '') is not null
      ) then
        raise exception 'goal_create payload does not match operation' using errcode = '22023';
      end if;
      insert into public.dostigator_goals (
        id, user_id, area_id, title, description, why, kind, status, progress,
        target_date, completed_at, created_at, updated_at, revision, last_mutation_id
      ) values (
        p_entity_id, v_owner, nullif(p_after->>'area_id', '')::uuid, trim(p_after->>'title'),
        coalesce(trim(p_after->>'description'), ''), coalesce(trim(p_after->>'why'), ''),
        coalesce(p_after->>'kind', 'goal'), coalesce(p_after->>'status', 'active'),
        coalesce((p_after->>'progress')::smallint, 0), nullif(p_after->>'target_date', '')::date,
        nullif(p_after->>'completed_at', '')::timestamptz,
        coalesce(nullif(p_after->>'created_at', '')::timestamptz, now()),
        coalesce(nullif(p_after->>'updated_at', '')::timestamptz, now()), 1, p_mutation_id
      ) returning * into v_goal;
      v_before := null;
    else
      if v_goal.revision <> p_expected_revision then raise exception 'goal revision conflict' using errcode = '40001'; end if;
      if p_operation = 'goal_create' then raise exception 'goal already exists' using errcode = '23505'; end if;
      v_before := public.dostigator_history_snapshot('goal', to_jsonb(v_goal));
      if not v_is_undo and (
        (p_operation = 'goal_edit' and p_after->>'status' is distinct from v_goal.status)
        or (p_operation = 'goal_edit' and nullif(p_after->>'completed_at', '')::timestamptz is distinct from v_goal.completed_at)
        or (p_operation in ('goal_pause', 'goal_resume', 'goal_complete') and (
          nullif(p_after->>'area_id', '')::uuid is distinct from v_goal.area_id
          or trim(p_after->>'title') is distinct from v_goal.title
          or coalesce(trim(p_after->>'description'), '') is distinct from v_goal.description
          or coalesce(trim(p_after->>'why'), '') is distinct from v_goal.why
          or p_after->>'kind' is distinct from v_goal.kind
          or nullif(p_after->>'target_date', '')::date is distinct from v_goal.target_date
        ))
        or (p_operation = 'goal_pause' and (p_after->>'progress')::smallint is distinct from v_goal.progress)
        or (p_operation = 'goal_pause' and (
          v_goal.status is distinct from 'active'
          or p_after->>'status' is distinct from 'paused' or nullif(p_after->>'completed_at', '') is not null
        ))
        or (p_operation = 'goal_resume' and (
          v_goal.status is not distinct from 'active'
          or p_after->>'status' is distinct from 'active'
          or (p_after->>'progress')::smallint is distinct from 0
          or nullif(p_after->>'completed_at', '') is not null
        ))
        or (p_operation = 'goal_complete' and (
          v_goal.status is distinct from 'active'
          or p_after->>'status' is distinct from 'completed'
          or (p_after->>'progress')::smallint is distinct from 100
          or nullif(p_after->>'completed_at', '') is null
        ))
      ) then
        raise exception 'goal payload does not match operation' using errcode = '22023';
      end if;
      update public.dostigator_goals set
        area_id = nullif(p_after->>'area_id', '')::uuid,
        title = trim(p_after->>'title'), description = coalesce(trim(p_after->>'description'), ''),
        why = coalesce(trim(p_after->>'why'), ''), kind = p_after->>'kind', status = p_after->>'status',
        progress = (p_after->>'progress')::smallint, target_date = nullif(p_after->>'target_date', '')::date,
        completed_at = nullif(p_after->>'completed_at', '')::timestamptz,
        updated_at = coalesce(nullif(p_after->>'updated_at', '')::timestamptz, now()),
        revision = revision + 1, last_mutation_id = p_mutation_id
      where id = p_entity_id and user_id = v_owner returning * into v_goal;
    end if;
    v_result_row := to_jsonb(v_goal);
    v_after := public.dostigator_history_snapshot('goal', v_result_row);

  elsif p_entity_type = 'action' then
    if not (p_operation in ('action_create', 'action_edit', 'action_complete', 'action_reopen', 'action_delete', 'focus_add', 'focus_remove', 'legacy_upsert') or v_is_undo) then
      raise exception 'operation is not allowed for action' using errcode = '22023';
    end if;
    if not v_is_undo and p_operation = 'legacy_upsert' then
      if not (p_after ? 'status') or jsonb_typeof(p_after->'status') <> 'string'
        or p_after->>'status' not in ('todo', 'done', 'cancelled')
        or not (p_after ? 'completed_at') or jsonb_typeof(p_after->'completed_at') not in ('null', 'string')
        or not (p_after ? 'focus_date') or not (p_after ? 'focus_position')
        or (p_after->>'status' = 'done' and nullif(p_after->>'completed_at', '') is null)
        or (p_after->>'status' <> 'done' and nullif(p_after->>'completed_at', '') is not null) then
        raise exception 'action payload does not match operation' using errcode = '22023';
      end if;
      if p_after->'focus_date' = 'null'::jsonb and p_after->'focus_position' = 'null'::jsonb then
        v_focus_date := null;
      elsif jsonb_typeof(p_after->'focus_date') = 'string'
        and jsonb_typeof(p_after->'focus_position') = 'number'
        and p_after->>'focus_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        v_focus_date := (p_after->>'focus_date')::date;
        v_payload_number := (p_after->>'focus_position')::numeric;
        if v_focus_date::text <> p_after->>'focus_date'
          or v_payload_number <> trunc(v_payload_number) or v_payload_number not between 1 and 3 then
          raise exception 'action payload does not match operation' using errcode = '22023';
        end if;
      else
        raise exception 'action payload does not match operation' using errcode = '22023';
      end if;
      if p_after->>'status' = 'cancelled' and v_focus_date is not null then
        raise exception 'action payload does not match operation' using errcode = '22023';
      end if;
    end if;
    select * into v_action from public.dostigator_actions where id = p_entity_id and user_id = v_owner for update;
    if not found then
      if p_operation not in ('action_create', 'legacy_upsert') or p_expected_revision <> 0 then
        raise exception 'action is missing or stale' using errcode = '40001';
      end if;
      if p_operation = 'action_create' and (
        coalesce(p_after->>'status', 'todo') <> 'todo'
        or nullif(p_after->>'completed_at', '') is not null
      ) then
        raise exception 'action_create payload does not match operation' using errcode = '22023';
      end if;
      insert into public.dostigator_actions (
        id, user_id, goal_id, title, status, due_date, focus_date, focus_position,
        result_note, completed_at, created_at, updated_at, revision, last_mutation_id
      ) values (
        p_entity_id, v_owner, (p_after->>'goal_id')::uuid, trim(p_after->>'title'),
        coalesce(p_after->>'status', 'todo'), nullif(p_after->>'due_date', '')::date,
        nullif(p_after->>'focus_date', '')::date, nullif(p_after->>'focus_position', '')::smallint,
        coalesce(trim(p_after->>'result_note'), ''), nullif(p_after->>'completed_at', '')::timestamptz,
        coalesce(nullif(p_after->>'created_at', '')::timestamptz, now()),
        coalesce(nullif(p_after->>'updated_at', '')::timestamptz, now()), 1, p_mutation_id
      ) returning * into v_action;
      v_before := null;
    else
      if v_action.revision <> p_expected_revision then raise exception 'action revision conflict' using errcode = '40001'; end if;
      if p_operation = 'action_create' then raise exception 'action already exists' using errcode = '23505'; end if;
      v_before := public.dostigator_history_snapshot('action', to_jsonb(v_action));
      if not v_is_undo and (
        (p_operation = 'action_edit' and (
          (p_after->>'goal_id')::uuid is distinct from v_action.goal_id
          or p_after->>'status' is distinct from v_action.status
          or nullif(p_after->>'focus_date', '')::date is distinct from v_action.focus_date
          or nullif(p_after->>'focus_position', '')::smallint is distinct from v_action.focus_position
          or nullif(p_after->>'completed_at', '')::timestamptz is distinct from v_action.completed_at
        ))
        or (p_operation in ('action_complete', 'action_reopen', 'action_delete') and (
          (p_after->>'goal_id')::uuid is distinct from v_action.goal_id
          or trim(p_after->>'title') is distinct from v_action.title
          or nullif(p_after->>'due_date', '')::date is distinct from v_action.due_date
        ))
        or (p_operation in ('action_complete', 'action_reopen') and (
          nullif(p_after->>'focus_date', '')::date is distinct from v_action.focus_date
          or nullif(p_after->>'focus_position', '')::smallint is distinct from v_action.focus_position
        ))
        or (p_operation = 'action_complete' and (
          v_action.status is distinct from 'todo'
          or p_after->>'status' is distinct from 'done' or nullif(p_after->>'completed_at', '') is null
        ))
        or (p_operation = 'action_reopen' and (
          v_action.status is distinct from 'done'
          or p_after->>'status' is distinct from 'todo'
          or coalesce(trim(p_after->>'result_note'), '') is distinct from ''
          or nullif(p_after->>'completed_at', '') is not null
        ))
        or (p_operation = 'action_delete' and (
          v_action.status is not distinct from 'cancelled'
          or p_after->>'status' is distinct from 'cancelled'
          or nullif(p_after->>'focus_date', '') is not null
          or nullif(p_after->>'focus_position', '') is not null
          or nullif(p_after->>'completed_at', '') is not null
          or coalesce(trim(p_after->>'result_note'), '') is distinct from v_action.result_note
        ))
        or (p_operation = 'focus_add' and (
          v_action.status is distinct from 'todo'
          or p_after->>'status' is distinct from 'todo'
          or v_action.focus_date is not distinct from nullif(p_after->>'focus_date', '')::date
          or nullif(p_after->>'focus_date', '') is null
          or nullif(p_after->>'focus_position', '') is null
        ))
        or (p_operation = 'focus_remove' and (
          v_action.status is distinct from 'todo'
          or v_action.focus_date is null or v_action.focus_position is null
          or p_after->>'status' is distinct from 'todo'
          or nullif(p_after->>'focus_date', '') is not null
          or nullif(p_after->>'focus_position', '') is not null
        ))
        or (p_operation in ('focus_add', 'focus_remove') and (
          (p_after->>'goal_id')::uuid is distinct from v_action.goal_id
          or trim(p_after->>'title') is distinct from v_action.title
          or nullif(p_after->>'due_date', '')::date is distinct from v_action.due_date
          or coalesce(trim(p_after->>'result_note'), '') is distinct from v_action.result_note
          or nullif(p_after->>'completed_at', '')::timestamptz is distinct from v_action.completed_at
        ))
      ) then
        raise exception 'action payload does not match operation' using errcode = '22023';
      end if;
      if v_is_undo and nullif(p_after->>'focus_date', '') is not null and nullif(p_after->>'focus_position', '') is not null then
        select count(*) into v_focus_count
        from public.dostigator_actions
        where user_id = v_owner and id <> p_entity_id and status <> 'cancelled'
          and focus_date = (p_after->>'focus_date')::date;
        if v_focus_count >= 3 then
          raise exception 'focus limit blocks undo' using errcode = '23514';
        end if;
        if exists (
          select 1 from public.dostigator_actions
          where user_id = v_owner and id <> p_entity_id and status <> 'cancelled'
            and focus_date = (p_after->>'focus_date')::date
            and focus_position = (p_after->>'focus_position')::smallint
        ) then
          raise exception 'focus position blocks undo' using errcode = '23514';
        end if;
      end if;
      update public.dostigator_actions set
        goal_id = (p_after->>'goal_id')::uuid, title = trim(p_after->>'title'), status = p_after->>'status',
        due_date = nullif(p_after->>'due_date', '')::date, focus_date = nullif(p_after->>'focus_date', '')::date,
        focus_position = nullif(p_after->>'focus_position', '')::smallint,
        result_note = coalesce(trim(p_after->>'result_note'), ''),
        completed_at = nullif(p_after->>'completed_at', '')::timestamptz,
        updated_at = coalesce(nullif(p_after->>'updated_at', '')::timestamptz, now()),
        revision = revision + 1, last_mutation_id = p_mutation_id
      where id = p_entity_id and user_id = v_owner returning * into v_action;
    end if;
    v_result_row := to_jsonb(v_action);
    v_after := public.dostigator_history_snapshot('action', v_result_row);

  elsif p_entity_type = 'habit' then
    if not (p_operation in ('habit_create', 'habit_edit', 'habit_pause', 'habit_resume', 'legacy_upsert') or v_is_undo) then
      raise exception 'operation is not allowed for habit' using errcode = '22023';
    end if;
    if public.dostigator_valid_activity_periods(
      p_after->'activity_periods', (p_after->>'active')::boolean
    ) is not true then
      raise exception 'habit payload does not match operation' using errcode = '22023';
    end if;
    select * into v_habit from public.dostigator_habits where id = p_entity_id and user_id = v_owner for update;
    if not found then
      if p_operation not in ('habit_create', 'legacy_upsert') or p_expected_revision <> 0 then
        raise exception 'habit is missing or stale' using errcode = '40001';
      end if;
      if p_operation = 'habit_create' and coalesce((p_after->>'active')::boolean, true) is not true then
        raise exception 'habit_create payload does not match operation' using errcode = '22023';
      end if;
      insert into public.dostigator_habits (
        id, user_id, area_id, title, target_per_week, active, activity_periods,
        created_at, updated_at, revision, last_mutation_id
      ) values (
        p_entity_id, v_owner, nullif(p_after->>'area_id', '')::uuid, trim(p_after->>'title'),
        coalesce((p_after->>'target_per_week')::smallint, 7), coalesce((p_after->>'active')::boolean, true),
        coalesce(p_after->'activity_periods', '[]'::jsonb),
        coalesce(nullif(p_after->>'created_at', '')::timestamptz, now()),
        coalesce(nullif(p_after->>'updated_at', '')::timestamptz, now()), 1, p_mutation_id
      ) returning * into v_habit;
      v_before := null;
    else
      if v_habit.revision <> p_expected_revision then raise exception 'habit revision conflict' using errcode = '40001'; end if;
      if p_operation = 'habit_create' then raise exception 'habit already exists' using errcode = '23505'; end if;
      v_before := public.dostigator_history_snapshot('habit', to_jsonb(v_habit));
      if not v_is_undo and (
        (p_operation = 'habit_edit' and (
          (p_after->>'active')::boolean is distinct from v_habit.active
          or p_after->'activity_periods' is distinct from v_habit.activity_periods
        ))
        or (p_operation in ('habit_pause', 'habit_resume') and (
          nullif(p_after->>'area_id', '')::uuid is distinct from v_habit.area_id
          or trim(p_after->>'title') is distinct from v_habit.title
          or (p_after->>'target_per_week')::smallint is distinct from v_habit.target_per_week
        ))
        or (p_operation = 'habit_pause' and (
          v_habit.active is distinct from true
          or (p_after->>'active')::boolean is distinct from false
          or (select count(*) from jsonb_array_elements(v_habit.activity_periods) period where period->'ended_on' = 'null'::jsonb) <> 1
          or (select count(*) from jsonb_array_elements(p_after->'activity_periods') period where period->'ended_on' = 'null'::jsonb) <> 0
          or jsonb_array_length(p_after->'activity_periods') <> jsonb_array_length(v_habit.activity_periods)
          or jsonb_array_length(v_habit.activity_periods) = 0
          or v_habit.activity_periods->(jsonb_array_length(v_habit.activity_periods) - 1)->>'ended_on' is not null
          or (p_after->'activity_periods')->(jsonb_array_length(v_habit.activity_periods) - 1)->>'ended_on' !~ '^\d{4}-\d{2}-\d{2}$'
          or (p_after->'activity_periods')->(jsonb_array_length(v_habit.activity_periods) - 1)->>'started_on'
            is distinct from v_habit.activity_periods->(jsonb_array_length(v_habit.activity_periods) - 1)->>'started_on'
          or ((p_after->'activity_periods') - (jsonb_array_length(v_habit.activity_periods) - 1))
            is distinct from (v_habit.activity_periods - (jsonb_array_length(v_habit.activity_periods) - 1))
        ))
        or (p_operation = 'habit_resume' and (
          v_habit.active is distinct from false
          or (p_after->>'active')::boolean is distinct from true
          or (select count(*) from jsonb_array_elements(v_habit.activity_periods) period where period->'ended_on' = 'null'::jsonb) <> 0
          or (select count(*) from jsonb_array_elements(p_after->'activity_periods') period where period->'ended_on' = 'null'::jsonb) <> 1
          or jsonb_array_length(p_after->'activity_periods') <> jsonb_array_length(v_habit.activity_periods) + 1
          or ((p_after->'activity_periods') - jsonb_array_length(v_habit.activity_periods)) is distinct from v_habit.activity_periods
          or (p_after->'activity_periods')->jsonb_array_length(v_habit.activity_periods)->>'started_on' !~ '^\d{4}-\d{2}-\d{2}$'
          or (p_after->'activity_periods')->jsonb_array_length(v_habit.activity_periods)->>'ended_on' is not null
        ))
      ) then
        raise exception 'habit payload does not match operation' using errcode = '22023';
      end if;
      update public.dostigator_habits set
        area_id = nullif(p_after->>'area_id', '')::uuid, title = trim(p_after->>'title'),
        target_per_week = (p_after->>'target_per_week')::smallint, active = (p_after->>'active')::boolean,
        activity_periods = p_after->'activity_periods',
        updated_at = coalesce(nullif(p_after->>'updated_at', '')::timestamptz, now()),
        revision = revision + 1, last_mutation_id = p_mutation_id
      where id = p_entity_id and user_id = v_owner returning * into v_habit;
    end if;
    v_result_row := to_jsonb(v_habit);
    v_after := public.dostigator_history_snapshot('habit', v_result_row);

  elsif p_entity_type = 'habit_checkin' then
    if not (p_operation in ('habit_check', 'habit_uncheck', 'legacy_upsert', 'legacy_delete') or v_is_undo) then
      raise exception 'operation is not allowed for check-in' using errcode = '22023';
    end if;
    if not v_is_undo and p_operation in ('habit_check', 'legacy_upsert') then
      if not (p_after ? 'habit_id') or not (p_after ? 'checked_on')
        or p_after->>'checked_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'check-in is outside habit activity periods' using errcode = '22023';
      end if;
      v_checkin_habit_id := (p_after->>'habit_id')::uuid;
      v_checked_on := (p_after->>'checked_on')::date;
      if v_checked_on::text <> p_after->>'checked_on' then
        raise exception 'check-in is outside habit activity periods' using errcode = '22023';
      end if;
      select * into v_habit from public.dostigator_habits
      where id = v_checkin_habit_id and user_id = v_owner;
      if not found or public.dostigator_valid_activity_periods(v_habit.activity_periods, v_habit.active) is not true
        or not exists (
          select 1 from jsonb_array_elements(v_habit.activity_periods) period
          where (period->>'started_on')::date <= v_checked_on
            and (period->'ended_on' = 'null'::jsonb or (period->>'ended_on')::date >= v_checked_on)
        ) then
        raise exception 'check-in is outside habit activity periods' using errcode = '22023';
      end if;
    end if;
    select * into v_checkin from public.dostigator_habit_checkins where id = p_entity_id and user_id = v_owner for update;
    if found and p_operation = 'habit_check' and not v_is_undo then
      raise exception 'habit_check already exists' using errcode = '23505';
    end if;
    if p_operation in ('habit_uncheck', 'legacy_delete') then
      if not found or v_checkin.revision <> p_expected_revision then raise exception 'check-in is missing or stale' using errcode = '40001'; end if;
      v_before := public.dostigator_history_snapshot('habit_checkin', to_jsonb(v_checkin));
      delete from public.dostigator_habit_checkins where id = p_entity_id and user_id = v_owner;
      v_after := null;
      v_result_row := null;
    elsif not found then
      if (p_operation not in ('habit_check', 'legacy_upsert') and not v_is_undo)
        or (not v_is_undo and p_expected_revision <> 0) then
        raise exception 'check-in is missing or stale' using errcode = '40001';
      end if;
      insert into public.dostigator_habit_checkins (
        id, user_id, habit_id, checked_on, note, created_at, revision, last_mutation_id
      ) values (
        p_entity_id, v_owner, (p_after->>'habit_id')::uuid, (p_after->>'checked_on')::date,
        coalesce(trim(p_after->>'note'), ''), coalesce(nullif(p_after->>'created_at', '')::timestamptz, now()),
        case when v_is_undo then p_expected_revision + 1 else 1 end, p_mutation_id
      ) returning * into v_checkin;
      v_before := null;
      v_result_row := to_jsonb(v_checkin);
      v_after := public.dostigator_history_snapshot('habit_checkin', v_result_row);
    else
      if v_checkin.revision <> p_expected_revision then raise exception 'check-in revision conflict' using errcode = '40001'; end if;
      v_before := public.dostigator_history_snapshot('habit_checkin', to_jsonb(v_checkin));
      update public.dostigator_habit_checkins set
        habit_id = (p_after->>'habit_id')::uuid, checked_on = (p_after->>'checked_on')::date,
        note = coalesce(trim(p_after->>'note'), ''), revision = revision + 1, last_mutation_id = p_mutation_id
      where id = p_entity_id and user_id = v_owner returning * into v_checkin;
      v_result_row := to_jsonb(v_checkin);
      v_after := public.dostigator_history_snapshot('habit_checkin', v_result_row);
    end if;

  elsif p_entity_type = 'review' then
    if not (p_operation in ('review_create', 'review_edit', 'legacy_upsert') or v_is_undo) then
      raise exception 'operation is not allowed for review' using errcode = '22023';
    end if;
    if not v_is_undo and public.dostigator_valid_iso_monday(p_after->>'week_start') is not true then
      if p_operation in ('review_create', 'legacy_upsert') then
        raise exception 'review snapshot does not match week' using errcode = '22023';
      end if;
      raise exception 'review payload does not match operation' using errcode = '22023';
    end if;
    if not v_is_undo and p_operation in ('review_create', 'legacy_upsert')
      and (
        not (p_after ? 'metrics_snapshot')
        or (p_operation = 'review_create' and jsonb_typeof(p_after->'metrics_snapshot') <> 'object')
        or public.dostigator_valid_weekly_metrics(
          p_after->'metrics_snapshot', p_after->>'week_start'
        ) is not true
      ) then
      raise exception 'review snapshot does not match week' using errcode = '22023';
    end if;
    select * into v_review from public.dostigator_weekly_reviews where id = p_entity_id and user_id = v_owner for update;
    if not found then
      if p_operation not in ('review_create', 'legacy_upsert') or p_expected_revision <> 0 then
        raise exception 'review is missing or stale' using errcode = '40001';
      end if;
      insert into public.dostigator_weekly_reviews (
        id, user_id, week_start, wins, blockers, next_focus, self_score, metrics_snapshot,
        created_at, updated_at, revision, last_mutation_id
      ) values (
        p_entity_id, v_owner, (p_after->>'week_start')::date, coalesce(trim(p_after->>'wins'), ''),
        coalesce(trim(p_after->>'blockers'), ''), coalesce(trim(p_after->>'next_focus'), ''),
        nullif(p_after->>'self_score', '')::smallint, nullif(p_after->'metrics_snapshot', 'null'::jsonb),
        coalesce(nullif(p_after->>'created_at', '')::timestamptz, now()),
        coalesce(nullif(p_after->>'updated_at', '')::timestamptz, now()), 1, p_mutation_id
      ) returning * into v_review;
      v_before := null;
    else
      if v_review.revision <> p_expected_revision then raise exception 'review revision conflict' using errcode = '40001'; end if;
      if p_operation = 'review_create' then raise exception 'review already exists' using errcode = '23505'; end if;
      v_before := public.dostigator_history_snapshot('review', to_jsonb(v_review));
      if not v_is_undo and p_operation in ('review_edit', 'legacy_upsert')
        and (p_after->>'week_start')::date is distinct from v_review.week_start then
        raise exception 'review payload does not match operation' using errcode = '22023';
      end if;
      update public.dostigator_weekly_reviews set
        week_start = (p_after->>'week_start')::date, wins = coalesce(trim(p_after->>'wins'), ''),
        blockers = coalesce(trim(p_after->>'blockers'), ''), next_focus = coalesce(trim(p_after->>'next_focus'), ''),
        self_score = nullif(p_after->>'self_score', '')::smallint,
        metrics_snapshot = case when v_is_undo or p_source = 'import'
          then nullif(p_after->'metrics_snapshot', 'null'::jsonb) else v_review.metrics_snapshot end,
        updated_at = coalesce(nullif(p_after->>'updated_at', '')::timestamptz, now()),
        revision = revision + 1, last_mutation_id = p_mutation_id
      where id = p_entity_id and user_id = v_owner returning * into v_review;
    end if;
    v_result_row := to_jsonb(v_review);
    v_after := public.dostigator_history_snapshot('review', v_result_row);
  else
    raise exception 'unknown entity type' using errcode = '22023';
  end if;

  insert into public.dostigator_history_events (
    user_id, mutation_id, entity_type, entity_id, operation, label, before_data, after_data,
    base_revision, result_revision, source, reverts_event_id
  ) values (
    v_owner, p_mutation_id, p_entity_type, p_entity_id,
    case when v_is_undo then 'undo' else p_operation end, trim(p_label), v_before, v_after,
    p_expected_revision, p_expected_revision + 1, p_source, v_reverts_event_id
  ) returning * into v_event;

  return jsonb_build_object('event', to_jsonb(v_event), 'row', v_result_row, 'idempotent', false);
end
$$;

create or replace function public.dostigator_undo_mutation(
  p_expected_owner uuid,
  p_original_mutation_id uuid,
  p_mutation_id uuid,
  p_source text default 'undo'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_original public.dostigator_history_events%rowtype;
  v_existing public.dostigator_history_events%rowtype;
  v_current_revision bigint;
  v_current jsonb;
  v_event public.dostigator_history_events%rowtype;
  v_dependents bigint;
  v_request_envelope jsonb;
  v_stored_request_envelope jsonb;
begin
  if v_owner is null or p_expected_owner is null or v_owner is distinct from p_expected_owner then
    raise exception 'expected owner does not match authenticated user' using errcode = '42501';
  end if;
  if p_original_mutation_id is null or p_mutation_id is null then
    raise exception 'invalid undo envelope' using errcode = '22023';
  end if;
  if p_source not in ('ui', 'offline', 'undo', 'import', 'legacy') then
    raise exception 'invalid mutation source' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':' || p_mutation_id::text, 0));

  v_request_envelope := jsonb_build_object(
    'rpc', 'undo',
    'expected_owner', p_expected_owner,
    'original_mutation_id', p_original_mutation_id,
    'source', p_source
  );

  select * into v_existing from public.dostigator_history_events where user_id = v_owner and mutation_id = p_mutation_id;
  if found then
    select request_envelope into v_stored_request_envelope
    from public.dostigator_mutation_requests
    where user_id = v_owner and mutation_id = p_mutation_id;
    if not found or v_stored_request_envelope <> v_request_envelope then
      raise exception 'mutation id was reused with a different request envelope' using errcode = '22023';
    end if;
    return jsonb_build_object('event', to_jsonb(v_existing), 'row', v_existing.after_data, 'idempotent', true);
  end if;

  insert into public.dostigator_mutation_requests (user_id, mutation_id, request_envelope)
  values (v_owner, p_mutation_id, v_request_envelope);

  select * into v_original from public.dostigator_history_events
  where user_id = v_owner and mutation_id = p_original_mutation_id for update;
  if not found then raise exception 'history event not found' using errcode = 'P0002'; end if;
  if v_original.operation = 'undo' then raise exception 'undo events cannot be undone' using errcode = '22023'; end if;
  if exists (select 1 from public.dostigator_history_events where reverts_event_id = v_original.id) then
    raise exception 'change was already undone' using errcode = '23505';
  end if;

  -- A create has no before snapshot. It can be removed only while still current
  -- and while no dependent product data exists.
  if v_original.before_data is null then
    if v_original.entity_type = 'goal' then
      select revision, to_jsonb(g) into v_current_revision, v_current from public.dostigator_goals g
        where id = v_original.entity_id and user_id = v_owner for update;
      if not found or v_current_revision <> v_original.result_revision then raise exception 'newer changes block undo' using errcode = '40001'; end if;
      select count(*) into v_dependents from public.dostigator_actions where goal_id = v_original.entity_id and user_id = v_owner;
      if v_dependents > 0 then raise exception 'goal has dependent actions' using errcode = '23503'; end if;
      delete from public.dostigator_goals where id = v_original.entity_id and user_id = v_owner;
    elsif v_original.entity_type = 'action' then
      select revision, to_jsonb(a) into v_current_revision, v_current from public.dostigator_actions a
        where id = v_original.entity_id and user_id = v_owner for update;
      if not found or v_current_revision <> v_original.result_revision then raise exception 'newer changes block undo' using errcode = '40001'; end if;
      delete from public.dostigator_actions where id = v_original.entity_id and user_id = v_owner;
    elsif v_original.entity_type = 'habit' then
      select revision, to_jsonb(h) into v_current_revision, v_current from public.dostigator_habits h
        where id = v_original.entity_id and user_id = v_owner for update;
      if not found or v_current_revision <> v_original.result_revision then raise exception 'newer changes block undo' using errcode = '40001'; end if;
      select count(*) into v_dependents from public.dostigator_habit_checkins where habit_id = v_original.entity_id and user_id = v_owner;
      if v_dependents > 0 then raise exception 'habit has dependent check-ins' using errcode = '23503'; end if;
      delete from public.dostigator_habits where id = v_original.entity_id and user_id = v_owner;
    elsif v_original.entity_type = 'habit_checkin' then
      select revision, to_jsonb(c) into v_current_revision, v_current from public.dostigator_habit_checkins c
        where id = v_original.entity_id and user_id = v_owner for update;
      if not found or v_current_revision <> v_original.result_revision then raise exception 'newer changes block undo' using errcode = '40001'; end if;
      delete from public.dostigator_habit_checkins where id = v_original.entity_id and user_id = v_owner;
    elsif v_original.entity_type = 'review' then
      select revision, to_jsonb(r) into v_current_revision, v_current from public.dostigator_weekly_reviews r
        where id = v_original.entity_id and user_id = v_owner for update;
      if not found or v_current_revision <> v_original.result_revision then raise exception 'newer changes block undo' using errcode = '40001'; end if;
      delete from public.dostigator_weekly_reviews where id = v_original.entity_id and user_id = v_owner;
    else
      raise exception 'entity cannot be undone' using errcode = '22023';
    end if;

    insert into public.dostigator_history_events (
      user_id, mutation_id, entity_type, entity_id, operation, label, before_data, after_data,
      base_revision, result_revision, source, reverts_event_id
    ) values (
      v_owner, p_mutation_id, v_original.entity_type, v_original.entity_id, 'undo',
      left('Отмена: ' || v_original.label, 180),
      public.dostigator_history_snapshot(v_original.entity_type, v_current), null,
      v_original.result_revision, v_original.result_revision + 1, p_source, v_original.id
    ) returning * into v_event;
    return jsonb_build_object('event', to_jsonb(v_event), 'row', null, 'idempotent', false);
  end if;

  perform set_config('dostigator.reverts_event_id', v_original.id::text, true);
  return public.dostigator_apply_mutation(
    p_expected_owner, p_mutation_id, v_original.entity_type, v_original.entity_id, 'undo',
    left('Отмена: ' || v_original.label, 180), v_original.result_revision, v_original.before_data, p_source
  );
end
$$;

create or replace function public.dostigator_history_page(
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 30
)
returns setof public.dostigator_history_events
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select event.*
  from public.dostigator_history_events event
  where event.user_id = auth.uid()
    and (
      p_before_created_at is null
      or event.created_at < p_before_created_at
      or (event.created_at = p_before_created_at and p_before_id is not null and event.id < p_before_id)
    )
  order by event.created_at desc, event.id desc
  limit least(greatest(p_limit, 1), 100)
$$;

-- The RPCs own all post-migration product mutations. Keeping SELECT grants
-- preserves normal PostgREST reads while preventing partial row/event writes.
revoke insert, update, delete on table
  public.dostigator_goals,
  public.dostigator_actions,
  public.dostigator_habits,
  public.dostigator_habit_checkins,
  public.dostigator_weekly_reviews
from authenticated;

revoke all on function public.dostigator_history_snapshot(text, jsonb) from public, anon, authenticated;
revoke all on function public.dostigator_valid_activity_periods(jsonb, boolean) from public, anon, authenticated;
revoke all on function public.dostigator_valid_iso_monday(text) from public, anon, authenticated;
revoke all on function public.dostigator_valid_weekly_metrics(jsonb, text) from public, anon, authenticated;
revoke all on function public.dostigator_apply_mutation(uuid, uuid, text, uuid, text, text, bigint, jsonb, text) from public, anon;
revoke all on function public.dostigator_undo_mutation(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.dostigator_history_page(timestamptz, uuid, integer) from public, anon;
grant execute on function public.dostigator_apply_mutation(uuid, uuid, text, uuid, text, text, bigint, jsonb, text) to authenticated;
grant execute on function public.dostigator_undo_mutation(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.dostigator_history_page(timestamptz, uuid, integer) to authenticated;
