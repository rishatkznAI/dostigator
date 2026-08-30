-- TrainLog personal coaching improvements.
-- Additive only: existing sessions, sets, measurements and nutrition entries remain valid.
begin;

set local lock_timeout = '5s';

alter table public.workout_sessions
  add column readiness_sleep smallint
    check (readiness_sleep is null or readiness_sleep between 1 and 5),
  add column readiness_energy smallint
    check (readiness_energy is null or readiness_energy between 1 and 5),
  add column readiness_stress smallint
    check (readiness_stress is null or readiness_stress between 1 and 5),
  add column readiness_discomfort boolean not null default false,
  add column readiness_mode text
    check (readiness_mode is null or readiness_mode in ('normal', 'reduced')),
  add column readiness_note text not null default ''
    check (char_length(readiness_note) <= 500);

alter table public.workout_session_exercises
  add column skipped boolean not null default false,
  add column skip_reason text not null default ''
    check (char_length(skip_reason) <= 500);

alter table public.workout_sets
  add column is_warmup boolean not null default false;

alter table public.body_measurements
  add column chest_cm numeric(5,1)
    check (chest_cm is null or chest_cm between 1 and 300),
  add column photo_front_path text,
  add column photo_side_path text,
  add column photo_back_path text;

alter table public.nutrition_entries
  add column alcohol_units numeric(5,1)
    check (alcohol_units is null or alcohol_units between 0 and 100);

-- Cancellation, set removal, editable measurements and backup restore need only
-- row-owned DELETE; the existing RLS policies already enforce auth.uid() ownership.
grant delete on table public.workout_sessions to authenticated;
grant delete on table public.workout_session_exercises to authenticated;
grant delete on table public.workout_sets to authenticated;
grant delete on table public.body_measurements to authenticated;

-- Private progress photos. Object names always begin with the authenticated user UUID.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trainlog-progress-photos',
  'trainlog-progress-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create policy "trainlog progress photos select own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'trainlog-progress-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "trainlog progress photos insert own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'trainlog-progress-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "trainlog progress photos update own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'trainlog-progress-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'trainlog-progress-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "trainlog progress photos delete own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'trainlog-progress-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

commit;
