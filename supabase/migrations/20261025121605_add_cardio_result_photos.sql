-- Immutable metadata for JPEG results stored in the existing private bucket.
-- Storage bucket settings and its owner-folder policies remain unchanged.
begin;

create table public.cardio_result_photos (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  cardio_id uuid not null references public.cardio_facts(id) on delete cascade,
  object_path text not null unique,
  byte_size integer not null check (byte_size between 1 and 2097152),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint cardio_result_photos_owner_path check (
    object_path = user_id::text || '/cardio/' || cardio_id::text || '/' || id::text || '.jpg'
  )
);
create index cardio_result_photos_cardio_owner_idx on public.cardio_result_photos(cardio_id,user_id,created_at,id);

alter table public.cardio_result_photos enable row level security;
revoke all on public.cardio_result_photos from public,anon,authenticated;
grant select,insert on public.cardio_result_photos to authenticated;
grant update(deleted_at) on public.cardio_result_photos to authenticated;

create policy cardio_result_photos_owner_select on public.cardio_result_photos
  for select to authenticated using ((select auth.uid())=user_id);
create policy cardio_result_photos_owner_update on public.cardio_result_photos
  for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy cardio_result_photos_owner_insert on public.cardio_result_photos
  for insert to authenticated with check (
    (select auth.uid())=user_id and exists (
      select 1 from public.cardio_facts parent
      where parent.id=cardio_id and parent.user_id=(select auth.uid())
        and (cardio_result_photos.deleted_at is not null or parent.deleted_at is null)
    )
  );

-- Check the relational owner invariant without adding a redundant parent index
-- or changing cardio facts. This invoker trigger also protects privileged imports;
-- ordinary API callers must independently pass the table's ownership RLS policy.
create function private.check_cardio_result_photo_parent() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if (to_jsonb(new)-'deleted_at') is distinct from (to_jsonb(old)-'deleted_at') then
      raise exception 'Photo metadata is immutable' using errcode='42501';
    end if;
    if old.deleted_at is not null then
      if new.deleted_at is null then
        raise exception 'Deleted photo cannot be restored' using errcode='42501';
      end if;
      new.deleted_at:=old.deleted_at;
    end if;
    return new;
  end if;
  if not exists (
    select 1 from public.cardio_facts parent
    where parent.id=new.cardio_id and parent.user_id=new.user_id
      and (new.deleted_at is not null or parent.deleted_at is null)
  ) then
    raise exception 'Photo requires a cardio result owned by the same account; active photos require an active result' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private.check_cardio_result_photo_parent() from public,anon,authenticated;
create trigger cardio_result_photo_parent_guard before insert or update on public.cardio_result_photos
  for each row execute function private.check_cardio_result_photo_parent();

notify pgrst, 'reload schema';
commit;
