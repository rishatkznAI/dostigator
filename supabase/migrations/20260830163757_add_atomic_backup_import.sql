-- Restore a complete backup in one database transaction. Any invalid row,
-- ownership conflict or revision failure aborts areas, product rows and all
-- generated history events together.
drop function if exists public.dostigator_import_backup(uuid, uuid, jsonb);

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
  foreach v_section in array array['goals', 'actions', 'habits', 'checkins', 'reviews'] loop
    if exists (
      select 1
      from jsonb_array_elements(p_payload->v_section) row_data
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
      ('reviews', 'review', 'Обзор восстановлен из резервной копии')
    ) as groups(section_name, entity_type, event_label)
  loop
    for v_row in select value from jsonb_array_elements(p_payload->v_section) loop
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

revoke all on function public.dostigator_import_backup(uuid, uuid, jsonb) from public, anon;
grant execute on function public.dostigator_import_backup(uuid, uuid, jsonb) to authenticated;
