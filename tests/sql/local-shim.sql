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
