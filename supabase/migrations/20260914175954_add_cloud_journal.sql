-- Private journal entries use the same atomic history and revision protocol as goals.
create table public.dostigator_journals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null check (date between date '0001-01-01' and date '9999-12-31'),
  entry_type text not null check (entry_type in ('idea', 'plan', 'day-note')),
  title text not null check (char_length(trim(title)) between 1 and 180),
  content text not null default '' check (char_length(content) <= 5000),
  revision bigint not null default 0 check (revision >= 0),
  last_mutation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index dostigator_journals_owner_date_idx on public.dostigator_journals (user_id, date desc, created_at desc);
alter table public.dostigator_journals enable row level security;
create policy "journal select own" on public.dostigator_journals for select to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.dostigator_journals from public, anon, authenticated;
grant select on public.dostigator_journals to authenticated;
alter table public.dostigator_history_events drop constraint dostigator_history_events_entity_type_check;
alter table public.dostigator_history_events add constraint dostigator_history_events_entity_type_check
  check (entity_type in ('goal', 'action', 'habit', 'habit_checkin', 'review', 'journal'));
alter table public.dostigator_history_events drop constraint dostigator_history_events_operation_check;
alter table public.dostigator_history_events add constraint dostigator_history_events_operation_check check (operation in (
  'goal_create', 'goal_edit', 'goal_pause', 'goal_resume', 'goal_complete',
  'action_create', 'action_edit', 'action_complete', 'action_reopen', 'action_delete', 'focus_add', 'focus_remove',
  'habit_create', 'habit_edit', 'habit_pause', 'habit_resume', 'habit_check', 'habit_uncheck',
  'review_create', 'review_edit', 'journal_create', 'journal_edit', 'journal_delete', 'undo', 'legacy_upsert', 'legacy_delete'
));


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
    when 'journal' then jsonb_build_object(
      'id', p_row->'id', 'date', p_row->'date', 'entry_type', p_row->'entry_type',
      'title', p_row->'title', 'content', p_row->'content'
    )
    else null
  end
