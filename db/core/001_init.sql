-- db/core/001_init.sql - the core of the DAME demo: people, sessions, spaces,
-- tools, roles, access, settings, audit, the require-checks and the security check.
-- Serves: contracts 1 (Identity), 2 (Structure), 3 (Access), 7 (Audit).
-- Must not change: once run, this file is never edited; a fix is a new file
-- with the next number. No table is ever reachable from the API: only the
-- dame_* functions in schema public, each starting with a core.require_* check.
--
-- How to run: paste the whole file into the Supabase SQL editor and press Run.
-- It either finishes completely or changes nothing. The last result must be
-- an empty table (no security problems).

begin;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles
                 where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'Run this in the Supabase SQL editor as the postgres role.';
  end if;
  if pg_catalog.to_regnamespace('core') is not null then
    raise exception 'Schema core already exists: 001 was already run. Do not run it twice.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Schema and default rights
-- ---------------------------------------------------------------------------
create schema core;
revoke all on schema core from public, anon, authenticated;

-- Supabase gives anon and authenticated rights on everything new in public.
-- Take that away: each dame_* function is granted by name below.
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

-- ---------------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------------

-- One person = one row. id is the user id given by sign-in.
create table core.profiles (
  id          uuid primary key,
  email       text not null,
  name        text not null,
  status      text not null default 'pending' check (status in ('pending', 'active', 'disabled')),
  is_it       boolean not null default false,
  created_at  timestamptz not null default pg_catalog.now(),
  decided_at  timestamptz,
  decided_by  uuid references core.profiles (id),
  check (not is_it or status = 'active')
);

-- Every sign-in seen by the platform. Only the newest one of a user is
-- honoured, for 12 hours. Rows are never deleted, so an old session can never
-- come back as a new one.
create table core.sessions (
  seq         bigint generated always as identity primary key,
  session_id  uuid not null unique,
  user_id     uuid not null,
  first_seen  timestamptz not null default pg_catalog.now(),
  ended_at    timestamptz
);
create index sessions_user on core.sessions (user_id, seq desc);

create table core.spaces (
  id          text primary key check (core.id_ok(id)),
  name        text not null check (pg_catalog.length(name) between 1 and 80),
  description text not null default '' check (pg_catalog.length(description) <= 400),
  icon        text not null default '',
  colour      text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default pg_catalog.now(),
  created_by  uuid not null references core.profiles (id)
);

create table core.tools (
  space         text not null references core.spaces (id),
  id            text not null check (core.id_ok(id)),
  name          text not null check (pg_catalog.length(name) between 1 and 80),
  description   text not null default '' check (pg_catalog.length(description) <= 400),
  icon          text not null default '',
  colour        text not null default '',
  active        boolean not null default true,
  open_to_space boolean not null default false,
  open_level    text not null default 'read' check (core.level_rank(open_level) is not null),
  created_at    timestamptz not null default pg_catalog.now(),
  created_by    uuid not null references core.profiles (id),
  primary key (space, id)
);

-- Ids are permanent and never reused: a deleted space or tool leaves its id here.
create table core.retired_ids (
  kind        text not null check (kind in ('space', 'tool')),
  space       text not null,
  id          text not null default '',
  retired_at  timestamptz not null default pg_catalog.now(),
  primary key (kind, space, id)
);

create table core.space_admins (
  space     text not null references core.spaces (id),
  user_id   uuid not null references core.profiles (id),
  added_at  timestamptz not null default pg_catalog.now(),
  added_by  uuid not null references core.profiles (id),
  primary key (space, user_id)
);

create table core.space_members (
  space     text not null references core.spaces (id),
  user_id   uuid not null references core.profiles (id),
  added_at  timestamptz not null default pg_catalog.now(),
  added_by  uuid not null references core.profiles (id),
  primary key (space, user_id)
);

create table core.tool_managers (
  space     text not null,
  tool      text not null,
  user_id   uuid not null references core.profiles (id),
  added_at  timestamptz not null default pg_catalog.now(),
  added_by  uuid not null references core.profiles (id),
  primary key (space, tool, user_id),
  foreign key (space, tool) references core.tools (space, id)
);

