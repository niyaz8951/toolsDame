-- tests/sql/local-shim.sql - stands in for the parts of Supabase the core SQL
-- relies on, so the SQL tests can run on a plain local PostgreSQL.
-- Serves: tests only. NEVER paste this into Supabase: it already has these.
-- Must not change: auth.uid() and auth.jwt() read the same request setting
-- that Supabase's own functions read.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb;
$$;
create function auth.uid() returns uuid language sql stable as $$
  select (auth.jwt() ->> 'sub')::uuid;
$$;
grant usage on schema auth to anon, authenticated;
-- Supabase gives these roles rights on everything new in public; copy that,
-- so the test proves 001 takes them away.
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;

-- Supabase Storage, as far as the core SQL touches it: a list of buckets and a
-- list of stored files under row security. The site's roles may try anything;
-- the policies decide.
create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now(),
  unique (bucket_id, name));
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant all on storage.objects to anon, authenticated;
grant select on storage.buckets to anon, authenticated;

-- Supabase Auth's own tables, as far as db/core/009 and 010 write to them, and the two
-- password functions of the pgcrypto extension (here a plain stand-in: the real
-- ones make a bcrypt hash; the tests only need "same password, same salt -> same hash").
create table auth.users (
  instance_id uuid, id uuid primary key, aud text, role text, email text unique, encrypted_password text,
  email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz,
  confirmation_token text, recovery_token text, email_change_token_new text, email_change text, email_change_token_current text,
  phone_change text, phone_change_token text, reauthentication_token text);
create table auth.identities (
  id uuid primary key, user_id uuid references auth.users (id) on delete cascade, identity_data jsonb, provider text, provider_id text,
  last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users (id) on delete cascade, created_at timestamptz default now());
create schema extensions;
create function extensions.gen_salt(text) returns text language sql volatile as $$
  select '$stub$' || substr(md5(random()::text), 1, 16) || '$';
$$;
create function extensions.crypt(p_password text, p_salt text) returns text language sql immutable as $$
  select substr(p_salt, 1, 23) || md5(p_password || substr(p_salt, 1, 23));
$$;