$$;

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
  v_journal public.dostigator_journals%rowtype;
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

  elsif p_entity_type = 'journal' then
    if p_expected_revision is null or p_operation is null or p_source is null
      or not (p_operation in ('journal_create', 'journal_edit', 'journal_delete', 'legacy_upsert') or v_is_undo) then
      raise exception 'invalid journal operation' using errcode = '22023';
    end if;
    if jsonb_typeof(p_after) is distinct from 'object'
      or jsonb_typeof(p_after->'date') is distinct from 'string'
      or coalesce(p_after->>'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(p_after->'entry_type') is distinct from 'string'
      or coalesce(p_after->>'entry_type', '') not in ('idea', 'plan', 'day-note')
      or jsonb_typeof(p_after->'title') is distinct from 'string'
      or char_length(trim(coalesce(p_after->>'title', ''))) not between 1 and 180
      or jsonb_typeof(p_after->'content') is distinct from 'string'
      or char_length(p_after->>'content') > 5000 then
      raise exception 'invalid journal entry' using errcode = '22023';
    end if;
    if (p_after->>'date')::date::text <> p_after->>'date' then
      raise exception 'invalid journal date' using errcode = '22023';
    end if;
    if v_is_undo and not exists (
      select 1 from public.dostigator_history_events e
      where e.id = v_reverts_event_id and e.user_id = v_owner
        and e.entity_type = 'journal' and e.entity_id = p_entity_id
        and e.result_revision = p_expected_revision and e.before_data = p_after
        and e.operation <> 'undo'
    ) then
      raise exception 'invalid journal undo context' using errcode = '42501';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':journal:' || p_entity_id::text, 0));
    select * into v_journal from public.dostigator_journals
      where id = p_entity_id and user_id = v_owner for update;
    if not found then
      if (not v_is_undo and (p_operation not in ('journal_create', 'legacy_upsert') or p_expected_revision <> 0))
        or exists (select 1 from public.dostigator_history_events e
          where e.user_id = v_owner and e.entity_type = 'journal' and e.entity_id = p_entity_id
            and (not v_is_undo or e.result_revision > p_expected_revision)) then
        raise exception 'journal is missing or stale' using errcode = '40001';
      end if;
      insert into public.dostigator_journals (
        id, user_id, date, entry_type, title, content, created_at, updated_at, revision, last_mutation_id
      ) values (
        p_entity_id, v_owner, (p_after->>'date')::date, p_after->>'entry_type', trim(p_after->>'title'),
        p_after->>'content', coalesce(nullif(p_after->>'created_at', '')::timestamptz, now()),
        coalesce(nullif(p_after->>'updated_at', '')::timestamptz, now()),
        p_expected_revision + 1, p_mutation_id
      ) returning * into v_journal;
      v_before := null;
      v_result_row := to_jsonb(v_journal);
      v_after := public.dostigator_history_snapshot('journal', v_result_row);
    else
      if v_journal.revision <> p_expected_revision then
        raise exception 'journal revision conflict' using errcode = '40001';
      end if;
      if p_operation = 'journal_create' then raise exception 'journal already exists' using errcode = '23505'; end if;
      v_before := public.dostigator_history_snapshot('journal', to_jsonb(v_journal));
      if p_operation = 'journal_delete' then
        if public.dostigator_history_snapshot('journal', p_after) is distinct from v_before then
          raise exception 'journal delete does not match current entry' using errcode = '40001';
        end if;
        delete from public.dostigator_journals where id = p_entity_id and user_id = v_owner;
        v_result_row := null;
        v_after := null;
      else
        update public.dostigator_journals set
          date = (p_after->>'date')::date, entry_type = p_after->>'entry_type',
          title = trim(p_after->>'title'), content = p_after->>'content',
          updated_at = coalesce(nullif(p_after->>'updated_at', '')::timestamptz, now()),
          revision = revision + 1, last_mutation_id = p_mutation_id
        where id = p_entity_id and user_id = v_owner returning * into v_journal;
        v_result_row := to_jsonb(v_journal);
        v_after := public.dostigator_history_snapshot('journal', v_result_row);
      end if;
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
    elsif v_original.entity_type = 'journal' then
      perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':journal:' || v_original.entity_id::text, 0));
      select revision, to_jsonb(j) into v_current_revision, v_current from public.dostigator_journals j
        where id = v_original.entity_id and user_id = v_owner for update;
      if not found or v_current_revision <> v_original.result_revision then
        raise exception 'newer changes block undo' using errcode = '40001';
      end if;
      delete from public.dostigator_journals where id = v_original.entity_id and user_id = v_owner;
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