create table core.tool_access (
  space     text not null,
  tool      text not null,
  user_id   uuid not null references core.profiles (id),
  level     text not null check (core.level_rank(level) is not null),
  added_at  timestamptz not null default pg_catalog.now(),
  added_by  uuid not null references core.profiles (id),
  primary key (space, tool, user_id),
  foreign key (space, tool) references core.tools (space, id)
);

create table core.settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default pg_catalog.now(),
  updated_by  uuid references core.profiles (id)
);
insert into core.settings (key, value) values ('ai_mode', 'prompt');

-- Who, when, what. Rows are only ever added.
create table core.audit (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default pg_catalog.now(),
  actor   uuid,
  action  text not null,
  space   text,
  tool    text,
  target  text,
  detail  jsonb not null default '{}'::jsonb
);
create index audit_space on core.audit (space, id desc);

create function core.audit_is_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'The audit is append-only: rows cannot be changed or deleted.';
end $$;

create trigger audit_no_change before update or delete on core.audit
  for each row execute function core.audit_is_append_only();
create trigger audit_no_truncate before truncate on core.audit
  for each statement execute function core.audit_is_append_only();

-- Row security on and forced on every table. No policies: nobody reaches a
-- table except through the functions below.
do $$
declare t record;
begin
  for t in select c.oid::regclass as name from pg_catalog.pg_class c
           join pg_catalog.pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'core' and c.relkind = 'r'
  loop
    execute pg_catalog.format('alter table %s enable row level security', t.name);
    execute pg_catalog.format('alter table %s force row level security', t.name);
    execute pg_catalog.format('revoke all on table %s from public, anon, authenticated', t.name);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Audit and the require-checks (the first line of every dame_* function)
-- ---------------------------------------------------------------------------

create function core.audit_add(p_actor uuid, p_action text, p_target text default null,
                               p_detail jsonb default '{}'::jsonb,
                               p_space text default null, p_tool text default null) returns void
language sql volatile set search_path = '' as $$
  insert into core.audit (actor, action, space, tool, target, detail)
  values (p_actor, p_action, p_space, p_tool, p_target, coalesce(p_detail, '{}'::jsonb));
$$;

-- Signed in, with the one valid session. Says nothing about approval.
create function core.require_login() returns uuid
language plpgsql volatile set search_path = '' as $$
declare
  v_claims  jsonb := auth.jwt();
  v_uid     uuid  := auth.uid();
  v_sid     uuid;
  v_row     core.sessions;
  v_newest  uuid;
begin
  if v_uid is null
     or coalesce(v_claims ->> 'role', '') <> 'authenticated'
     or coalesce(v_claims ->> 'is_anonymous', 'false') <> 'false' then
    perform core.fail('signed_out', 'You are not signed in. Sign in and try again.', 401);
  end if;

  begin
    v_sid := (v_claims ->> 'session_id')::uuid;
  exception when others then
    v_sid := null;
  end;
  if v_sid is null then
    perform core.fail('signed_out', 'You are not signed in. Sign in and try again.', 401);
  end if;

  insert into core.sessions (session_id, user_id) values (v_sid, v_uid)
  on conflict (session_id) do nothing;

  select * into v_row from core.sessions where session_id = v_sid;
  select s.session_id into v_newest from core.sessions s
   where s.user_id = v_uid order by s.seq desc limit 1;

  if v_row.user_id <> v_uid
     or v_row.ended_at is not null
     or v_newest <> v_sid
     or v_row.first_seen < pg_catalog.now() - interval '12 hours' then
    perform core.fail('session_ended', 'Your session has ended. Sign in again.', 401);
  end if;

  return v_uid;
end $$;

-- Signed in and approved.
create function core.require_user() returns uuid
language plpgsql volatile set search_path = '' as $$
declare
  v_uid     uuid := core.require_login();
  v_status  text;
