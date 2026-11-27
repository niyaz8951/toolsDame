-- db/upgrade.sql - brings the live demo database to the final version in db/.
-- Only the change, in two parts:
--   1. An IT admin acts as admin of every space and has the top level on every
--      tool (owner, 2026-11-27). Named admins stay as they are and are still
--      the only ones counted ("the last admin"). When an IT admin opens a tool
--      he is not named in, the audit says so (it.tool_opened). Private rows
--      stay with their owner. An IT admin does not ask himself for more quota.
--   2. Removing one column of a table (dame_table_drop_column), from the
--      delivery before. Written so that it does no harm if that one already ran.
-- Serves: contracts 3 (Access) and 7 (Audit); SECURITY "Database".
-- Must not change: only for a database that db/check.sql called final before
-- one of these two deliveries; never for a new database (db/install.sql has it).
-- The next delivery after it ran removes this file.
--
-- How to run: paste the whole file into the Supabase SQL editor and press Run.
-- It finishes completely or changes nothing. The security check must show no
-- rows, and the last result (the question of db/check.sql) must say yes.

begin;

do $$
begin
  if pg_catalog.to_regclass('core.space_quotas') is null then
    raise exception 'This database is not the version before: build it with db/install.sql instead.';
  end if;
  if pg_catalog.to_regprocedure('core.can_admin_space(uuid, text)') is not null then
    raise exception 'This upgrade was already run. db/check.sql says whether the database is final.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. IT admin acts as admin of every space
-- ---------------------------------------------------------------------------

-- May this person act as admin of this space? Its named admins, and every
-- IT admin on every space (owner, 2026-11-27). Every gate uses this one.
create or replace function core.can_admin_space(p_uid uuid, p_space text) returns boolean
language sql stable set search_path = '' as $$
  select core.is_space_admin(p_uid, p_space) or core.is_it(p_uid);
$$;

-- p_role: 'admin' = may act as admin of this space (named admin or IT admin);
-- 'member' = anyone who belongs to it.
create or replace function core.require_space(p_space text, p_role text default 'admin') returns uuid
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
  if core.can_admin_space(v_uid, p_space) then
    return v_uid;
  end if;
  if p_role = 'member' and v_active
     and exists (select 1 from core.space_members m where m.space = p_space and m.user_id = v_uid) then
    return v_uid;
  end if;
  perform core.fail('not_allowed', 'You do not have this space. Ask its admin.');
end $$;

-- The highest level a user has on a tool by being named, or null: as named
-- admin of the space, as the tool's manager, by access or as a member of a
-- space whose tool is open to it. Leaves IT out (for the account card).
create or replace function core.named_tool_level(p_uid uuid, p_space text, p_tool text) returns text
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

-- The highest level a user has on a tool, or null. Whoever may act as admin
-- of the space (its named admins, every IT admin) and the tool's managers
-- have the top level.
create or replace function core.tool_level(p_uid uuid, p_space text, p_tool text) returns text
language sql stable set search_path = '' as $$
  select case
           when not exists (select 1 from core.tools t where t.space = p_space and t.id = p_tool) then null
           when core.is_it(p_uid) then 'approve'
           else core.named_tool_level(p_uid, p_space, p_tool) end;
$$;

-- Is this person one of the tool's managers?
create or replace function core.is_tool_manager(p_uid uuid, p_space text, p_tool text) returns boolean
language sql stable set search_path = '' as $$
  select core.can_admin_space(p_uid, p_space)
      or exists (select 1 from core.tool_managers m
                  where m.space = p_space and m.tool = p_tool and m.user_id = p_uid);
$$;

-- Whoever may act as admin of the tool's space, or one of the tool's managers.
create or replace function core.require_tool_manager(p_space text, p_tool text) returns uuid
language plpgsql volatile set search_path = '' as $$
declare
  v_uid uuid := core.require_user();