create or replace function public.dostigator_import_backup(
  p_expected_owner uuid,
  p_import_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_existing_envelope jsonb;
  v_envelope jsonb;
  v_trusted_import_token text;
  v_counts jsonb;
  v_row jsonb;
  v_entity_type text;
  v_entity_id uuid;
  v_revision bigint;
  v_hash text;
  v_mutation_id uuid;
  v_section text;
  v_label text;
  v_source_area_id uuid;
  v_destination_area_id uuid;
  v_area_by_id uuid;
  v_area_by_name uuid;
  v_focus_commitments jsonb;
  v_source_entity_id uuid;
  v_destination_entity_id uuid;
  v_entity_by_id uuid;
  v_entity_by_natural uuid;
  v_entity_by_derived uuid;
  v_derived_entity_id uuid;
  v_source_id_taken boolean;
  v_source_parent_id uuid;
  v_destination_parent_id uuid;
  v_committed_on date;
begin
  if v_owner is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_expected_owner is null or p_expected_owner <> v_owner then
    raise exception 'backup import owner mismatch' using errcode = '42501';
  end if;
  if p_import_id is null then
    raise exception 'backup import id is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'backup payload must be an object' using errcode = '22023';
  end if;

  foreach v_section in array array['areas', 'goals', 'actions', 'habits', 'checkins', 'reviews'] loop
    if jsonb_typeof(p_payload->v_section) <> 'array' then
      raise exception 'backup section % must be an array', v_section using errcode = '22023';
    end if;
  end loop;
  if p_payload ? 'journals' and jsonb_typeof(p_payload->'journals') is distinct from 'array' then
    raise exception 'backup journals must be an array' using errcode = '22023';
  end if;
  v_focus_commitments := coalesce(p_payload->'focusCommitments', '[]'::jsonb);
  if jsonb_typeof(v_focus_commitments) <> 'array' then
    raise exception 'backup section focusCommitments must be an array' using errcode = '22023';
  end if;
  if (
    jsonb_array_length(p_payload->'areas')
    + jsonb_array_length(p_payload->'goals')
    + jsonb_array_length(p_payload->'actions')
    + jsonb_array_length(p_payload->'habits')
    + jsonb_array_length(p_payload->'checkins')
    + jsonb_array_length(p_payload->'reviews')
    + jsonb_array_length(v_focus_commitments)
    + jsonb_array_length(coalesce(p_payload->'journals', '[]'::jsonb))
  ) > 10000 then
    raise exception 'backup contains too many rows' using errcode = '54000';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_payload->'areas') area
    group by nullif(trim(area->>'id'), '')
    having count(*) > 1
  ) or exists (
    select 1
    from jsonb_array_elements(p_payload->'areas') area
    group by nullif(trim(area->>'name'), '')
    having count(*) > 1
  ) then
    raise exception 'backup contains duplicate area identities' using errcode = '22023';
  end if;
  foreach v_section in array array['goals', 'actions', 'habits', 'checkins', 'reviews', 'journals'] loop
    if exists (
      select 1
      from jsonb_array_elements(coalesce(p_payload->v_section, '[]'::jsonb)) row_data
      group by nullif(trim(row_data->>'id'), '')
      having count(*) > 1
    ) then
      raise exception 'backup contains duplicate % ids', v_section using errcode = '22023';
    end if;
  end loop;
  if exists (
    select 1 from jsonb_array_elements(p_payload->'reviews') review
    group by nullif(trim(review->>'week_start'), '') having count(*) > 1
  ) then
    raise exception 'backup contains duplicate review weeks' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_focus_commitments) commitment
    group by nullif(trim(commitment->>'id'), '') having count(*) > 1
  ) or exists (
    select 1 from jsonb_array_elements(v_focus_commitments) commitment
    group by nullif(trim(commitment->>'action_id'), ''), nullif(trim(commitment->>'committed_on'), '')
    having count(*) > 1
  ) or exists (
    select 1 from jsonb_array_elements(v_focus_commitments) commitment
    group by nullif(trim(commitment->>'committed_on'), ''), nullif(trim(commitment->>'position'), '')
    having count(*) > 1
  ) then
    raise exception 'backup contains duplicate focus commitments' using errcode = '22023';
  end if;

  v_counts := jsonb_build_object(
    'areas', jsonb_array_length(p_payload->'areas'),
    'goals', jsonb_array_length(p_payload->'goals'),
    'actions', jsonb_array_length(p_payload->'actions'),
    'habits', jsonb_array_length(p_payload->'habits'),
    'checkins', jsonb_array_length(p_payload->'checkins'),
    'reviews', jsonb_array_length(p_payload->'reviews'),
    'journals', jsonb_array_length(coalesce(p_payload->'journals', '[]'::jsonb)),
    'focusCommitments', jsonb_array_length(v_focus_commitments)
  );
  v_envelope := jsonb_build_object(
    'rpc', 'backup_import',
    'expected_owner', p_expected_owner,
    'payload_md5', md5(p_payload::text),
    'counts', v_counts
  );

  perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':backup:' || p_import_id::text, 0));
  select request_envelope into v_existing_envelope
  from public.dostigator_mutation_requests
  where user_id = v_owner and mutation_id = p_import_id;
  if found then
    if v_existing_envelope <> v_envelope then
      raise exception 'backup import id was reused with different data' using errcode = '22023';
    end if;
    return jsonb_build_object('idempotent', true, 'counts', v_counts);
  end if;
  if exists (
    select 1 from public.dostigator_history_events
    where user_id = v_owner and mutation_id = p_import_id
  ) then
    raise exception 'backup import id conflicts with a mutation id' using errcode = '22023';
  end if;
  v_trusted_import_token := gen_random_uuid()::text;
  insert into public.dostigator_mutation_requests (user_id, mutation_id, request_envelope)
  values (
    v_owner,
    p_import_id,
    v_envelope || jsonb_build_object('trusted_context', v_trusted_import_token)
  );
  perform set_config('dostigator.trusted_backup_import_token', v_trusted_import_token, true);

  -- Area UUIDs are global primary keys, while a user's stable area identity is
  -- its owner-scoped unique name. A backup from another account therefore maps
  -- each source UUID to the destination user's real area UUID before any goal
  -- or habit is restored. The temporary map lives only for this transaction.
  create temporary table if not exists pg_temp.dostigator_backup_area_map (
    source_id uuid primary key,
    destination_id uuid not null unique,
    area_name text not null unique
  ) on commit drop;
  truncate table pg_temp.dostigator_backup_area_map;
  create temporary table if not exists pg_temp.dostigator_backup_entity_map (
    entity_type text not null,
    source_id uuid not null,
    destination_id uuid not null,
    primary key (entity_type, source_id),
    unique (entity_type, destination_id)
  ) on commit drop;
  truncate table pg_temp.dostigator_backup_entity_map;

  for v_row in select value from jsonb_array_elements(p_payload->'areas') loop
    if jsonb_typeof(v_row) <> 'object' or nullif(trim(v_row->>'id'), '') is null
      or nullif(trim(v_row->>'name'), '') is null then
      raise exception 'backup contains an invalid area' using errcode = '22023';
    end if;
    v_source_area_id := (v_row->>'id')::uuid;
    v_area_by_id := null;
    v_area_by_name := null;
    select id into v_area_by_id
    from public.dostigator_areas
    where id = v_source_area_id and user_id = v_owner
    for update;
    select id into v_area_by_name
    from public.dostigator_areas
    where user_id = v_owner and name = trim(v_row->>'name')
    for update;

    if v_area_by_id is not null and v_area_by_name is not null
      and v_area_by_id <> v_area_by_name then
      raise exception 'backup area id and name match different destination areas' using errcode = '22023';
    end if;

    v_destination_area_id := coalesce(v_area_by_name, v_area_by_id);
    if v_destination_area_id is null then
      if not exists (select 1 from public.dostigator_areas where id = v_source_area_id) then
        v_destination_area_id := v_source_area_id;
      else
        -- A cross-account source UUID is already owned elsewhere. Derive a
        -- stable owner-scoped UUID so a later import with a new import UUID
        -- still updates the same destination row rather than duplicating it.
        v_hash := md5(v_owner::text || ':area:' || v_source_area_id::text);
        v_destination_area_id := (
          substr(v_hash, 1, 8) || '-' || substr(v_hash, 9, 4) || '-' || substr(v_hash, 13, 4)
          || '-' || substr(v_hash, 17, 4) || '-' || substr(v_hash, 21, 12)
        )::uuid;
        if exists (
          select 1 from public.dostigator_areas
          where id = v_destination_area_id and user_id <> v_owner
        ) then
          raise exception 'backup area owner collision' using errcode = '42501';
        end if;
      end if;
    end if;

    if exists (
      select 1 from public.dostigator_areas
      where id = v_destination_area_id and user_id = v_owner
    ) then
      update public.dostigator_areas set
        name = trim(v_row->>'name'),
        color = coalesce(nullif(v_row->>'color', ''), '#ffc857'),
        icon = coalesce(nullif(v_row->>'icon', ''), 'sparkles'),
        position = coalesce((v_row->>'position')::integer, 0),
        archived_at = nullif(v_row->>'archived_at', '')::timestamptz,
        updated_at = coalesce(nullif(v_row->>'updated_at', '')::timestamptz, now()),
        revision = revision + 1,
        last_mutation_id = p_import_id
      where id = v_destination_area_id and user_id = v_owner;
    else
      insert into public.dostigator_areas (
        id, user_id, name, color, icon, position, archived_at, created_at, updated_at,
        revision, last_mutation_id
      ) values (
        v_destination_area_id, v_owner, trim(v_row->>'name'),
        coalesce(nullif(v_row->>'color', ''), '#ffc857'),
        coalesce(nullif(v_row->>'icon', ''), 'sparkles'), coalesce((v_row->>'position')::integer, 0),
        nullif(v_row->>'archived_at', '')::timestamptz,
        coalesce(nullif(v_row->>'created_at', '')::timestamptz, now()),
        coalesce(nullif(v_row->>'updated_at', '')::timestamptz, now()),
        1, p_import_id
      );
    end if;

    insert into pg_temp.dostigator_backup_area_map (source_id, destination_id, area_name)
    values (v_source_area_id, v_destination_area_id, trim(v_row->>'name'));
  end loop;

  for v_section, v_entity_type, v_label in
    select * from (values
      ('goals', 'goal', 'Цель восстановлена из резервной копии'),
      ('actions', 'action', 'Действие восстановлено из резервной копии'),
      ('habits', 'habit', 'Привычка восстановлена из резервной копии'),
      ('checkins', 'habit_checkin', 'Отметка восстановлена из резервной копии'),
      ('reviews', 'review', 'Обзор восстановлен из резервной копии'),
      ('journals', 'journal', 'Запись дневника восстановлена из резервной копии')
    ) as groups(section_name, entity_type, event_label)
  loop
    for v_row in select value from jsonb_array_elements(coalesce(p_payload->v_section, '[]'::jsonb)) loop
      if jsonb_typeof(v_row) <> 'object' or nullif(trim(v_row->>'id'), '') is null then
        raise exception 'backup contains an invalid % row', v_entity_type using errcode = '22023';
      end if;
      v_source_entity_id := (v_row->>'id')::uuid;
      if v_entity_type in ('goal', 'habit') and nullif(v_row->>'area_id', '') is not null then
        v_source_area_id := (v_row->>'area_id')::uuid;
        select destination_id into v_destination_area_id
        from pg_temp.dostigator_backup_area_map
        where source_id = v_source_area_id;
        if not found then
          raise exception 'backup % references an unknown area', v_entity_type using errcode = '22023';
        end if;
        v_row := v_row || jsonb_build_object('area_id', v_destination_area_id);
      end if;
      if v_entity_type = 'action' then
        v_source_parent_id := nullif(v_row->>'goal_id', '')::uuid;
        select destination_id into v_destination_parent_id
        from pg_temp.dostigator_backup_entity_map
        where entity_type = 'goal' and source_id = v_source_parent_id;
        if not found then
          raise exception 'backup action references an unknown goal' using errcode = '22023';
        end if;
        v_row := v_row || jsonb_build_object('goal_id', v_destination_parent_id);
      elsif v_entity_type = 'habit_checkin' then
        v_source_parent_id := nullif(v_row->>'habit_id', '')::uuid;
        select destination_id into v_destination_parent_id
        from pg_temp.dostigator_backup_entity_map
        where entity_type = 'habit' and source_id = v_source_parent_id;
        if not found then
          raise exception 'backup check-in references an unknown habit' using errcode = '22023';
        end if;
        v_row := v_row || jsonb_build_object('habit_id', v_destination_parent_id);
      end if;

      v_entity_by_id := null;
      v_entity_by_natural := null;
      v_entity_by_derived := null;
      v_hash := md5(v_owner::text || ':' || v_entity_type || ':' || v_source_entity_id::text);
      v_derived_entity_id := (
        substr(v_hash, 1, 8) || '-' || substr(v_hash, 9, 4) || '-' || substr(v_hash, 13, 4)
        || '-' || substr(v_hash, 17, 4) || '-' || substr(v_hash, 21, 12)
      )::uuid;

      if v_entity_type = 'goal' then
        select id into v_entity_by_id from public.dostigator_goals
        where id = v_source_entity_id and user_id = v_owner for update;
        select id into v_entity_by_derived from public.dostigator_goals
        where id = v_derived_entity_id and user_id = v_owner for update;
        select exists (select 1 from public.dostigator_goals where id = v_source_entity_id)
          into v_source_id_taken;
      elsif v_entity_type = 'action' then
        select id into v_entity_by_id from public.dostigator_actions
        where id = v_source_entity_id and user_id = v_owner for update;
        select id into v_entity_by_derived from public.dostigator_actions
        where id = v_derived_entity_id and user_id = v_owner for update;
        select exists (select 1 from public.dostigator_actions where id = v_source_entity_id)
          into v_source_id_taken;
      elsif v_entity_type = 'habit' then
        select id into v_entity_by_id from public.dostigator_habits
        where id = v_source_entity_id and user_id = v_owner for update;
        select id into v_entity_by_derived from public.dostigator_habits
        where id = v_derived_entity_id and user_id = v_owner for update;
        select exists (select 1 from public.dostigator_habits where id = v_source_entity_id)
          into v_source_id_taken;
      elsif v_entity_type = 'habit_checkin' then
        select id into v_entity_by_id from public.dostigator_habit_checkins
        where id = v_source_entity_id and user_id = v_owner for update;
        select id into v_entity_by_natural from public.dostigator_habit_checkins
        where user_id = v_owner and habit_id = v_destination_parent_id
          and checked_on = (v_row->>'checked_on')::date for update;
        select id into v_entity_by_derived from public.dostigator_habit_checkins
        where id = v_derived_entity_id and user_id = v_owner for update;
        select exists (select 1 from public.dostigator_habit_checkins where id = v_source_entity_id)
          into v_source_id_taken;
      elsif v_entity_type = 'journal' then
        select id into v_entity_by_id from public.dostigator_journals
        where id = v_source_entity_id and user_id = v_owner for update;
        select id into v_entity_by_derived from public.dostigator_journals
        where id = v_derived_entity_id and user_id = v_owner for update;
        select exists (select 1 from public.dostigator_journals where id = v_source_entity_id)
          into v_source_id_taken;
      else
        select id into v_entity_by_id from public.dostigator_weekly_reviews
        where id = v_source_entity_id and user_id = v_owner for update;
        select id into v_entity_by_natural from public.dostigator_weekly_reviews
        where user_id = v_owner and week_start = (v_row->>'week_start')::date for update;
        select id into v_entity_by_derived from public.dostigator_weekly_reviews
        where id = v_derived_entity_id and user_id = v_owner for update;
        select exists (select 1 from public.dostigator_weekly_reviews where id = v_source_entity_id)
          into v_source_id_taken;
      end if;

      if v_entity_by_id is not null and v_entity_by_natural is not null
        and v_entity_by_id <> v_entity_by_natural then
        raise exception 'backup % id and natural key match different destination rows', v_entity_type
          using errcode = '22023';
      end if;
      v_destination_entity_id := coalesce(v_entity_by_natural, v_entity_by_id, v_entity_by_derived);
      if v_destination_entity_id is null then
        v_destination_entity_id := case when v_source_id_taken
          then v_derived_entity_id else v_source_entity_id end;
      end if;

      if v_destination_entity_id = v_derived_entity_id and v_entity_by_derived is null then
        if (v_entity_type = 'goal' and exists (
          select 1 from public.dostigator_goals where id = v_destination_entity_id and user_id <> v_owner
        )) or (v_entity_type = 'action' and exists (
          select 1 from public.dostigator_actions where id = v_destination_entity_id and user_id <> v_owner
        )) or (v_entity_type = 'habit' and exists (
          select 1 from public.dostigator_habits where id = v_destination_entity_id and user_id <> v_owner
        )) or (v_entity_type = 'habit_checkin' and exists (
          select 1 from public.dostigator_habit_checkins where id = v_destination_entity_id and user_id <> v_owner
        )) or (v_entity_type = 'journal' and exists (
          select 1 from public.dostigator_journals where id = v_destination_entity_id and user_id <> v_owner
        )) or (v_entity_type = 'review' and exists (
          select 1 from public.dostigator_weekly_reviews where id = v_destination_entity_id and user_id <> v_owner
        )) then
          raise exception 'backup % owner-scoped id collision', v_entity_type using errcode = '42501';
        end if;
      end if;

      insert into pg_temp.dostigator_backup_entity_map (entity_type, source_id, destination_id)
      values (v_entity_type, v_source_entity_id, v_destination_entity_id);
      v_entity_id := v_destination_entity_id;
      v_row := v_row || jsonb_build_object('id', v_entity_id);
      v_hash := md5(p_import_id::text || ':' || v_entity_type || ':' || v_source_entity_id::text);
      v_mutation_id := (
        substr(v_hash, 1, 8) || '-' || substr(v_hash, 9, 4) || '-' || substr(v_hash, 13, 4)
        || '-' || substr(v_hash, 17, 4) || '-' || substr(v_hash, 21, 12)
      )::uuid;
      if exists (
        select 1 from public.dostigator_history_events
        where user_id = v_owner and mutation_id = v_mutation_id
      ) then
        continue;
      end if;

      if v_entity_type = 'goal' then
        select revision into v_revision from public.dostigator_goals where id = v_entity_id and user_id = v_owner;
      elsif v_entity_type = 'action' then
        select revision into v_revision from public.dostigator_actions where id = v_entity_id and user_id = v_owner;
      elsif v_entity_type = 'habit' then
        select revision into v_revision from public.dostigator_habits where id = v_entity_id and user_id = v_owner;
      elsif v_entity_type = 'habit_checkin' then
        select revision into v_revision from public.dostigator_habit_checkins where id = v_entity_id and user_id = v_owner;
      elsif v_entity_type = 'journal' then
        select revision into v_revision from public.dostigator_journals where id = v_entity_id and user_id = v_owner;
      else
        select revision into v_revision from public.dostigator_weekly_reviews where id = v_entity_id and user_id = v_owner;
      end if;

      perform public.dostigator_apply_mutation(
        p_expected_owner,
        v_mutation_id,
        v_entity_type,
        v_entity_id,
        'legacy_upsert',
        v_label,
        coalesce(v_revision, 0),
        v_row || jsonb_build_object('user_id', v_owner),
        'import'
      );
      v_revision := null;
    end loop;
  end loop;

  -- The capability exists only while this SECURITY DEFINER function invokes
  -- the mutation RPC. Clear it and remove it from durable state before control
  -- returns to the caller, including when the ledger import below succeeds.
  perform set_config('dostigator.trusted_backup_import_token', '', true);
  update public.dostigator_mutation_requests
  set request_envelope = v_envelope
  where user_id = v_owner and mutation_id = p_import_id;

  -- Focus commitments are durable history, not mutation-history events. Map
  -- their action dependency through the imported action IDs and use the
  -- owner-scoped (action, day) key so trigger-created current commitments and
  -- repeated imports converge on one row.
  for v_row in select value from jsonb_array_elements(v_focus_commitments) loop
    if jsonb_typeof(v_row) <> 'object'
      or nullif(trim(v_row->>'id'), '') is null
      or nullif(trim(v_row->>'action_id'), '') is null
      or coalesce(v_row->>'committed_on', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(v_row->'position') <> 'number' then
      raise exception 'backup contains an invalid focus commitment' using errcode = '22023';
    end if;
    v_source_entity_id := (v_row->>'id')::uuid;
    v_source_parent_id := (v_row->>'action_id')::uuid;
    v_committed_on := (v_row->>'committed_on')::date;
    if v_committed_on::text <> v_row->>'committed_on'
      or (v_row->>'position')::numeric <> trunc((v_row->>'position')::numeric)
      or (v_row->>'position')::integer not between 1 and 3 then
      raise exception 'backup contains an invalid focus commitment' using errcode = '22023';
    end if;
    select destination_id into v_destination_parent_id
    from pg_temp.dostigator_backup_entity_map
    where entity_type = 'action' and source_id = v_source_parent_id;
    if not found then
      raise exception 'backup focus commitment references an unknown action' using errcode = '22023';
    end if;

    v_hash := md5(v_owner::text || ':focus_commitment:' || v_source_entity_id::text);
    v_derived_entity_id := (
      substr(v_hash, 1, 8) || '-' || substr(v_hash, 9, 4) || '-' || substr(v_hash, 13, 4)
      || '-' || substr(v_hash, 17, 4) || '-' || substr(v_hash, 21, 12)
    )::uuid;
    v_entity_by_id := null;
    v_entity_by_natural := null;
    v_entity_by_derived := null;
    select id into v_entity_by_id from public.dostigator_focus_commitments
    where id = v_source_entity_id and user_id = v_owner for update;
    select id into v_entity_by_natural from public.dostigator_focus_commitments
    where user_id = v_owner and action_id = v_destination_parent_id and committed_on = v_committed_on
    for update;
    select id into v_entity_by_derived from public.dostigator_focus_commitments
    where id = v_derived_entity_id and user_id = v_owner for update;
    select exists (
      select 1 from public.dostigator_focus_commitments where id = v_source_entity_id
    ) into v_source_id_taken;

    if v_entity_by_id is not null and v_entity_by_natural is not null
      and v_entity_by_id <> v_entity_by_natural then
      raise exception 'backup focus commitment id and natural key match different destination rows'
        using errcode = '22023';
    end if;
    v_destination_entity_id := coalesce(v_entity_by_natural, v_entity_by_id, v_entity_by_derived);
    if v_destination_entity_id is null then
      v_destination_entity_id := case when v_source_id_taken
        then v_derived_entity_id else v_source_entity_id end;
    end if;
    if v_destination_entity_id = v_derived_entity_id and v_entity_by_derived is null
      and exists (
        select 1 from public.dostigator_focus_commitments
        where id = v_destination_entity_id and user_id <> v_owner
      ) then
      raise exception 'backup focus commitment owner-scoped id collision' using errcode = '42501';
    end if;

    insert into pg_temp.dostigator_backup_entity_map (entity_type, source_id, destination_id)
    values ('focus_commitment', v_source_entity_id, v_destination_entity_id);
    if exists (
      select 1 from public.dostigator_focus_commitments
      where id = v_destination_entity_id and user_id = v_owner
    ) then
      update public.dostigator_focus_commitments set
        action_id = v_destination_parent_id,
        committed_on = v_committed_on,
        position = (v_row->>'position')::smallint,
        source_mutation_id = p_import_id,
        created_at = coalesce(nullif(v_row->>'created_at', '')::timestamptz, now())
      where id = v_destination_entity_id and user_id = v_owner;
    else
      insert into public.dostigator_focus_commitments (
        id, user_id, action_id, committed_on, position, source_mutation_id, created_at
      ) values (
        v_destination_entity_id, v_owner, v_destination_parent_id, v_committed_on,
        (v_row->>'position')::smallint, p_import_id,
        coalesce(nullif(v_row->>'created_at', '')::timestamptz, now())
      );
    end if;
  end loop;

  return jsonb_build_object('idempotent', false, 'counts', v_counts);
end
$$;

notify pgrst, 'reload schema';