begin
  select p.status into v_status from core.profiles p where p.id = v_uid;
  if v_status is null then
    perform core.fail('no_profile', 'No access request was found for you. Open the start page and request access.');
  elsif v_status = 'pending' then
    perform core.fail('pending', 'Your account is waiting for approval by an IT admin.');
  elsif v_status <> 'active' then
    perform core.fail('disabled', 'Your account is switched off. Ask an IT admin.');
  end if;
  return v_uid;
end $$;

create function core.require_it() returns uuid
language plpgsql volatile set search_path = '' as $$
declare
  v_uid uuid := core.require_user();
begin
  if not exists (select 1 from core.profiles p where p.id = v_uid and p.is_it) then
    perform core.fail('not_allowed', 'Only an IT admin can do this.');
  end if;
  return v_uid;
end $$;

create function core.is_space_admin(p_uid uuid, p_space text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from core.space_admins a where a.space = p_space and a.user_id = p_uid);
$$;

-- p_role: 'admin' = an admin of this space; 'member' = anyone who belongs to it.
create function core.require_space(p_space text, p_role text default 'admin') returns uuid
language plpgsql volatile set search_path = '' as $$
declare
  v_uid     uuid := core.require_user();
  v_active  boolean;
begin
  if p_role is null or p_role not in ('admin', 'member') then
    perform core.fail('bad_request', 'Unknown role.', 400);
  end if;
  select s.active into v_active from core.spaces s where s.id = p_space;
  if v_active is null then
    perform core.fail('not_allowed', 'You do not have this space. Ask its admin.');
  end if;
  if core.is_space_admin(v_uid, p_space) then
    return v_uid;
  end if;
  if p_role = 'member' and v_active
     and exists (select 1 from core.space_members m where m.space = p_space and m.user_id = v_uid) then
    return v_uid;
  end if;
  perform core.fail('not_allowed', 'You do not have this space. Ask its admin.');
end $$;

-- The highest level a user has on a tool, or null.
-- Space admins and the tool's managers have the top level.
create function core.tool_level(p_uid uuid, p_space text, p_tool text) returns text
language plpgsql stable set search_path = '' as $$
declare
  v_tool   core.tools;
  v_space  boolean;
  v_rank   integer := 0;
begin
  if not exists (select 1 from core.profiles p where p.id = p_uid and p.status = 'active') then
    return null;
  end if;
  select * into v_tool from core.tools t where t.space = p_space and t.id = p_tool;
  if v_tool.id is null then
    return null;
  end if;
  if core.is_space_admin(p_uid, p_space)
     or exists (select 1 from core.tool_managers m
                where m.space = p_space and m.tool = p_tool and m.user_id = p_uid) then
    return 'approve';
  end if;
  select s.active into v_space from core.spaces s where s.id = p_space;
  if not v_space or not v_tool.active then
    return null;
  end if;
  select coalesce(max(core.level_rank(a.level)), 0) into v_rank from core.tool_access a
   where a.space = p_space and a.tool = p_tool and a.user_id = p_uid;
  if v_tool.open_to_space
     and exists (select 1 from core.space_members m where m.space = p_space and m.user_id = p_uid) then
    v_rank := greatest(v_rank, core.level_rank(v_tool.open_level));
  end if;
  return case v_rank when 1 then 'read' when 2 then 'contribute'
                     when 3 then 'edit' when 4 then 'approve' end;
end $$;

create function core.has_tool(p_uid uuid, p_space text, p_tool text, p_level text) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(core.level_rank(core.tool_level(p_uid, p_space, p_tool)) >= core.level_rank(p_level), false);
$$;

create function core.require_tool(p_space text, p_tool text, p_level text) returns uuid
language plpgsql volatile set search_path = '' as $$
declare
  v_uid uuid := core.require_user();
begin
  if core.level_rank(p_level) is null then
    perform core.fail('bad_request', 'Unknown level.', 400);
  end if;
  if not core.has_tool(v_uid, p_space, p_tool, p_level) then
    perform core.fail('not_allowed', 'Your level on this tool does not allow this. Ask the tool''s manager.');
  end if;
  return v_uid;
