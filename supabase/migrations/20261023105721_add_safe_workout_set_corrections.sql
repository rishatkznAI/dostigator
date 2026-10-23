-- Narrow correction API: finished sessions stay closed; only recorded set values can change.
-- Preserve the original set in the private idempotency receipt. No existing rows are migrated.
create function private.training_correct_set(
  p_expected_owner uuid, p_mutation_id uuid, p_session_id uuid, p_set_id uuid,
  p_expected_revision bigint, p_expected_updated_at timestamptz, p_values jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid := auth.uid(); v_request jsonb; v_prior private.training_requests%rowtype;
  v_session public.workout_sessions%rowtype; v_before public.workout_sets%rowtype;
  v_after public.workout_sets%rowtype; v_result jsonb; v_weight numeric; v_reps integer; v_rir integer;
begin
  if v_owner is null or p_expected_owner is distinct from v_owner then
    raise exception 'Account changed' using errcode='42501'; end if;
  if p_mutation_id is null or p_session_id is null or p_set_id is null
    or p_expected_revision is null or p_expected_revision<0 or p_expected_updated_at is null
    or jsonb_typeof(p_values) is distinct from 'object'
    or not (p_values ?& array['weight_kg','reps','rir'])
    or p_values-array['weight_kg','reps','rir'] <> '{}'::jsonb then
    raise exception 'Invalid correction' using errcode='22023'; end if;
  if jsonb_typeof(p_values->'weight_kg') is distinct from 'number'
    or jsonb_typeof(p_values->'reps') is distinct from 'number'
    or jsonb_typeof(p_values->'rir') not in ('number','null') then
    raise exception 'Invalid set values' using errcode='22023'; end if;
  v_weight := (p_values->>'weight_kg')::numeric;
  if (p_values->>'reps')::numeric <> trunc((p_values->>'reps')::numeric)
    or (p_values->>'rir')::numeric <> trunc((p_values->>'rir')::numeric) then
    raise exception 'Whole repetitions required' using errcode='22023'; end if;
  v_reps := (p_values->>'reps')::integer; v_rir := (p_values->>'rir')::integer;
  if v_weight<0 or v_weight>1000 or v_reps<1 or v_reps>1000 or v_rir<0 or v_rir>5 then
    raise exception 'Set values out of range' using errcode='22023'; end if;
  v_request := jsonb_build_object('kind','correct_set','session',p_session_id,'set',p_set_id,
    'revision',p_expected_revision,'updated_at',p_expected_updated_at,'values',p_values);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text||p_mutation_id::text,19));
  select * into v_prior from private.training_requests where user_id=v_owner and mutation_id=p_mutation_id;
  if found then
    if v_prior.payload<>v_request then raise exception 'Mutation reused' using errcode='PT409'; end if;
    return v_prior.response;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_session_id::text,23));
  select * into v_session from public.workout_sessions where id=p_session_id for update;
  if not found or v_session.user_id<>v_owner then raise exception 'Access denied' using errcode='42501'; end if;
  if v_session.finished_at is null then raise exception 'Only finished workouts can be corrected' using errcode='22023'; end if;
  if v_session.revision<>p_expected_revision or v_session.updated_at<>p_expected_updated_at then
    raise exception 'History changed; reload before correction' using errcode='PT409'; end if;
  select * into v_before from public.workout_sets where id=p_set_id and session_id=p_session_id and user_id=v_owner for update;
  if not found or not v_before.done then raise exception 'Recorded set not found' using errcode='22023'; end if;
  update public.workout_sets set weight_kg=v_weight,reps=v_reps,rir=v_rir where id=p_set_id returning * into v_after;
  update public.workout_sessions set revision=revision+1,updated_at=clock_timestamp() where id=p_session_id returning * into v_session;
  v_result := jsonb_build_object('id',p_session_id,'revision',v_session.revision,'updated_at',v_session.updated_at,
    'set',to_jsonb(v_after),'previous_set',to_jsonb(v_before));
  insert into private.training_requests values(v_owner,p_mutation_id,v_request,v_result);
  return v_result;
end $$;
revoke all on function private.training_correct_set(uuid,uuid,uuid,uuid,bigint,timestamptz,jsonb) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.training_correct_set(uuid,uuid,uuid,uuid,bigint,timestamptz,jsonb) to authenticated;

create function public.training_correct_set(
  p_expected_owner uuid, p_mutation_id uuid, p_session_id uuid, p_set_id uuid,
  p_expected_revision bigint, p_expected_updated_at timestamptz, p_values jsonb
) returns jsonb language sql security invoker set search_path='' as $$
  select private.training_correct_set(p_expected_owner,p_mutation_id,p_session_id,p_set_id,
    p_expected_revision,p_expected_updated_at,p_values);
$$;
revoke all on function public.training_correct_set(uuid,uuid,uuid,uuid,bigint,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.training_correct_set(uuid,uuid,uuid,uuid,bigint,timestamptz,jsonb) to authenticated;
