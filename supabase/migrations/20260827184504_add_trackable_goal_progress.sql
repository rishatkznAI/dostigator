alter table public.dostigator_goals
  drop constraint dostigator_goals_kind_check;

alter table public.dostigator_goals
  add constraint dostigator_goals_kind_check
  check (kind in ('goal', 'project', 'book'));

alter table public.dostigator_goals
  add column book_format text,
  add column metric_label text,
  add column target_value numeric(12, 2),
  add column initial_value numeric(12, 2) not null default 0;

alter table public.dostigator_goals
  add constraint dostigator_goals_book_format_check
    check (book_format is null or book_format in ('paper', 'ebook', 'audio')),
  add constraint dostigator_goals_metric_label_check
    check (metric_label is null or char_length(metric_label) between 1 and 30),
  add constraint dostigator_goals_target_value_check
    check (target_value is null or target_value > 0),
  add constraint dostigator_goals_initial_value_check
    check (initial_value >= 0 and (target_value is null or initial_value <= target_value)),
  add constraint dostigator_goals_book_fields_check
    check (
      (kind = 'book' and book_format is not null and metric_label is not null and target_value is not null)
      or
      (kind <> 'book' and book_format is null and metric_label is null and target_value is null and initial_value = 0)
    );

create table public.dostigator_progress_entries (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null,
  recorded_on date not null default current_date,
  amount numeric(12, 2) not null check (amount > 0),
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  constraint dostigator_progress_goal_owner_fk
    foreign key (goal_id, user_id)
    references public.dostigator_goals(id, user_id)
    on delete cascade
);

create index dostigator_progress_goal_date_idx
  on public.dostigator_progress_entries (goal_id, recorded_on desc, created_at desc);

create index dostigator_progress_goal_owner_idx
  on public.dostigator_progress_entries (goal_id, user_id);

create index dostigator_progress_user_date_idx
  on public.dostigator_progress_entries (user_id, recorded_on desc);

alter table public.dostigator_progress_entries enable row level security;

create policy "dostigator progress select own" on public.dostigator_progress_entries
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "dostigator progress insert own" on public.dostigator_progress_entries
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "dostigator progress update own" on public.dostigator_progress_entries
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "dostigator progress delete own" on public.dostigator_progress_entries
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.dostigator_progress_entries from anon, authenticated;
grant select, insert, update, delete on table public.dostigator_progress_entries to authenticated;
