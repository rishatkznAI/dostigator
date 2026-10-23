export async function bootstrap(admin, ownerA, ownerB) {
  await admin.query(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create schema storage;
    create table auth.users (id uuid primary key);
    create table storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text not null references storage.buckets(id) on delete cascade,
      name text not null
    );
    create or replace function storage.foldername(name text) returns text[]
      language sql immutable
      as $$ select string_to_array(name, '/') $$;
    alter table storage.objects enable row level security;
    create or replace function auth.uid() returns uuid
      language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users (id) values ('${ownerA}'), ('${ownerB}');
  `)
}