begin
  if exists (select 1 from core.tools t where t.space = p_space and t.id = p_tool)
     and (core.can_admin_space(v_uid, p_space)
          or exists (select 1 from core.tool_managers m
                     where m.space = p_space and m.tool = p_tool and m.user_id = v_uid)) then
    return v_uid;
  end if;
  perform core.fail('not_allowed', 'You do not look after this tool. Ask the space admin.');
end $$;

-- One person's account as a card. p_full adds what only IT sees.
create or replace function core.account_card(p_user uuid, p_full boolean) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_row   core.profiles;
  v_card  jsonb;
begin
  select * into v_row from core.profiles p where p.id = p_user;
  if v_row.id is null then
    return null;
  end if;
  v_card := pg_catalog.jsonb_build_object(
    'id', v_row.id, 'name', v_row.name, 'username', v_row.username,
    'email', case when v_row.username is null then v_row.email end,
    'job_title', v_row.job_title, 'department', v_row.department, 'office', v_row.office,
    'phone', v_row.phone, 'staff_no', v_row.staff_no,
    'is_it', v_row.is_it, 'status', v_row.status, 'created_at', v_row.created_at,
    'pw_changed_at', v_row.pw_changed_at,
    'spaces', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', s.id, 'name', s.name, 'active', s.active,
               'role', case when core.is_space_admin(p_user, s.id) then 'admin' else 'member' end) order by s.name)
        from core.spaces s
       where core.is_space_admin(p_user, s.id)
          or exists (select 1 from core.space_members m where m.space = s.id and m.user_id = p_user)), '[]'::jsonb),
    'tools', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('space', t.space, 'space_name', s.name, 'tool', t.id, 'name', t.name,
               'level', core.named_tool_level(p_user, t.space, t.id),
               'manager', exists (select 1 from core.tool_managers m where m.space = t.space and m.tool = t.id and m.user_id = p_user))
             order by s.name, t.name)
        from core.tools t join core.spaces s on s.id = t.space
       where core.named_tool_level(p_user, t.space, t.id) is not null), '[]'::jsonb),
    'sign_ins', coalesce((
      select pg_catalog.jsonb_agg(x.at order by x.id desc)
        from (select a.id, a.at from core.audit a
               where a.actor = p_user and a.action = 'user.signed_in' order by a.id desc limit 10) x), '[]'::jsonb));
  if p_full then
    v_card := v_card || pg_catalog.jsonb_build_object(
      'decided_at', v_row.decided_at,
      'must_change', v_row.must_change,
      'temp_set_at', v_row.temp_set_at,
      'temp_expired', v_row.must_change and v_row.temp_set_at is not null
                      and v_row.temp_set_at < pg_catalog.now() - pg_catalog.make_interval(days => core.temp_days()));
  end if;
  return v_card;
end $$;

-- The spaces the caller may open: as admin (an IT admin: all), as member, or through a tool.
create or replace function public.dame_spaces_list() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_user();
begin
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', s.id, 'name', s.name, 'description', s.description,
             'icon', s.icon, 'colour', s.colour, 'active', s.active,
             'is_admin', core.can_admin_space(v_uid, s.id)) order by s.name)
      from core.spaces s
     where core.can_admin_space(v_uid, s.id)
        or (s.active and (
              exists (select 1 from core.space_members m where m.space = s.id and m.user_id = v_uid)
           or exists (select 1 from core.tool_managers m where m.space = s.id and m.user_id = v_uid)
           or exists (select 1 from core.tool_access a where a.space = s.id and a.user_id = v_uid)))
  ), '[]'::jsonb);
end $$;

