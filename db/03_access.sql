-- db/03_access.sql - the audit and the require-checks: the first line
-- of every dame_* function is one of the core.require_* checks below.
-- Serves: contracts 1 (Identity), 3 (Access) and 7 (Audit).
-- Must not change: the database decides who may do what, never the page.
-- One person = one user id; only his newest sign-in counts, for 12 hours.
-- How to run: as part of db/install.sql (psql), or pasted in number
-- order. Only into an empty database; see db/README.md.

-- ---------------------------------------------------------------------------
-- 1. The audit
-- ---------------------------------------------------------------------------

-- Writes one line to the audit.
create function core.audit_add(p_actor uuid, p_action text, p_target text default null,
                               p_detail jsonb default '{}'::jsonb,
                               p_space text default null, p_tool text default null) returns void
language sql volatile set search_path = '' as $$
  insert into core.audit (actor, action, space, tool, target, detail)
  values (p_actor, p_action, p_space, p_tool, p_target, coalesce(p_detail, '{}'::jsonb));
$$;

-- The audit as the pages show it, newest first, optionally narrowed to a space or a tool.
create function core.audit_json(p_limit integer, p_before bigint, p_space text, p_tool text) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id', a.id, 'at', a.at, 'action', a.action, 'space', a.space, 'tool', a.tool,
           'actor', coalesce(pa.name, case when a.actor is null then 'Owner (SQL editor)' else 'Unknown' end),
           'target', coalesce(pt.name || ' (' || pt.email || ')', a.target),
           'detail', a.detail) order by a.id desc), '[]'::jsonb)
    from (select * from core.audit x
           where (p_before is null or x.id < p_before)
             and (p_space is null or x.space = p_space)
             and (p_tool is null or x.tool = p_tool)
           order by x.id desc
           limit least(greatest(coalesce(p_limit, 100), 1), 500)) a
    left join core.profiles pa on pa.id = a.actor
    left join core.profiles pt on pt.id::text = a.target;
$$;

-- ---------------------------------------------------------------------------
-- 2. Who is calling
-- ---------------------------------------------------------------------------

-- Signed in, with the one valid session: the person's newest sign-in, at most
-- 12 hours old, not ended. Says nothing about approval. The first time a
-- session of a known person is seen, that sign-in is written to the audit.
-- SUPABASE: reads auth.jwt() and auth.uid().
create function core.require_login() returns uuid
language plpgsql volatile set search_path = '' as $$
declare
  v_claims  jsonb := auth.jwt();
  v_uid     uuid  := auth.uid();
  v_sid     uuid;
  v_row     core.sessions;
  v_newest  uuid;
  v_new     integer;
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
  get diagnostics v_new = row_count;

  select * into v_row from core.sessions where session_id = v_sid;
  select s.session_id into v_newest from core.sessions s
   where s.user_id = v_uid order by s.seq desc limit 1;

  if v_row.user_id <> v_uid
     or v_row.ended_at is not null
     or v_newest <> v_sid
     or v_row.first_seen < pg_catalog.now() - interval '12 hours' then
    perform core.fail('session_ended', 'Your session has ended. Sign in again.', 401);
  end if;

  if v_new > 0 and exists (select 1 from core.profiles p where p.id = v_uid) then
    perform core.audit_add(v_uid, 'user.signed_in', v_uid::text);
  end if;
  return v_uid;
end $$;

-- Who is calling, if he is signed in with his one valid session and approved.
-- Reads only (for the file policies); returns null instead of refusing.
-- SUPABASE: reads auth.jwt() and auth.uid().
create function core.peek_user() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  v_claims jsonb := auth.jwt();
  v_uid    uuid  := auth.uid();
  v_sid    uuid;
begin
  if v_uid is null
     or coalesce(v_claims ->> 'role', '') <> 'authenticated'
     or coalesce(v_claims ->> 'is_anonymous', 'false') <> 'false' then
    return null;
  end if;
  begin
    v_sid := (v_claims ->> 'session_id')::uuid;
  exception when others then
    return null;
  end;
  if not exists (select 1 from core.profiles p where p.id = v_uid and p.status = 'active') then
    return null;
  end if;
  if not exists (
       select 1 from core.sessions s
        where s.session_id = v_sid and s.user_id = v_uid and s.ended_at is null
          and s.first_seen >= pg_catalog.now() - interval '12 hours'
          and s.seq = (select max(x.seq) from core.sessions x where x.user_id = v_uid)) then
    return null;
  end if;
  return v_uid;
