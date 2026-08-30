-- Apply the reference-data RLS hardening to existing TrainLog environments too.
begin;

alter table public.exercise_library enable row level security;
alter table public.workout_templates enable row level security;
alter table public.workout_template_items enable row level security;

drop policy if exists "exercise library public read" on public.exercise_library;
create policy "exercise library public read"
  on public.exercise_library for select to anon, authenticated using (active = true);

drop policy if exists "workout templates public read" on public.workout_templates;
create policy "workout templates public read"
  on public.workout_templates for select to anon, authenticated using (active = true);

drop policy if exists "workout template items public read" on public.workout_template_items;
create policy "workout template items public read"
  on public.workout_template_items for select to anon, authenticated using (true);

commit;