-- The space and the tools the caller may open, with his level on each.
create or replace function public.dame_space_get(p_space text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := core.require_user();
  v_space core.spaces;
  v_admin boolean;
  v_tools jsonb;
begin
  select * into v_space from core.spaces s where s.id = p_space;
  v_admin := v_space.id is not null and core.can_admin_space(v_uid, p_space);
  if v_space.id is not null and (v_admin or v_space.active) then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', t.id, 'name', t.name, 'description', t.description, 'icon', t.icon, 'colour', t.colour,
             'active', t.active, 'level', core.tool_level(v_uid, t.space, t.id),
             'is_manager', v_admin or exists (select 1 from core.tool_managers g
                                              where g.space = t.space and g.tool = t.id and g.user_id = v_uid))
           order by t.name), '[]'::jsonb)
      into v_tools
      from core.tools t
     where t.space = p_space and core.tool_level(v_uid, t.space, t.id) is not null;
  end if;
  if v_space.id is null
     or not (v_admin
             or (v_space.active and (pg_catalog.jsonb_array_length(v_tools) > 0
                 or exists (select 1 from core.space_members m where m.space = p_space and m.user_id = v_uid)))) then
    perform core.fail('not_allowed', 'You do not have this space. Ask its admin.');
  end if;
  return pg_catalog.jsonb_build_object(
    'id', v_space.id, 'name', v_space.name, 'description', v_space.description,
    'active', v_space.active, 'is_admin', v_admin, 'tools', v_tools);
end $$;

-- The tool's managers and space admins: the tool, its managers and who has which level.
create or replace function public.dame_tool_admin_get(p_space text, p_tool text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_tool_manager(p_space, p_tool);
begin
  return (
    select pg_catalog.jsonb_build_object(
      'space', t.space, 'space_name', s.name, 'id', t.id, 'name', t.name, 'description', t.description,
      'icon', t.icon, 'colour', t.colour, 'active', t.active, 'space_active', s.active,
      'open_to_space', t.open_to_space, 'open_level', t.open_level,
      'is_space_admin', core.can_admin_space(v_uid, t.space),
      'managers', coalesce((select pg_catalog.jsonb_agg(core.person_json(g.user_id) order by g.added_at)
                              from core.tool_managers g where g.space = t.space and g.tool = t.id), '[]'::jsonb),
      'access', coalesce((select pg_catalog.jsonb_agg(core.person_json(x.user_id) || pg_catalog.jsonb_build_object('level', x.level)
                                                       order by x.added_at)
                            from core.tool_access x where x.space = t.space and x.tool = t.id), '[]'::jsonb))
      from core.tools t join core.spaces s on s.id = t.space
     where t.space = p_space and t.id = p_tool);
end $$;

-- Opens a tool: everyone with at least "read" gets the live version; managers may ask for the preview.
create or replace function public.dame_tool_open(p_space text, p_tool text, p_preview boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid;
  v_tool    core.tools;
  v_manager boolean;
  v_version integer;
begin
  if coalesce(p_preview, false) then
    v_uid := core.require_tool_manager(p_space, p_tool);
  else
    v_uid := core.require_tool(p_space, p_tool, 'read');
  end if;
  select * into v_tool from core.tools t where t.space = p_space and t.id = p_tool;
  v_manager := core.is_tool_manager(v_uid, p_space, p_tool);
  v_version := case when coalesce(p_preview, false) then v_tool.preview_version else v_tool.live_version end;
  if v_version is null then
    perform core.fail('not_live',
      case when coalesce(p_preview, false) then 'There is no preview. Upload a version on the tool''s admin page.'
           when v_manager then 'Nothing is live yet. Upload a version on the tool''s admin page, try the preview, then press Make live.'
           else 'This tool is not published yet. Ask its manager.' end, 400);
  end if;
  -- An IT admin may open every tool; where he is not named, the audit says so.
  if core.is_it(v_uid) and core.named_tool_level(v_uid, p_space, p_tool) is null then
    perform core.audit_add(v_uid, 'it.tool_opened', null,
      pg_catalog.jsonb_build_object('version', v_version, 'preview', coalesce(p_preview, false)), p_space, p_tool);
  end if;
  return (
    select pg_catalog.jsonb_build_object(
      'space', v_tool.space, 'tool', v_tool.id, 'name', v_tool.name, 'icon', v_tool.icon, 'colour', v_tool.colour,
      'space_name', (select s.name from core.spaces s where s.id = v_tool.space),
      'version', v.version, 'preview', coalesce(p_preview, false), 'is_manager', v_manager,
      'level', core.tool_level(v_uid, p_space, p_tool),
      'me', (select pg_catalog.jsonb_build_object('id', p.id, 'name', p.name) from core.profiles p where p.id = v_uid),
      'files', v.files)
      from core.tool_versions v
     where v.space = p_space and v.tool = p_tool and v.version = v_version and v.state = 'ready');
end $$;

-- Only an admin of the space asks (IT sets limits directly, it does not ask itself).
create or replace function public.dame_quota_request(p_space text, p_rows bigint, p_tables integer, p_columns integer, p_reason text,
                                          p_tools integer default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := core.require_space(p_space, 'admin');
  l        record := core.quota_limits(p_space);
  v_tools  integer := coalesce(p_tools, l.max_tools);
  v_reason text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_reason, ''), '[[:cntrl:]]+', ' ', 'g'));
