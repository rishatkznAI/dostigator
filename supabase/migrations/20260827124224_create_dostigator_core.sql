-- Dostigator is a separate product that shares the hosted Supabase project with
-- TrainLog. Prefixes keep its API surface and migrations unambiguous.

create table public.dostigator_areas (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color text not null default '#ffc857' check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon text not null default 'target' check (char_length(icon) between 1 and 30),
  position smallint not null default 0 check (position >= 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, name)
);

create table public.dostigator_goals (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  area_id uuid,
  title text not null check (char_length(title) between 1 and 140),
  description text not null default '' check (char_length(description) <= 2000),
  why text not null default '' check (char_length(why) <= 1000),
  kind text not null default 'goal' check (kind in ('goal', 'project')),
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'archived')),
  progress smallint not null default 0 check (progress between 0 and 100),
  target_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint dostigator_goals_area_owner_fk
    foreign key (area_id, user_id)
    references public.dostigator_areas(id, user_id)
    on delete restrict
);

create table public.dostigator_actions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null,
  title text not null check (char_length(title) between 1 and 240),
  status text not null default 'todo' check (status in ('todo', 'done', 'cancelled')),
  due_date date,
  focus_date date,
  focus_position smallint check (focus_position between 1 and 3),
  result_note text not null default '' check (char_length(result_note) <= 1500),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint dostigator_actions_goal_owner_fk
    foreign key (goal_id, user_id)
    references public.dostigator_goals(id, user_id)
    on delete cascade,
  constraint dostigator_focus_pair_check check (
    (focus_date is null and focus_position is null)
    or (focus_date is not null and focus_position is not null)
  )
);

create table public.dostigator_habits (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  area_id uuid,
  title text not null check (char_length(title) between 1 and 140),
  target_per_week smallint not null default 7 check (target_per_week between 1 and 7),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint dostigator_habits_area_owner_fk
    foreign key (area_id, user_id)
    references public.dostigator_areas(id, user_id)
    on delete restrict
);

create table public.dostigator_habit_checkins (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  habit_id uuid not null,
  checked_on date not null,
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (habit_id, checked_on),
  constraint dostigator_checkins_habit_owner_fk
    foreign key (habit_id, user_id)
    references public.dostigator_habits(id, user_id)
    on delete cascade
);

create table public.dostigator_weekly_reviews (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_start date not null,
  wins text not null default '' check (char_length(wins) <= 3000),
  blockers text not null default '' check (char_length(blockers) <= 3000),
  next_focus text not null default '' check (char_length(next_focus) <= 2000),
  self_score smallint check (self_score between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start)
);

create index dostigator_areas_user_position_idx
  on public.dostigator_areas (user_id, position)
  where archived_at is null;
create index dostigator_goals_user_status_idx
  on public.dostigator_goals (user_id, status, updated_at desc);
create index dostigator_goals_area_idx
  on public.dostigator_goals (area_id);
create index dostigator_actions_goal_status_idx
  on public.dostigator_actions (goal_id, status, created_at);
create index dostigator_actions_user_focus_idx
  on public.dostigator_actions (user_id, focus_date, focus_position)
  where focus_date is not null;
create unique index dostigator_actions_focus_slot_idx
  on public.dostigator_actions (user_id, focus_date, focus_position)
  where focus_date is not null and status = 'todo';
create index dostigator_habits_user_active_idx
  on public.dostigator_habits (user_id, active, created_at);
create index dostigator_habits_area_idx
  on public.dostigator_habits (area_id);
create index dostigator_checkins_user_date_idx
  on public.dostigator_habit_checkins (user_id, checked_on desc);
create index dostigator_reviews_user_week_idx
  on public.dostigator_weekly_reviews (user_id, week_start desc);

alter table public.dostigator_areas enable row level security;
alter table public.dostigator_goals enable row level security;
alter table public.dostigator_actions enable row level security;
alter table public.dostigator_habits enable row level security;
alter table public.dostigator_habit_checkins enable row level security;
alter table public.dostigator_weekly_reviews enable row level security;

create policy "dostigator areas select own" on public.dostigator_areas
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "dostigator areas insert own" on public.dostigator_areas
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "dostigator areas update own" on public.dostigator_areas
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "dostigator areas delete own" on public.dostigator_areas
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "dostigator goals select own" on public.dostigator_goals
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "dostigator goals insert own" on public.dostigator_goals
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "dostigator goals update own" on public.dostigator_goals
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "dostigator goals delete own" on public.dostigator_goals
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "dostigator actions select own" on public.dostigator_actions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "dostigator actions insert own" on public.dostigator_actions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "dostigator actions update own" on public.dostigator_actions
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "dostigator actions delete own" on public.dostigator_actions
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "dostigator habits select own" on public.dostigator_habits
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "dostigator habits insert own" on public.dostigator_habits
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "dostigator habits update own" on public.dostigator_habits
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "dostigator habits delete own" on public.dostigator_habits
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "dostigator checkins select own" on public.dostigator_habit_checkins
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "dostigator checkins insert own" on public.dostigator_habit_checkins
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "dostigator checkins update own" on public.dostigator_habit_checkins
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "dostigator checkins delete own" on public.dostigator_habit_checkins
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "dostigator reviews select own" on public.dostigator_weekly_reviews
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "dostigator reviews insert own" on public.dostigator_weekly_reviews
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "dostigator reviews update own" on public.dostigator_weekly_reviews
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "dostigator reviews delete own" on public.dostigator_weekly_reviews
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on table
  public.dostigator_areas,
  public.dostigator_goals,
  public.dostigator_actions,
  public.dostigator_habits,
  public.dostigator_habit_checkins,
  public.dostigator_weekly_reviews
from anon;

revoke all on table
  public.dostigator_areas,
  public.dostigator_goals,
  public.dostigator_actions,
  public.dostigator_habits,
  public.dostigator_habit_checkins,
  public.dostigator_weekly_reviews
from authenticated;

grant select, insert, update, delete on table
  public.dostigator_areas,
  public.dostigator_goals,
  public.dostigator_actions,
  public.dostigator_habits,
  public.dostigator_habit_checkins,
  public.dostigator_weekly_reviews
to authenticated;