end $$;

-- Signed in, approved, and with a password of his own: an account with a
-- temporary password (made by IT, or reset) is refused everywhere until the
-- person has chosen his own.
create function core.require_user() returns uuid
language plpgsql volatile set search_path = '' as $$
declare
  v_uid   uuid := core.require_login();
  v_row   core.profiles;
begin
  select * into v_row from core.profiles p where p.id = v_uid;
  if v_row.id is null then
    perform core.fail('no_profile', 'No access request was found for you. Open the start page and request access.');
  elsif v_row.status = 'pending' then
    perform core.fail('pending', 'Your account is waiting for approval by an IT admin.');
  elsif v_row.status <> 'active' then
    perform core.fail('disabled', 'Your account is switched off. Ask an IT admin.');
  elsif v_row.must_change then
    perform core.fail('must_change', 'Choose your own password first. Open the start page.');
  end if;
  return v_uid;
end $$;

-- Is this person an IT admin?
create function core.is_it(p_uid uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from core.profiles p where p.id = p_uid and p.is_it and p.status = 'active');
$$;

-- Signed in, approved, and an IT admin.
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

-- The person an action is about must exist and be approved.
create function core.require_person(p_user uuid) returns void
language plpgsql volatile set search_path = '' as $$
begin
  if p_user is null or not exists (select 1 from core.profiles p where p.id = p_user and p.status = 'active') then
    perform core.fail('bad_request', 'This person was not found or is not approved. Pick someone from the list.', 400);
  end if;
end $$;

-- A person as the pages show him: id, name, email, approved or not.
create function core.person_json(p_user uuid) returns jsonb
language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object('id', p.id, 'name', p.name, 'email', p.email, 'active', p.status = 'active')
    from core.profiles p where p.id = p_user;
$$;

-- ---------------------------------------------------------------------------
-- 3. Spaces
-- ---------------------------------------------------------------------------

-- Is this person an admin of this space?
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

-- An admin of this space, or an IT admin (for the admins of a space only).
create function core.require_space_or_it(p_space text) returns uuid
language plpgsql volatile set search_path = '' as $$
declare
  v_uid uuid := core.require_user();
begin
  if core.is_space_admin(v_uid, p_space) then
    return v_uid;
  end if;
  if not core.is_it(v_uid) then
    perform core.fail('not_allowed', 'You do not have this space. Ask its admin.');
  end if;
  if not exists (select 1 from core.spaces s where s.id = p_space) then
    perform core.fail('bad_request', 'This space was not found. Reload the page.', 400);
  end if;
  return v_uid;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Tools: the level of a person on a tool
-- ---------------------------------------------------------------------------

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

-- Has this person at least this level on the tool?
create function core.has_tool(p_uid uuid, p_space text, p_tool text, p_level text) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(core.level_rank(core.tool_level(p_uid, p_space, p_tool)) >= core.level_rank(p_level), false);
$$;

-- Signed in, approved, and at least this level on the tool.
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

-- Is this person one of the tool's managers?
create function core.is_tool_manager(p_uid uuid, p_space text, p_tool text) returns boolean
language sql stable set search_path = '' as $$
  select core.is_space_admin(p_uid, p_space)
      or exists (select 1 from core.tool_managers m
                  where m.space = p_space and m.tool = p_tool and m.user_id = p_uid);
$$;

-- An admin of the tool's space, or one of the tool's managers.
create function core.require_tool_manager(p_space text, p_tool text) returns uuid
language plpgsql volatile set search_path = '' as $$
declare
  v_uid uuid := core.require_user();
begin
  if exists (select 1 from core.tools t where t.space = p_space and t.id = p_tool)
     and (core.is_space_admin(v_uid, p_space)
          or exists (select 1 from core.tool_managers m
                     where m.space = p_space and m.tool = p_tool and m.user_id = v_uid)) then
    return v_uid;
  end if;
  perform core.fail('not_allowed', 'You do not look after this tool. Ask the space admin.');
end $$;

-- The tool must exist in a space the caller administers.
create function core.require_tool_of_space(p_space text, p_tool text) returns uuid
language plpgsql volatile set search_path = '' as $$
declare
  v_uid uuid := core.require_space(p_space, 'admin');
begin
  if not exists (select 1 from core.tools t where t.space = p_space and t.id = p_tool) then
    perform core.fail('bad_request', 'This tool was not found. Reload the page.', 400);
  end if;
  return v_uid;
end $$;