begin
  if not core.is_space_admin(v_uid, p_space) then
    perform core.fail('not_allowed', 'You are an IT admin: change this space''s limits yourself on IT admin > Quotas.');
  end if;
  perform core.quota_number(p_rows, 100, 10000000, 'Rows in the space');
  perform core.quota_number(p_tables, 1, 100, 'Tables in a tool');
  perform core.quota_number(p_columns, 1, 200, 'Columns in a table');
  perform core.quota_number(v_tools, 1, 200, 'Tools in the space');
  if p_rows < l.max_rows or p_tables < l.max_tables or p_columns < l.max_columns or v_tools < l.max_tools then
    perform core.fail('bad_request', 'A request asks for more, not less. Leave a number as it is if you do not need more of it.', 400);
  end if;
  if p_rows = l.max_rows and p_tables = l.max_tables and p_columns = l.max_columns and v_tools = l.max_tools then
    perform core.fail('bad_request', 'These are the limits the space already has. Raise the number you need more of.', 400);
  end if;
  if pg_catalog.length(v_reason) not between 10 and 500 then
    perform core.fail('bad_request', 'Say in a sentence why the space needs more (10 to 500 characters). IT decides from it.', 400);
  end if;
  perform 1 from core.spaces s where s.id = p_space for update;
  if exists (select 1 from core.quota_requests r where r.space = p_space and r.status = 'open') then
    perform core.fail('bad_request', 'A request of this space is already waiting for IT. Take it back first if you want to change it.', 400);
  end if;
  insert into core.quota_requests (space, asked_by, want_rows, want_tables, want_columns, want_tools, reason)
  values (p_space, v_uid, p_rows, p_tables, p_columns, v_tools, v_reason);
  perform core.audit_add(v_uid, 'quota.requested', null,
    pg_catalog.jsonb_build_object('rows', p_rows, 'tables', p_tables, 'columns', p_columns, 'tools', v_tools, 'reason', v_reason), p_space);
end $$;

