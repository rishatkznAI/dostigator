-- Production has an immediate unique constraint absent from the original baseline.
-- Renumbering after deleting an early set or prepending a warmup can temporarily
-- reuse an occupied number. Reconcile the whole atomic request before checking
-- final uniqueness, so already-persisted exact retry payloads can succeed unchanged.
begin;

alter table public.workout_sets
  drop constraint if exists workout_sets_session_exercise_id_set_number_key;
alter table public.workout_sets
  add constraint workout_sets_session_exercise_id_set_number_key
  unique (session_exercise_id, set_number) deferrable initially immediate;

create or replace function public.training_save_workout(p_mutation_id uuid,p_expected_revision bigint,p_session jsonb,p_exercises jsonb,p_sets jsonb,p_deleted_set_ids uuid[] default '{}',p_expected_owner uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid:=auth.uid(); v_id uuid:=(p_session->>'id')::uuid; v_prior private.training_requests%rowtype;
  v_old public.workout_sessions%rowtype; v_row public.workout_sessions%rowtype; v_ex public.workout_session_exercises%rowtype;
  v_set public.workout_sets%rowtype; v_item jsonb; v_request jsonb; v_result jsonb;
begin
  if v_owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_expected_owner is null then raise exception 'Обновите приложение: требуется защищённое сохранение' using errcode='PT426'; end if;
  if p_expected_owner is not null and p_expected_owner<>v_owner then
    raise exception 'Workout owner changed' using errcode='42501'; end if;
  if p_session ? 'user_id' and (p_session->>'user_id')::uuid is distinct from v_owner then
    raise exception 'Workout owner changed' using errcode='42501'; end if;
  if v_id is null or p_mutation_id is null or p_expected_revision is null or p_expected_revision<0
    or jsonb_typeof(p_exercises) is distinct from 'array' or jsonb_typeof(p_sets) is distinct from 'array' then raise exception 'Invalid workout'; end if;
  v_request:=jsonb_build_object('kind','workout','session',p_session,'exercises',p_exercises,'sets',p_sets,'deleted',p_deleted_set_ids,'expected',p_expected_revision);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text||p_mutation_id::text,19));
  select * into v_prior from private.training_requests where user_id=v_owner and mutation_id=p_mutation_id;
  if found then
    if v_prior.payload<>v_request then raise exception 'Mutation ID reused with different payload' using errcode='PT409'; end if;
    return v_prior.response;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_id::text,23));
  if exists(select 1 from private.training_deleted_sessions where id=v_id) then raise exception 'Workout cancelled' using errcode='PT409'; end if;
  select * into v_old from public.workout_sessions where id=v_id for update;
  if v_old.id is not null and v_old.user_id<>v_owner then raise exception 'Access denied' using errcode='42501'; end if;
  if coalesce(v_old.revision,0)<>p_expected_revision or v_old.finished_at is not null
    or (v_old.id is not null and v_old.revision=0 and (p_session->>'legacy_updated_at')::timestamptz is distinct from v_old.updated_at) then
    raise exception 'Workout conflict: compare the saved result' using errcode='PT409',detail=jsonb_build_object(
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
  -- Preserve set UUIDs and facts while reconciling renumbered or removed sets.
  -- Only this uniqueness check is deferred; ownership, CAS and FK guards stay active.
  set constraints public.workout_sets_session_exercise_id_set_number_key deferred;
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
  -- Reject a genuinely duplicate final number before recording a successful receipt.
  set constraints public.workout_sets_session_exercise_id_set_number_key immediate;
  if v_row.finished_at is not null and not exists(select 1 from public.workout_sets where session_id=v_id and done and not is_warmup) then
    raise exception 'Cannot complete a workout without a recorded work set'; end if;
  v_result:=jsonb_build_object('id',v_id,'revision',v_row.revision,'updated_at',v_row.updated_at,'finished_at',v_row.finished_at);
  insert into private.training_requests values(v_owner,p_mutation_id,v_request,v_result);
  return v_result;
end $$;

revoke all on function public.training_save_workout(uuid,bigint,jsonb,jsonb,jsonb,uuid[],uuid) from public,anon,authenticated;
grant execute on function public.training_save_workout(uuid,bigint,jsonb,jsonb,jsonb,uuid[],uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
