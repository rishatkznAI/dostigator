-- Additive contract. Prototype tested only in disposable local PostgreSQL.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.cardio_facts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_date date not null check (activity_date <= current_date),
  kind text not null check (kind in ('walk','bike','elliptical','outdoor','other')),
  duration_minutes integer not null check (duration_minutes between 0 and 1440),
  duration_seconds integer check (duration_seconds between 1 and 86459),
  workout_session_id uuid,
  distance_km numeric(7,2) check (distance_km > 0 and distance_km <= 1000),
  effort integer check (effort between 1 and 10),
  average_pulse integer check (average_pulse between 30 and 250),
  speed_kmh numeric check (speed_kmh > 0 and speed_kmh <= 50),
  incline_percent numeric check (incline_percent between -20 and 40),
  resistance_level numeric check (resistance_level between 0 and 100),
  note text not null default '' check (length(note) <= 4000),
  revision bigint not null check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint cardio_facts_precision check (
    (duration_seconds is null and duration_minutes >= 1)
    or (duration_seconds is not null and duration_minutes = duration_seconds / 60)),
  foreign key (workout_session_id,user_id) references public.workout_sessions(id,user_id) on delete no action deferrable initially deferred
);
create index cardio_facts_history_idx on public.cardio_facts(user_id,activity_date desc,id);
create index cardio_facts_workout_idx on public.cardio_facts(user_id,workout_session_id);
alter table public.cardio_facts enable row level security;
revoke all on public.cardio_facts from public,anon,authenticated;
grant select on public.cardio_facts to authenticated;
create policy cardio_facts_owner_read on public.cardio_facts for select to authenticated using ((select auth.uid())=user_id);

create table private.training_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  payload jsonb not null,
  response jsonb not null,
  primary key(user_id,mutation_id)
);
alter table private.training_requests enable row level security;
revoke all on private.training_requests from public,anon,authenticated;

-- The table owner may maintain the projection inside the authenticated RPC.
-- API callers cannot fake this by setting a flag or a client protocol field.
create function private.guard_cardio_projection() returns trigger
language plpgsql set search_path='' as $$
begin
  if current_user = pg_catalog.pg_get_userbyid((select relowner from pg_catalog.pg_class where oid=TG_RELID)) then
    if TG_OP='DELETE' then return OLD; else return NEW; end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(coalesce(NEW.id,OLD.id)::text,17));
  if exists(select 1 from public.cardio_facts where id=coalesce(NEW.id,OLD.id)) then
    raise exception 'Обновите приложение: точный результат изменяется через новый API' using errcode='40001';
  end if;
  if TG_OP='DELETE' then return OLD; else return NEW; end if;
end $$;
create trigger cardio_projection_guard before insert or update or delete on public.cardio_sessions
for each row execute function private.guard_cardio_projection();

create function public.cardio_list_facts(p_include_deleted boolean default false) returns setof jsonb
language sql stable security invoker set search_path='' as $$
  select to_jsonb(f) from public.cardio_facts f
  where f.user_id=(select auth.uid()) and (p_include_deleted or f.deleted_at is null)
  union all
  select to_jsonb(l)||jsonb_build_object('revision',0,'duration_seconds',null,'workout_session_id',null,
    'speed_kmh',null,'incline_percent',null,'resistance_level',null,'deleted_at',null)
  from public.cardio_sessions l where l.user_id=(select auth.uid())
    and not exists(select 1 from public.cardio_facts f where f.id=l.id);
$$;

