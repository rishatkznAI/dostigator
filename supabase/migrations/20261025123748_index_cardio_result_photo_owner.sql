-- Cover the owner FK and account-scoped photo reads without changing rows.
create index if not exists cardio_result_photos_owner_idx on public.cardio_result_photos(user_id);
