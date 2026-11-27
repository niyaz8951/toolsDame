-- db/install/01_base.sql - the schema core, default rights, and the small
-- helpers every other file uses.
-- Serves: contracts 2 (Structure: the id rule) and 3 (Access: the four levels).
-- Must not change: an id is lower case, digits, single dashes, 3-30 chars;
-- levels are read < contribute < edit < approve. Nothing here is reachable
-- from the site.
-- How to run: as part of db/install/install.sql (psql), or pasted in number
-- order. Only into an empty database; see db/install/README.md.

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles
                 where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'Run this as the database owner (postgres in Supabase).';
  end if;
  if pg_catalog.to_regnamespace('core') is not null then
    raise exception 'Schema core already exists. db/install is for an empty database only; see db/install/README.md.';
  end if;
  if pg_catalog.to_regrole('anon') is null or pg_catalog.to_regrole('authenticated') is null then
    raise exception 'The roles anon and authenticated are missing (Supabase has them; elsewhere make them first, see README).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Schema and default rights
-- ---------------------------------------------------------------------------

create schema core;
revoke all on schema core from public, anon, authenticated;

-- Supabase gives anon and authenticated rights on everything new in public.
-- Take that away: each dame_* function is granted by name in 09_rights.sql.
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Small helpers
-- ---------------------------------------------------------------------------

-- An id of a space or a tool: lower case, digits, single dashes, 3-30 chars.
create function core.id_ok(p_id text) returns boolean
language sql immutable set search_path = '' as $$
  select p_id is not null
     and pg_catalog.length(p_id) between 3 and 30
     and p_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$';
$$;

-- read < contribute < edit < approve
create function core.level_rank(p_level text) returns integer
language sql immutable set search_path = '' as $$
  select case p_level when 'read' then 1 when 'contribute' then 2
                      when 'edit' then 3 when 'approve' then 4 end;
$$;

-- Refuse, with a sentence for the person and a short code for the page.
-- 401 = sign in again, 403 = not allowed, 400 = the request is wrong.
create function core.fail(p_code text, p_message text, p_http integer default 403) returns void
language plpgsql volatile set search_path = '' as $$
begin
  raise exception using
    errcode = 'PT' || p_http::text,
    message = p_message,
    detail = p_code;
end $$;

-- A display name: no control characters, trimmed, 1-80 characters.
create function core.clean_name(p_name text, p_fallback text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(
    nullif(pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g')), 80), ''),
    nullif(pg_catalog.left(pg_catalog.split_part(coalesce(p_fallback, ''), '@', 1), 80), ''),
    'User');
$$;

-- Free text typed by a person: no control characters, trimmed, cut to length.
create function core.clean_text(p_text text, p_max integer) returns text
language sql immutable set search_path = '' as $$
  select pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_text, ''), '[[:cntrl:]]', ' ', 'g')), p_max);
$$;

-- A short line of text: no control characters, single spaces, trimmed, cut to p_max.
create function core.clean_line(p_text text, p_max integer) returns text
language sql immutable set search_path = '' as $$
  select pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(
           pg_catalog.regexp_replace(coalesce(p_text, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), p_max);
$$;

-- ---------------------------------------------------------------------------
-- 3. Trigger functions (the triggers are in 02_tables.sql)
-- ---------------------------------------------------------------------------

-- The audit is append-only: no update, no delete, no truncate.
create function core.audit_is_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'The audit is append-only: rows cannot be changed or deleted.';
end $$;

-- A ready version never changes again. Before that, its files and who started it are fixed; only its state moves on.
create function core.version_is_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.state = 'ready' then
    raise exception 'A version that is ready can never be changed.';
  end if;
  if new.space <> old.space or new.tool <> old.tool or new.version <> old.version
     or new.files <> old.files or new.created_by <> old.created_by then
    raise exception 'Only the state of a version can change.';
  end if;
  return new;
end $$;