end $$;

-- ---------------------------------------------------------------------------
-- 5. For the owner, in the SQL editor only (not reachable from the site)
-- ---------------------------------------------------------------------------

-- Makes the very first IT admin. Works once: refuses when an IT admin exists.
-- The person must have signed in on the site once, so that his request exists.
--   select core.make_first_admin('your email');
create function core.make_first_admin(p_email text) returns text
language plpgsql volatile set search_path = '' as $$
declare
  v_id uuid;
begin
  if exists (select 1 from core.profiles p where p.is_it) then
    raise exception 'An IT admin already exists. New IT admins are named on the IT admin page.';
  end if;
  select p.id into v_id from core.profiles p where p.email = pg_catalog.lower(pg_catalog.btrim(p_email));
  if v_id is null then
    raise exception 'No access request with this email. Request access and sign in on the site once, then run this again.';
  end if;
  update core.profiles set status = 'active', is_it = true, decided_at = pg_catalog.now() where id = v_id;
  perform core.audit_add(null, 'user.first_admin', v_id::text);
  return 'Done. Sign in on the site: you are the first IT admin.';
end $$;

-- One row per problem. Must return nothing after every SQL file.
create function core.security_check() returns table (problem text, object text)
language plpgsql stable set search_path = '' as $$
begin
  -- a. Every table of ours has row security on and forced.
  return query
    select 'Table without forced row security'::text, c.oid::regclass::text
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p')
       and (n.nspname in ('core', 'public') or n.nspname like 't\_%' or n.nspname like 'p\_%')
       and not (c.relrowsecurity and c.relforcerowsecurity);

  -- b. Nothing in public but dame_* functions.
  return query
    select 'Table, view or sequence in public'::text, c.oid::regclass::text
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f');
  return query
    select 'Function in public that is not dame_*'::text, p.oid::regprocedure::text
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname not like 'dame\_%'
       and not exists (select 1 from pg_catalog.pg_depend d where d.objid = p.oid and d.deptype = 'e');

  -- c. Every dame_* function runs as its owner with an empty search path.
  return query
    select 'dame_* function without security definer and empty search_path'::text, p.oid::regprocedure::text
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'dame\_%'
       and not (p.prosecdef and coalesce('search_path=""' = any (p.proconfig), false));

  -- d. A signed-out visitor runs only dame_site_info.
  return query
    select 'Function a signed-out visitor can run'::text, p.oid::regprocedure::text
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname <> 'dame_site_info'
       and not exists (select 1 from pg_catalog.pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and pg_catalog.has_function_privilege('anon', p.oid, 'execute');

  -- e. The site's roles cannot enter our schemas or touch our tables.
  return query
    select 'Schema open to ' || r.rolname, n.nspname::text
      from pg_catalog.pg_namespace n
      cross join (select rolname from pg_catalog.pg_roles where rolname in ('anon', 'authenticated')) r
     where (n.nspname = 'core' or n.nspname like 't\_%' or n.nspname like 'p\_%')
       and pg_catalog.has_schema_privilege(r.rolname, n.oid, 'usage');
  return query
    select 'Table open to ' || r.rolname, c.oid::regclass::text
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      cross join (select rolname from pg_catalog.pg_roles where rolname in ('anon', 'authenticated')) r
     where c.relkind in ('r', 'p')
       and (n.nspname = 'core' or n.nspname like 't\_%' or n.nspname like 'p\_%')
       and pg_catalog.has_table_privilege(r.rolname, c.oid, 'select, insert, update, delete, truncate');

  -- f. No public storage bucket.
  if pg_catalog.to_regclass('storage.buckets') is not null then
    return query execute
      'select ''Public storage bucket''::text, b.id::text from storage.buckets b where b.public';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. The API: dame_* functions (the only things the site can call)
-- ---------------------------------------------------------------------------

-- The one function a signed-out visitor may run. Holds no data.
create function public.dame_site_info() returns jsonb
language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object('name', 'DAME', 'demo', true, 'api', 1);
$$;

-- Called right after sign-in. Records the access request the first time and
-- returns only the caller's own status: pending, active or disabled.
create function public.dame_request_access() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := core.require_login();
  v_claims  jsonb := auth.jwt();
  v_email   text := pg_catalog.lower(pg_catalog.left(coalesce(v_claims ->> 'email', ''), 254));
  v_added   integer;
  v_row     core.profiles;
begin
  if v_email = '' then
    perform core.fail('bad_request', 'Your sign-in has no email address. Ask an IT admin.', 400);
  end if;

  insert into core.profiles (id, email, name)
  values (v_uid, v_email, core.clean_name(v_claims -> 'user_metadata' ->> 'name', v_email))
  on conflict (id) do nothing;
  get diagnostics v_added = row_count;
  if v_added > 0 then
    perform core.audit_add(v_uid, 'user.requested', v_uid::text, pg_catalog.jsonb_build_object('email', v_email));
  end if;

  select * into v_row from core.profiles p where p.id = v_uid;
  if v_row.email <> v_email then
    update core.profiles set email = v_email where id = v_uid;
    perform core.audit_add(v_uid, 'user.email_changed', v_uid::text,
                           pg_catalog.jsonb_build_object('from', v_row.email, 'to', v_email));
  end if;

  return pg_catalog.jsonb_build_object('status', v_row.status);
end $$;

-- Who am I. Approved users only.
create function public.dame_me() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_user();
begin
  return (select pg_catalog.jsonb_build_object(
            'id', p.id, 'name', p.name, 'email', p.email, 'is_it', p.is_it,
            'ai_mode', (select s.value from core.settings s where s.key = 'ai_mode'))
          from core.profiles p where p.id = v_uid);
end $$;

-- Ends the caller's session at once, whatever the sign-in service still thinks.
create function public.dame_sign_out() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_login();
begin
  update core.sessions set ended_at = pg_catalog.now()
   where user_id = v_uid and ended_at is null;
end $$;

-- The spaces the caller may open: as admin, as member, or through a tool.
create function public.dame_spaces_list() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_user();
begin
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', s.id, 'name', s.name, 'description', s.description,
             'icon', s.icon, 'colour', s.colour, 'active', s.active,
             'is_admin', core.is_space_admin(v_uid, s.id)) order by s.name)
      from core.spaces s
     where core.is_space_admin(v_uid, s.id)
        or (s.active and (
              exists (select 1 from core.space_members m where m.space = s.id and m.user_id = v_uid)
           or exists (select 1 from core.tool_managers m where m.space = s.id and m.user_id = v_uid)
           or exists (select 1 from core.tool_access a where a.space = s.id and a.user_id = v_uid)))
  ), '[]'::jsonb);
