-- TrainLog Cloud v1 security hardening.
-- This migration is additive: it preserves the existing schema and A/B/C seed data.

-- Public program data is read-only through the Data API.
revoke all on table public.exercise_library from anon, authenticated;
revoke all on table public.workout_templates from anon, authenticated;
revoke all on table public.workout_template_items from anon, authenticated;

grant select on table public.exercise_library to anon, authenticated;
grant select on table public.workout_templates to anon, authenticated;
grant select on table public.workout_template_items to anon, authenticated;

-- User-owned data is never exposed to anon. The client needs SELECT, INSERT and
-- UPDATE for idempotent draft upserts; DELETE/TRUNCATE/TRIGGER/REFERENCES are not
-- part of the v1 frontend surface.
revoke all on table public.workout_sessions from anon, authenticated;
revoke all on table public.workout_session_exercises from anon, authenticated;
revoke all on table public.workout_sets from anon, authenticated;
revoke all on table public.body_measurements from anon, authenticated;

grant select, insert, update on table public.workout_sessions to authenticated;
grant select, insert, update on table public.workout_session_exercises to authenticated;
grant select, insert, update on table public.workout_sets to authenticated;
grant select, insert, update on table public.body_measurements to authenticated;

-- A child row cannot point at a session, exercise snapshot or user from another
-- ownership chain. The existing simple FKs remain in place for compatibility.
alter table public.workout_sessions
  add constraint workout_sessions_id_user_id_key unique (id, user_id);

alter table public.workout_session_exercises
  add constraint workout_session_exercises_id_session_user_key
    unique (id, session_id, user_id),
  add constraint workout_session_exercises_session_user_fkey
    foreign key (session_id, user_id)
    references public.workout_sessions (id, user_id)
    on delete cascade;

alter table public.workout_sets
  add constraint workout_sets_exercise_session_user_fkey
    foreign key (session_exercise_id, session_id, user_id)
    references public.workout_session_exercises (id, session_id, user_id)
    on delete cascade;

-- Cover FK checks and the application's template/history access patterns.
create index workout_template_items_exercise_key_idx
  on public.workout_template_items (exercise_key);

create index workout_sessions_template_code_idx
  on public.workout_sessions (template_code);

create index workout_session_exercises_exercise_key_idx
  on public.workout_session_exercises (exercise_key);

create index workout_session_exercises_session_user_idx
  on public.workout_session_exercises (session_id, user_id);

create index workout_sets_exercise_session_user_idx
  on public.workout_sets (session_exercise_id, session_id, user_id);