create function public.cardio_apply_fact(p_id uuid,p_mutation_id uuid,p_expected_revision bigint,p_record jsonb,p_delete boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid := auth.uid(); v_request jsonb; v_prior private.training_requests%rowtype;
  v_old public.cardio_facts%rowtype; v_new public.cardio_facts%rowtype;
  v_legacy public.cardio_sessions%rowtype; v_revision bigint; v_result jsonb;
begin
  if v_owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_id is null or p_mutation_id is null or p_expected_revision is null or p_expected_revision<0 or p_delete is null then
    raise exception 'Invalid mutation'; end if;
  v_request := jsonb_build_object('kind','cardio','id',p_id,'expected',p_expected_revision,'record',p_record,'delete',p_delete);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text||p_mutation_id::text,19));
  select * into v_prior from private.training_requests where user_id=v_owner and mutation_id=p_mutation_id;
  if found then
    if v_prior.payload<>v_request then raise exception 'Mutation ID reused with different payload' using errcode='40001'; end if;
    return v_prior.response;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,17));
  select * into v_legacy from public.cardio_sessions where id=p_id for update;
  select * into v_old from public.cardio_facts where id=p_id for update;
  if (v_old.id is not null and v_old.user_id<>v_owner) or (v_legacy.id is not null and v_legacy.user_id<>v_owner) then
    raise exception 'Access denied' using errcode='42501'; end if;
  v_revision:=coalesce(v_old.revision,0);
  if v_revision<>p_expected_revision or v_old.deleted_at is not null then
    raise exception 'Cardio conflict' using errcode='40001', detail=coalesce(to_jsonb(v_old),'null'::jsonb)::text; end if;
  if v_old.id is null and v_legacy.id is not null and
    (p_record->>'legacy_updated_at')::timestamptz is distinct from v_legacy.updated_at then
    raise exception 'Legacy cardio changed: reload before importing local precision' using errcode='40001'; end if;
  if p_delete then
    if v_old.id is not null then v_new:=v_old;
    elsif v_legacy.id is not null then v_new:=jsonb_populate_record(null::public.cardio_facts,to_jsonb(v_legacy));
    else v_new:=jsonb_populate_record(null::public.cardio_facts,p_record); end if;
    v_new.deleted_at:=clock_timestamp();
    v_new.workout_session_id:=null;
  else
    if jsonb_typeof(p_record) is distinct from 'object' then raise exception 'Invalid record'; end if;
    if exists(select 1 from jsonb_object_keys(p_record) k where k<>all(array[
      'activity_date','kind','duration_minutes','duration_seconds','workout_session_id','distance_km',
      'effort','average_pulse','speed_kmh','incline_percent','resistance_level','note','legacy_updated_at'])) then raise exception 'Unexpected field'; end if;
    v_new:=jsonb_populate_record(null::public.cardio_facts,p_record);
    -- Unknown precision is permitted only when preserving a real legacy minute fact.
    if v_new.duration_seconds is null and not (
      (v_old.id is not null and v_old.duration_seconds is null and v_new.duration_minutes=v_old.duration_minutes)
      or (v_old.id is null and v_legacy.id is not null and v_new.duration_minutes=v_legacy.duration_minutes)) then
      raise exception 'Exact duration required'; end if;
  end if;
  v_new.id:=p_id; v_new.user_id:=v_owner; v_new.revision:=v_revision+1;
  v_new.created_at:=coalesce(v_old.created_at,v_legacy.created_at,clock_timestamp());
  v_new.updated_at:=clock_timestamp(); v_new.note:=coalesce(v_new.note,'');
  insert into public.cardio_facts select (v_new).* on conflict(id) do update set
    activity_date=excluded.activity_date,kind=excluded.kind,duration_minutes=excluded.duration_minutes,
    duration_seconds=excluded.duration_seconds,workout_session_id=excluded.workout_session_id,
    distance_km=excluded.distance_km,effort=excluded.effort,average_pulse=excluded.average_pulse,
    speed_kmh=excluded.speed_kmh,incline_percent=excluded.incline_percent,resistance_level=excluded.resistance_level,
    note=excluded.note,revision=excluded.revision,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at;
  if v_new.deleted_at is not null or v_new.duration_minutes=0 then
    delete from public.cardio_sessions where id=p_id;
  else
    insert into public.cardio_sessions(id,user_id,activity_date,kind,duration_minutes,distance_km,effort,average_pulse,note,created_at,updated_at)
    values(p_id,v_owner,v_new.activity_date,v_new.kind,v_new.duration_minutes,v_new.distance_km,v_new.effort,v_new.average_pulse,v_new.note,v_new.created_at,v_new.updated_at)
    on conflict(id) do update set activity_date=excluded.activity_date,kind=excluded.kind,duration_minutes=excluded.duration_minutes,
      distance_km=excluded.distance_km,effort=excluded.effort,average_pulse=excluded.average_pulse,note=excluded.note,updated_at=excluded.updated_at;
  end if;
  v_result:=to_jsonb(v_new);
  insert into private.training_requests values(v_owner,p_mutation_id,v_request,v_result);
  return v_result;
end $$;

