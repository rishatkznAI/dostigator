begin;

drop policy if exists exercise_library_public_read on public.exercise_library;
drop policy if exists "exercise library public read" on public.exercise_library;
create policy "exercise library public read"
  on public.exercise_library for select to anon, authenticated
  using (active = true);

drop policy if exists workout_templates_public_read on public.workout_templates;
drop policy if exists "workout templates public read" on public.workout_templates;
create policy "workout templates public read"
  on public.workout_templates for select to anon, authenticated
  using (active = true);

drop policy if exists workout_template_items_public_read on public.workout_template_items;
drop policy if exists "workout template items public read" on public.workout_template_items;
create policy "workout template items public read"
  on public.workout_template_items for select to anon, authenticated
  using (true);

commit;
