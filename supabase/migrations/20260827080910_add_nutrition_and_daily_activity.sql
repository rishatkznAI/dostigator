-- Personal nutrition and step tracking for weekly reports.
begin;

set local lock_timeout = '5s';

create table public.nutrition_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  eaten_at timestamptz not null default now(),
  meal_type text not null default 'other'
    check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack', 'other')),
  description text not null
    check (char_length(btrim(description)) between 1 and 1000),
  calories integer
    check (calories is null or calories between 0 and 5000),
  protein_g numeric(6,1)
    check (protein_g is null or protein_g between 0 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index nutrition_entries_user_eaten_at_idx
  on public.nutrition_entries (user_id, eaten_at desc);

alter table public.nutrition_entries enable row level security;

create policy "nutrition entries select own"
  on public.nutrition_entries for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "nutrition entries insert own"
  on public.nutrition_entries for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "nutrition entries update own"
  on public.nutrition_entries for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "nutrition entries delete own"
  on public.nutrition_entries for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.nutrition_entries from anon;
grant select, insert, update, delete on table public.nutrition_entries to authenticated;

create table public.daily_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  activity_date date not null default current_date,
  steps integer not null default 0
    check (steps between 0 and 100000),
  note text not null default ''
    check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, activity_date)
);

alter table public.daily_activity enable row level security;

create policy "daily activity select own"
  on public.daily_activity for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "daily activity insert own"
  on public.daily_activity for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "daily activity update own"
  on public.daily_activity for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "daily activity delete own"
  on public.daily_activity for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.daily_activity from anon;
grant select, insert, update, delete on table public.daily_activity to authenticated;

commit;