-- Restore only missing or identical facts. A divergent server fact aborts the
-- entire cardio restore; importing a file is never an implicit overwrite.
create function public.cardio_restore_facts(p_import_id uuid,p_records jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_item jsonb; v_payload jsonb; v_request jsonb; v_prior private.training_requests%rowtype;
  v_existing public.cardio_facts%rowtype; v_legacy public.cardio_sessions%rowtype; v_id uuid; v_count integer:=0; v_response jsonb;
begin
  if v_owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_import_id is null or jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records)>10000 then raise exception 'Invalid backup'; end if;
  v_request:=jsonb_build_object('kind','cardio_restore','records',p_records);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text||p_import_id::text,19));
  select * into v_prior from private.training_requests where user_id=v_owner and mutation_id=p_import_id;
  if found then
    if v_prior.payload<>v_request then raise exception 'Import ID reused' using errcode='40001'; end if;
    return v_prior.response;
  end if;
  for v_item in select value from jsonb_array_elements(p_records) order by value->>'id' loop
    if (v_item->>'user_id')::uuid is distinct from v_owner then raise exception 'Backup owner mismatch' using errcode='42501'; end if;
    if (v_item->>'created_at') is null or (v_item->>'created_at')::timestamptz>clock_timestamp() then raise exception 'Invalid backup creation time'; end if;
    v_id:=(v_item->>'id')::uuid;
    if v_id is null then raise exception 'Missing cardio ID'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_id::text,17));
    v_payload:=v_item-array['id','user_id','created_at','updated_at','revision','deleted_at','mutation_id','legacy_updated_at'];
    select * into v_existing from public.cardio_facts where id=v_id for update;
    if v_existing.id is not null then
      if v_existing.user_id<>v_owner then raise exception 'Access denied' using errcode='42501'; end if;
      if (to_jsonb(v_existing)-array['id','user_id','created_at','updated_at','revision','deleted_at'])<>v_payload
        or (v_existing.deleted_at is null)<>((v_item->>'deleted_at') is null) then raise exception 'Backup conflicts with server cardio' using errcode='40001'; end if;
      continue;
    end if;
    select * into v_legacy from public.cardio_sessions where id=v_id for update;
    if v_legacy.id is not null then
      if v_legacy.user_id<>v_owner then raise exception 'Access denied' using errcode='42501'; end if;
      if (to_jsonb(v_legacy)-array['id','user_id','created_at','updated_at'])<>(v_payload-array['duration_seconds','workout_session_id','speed_kmh','incline_percent','resistance_level']) then
        raise exception 'Backup conflicts with legacy cardio' using errcode='40001'; end if;
    elsif v_payload->>'duration_seconds' is null then
      insert into public.cardio_sessions(id,user_id,activity_date,kind,duration_minutes,distance_km,effort,average_pulse,note)
      values(v_id,v_owner,(v_payload->>'activity_date')::date,v_payload->>'kind',(v_payload->>'duration_minutes')::integer,
        (v_payload->>'distance_km')::numeric,(v_payload->>'effort')::integer,(v_payload->>'average_pulse')::integer,coalesce(v_payload->>'note',''))
      returning * into v_legacy;
    end if;
    v_payload:=v_payload||jsonb_build_object('legacy_updated_at',v_legacy.updated_at);
    v_response:=public.cardio_apply_fact(v_id,gen_random_uuid(),0,v_payload,false);
    update public.cardio_facts set created_at=(v_item->>'created_at')::timestamptz where id=v_id and user_id=v_owner;
    update public.cardio_sessions set created_at=(v_item->>'created_at')::timestamptz where id=v_id and user_id=v_owner;
    if v_item->>'deleted_at' is not null then perform public.cardio_apply_fact(v_id,gen_random_uuid(),1,null,true); end if;
    v_count:=v_count+1;
  end loop;
  v_response:=jsonb_build_object('restored',v_count);
  insert into private.training_requests values(v_owner,p_import_id,v_request,v_response);
  return v_response;
end $$;

alter table public.workout_sessions add column revision bigint not null default 0 check (revision>=0);
create table private.training_deleted_sessions(id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade);
alter table private.training_deleted_sessions enable row level security;
revoke all on private.training_deleted_sessions from public,anon,authenticated;
create function private.guard_workout_protocol() returns trigger
language plpgsql set search_path='' as $$
declare v_session uuid;
begin
  if current_user = pg_catalog.pg_get_userbyid((select relowner from pg_catalog.pg_class where oid=TG_RELID)) then
    if TG_OP='DELETE' then return OLD; else return NEW; end if;
  end if;
  if TG_TABLE_NAME='workout_sessions' then
    if (TG_OP<>'INSERT' and OLD.revision>0) or (TG_OP<>'DELETE' and NEW.revision<>0) then
      raise exception 'Обновите приложение: используйте атомарное сохранение тренировки' using errcode='40001'; end if;
    if TG_OP='UPDATE' and OLD.finished_at is not null and NEW is distinct from OLD then
      raise exception 'Completed workout cannot be overwritten' using errcode='40001'; end if;
  else
    v_session:=case when TG_OP='DELETE' then OLD.session_id else NEW.session_id end;
    if exists(select 1 from public.workout_sessions where id=v_session and revision>0)
      or (TG_OP='UPDATE' and exists(select 1 from public.workout_sessions where id=OLD.session_id and revision>0)) then
      raise exception 'Use atomic workout API' using errcode='40001'; end if;
  end if;
  if TG_OP='DELETE' then return OLD; else return NEW; end if;
