begin;

do $$
declare
  user_a uuid := gen_random_uuid();
  user_b uuid := gen_random_uuid();
  area_a uuid := gen_random_uuid();
  area_b uuid := gen_random_uuid();
  goal_a uuid := gen_random_uuid();
  goal_b uuid := gen_random_uuid();
  action_a uuid := gen_random_uuid();
  affected integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values
    (user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dostigator-a@example.test', '', now(), now(), now()),
    (user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dostigator-b@example.test', '', now(), now(), now());

  insert into public.dostigator_areas (id, user_id, name) values
    (area_a, user_a, 'Area A'), (area_b, user_b, 'Area B');
  insert into public.dostigator_goals (id, user_id, area_id, title) values
    (goal_a, user_a, area_a, 'Goal A'), (goal_b, user_b, area_b, 'Goal B');
  insert into public.dostigator_actions (id, user_id, goal_id, title) values
    (action_a, user_a, goal_a, 'Action A');

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);

  if (select count(*) from public.dostigator_goals) <> 1 then
    raise exception 'RLS FAIL: User A can read another user goals';
  end if;

  update public.dostigator_goals set title = 'stolen' where id = goal_b;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'RLS FAIL: User A updated User B goal';
  end if;

  delete from public.dostigator_areas where id = area_b;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'RLS FAIL: User A deleted User B area';
  end if;

  begin
    insert into public.dostigator_actions (id, goal_id, title) values (gen_random_uuid(), goal_b, 'cross tenant');
    raise exception 'RLS FAIL: cross-tenant child insert succeeded';
  exception when foreign_key_violation then
    null;
  end;

  raise notice 'RLS PASS';
end $$;

rollback;
