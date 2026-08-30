-- Keep the action focus_* columns as the current pointer, but preserve every
-- day's Focus 3 promise in an owner-bound ledger. Existing mutation/Undo RPCs
-- remain the only write path; this trigger runs in their transaction.
create table public.dostigator_focus_commitments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action_id uuid not null references public.dostigator_actions(id) on delete cascade,
  committed_on date not null,
  position smallint not null check (position between 1 and 3),
  source_mutation_id uuid,
  created_at timestamptz not null default now(),
  unique (user_id, action_id, committed_on),
  unique (user_id, committed_on, position)
);

create index dostigator_focus_commitments_action_idx
  on public.dostigator_focus_commitments (action_id, committed_on);

alter table public.dostigator_focus_commitments enable row level security;

create policy "focus commitments are owner readable"
  on public.dostigator_focus_commitments for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.dostigator_focus_commitments from public, anon, authenticated;
grant select on table public.dostigator_focus_commitments to authenticated;

create or replace function public.dostigator_sync_focus_commitment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_destination_exists boolean := false;
  v_focus_delete_date date;
  v_focus_delete_text text;
begin
  if new.focus_date is not null and new.focus_position is not null and tg_op = 'UPDATE' then
    select exists (
      select 1 from public.dostigator_focus_commitments
      where user_id = new.user_id and action_id = new.id and committed_on = new.focus_date
    ) into v_destination_exists;
  end if;

  if tg_op = 'UPDATE'
    and old.focus_date is not null
    and old.focus_date is distinct from new.focus_date then
    if new.status = 'cancelled' then
      -- The client records its local deletion date in the immutable mutation
      -- envelope. Never substitute the database timezone/current_date.
      select case when request_envelope->>'operation' = 'action_delete'
        then request_envelope #>> '{after,focus_delete_date}' else null end
      into v_focus_delete_text
      from public.dostigator_mutation_requests
      where user_id = new.user_id and mutation_id = new.last_mutation_id;

      if v_focus_delete_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        begin
          v_focus_delete_date := v_focus_delete_text::date;
          if v_focus_delete_date::text <> v_focus_delete_text then v_focus_delete_date := null; end if;
        exception when others then
          v_focus_delete_date := null;
        end;
      end if;

      if v_focus_delete_date = old.focus_date then
        delete from public.dostigator_focus_commitments
        where user_id = old.user_id and action_id = old.id and committed_on = old.focus_date;
      else
        -- Past promises remain durable. Also materialize an old pointer when an
        -- offline cache predates this ledger migration.
        insert into public.dostigator_focus_commitments (
          user_id, action_id, committed_on, position, source_mutation_id, created_at
        ) values (
          old.user_id, old.id, old.focus_date, old.focus_position, old.last_mutation_id, old.updated_at
        ) on conflict (user_id, action_id, committed_on) do nothing;
      end if;
    elsif new.focus_date is null or v_destination_exists then
      -- null on a todo action is explicit focus_remove. An already-recorded
      -- destination means Undo is moving the pointer back.
      delete from public.dostigator_focus_commitments
      where user_id = old.user_id and action_id = old.id and committed_on = old.focus_date;
    else
      -- A move to a not-yet-recorded date is a new daily promise. Preserve the
      -- old pointer too, including when it came from a pre-migration cache.
      insert into public.dostigator_focus_commitments (
        user_id, action_id, committed_on, position, source_mutation_id, created_at
      ) values (
        old.user_id, old.id, old.focus_date, old.focus_position, old.last_mutation_id, old.updated_at
      ) on conflict (user_id, action_id, committed_on) do nothing;
    end if;
  end if;

  if new.focus_date is not null and new.focus_position is not null then
    insert into public.dostigator_focus_commitments (
      user_id, action_id, committed_on, position, source_mutation_id, created_at
    ) values (
      new.user_id, new.id, new.focus_date, new.focus_position, new.last_mutation_id, new.updated_at
    )
    on conflict (user_id, action_id, committed_on) do update
      set position = excluded.position;
  end if;

  return new;
end;
$$;

revoke execute on function public.dostigator_sync_focus_commitment() from public, anon, authenticated;

create trigger dostigator_actions_sync_focus_commitment
after insert or update of focus_date, focus_position on public.dostigator_actions
for each row execute function public.dostigator_sync_focus_commitment();

-- Preserve the current pointer for rows that predate this migration. Future
-- day changes will append instead of overwriting this row.
insert into public.dostigator_focus_commitments (
  user_id, action_id, committed_on, position, source_mutation_id, created_at
)
select user_id, id, focus_date, focus_position, last_mutation_id, updated_at
from public.dostigator_actions
where focus_date is not null and focus_position is not null and status <> 'cancelled'
on conflict (user_id, action_id, committed_on) do nothing;

comment on table public.dostigator_focus_commitments is
  'Durable daily Focus 3 commitments; action.focus_* is only the current pointer.';