end $$;
create trigger workout_protocol_guard before insert or update or delete on public.workout_sessions for each row execute function private.guard_workout_protocol();
create trigger workout_exercise_protocol_guard before insert or update or delete on public.workout_session_exercises for each row execute function private.guard_workout_protocol();
create trigger workout_set_protocol_guard before insert or update or delete on public.workout_sets for each row execute function private.guard_workout_protocol();

create function public.training_save_workout(p_mutation_id uuid,p_expected_revision bigint,p_session jsonb,p_exercises jsonb,p_sets jsonb,p_deleted_set_ids uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid:=auth.uid(); v_id uuid:=(p_session->>'id')::uuid; v_prior private.training_requests%rowtype;
  v_old public.workout_sessions%rowtype; v_row public.workout_sessions%rowtype; v_ex public.workout_session_exercises%rowtype;
  v_set public.workout_sets%rowtype; v_item jsonb; v_request jsonb; v_result jsonb;
begin
  if v_owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if v_id is null or p_mutation_id is null or p_expected_revision is null or p_expected_revision<0
    or jsonb_typeof(p_exercises) is distinct from 'array' or jsonb_typeof(p_sets) is distinct from 'array' then raise exception 'Invalid workout'; end if;
  v_request:=jsonb_build_object('kind','workout','session',p_session,'exercises',p_exercises,'sets',p_sets,'deleted',p_deleted_set_ids,'expected',p_expected_revision);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text||p_mutation_id::text,19));
  select * into v_prior from private.training_requests where user_id=v_owner and mutation_id=p_mutation_id;
  if found then
    if v_prior.payload<>v_request then raise exception 'Mutation ID reused with different payload' using errcode='40001'; end if;
    return v_prior.response;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_id::text,23));
  if exists(select 1 from private.training_deleted_sessions where id=v_id) then raise exception 'Workout cancelled' using errcode='40001'; end if;
  select * into v_old from public.workout_sessions where id=v_id for update;
  if v_old.id is not null and v_old.user_id<>v_owner then raise exception 'Access denied' using errcode='42501'; end if;
  if coalesce(v_old.revision,0)<>p_expected_revision or v_old.finished_at is not null
    or (v_old.id is not null and v_old.revision=0 and (p_session->>'legacy_updated_at')::timestamptz is distinct from v_old.updated_at) then
    raise exception 'Workout conflict: compare the saved result' using errcode='40001',detail=jsonb_build_object(
      'session',to_jsonb(v_old),'exercises',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from public.workout_session_exercises e where session_id=v_id and user_id=v_owner),
      'sets',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from public.workout_sets s where session_id=v_id and user_id=v_owner))::text;
  end if;
  v_row:=jsonb_populate_record(null::public.workout_sessions,p_session);
  v_row.user_id:=v_owner; v_row.revision:=coalesce(v_old.revision,0)+1;
  v_row.created_at:=coalesce(v_old.created_at,clock_timestamp()); v_row.updated_at:=clock_timestamp();
  v_row.note:=coalesce(v_row.note,''); v_row.readiness_note:=coalesce(v_row.readiness_note,'');
  insert into public.workout_sessions select (v_row).* on conflict(id) do update set
    template_code=excluded.template_code,title=excluded.title,started_at=excluded.started_at,finished_at=excluded.finished_at,
    timer_paused_at=excluded.timer_paused_at,timer_paused_duration_ms=excluded.timer_paused_duration_ms,
    readiness_sleep=excluded.readiness_sleep,readiness_energy=excluded.readiness_energy,readiness_stress=excluded.readiness_stress,
    readiness_discomfort=excluded.readiness_discomfort,readiness_mode=excluded.readiness_mode,readiness_note=excluded.readiness_note,
    note=excluded.note,revision=excluded.revision,updated_at=excluded.updated_at;
  for v_item in select * from jsonb_array_elements(p_exercises) loop
    v_ex:=jsonb_populate_record(null::public.workout_session_exercises,v_item);
    if v_ex.session_id is distinct from v_id or exists(select 1 from public.workout_session_exercises where id=v_ex.id and (user_id<>v_owner or session_id<>v_id)) then
      raise exception 'Invalid exercise owner/session' using errcode='42501'; end if;
    v_ex.user_id:=v_owner; v_ex.created_at:=coalesce((select created_at from public.workout_session_exercises where id=v_ex.id),clock_timestamp());
    v_ex.note:=coalesce(v_ex.note,'');
    insert into public.workout_session_exercises select (v_ex).* on conflict(id) do update set exercise_key=excluded.exercise_key,
      exercise_name=excluded.exercise_name,target=excluded.target,sort_order=excluded.sort_order,skipped=excluded.skipped,skip_reason=excluded.skip_reason,note=excluded.note;
  end loop;
  for v_item in select * from jsonb_array_elements(p_sets) loop
    v_set:=jsonb_populate_record(null::public.workout_sets,v_item);
    if v_set.session_id is distinct from v_id or exists(select 1 from public.workout_sets where id=v_set.id and (user_id<>v_owner or session_id<>v_id)) then
      raise exception 'Invalid set owner/session' using errcode='42501'; end if;
    v_set.user_id:=v_owner; v_set.created_at:=coalesce((select created_at from public.workout_sets where id=v_set.id),clock_timestamp());
    insert into public.workout_sets select (v_set).* on conflict(id) do update set session_exercise_id=excluded.session_exercise_id,
      set_number=excluded.set_number,weight_kg=excluded.weight_kg,reps=excluded.reps,rir=excluded.rir,done=excluded.done,is_warmup=excluded.is_warmup,completed_at=excluded.completed_at;
  end loop;
  if exists(select 1 from public.workout_sets where id=any(p_deleted_set_ids) and (session_id<>v_id or user_id<>v_owner)) then
    raise exception 'Invalid deleted set owner' using errcode='42501'; end if;
  delete from public.workout_sets where id=any(p_deleted_set_ids) and session_id=v_id and user_id=v_owner;
  if v_row.finished_at is not null and not exists(select 1 from public.workout_sets where session_id=v_id and done and not is_warmup) then
    raise exception 'Cannot complete a workout without a recorded work set'; end if;
  v_result:=jsonb_build_object('id',v_id,'revision',v_row.revision,'updated_at',v_row.updated_at,'finished_at',v_row.finished_at);
  insert into private.training_requests values(v_owner,p_mutation_id,v_request,v_result);
  return v_result;