end $$;

-- IT admin: everyone, waiting accounts first. p_status narrows the list.
create function public.dame_users_list(p_status text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_it();
begin
  if p_status is not null and p_status not in ('pending', 'active', 'disabled') then
    perform core.fail('bad_request', 'Unknown status.', 400);
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', u.id, 'name', u.name, 'email', u.email, 'status', u.status,
             'is_it', u.is_it, 'created_at', u.created_at, 'decided_at', u.decided_at,
             'is_me', u.id = v_uid)
           order by (u.status = 'pending') desc, u.created_at desc)
      from (select * from core.profiles p
             where p_status is null or p.status = p_status
             order by (p.status = 'pending') desc, p.created_at desc limit 1000) u
  ), '[]'::jsonb);
end $$;

-- IT admin: approve (active) or switch off (disabled) another person's account.
create function public.dame_user_set_status(p_user uuid, p_status text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := core.require_it();
  v_old  text;
begin
  if p_status is null or p_status not in ('active', 'disabled') then
    perform core.fail('bad_request', 'Choose Approve or Switch off.', 400);
  end if;
  if p_user = v_uid then
    perform core.fail('not_allowed', 'You cannot change your own account. Ask another IT admin.');
  end if;
  select p.status into v_old from core.profiles p where p.id = p_user for update;
  if v_old is null then
    perform core.fail('bad_request', 'This person was not found. Reload the page.', 400);
  end if;
  if v_old = p_status then
    return;
  end if;

  update core.profiles
     set status = p_status,
         is_it = case when p_status = 'disabled' then false else is_it end,
         decided_at = pg_catalog.now(), decided_by = v_uid
   where id = p_user;
  if p_status = 'disabled' then
    update core.sessions set ended_at = pg_catalog.now() where user_id = p_user and ended_at is null;
  end if;

  perform core.audit_add(v_uid,
    case when p_status = 'active' and v_old = 'pending' then 'user.approved'
         when p_status = 'active' then 'user.switched_on'
         when v_old = 'pending' then 'user.refused'
         else 'user.switched_off' end,
    p_user::text);
end $$;

-- IT admin: make another approved person an IT admin, or take it back.
create function public.dame_user_set_it(p_user uuid, p_is_it boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := core.require_it();
  v_row  core.profiles;
begin
  if p_is_it is null then
    perform core.fail('bad_request', 'Choose yes or no.', 400);
  end if;
  if p_user = v_uid then
    perform core.fail('not_allowed', 'You cannot change your own role. Ask another IT admin.');
  end if;
  select * into v_row from core.profiles p where p.id = p_user for update;
  if v_row.id is null then
    perform core.fail('bad_request', 'This person was not found. Reload the page.', 400);
  end if;
  if v_row.status <> 'active' then
    perform core.fail('bad_request', 'Approve this account first.', 400);
  end if;
  if v_row.is_it = p_is_it then
    return;
  end if;
  update core.profiles set is_it = p_is_it where id = p_user;
  perform core.audit_add(v_uid, case when p_is_it then 'user.it_admin_on' else 'user.it_admin_off' end, p_user::text);
end $$;

-- IT admin: a site setting. Only known keys and values.
create function public.dame_setting_set(p_key text, p_value text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := core.require_it();
  v_old  text;
begin
  if p_key is distinct from 'ai_mode' or p_value is null or p_value not in ('off', 'prompt', 'prompt_all') then
    perform core.fail('bad_request', 'Unknown setting or value.', 400);
  end if;
  select s.value into v_old from core.settings s where s.key = p_key for update;
  if v_old = p_value then
    return;
  end if;
  update core.settings set value = p_value, updated_at = pg_catalog.now(), updated_by = v_uid where key = p_key;
  perform core.audit_add(v_uid, 'setting.changed', p_key, pg_catalog.jsonb_build_object('from', v_old, 'to', p_value));
end $$;

-- IT admin: the audit, newest first. p_before = show entries older than this id.
create function public.dame_audit_list(p_limit integer default 100, p_before bigint default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_it();
begin
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', a.id, 'at', a.at, 'action', a.action, 'space', a.space, 'tool', a.tool,
             'actor', coalesce(pa.name, case when a.actor is null then 'Owner (SQL editor)' else 'Unknown' end),
             'target', coalesce(pt.name || ' (' || pt.email || ')', a.target),
             'detail', a.detail) order by a.id desc)
      from (select * from core.audit x
             where p_before is null or x.id < p_before
             order by x.id desc
             limit least(greatest(coalesce(p_limit, 100), 1), 500)) a
      left join core.profiles pa on pa.id = a.actor
      left join core.profiles pt on a.action like 'user.%' and pt.id::text = a.target
  ), '[]'::jsonb);
end $$;

-- Rights: nobody by default, then each function by name.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_catalog.pg_proc p
           join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'dame\_%'
  loop
    execute pg_catalog.format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute pg_catalog.format('grant execute on function %s to authenticated', f.sig);
    if f.proname = 'dame_site_info' then
      execute pg_catalog.format('grant execute on function %s to anon', f.sig);
    end if;
  end loop;
end $$;

commit;

-- Must show no rows.
select * from core.security_check();