-- A space admin takes his open request back.
create or replace function public.dame_quota_request_cancel(p_space text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_space(p_space, 'admin');
  v_id  bigint;
begin
  if not core.is_space_admin(v_uid, p_space) then
    perform core.fail('not_allowed', 'You are an IT admin: answer the request on IT admin > Quotas.');
  end if;
  update core.quota_requests set status = 'taken_back', answered_at = pg_catalog.now(), answered_by = v_uid
   where space = p_space and status = 'open' returning id into v_id;
  if v_id is null then
    perform core.fail('bad_request', 'No request of this space is waiting. Reload the page.', 400);
  end if;
  perform core.audit_add(v_uid, 'quota.request_taken_back', null, '{}'::jsonb, p_space);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Removing a column (no harm if the delivery before already added it)
-- ---------------------------------------------------------------------------

-- Removes one column of a table (live and preview copy) and what was saved in it.
create or replace function public.dame_table_drop_column(p_space text, p_tool text, p_table text, p_column text, p_confirm text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := core.require_tool_manager(p_space, p_tool);
  v_def    core.tool_tables;
  v_col    jsonb;
  v_filled bigint;
  s        text;
begin
  perform 1 from core.tools t where t.space = p_space and t.id = p_tool for update;
  v_def := core.table_def(p_space, p_tool, p_table);
  if core.is_standard_column(p_column) then
    perform core.fail('bad_request', 'The five columns the site fills by itself (id, owner, created_at, updated_at, updated_by) cannot be removed.', 400);
  end if;
  select c into v_col from pg_catalog.jsonb_array_elements(v_def.columns) c where c ->> 'name' = p_column;
  if v_col is null then
    perform core.fail('bad_request', 'The table ' || v_def.name || ' has no column named ' || coalesce(pg_catalog.left(p_column, 50), '(none)')
      || '. Its columns: ' || (select pg_catalog.string_agg(c ->> 'name', ', ') from pg_catalog.jsonb_array_elements(v_def.columns) c) || '.', 400);
  end if;
  if pg_catalog.jsonb_array_length(v_def.columns) <= 1 then
    perform core.fail('bad_request', 'A table keeps at least one column of its own. Add the new column first, then remove this one; or delete the whole table.', 400);
  end if;
  if p_confirm is distinct from (v_col ->> 'name') then
    perform core.fail('bad_request', 'To remove the column and everything saved in it, type its name exactly: ' || (v_col ->> 'name'), 400);
  end if;

  execute pg_catalog.format('select count(*) from %I.%I where %I is not null',
    core.tool_schema(p_space, p_tool, false), v_def.name, v_col ->> 'name') into v_filled;
  foreach s in array array[core.tool_schema(p_space, p_tool, false), core.tool_schema(p_space, p_tool, true)] loop
    execute pg_catalog.format('alter table %I.%I drop column %I', s, v_def.name, v_col ->> 'name');
  end loop;
  update core.tool_tables t
     set columns = (select pg_catalog.jsonb_agg(x.c order by x.o)
                      from pg_catalog.jsonb_array_elements(t.columns) with ordinality x (c, o)
                     where x.c ->> 'name' <> (v_col ->> 'name'))
   where t.space = p_space and t.tool = p_tool and t.name = v_def.name;
  perform core.audit_add(v_uid, 'table.column_removed', null,
    pg_catalog.jsonb_build_object('table', v_def.name, 'column', v_col ->> 'name', 'type', v_col ->> 'type', 'filled_rows', v_filled), p_space, p_tool);
end $$;

-- Rights: nobody by default, then signed-in people through the site.
revoke all on function public.dame_table_drop_column(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.dame_table_drop_column(text, text, text, text, text) to authenticated;

commit;

-- Must show no rows.
select * from core.security_check();

-- The question of db/check.sql: must say yes.
select case when t.fingerprint = '17d3d87c0485c507cd3f58c90b574625' then 'yes' else 'no' end as final_version,
       t.fingerprint, '17d3d87c0485c507cd3f58c90b574625' as expected, t.parts
  from (select pg_catalog.md5(pg_catalog.string_agg(x, '|' order by x)) as fingerprint, pg_catalog.count(*) as parts
          from (select 'f ' || n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' as x
                  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'core' or (n.nspname = 'public' and p.proname like 'dame\_%')
                union all
                select 'c ' || c.relname || '.' || a.attname || ' ' || pg_catalog.format_type(a.atttypid, a.atttypmod)
                  from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid
                  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'core' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
                union all
                select 's ' || s.key from core.settings s) parts) t;