end $$;

create function public.training_cancel_workout(p_id uuid,p_mutation_id uuid,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid(); v_row public.workout_sessions%rowtype; v_payload jsonb; v_prior private.training_requests%rowtype;
begin
  if v_owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_id is null or p_mutation_id is null or p_expected_revision is null then raise exception 'Invalid cancellation'; end if;
  v_payload:=jsonb_build_object('kind','cancel_workout','id',p_id,'expected',p_expected_revision);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text||p_mutation_id::text,19));
  select * into v_prior from private.training_requests where user_id=v_owner and mutation_id=p_mutation_id;
  if found then
    if v_prior.payload<>v_payload then raise exception 'Mutation ID reused' using errcode='40001'; end if;
    return v_prior.response;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,23));
  select * into v_row from public.workout_sessions where id=p_id for update;
  if v_row.id is not null and v_row.user_id<>v_owner then raise exception 'Access denied' using errcode='42501'; end if;
  if coalesce(v_row.revision,0)<>p_expected_revision or v_row.finished_at is not null then raise exception 'Workout conflict' using errcode='40001'; end if;
  insert into private.training_deleted_sessions values(p_id,v_owner) on conflict(id) do nothing;
  delete from public.workout_sessions where id=p_id and user_id=v_owner;
  insert into private.training_requests values(v_owner,p_mutation_id,v_payload,jsonb_build_object('id',p_id,'cancelled',true));
  return jsonb_build_object('id',p_id,'cancelled',true);
end $$;

revoke all on function private.guard_cardio_projection(),private.guard_workout_protocol() from public,anon,authenticated;
revoke all on function public.cardio_list_facts(boolean),public.cardio_apply_fact(uuid,uuid,bigint,jsonb,boolean),
  public.training_save_workout(uuid,bigint,jsonb,jsonb,jsonb,uuid[]),public.training_cancel_workout(uuid,uuid,bigint),public.cardio_restore_facts(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cardio_list_facts(boolean),public.cardio_apply_fact(uuid,uuid,bigint,jsonb,boolean),
  public.training_save_workout(uuid,bigint,jsonb,jsonb,jsonb,uuid[]),public.training_cancel_workout(uuid,uuid,bigint),public.cardio_restore_facts(uuid,jsonb) to authenticated;
