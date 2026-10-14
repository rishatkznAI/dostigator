create table public.cardio_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  activity_date date not null default current_date,
  kind text not null check (kind in ('walk', 'bike', 'elliptical', 'outdoor', 'other')),
  duration_minutes integer not null check (duration_minutes between 1 and 1440),
  distance_km numeric(7,2) check (distance_km > 0 and distance_km <= 1000),
  effort integer check (effort between 1 and 10),
  average_pulse integer check (average_pulse between 30 and 250),
  note text not null default '' check (length(note) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cardio_sessions_user_date_idx on public.cardio_sessions(user_id, activity_date desc);
alter table public.cardio_sessions enable row level security;
revoke all on public.cardio_sessions from anon;
grant select, insert, update, delete on public.cardio_sessions to authenticated;
create policy cardio_sessions_select on public.cardio_sessions for select to authenticated using ((select auth.uid()) = user_id);
create policy cardio_sessions_insert on public.cardio_sessions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy cardio_sessions_update on public.cardio_sessions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy cardio_sessions_delete on public.cardio_sessions for delete to authenticated using ((select auth.uid()) = user_id);
