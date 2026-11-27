-- db/05_spaces_tools.sql - spaces and tools: create, change, on/off,
-- delete with cleanup; admins, members, managers, access; a tool's usage
-- guide; finding people; the audit of a space or a tool.
-- Serves: contracts 2 (Structure), 3 (Access) and 7 (Audit).
-- Must not change: Hub > Space > Tool, three levels. Ids are permanent and
-- never reused: a deleted space or tool leaves its id in core.retired_ids.
-- An admin acts only inside his own space.
-- How to run: as part of db/install.sql (psql), or pasted in number
-- order. Only into an empty database; see db/README.md.

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------

-- Checks what a person typed for a space or a tool. Returns nothing or refuses.
create function core.check_card(p_name text, p_description text, p_icon text, p_colour text) returns void
language plpgsql volatile set search_path = '' as $$
begin
  if pg_catalog.length(core.clean_text(p_name, 200)) not between 1 and 80 then
    perform core.fail('bad_request', 'Give it a name of 1 to 80 characters.', 400);
  end if;
  if pg_catalog.length(core.clean_text(p_description, 1000)) > 400 then
    perform core.fail('bad_request', 'The description may have 400 characters at most.', 400);
  end if;
  if pg_catalog.length(core.clean_text(p_icon, 100)) > 8 then
    perform core.fail('bad_request', 'The icon is one or two characters, or empty.', 400);
  end if;
  if coalesce(p_colour, '') <> '' and p_colour !~ '^#[0-9a-f]{6}$' then
    perform core.fail('bad_request', 'The colour must look like #0b63ce, or be empty.', 400);
  end if;
end $$;

-- A new space or tool id: right form, not in use, never used before.
create function core.check_new_id(p_kind text, p_space text, p_id text) returns void
language plpgsql volatile set search_path = '' as $$
begin
  if not core.id_ok(p_id) then
    perform core.fail('bad_request', 'The id needs 3 to 30 characters: small letters, digits and single dashes, like sales-team.', 400);
  end if;
  if (p_kind = 'space' and (exists (select 1 from core.spaces s where s.id = p_id)
        or exists (select 1 from core.retired_ids r where r.kind = 'space' and r.space = p_id)))
     or (p_kind = 'tool' and (exists (select 1 from core.tools t where t.space = p_space and t.id = p_id)
        or exists (select 1 from core.retired_ids r where r.kind = 'tool' and r.space = p_space and r.id = p_id))) then
    perform core.fail('bad_request', 'This id is taken or was used before. Ids are never reused: choose another.', 400);
  end if;
  -- A tool's database name is built from both ids and may have 63 characters.
  if p_kind = 'tool' and pg_catalog.length(p_space) + pg_catalog.length(p_id) > 59 then
    perform core.fail('bad_request', 'The space id and the tool id together are too long. Choose a shorter tool id.', 400);
  end if;
end $$;

-- Deletes a tool with everything it has: its two schemas (live and preview
-- tables), table list, versions, access, managers. Its id is retired for good
-- and the space's row count is taken again.
create function core.tool_remove(p_space text, p_tool text) returns void
language plpgsql volatile set search_path = '' as $$
begin
  execute pg_catalog.format('drop schema if exists %I cascade', core.tool_schema(p_space, p_tool, false));
  execute pg_catalog.format('drop schema if exists %I cascade', core.tool_schema(p_space, p_tool, true));
  delete from core.tool_tables where space = p_space and tool = p_tool;
  delete from core.tool_versions where space = p_space and tool = p_tool;
  delete from core.tool_access where space = p_space and tool = p_tool;
  delete from core.tool_managers where space = p_space and tool = p_tool;
  delete from core.tools where space = p_space and id = p_tool;
  insert into core.retired_ids (kind, space, id) values ('tool', p_space, p_tool);
  perform core.quota_recount(p_space);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Spaces: what a person sees
-- ---------------------------------------------------------------------------

-- The spaces the caller may open: as admin (an IT admin: all), as member, or through a tool.
create function public.dame_spaces_list() returns jsonb
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
create function public.dame_space_get(p_space text) returns jsonb
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

-- ---------------------------------------------------------------------------
-- 3. Spaces: IT admin
-- ---------------------------------------------------------------------------

-- IT admin: every space with its admins.
create function public.dame_spaces_all() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_it();
begin
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', s.id, 'name', s.name, 'description', s.description, 'active', s.active,
             'tools', (select count(*) from core.tools t where t.space = s.id),
             'members', (select count(*) from core.space_members m where m.space = s.id),
             'admins', coalesce((select pg_catalog.jsonb_agg(core.person_json(a.user_id) order by a.added_at)
                                   from core.space_admins a where a.space = s.id), '[]'::jsonb))
           order by s.name)
      from core.spaces s), '[]'::jsonb);
end $$;

-- IT admin: a new space with its first admin.
create function public.dame_space_create(p_id text, p_name text, p_description text, p_admin uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_it();
begin
  perform core.check_new_id('space', null, p_id);
  perform core.check_card(p_name, p_description, '', '');
  perform core.require_person(p_admin);
  insert into core.spaces (id, name, description, created_by)
  values (p_id, core.clean_text(p_name, 80), core.clean_text(p_description, 400), v_uid);
  insert into core.space_admins (space, user_id, added_by) values (p_id, p_admin, v_uid);
  perform core.audit_add(v_uid, 'space.created', p_admin::text,
                         pg_catalog.jsonb_build_object('name', core.clean_text(p_name, 80)), p_id);
end $$;

-- IT admin: switch a space on or off.
create function public.dame_space_set_active(p_space text, p_active boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_it();
  v_old boolean;
begin
  select s.active into v_old from core.spaces s where s.id = p_space for update;
  if v_old is null or p_active is null then
    perform core.fail('bad_request', 'This space was not found. Reload the page.', 400);
  end if;
  if v_old = p_active then
    return;
  end if;
  update core.spaces set active = p_active where id = p_space;
  perform core.audit_add(v_uid, case when p_active then 'space.switched_on' else 'space.switched_off' end, null, '{}'::jsonb, p_space);
end $$;

-- p_confirm must be the id of the space, typed by the IT admin.
create function public.dame_space_delete(p_space text, p_confirm text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := core.require_it();
  v_name  text;
  v_tools integer := 0;
  t       record;
begin
  select s.name into v_name from core.spaces s where s.id = p_space for update;
  if v_name is null then
    perform core.fail('bad_request', 'This space was not found. Reload the page.', 400);
  end if;
  if p_confirm is distinct from p_space then
    perform core.fail('bad_request', 'To delete, type the id of the space exactly: ' || p_space, 400);
  end if;
  for t in select id from core.tools where space = p_space loop
    perform core.tool_remove(p_space, t.id);
    v_tools := v_tools + 1;
  end loop;
  delete from core.space_members where space = p_space;
  delete from core.space_admins where space = p_space;
  delete from core.spaces where id = p_space;
  insert into core.retired_ids (kind, space) values ('space', p_space);
  perform core.audit_add(v_uid, 'space.deleted', null,
                         pg_catalog.jsonb_build_object('name', v_name, 'tools', v_tools), p_space);
end $$;

-- ---------------------------------------------------------------------------
-- 4. A space: its admins (and IT for the admins)
-- ---------------------------------------------------------------------------

-- Everything the space admin page shows.
create function public.dame_space_admin_get(p_space text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_space(p_space, 'admin');
begin
  return (
    select pg_catalog.jsonb_build_object(
      'id', s.id, 'name', s.name, 'description', s.description, 'active', s.active, 'me', v_uid,
      'admins', coalesce((select pg_catalog.jsonb_agg(core.person_json(a.user_id) order by a.added_at)
                            from core.space_admins a where a.space = s.id), '[]'::jsonb),
      'members', coalesce((select pg_catalog.jsonb_agg(core.person_json(m.user_id) order by m.added_at)
                             from core.space_members m where m.space = s.id), '[]'::jsonb),
      'tools', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                             'id', t.id, 'name', t.name, 'description', t.description, 'icon', t.icon,
                             'colour', t.colour, 'active', t.active,
                             'open_to_space', t.open_to_space, 'open_level', t.open_level,
                             'managers', coalesce((select pg_catalog.jsonb_agg(core.person_json(g.user_id) order by g.added_at)
                                                     from core.tool_managers g where g.space = t.space and g.tool = t.id), '[]'::jsonb),
                             'people', (select count(*) from core.tool_access x where x.space = t.space and x.tool = t.id))
                           order by t.name)
                           from core.tools t where t.space = s.id), '[]'::jsonb))
      from core.spaces s where s.id = p_space);
end $$;

-- Name and description of a space. An admin of that space, or an IT admin.
create function public.dame_space_update(p_space text, p_name text, p_description text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_space_or_it(p_space);
begin
  perform core.check_card(p_name, p_description, '', '');
  update core.spaces set name = core.clean_text(p_name, 80), description = core.clean_text(p_description, 400)
   where id = p_space;
  perform core.audit_add(v_uid, 'space.changed', null,
                         pg_catalog.jsonb_build_object('name', core.clean_text(p_name, 80)), p_space);
end $$;

-- Adds an admin to a space. An admin of that space, or an IT admin.
create function public.dame_space_admin_add(p_space text, p_user uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := core.require_space_or_it(p_space);
  v_added integer;
begin
  perform core.require_person(p_user);
  insert into core.space_admins (space, user_id, added_by) values (p_space, p_user, v_uid)
  on conflict do nothing;
  get diagnostics v_added = row_count;
  if v_added > 0 then
    perform core.audit_add(v_uid, 'space.admin_added', p_user::text, '{}'::jsonb, p_space);
  end if;
end $$;

-- Takes an admin away. A space always keeps at least one approved admin.
create function public.dame_space_admin_remove(p_space text, p_user uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := core.require_space_or_it(p_space);
  v_removed integer;
begin
  perform 1 from core.spaces s where s.id = p_space for update;
  if not exists (select 1 from core.space_admins a
                  join core.profiles p on p.id = a.user_id and p.status = 'active'
                 where a.space = p_space and a.user_id <> p_user) then
    perform core.fail('bad_request', 'A space always has at least one admin. Name another admin first.', 400);
  end if;
  delete from core.space_admins where space = p_space and user_id = p_user;
  get diagnostics v_removed = row_count;
  if v_removed > 0 then
    perform core.audit_add(v_uid, 'space.admin_removed', p_user::text, '{}'::jsonb, p_space);
  end if;
end $$;

-- Adds a member to a space. Its admins only.
create function public.dame_space_member_add(p_space text, p_user uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := core.require_space(p_space, 'admin');
  v_added integer;
begin
  perform core.require_person(p_user);
  insert into core.space_members (space, user_id, added_by) values (p_space, p_user, v_uid)
  on conflict do nothing;
  get diagnostics v_added = row_count;
  if v_added > 0 then
    perform core.audit_add(v_uid, 'space.member_added', p_user::text, '{}'::jsonb, p_space);
  end if;
end $$;

-- Takes a member away. Its admins only.
create function public.dame_space_member_remove(p_space text, p_user uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := core.require_space(p_space, 'admin');
  v_removed integer;
begin
  delete from core.space_members where space = p_space and user_id = p_user;
  get diagnostics v_removed = row_count;
  if v_removed > 0 then
    perform core.audit_add(v_uid, 'space.member_removed', p_user::text, '{}'::jsonb, p_space);
  end if;
end $$;

-- The icon and colour of a space's tile, for its admin page.
create function public.dame_space_look_get(p_space text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_space_or_it(p_space);
begin
  return (select pg_catalog.jsonb_build_object('icon', s.icon, 'colour', s.colour) from core.spaces s where s.id = p_space);
end $$;

-- Changes the icon and colour of a space's tile. An admin of that space, or an IT admin.
create function public.dame_space_look_set(p_space text, p_icon text, p_colour text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_space_or_it(p_space);
begin
  perform core.check_card('x', '', p_icon, p_colour);
  update core.spaces set icon = core.clean_text(p_icon, 8), colour = coalesce(p_colour, '') where id = p_space;
  perform core.audit_add(v_uid, 'space.changed', null,
                         pg_catalog.jsonb_build_object('name', 'icon and colour'), p_space);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Tools
-- ---------------------------------------------------------------------------

-- A space admin makes a tool, within the space's limit on tools (quotas).
-- A space that already has more tools than its limit keeps them; it adds none.
create function public.dame_tool_create(p_space text, p_id text, p_name text, p_description text,
                                        p_icon text, p_colour text,
                                        p_open_to_space boolean, p_open_level text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_space(p_space, 'admin');
  v_max integer := (core.quota_limits(p_space)).max_tools;
begin
  perform core.check_new_id('tool', p_space, p_id);
  perform core.check_card(p_name, p_description, p_icon, p_colour);
  if core.level_rank(coalesce(p_open_level, 'read')) is null then
    perform core.fail('bad_request', 'Unknown level.', 400);
  end if;
  -- One at a time per space, so two admins adding at once cannot both take the last free place.
  perform 1 from core.spaces s where s.id = p_space for update;
  if (select count(*) from core.tools t where t.space = p_space) >= v_max then
    perform core.fail('quota_full', 'This space has ' || v_max || ' tools, the limit IT set for it. '
      || 'Delete a tool that is not needed, or ask IT for more on the Quota part of this page.', 400);
  end if;
  insert into core.tools (space, id, name, description, icon, colour, open_to_space, open_level, created_by)
  values (p_space, p_id, core.clean_text(p_name, 80), core.clean_text(p_description, 400),
          core.clean_text(p_icon, 8), coalesce(p_colour, ''),
          coalesce(p_open_to_space, false), coalesce(p_open_level, 'read'), v_uid);
  perform core.audit_add(v_uid, 'tool.created', null,
                         pg_catalog.jsonb_build_object('name', core.clean_text(p_name, 80)), p_space, p_id);
end $$;

-- Space admins: name, description, icon, colour of a tool, and whether every member of the space may open it (and at which level).
create function public.dame_tool_update(p_space text, p_tool text, p_name text, p_description text,
                                        p_icon text, p_colour text,
                                        p_open_to_space boolean, p_open_level text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_tool_of_space(p_space, p_tool);
begin
  perform core.check_card(p_name, p_description, p_icon, p_colour);
  if core.level_rank(coalesce(p_open_level, 'read')) is null then
    perform core.fail('bad_request', 'Unknown level.', 400);
  end if;
  update core.tools
     set name = core.clean_text(p_name, 80), description = core.clean_text(p_description, 400),
         icon = core.clean_text(p_icon, 8), colour = coalesce(p_colour, ''),
         open_to_space = coalesce(p_open_to_space, false), open_level = coalesce(p_open_level, 'read')
   where space = p_space and id = p_tool;
  perform core.audit_add(v_uid, 'tool.changed', null,
    pg_catalog.jsonb_build_object('name', core.clean_text(p_name, 80),
      'open', case when coalesce(p_open_to_space, false) then coalesce(p_open_level, 'read') else 'no' end),
    p_space, p_tool);
end $$;

-- Space admins: switch a tool on or off.
create function public.dame_tool_set_active(p_space text, p_tool text, p_active boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_tool_of_space(p_space, p_tool);
  v_old boolean;
begin
  if p_active is null then
    perform core.fail('bad_request', 'Choose on or off.', 400);
  end if;
  select t.active into v_old from core.tools t where t.space = p_space and t.id = p_tool for update;
  if v_old = p_active then
    return;
  end if;
  update core.tools set active = p_active where space = p_space and id = p_tool;
  perform core.audit_add(v_uid, case when p_active then 'tool.switched_on' else 'tool.switched_off' end,
                         null, '{}'::jsonb, p_space, p_tool);
end $$;

-- p_confirm must be the id of the tool, typed by the admin.
create function public.dame_tool_delete(p_space text, p_tool text, p_confirm text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := core.require_tool_of_space(p_space, p_tool);
  v_name text;
begin
  select t.name into v_name from core.tools t where t.space = p_space and t.id = p_tool for update;
  if p_confirm is distinct from p_tool then
    perform core.fail('bad_request', 'To delete, type the id of the tool exactly: ' || p_tool, 400);
  end if;
  perform core.tool_remove(p_space, p_tool);
  perform core.audit_add(v_uid, 'tool.deleted', null, pg_catalog.jsonb_build_object('name', v_name), p_space, p_tool);
end $$;

-- Adds a manager to a tool. Space admins only.
create function public.dame_tool_manager_add(p_space text, p_tool text, p_user uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := core.require_tool_of_space(p_space, p_tool);
  v_added integer;
begin
  perform core.require_person(p_user);
  insert into core.tool_managers (space, tool, user_id, added_by) values (p_space, p_tool, p_user, v_uid)
  on conflict do nothing;
  get diagnostics v_added = row_count;
  if v_added > 0 then
    perform core.audit_add(v_uid, 'tool.manager_added', p_user::text, '{}'::jsonb, p_space, p_tool);
  end if;
end $$;

-- Takes a manager away. Space admins only.
create function public.dame_tool_manager_remove(p_space text, p_tool text, p_user uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := core.require_tool_of_space(p_space, p_tool);
  v_removed integer;
begin
  delete from core.tool_managers where space = p_space and tool = p_tool and user_id = p_user;
  get diagnostics v_removed = row_count;
  if v_removed > 0 then
    perform core.audit_add(v_uid, 'tool.manager_removed', p_user::text, '{}'::jsonb, p_space, p_tool);
  end if;
end $$;

-- p_level null takes the access away.
create function public.dame_tool_access_set(p_space text, p_tool text, p_user uuid, p_level text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_tool_manager(p_space, p_tool);
  v_old text;
begin
  select a.level into v_old from core.tool_access a
   where a.space = p_space and a.tool = p_tool and a.user_id = p_user for update;
  if p_level is null then
    if v_old is null then
      return;
    end if;
    delete from core.tool_access where space = p_space and tool = p_tool and user_id = p_user;
    perform core.audit_add(v_uid, 'tool.access_removed', p_user::text,
                           pg_catalog.jsonb_build_object('from', v_old, 'to', 'none'), p_space, p_tool);
    return;
  end if;
  if core.level_rank(p_level) is null then
    perform core.fail('bad_request', 'Unknown level.', 400);
  end if;
  perform core.require_person(p_user);
  if v_old is not distinct from p_level then
    return;
  end if;
  insert into core.tool_access (space, tool, user_id, level, added_by) values (p_space, p_tool, p_user, p_level, v_uid)
  on conflict (space, tool, user_id) do update set level = excluded.level, added_by = excluded.added_by, added_at = pg_catalog.now();
  perform core.audit_add(v_uid, 'tool.access_set', p_user::text,
                         pg_catalog.jsonb_build_object('from', coalesce(v_old, 'none'), 'to', p_level), p_space, p_tool);
end $$;

-- The tool's managers and space admins: the tool, its managers and who has which level.
create function public.dame_tool_admin_get(p_space text, p_tool text) returns jsonb
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

-- The guide of a tool, for everyone who has the tool (a manager also before it is live).
-- With it: whether the tool is live and whether it keeps data, so the page can say so.
create function public.dame_tool_help_get(p_space text, p_tool text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := core.require_tool(p_space, p_tool, 'read');
  v_tool core.tools;
begin
  select * into v_tool from core.tools t where t.space = p_space and t.id = p_tool;
  return pg_catalog.jsonb_build_object(
    'name', v_tool.name,
    'description', v_tool.description,
    'text', v_tool.help_text,
    'by', (select p.name from core.profiles p where p.id = v_tool.help_by),
    'at', v_tool.help_at,
    'live', v_tool.live_version is not null,
    'level', core.tool_level(v_uid, p_space, p_tool),
    'tables', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', tt.name, 'sharing', tt.sharing) order by tt.name)
                          from core.tool_tables tt where tt.space = p_space and tt.tool = p_tool), '[]'::jsonb));
end $$;

-- Writes the guide. An empty text brings back the guide the site writes by itself.
create function public.dame_tool_help_set(p_space text, p_tool text, p_text text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := core.require_tool_manager(p_space, p_tool);
  v_text text := pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.replace(coalesce(p_text, ''), E'\r', ''), '[\x01-\x09\x0B-\x1F\x7F]', '', 'g'));
begin
  if pg_catalog.char_length(v_text) > 4000 then
    perform core.fail('bad_request', 'The guide is too long. Keep it under 4000 characters.', 400);
  end if;
  update core.tools set help_text = v_text, help_by = v_uid, help_at = pg_catalog.now()
   where space = p_space and id = p_tool;
  perform core.audit_add(v_uid, 'tool.help_set', null,
    pg_catalog.jsonb_build_object('characters', pg_catalog.char_length(v_text)), p_space, p_tool);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Finding people, and the audit of a space or a tool
-- ---------------------------------------------------------------------------

-- Find an approved person by name or email, to give him a role or access.
-- Only for people who can give something: IT admins, space admins, tool managers.
create function public.dame_people_find(p_query text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_user();
  v_q   text := core.clean_text(p_query, 80);
begin
  if not (core.is_it(v_uid)
          or exists (select 1 from core.space_admins a where a.user_id = v_uid)
          or exists (select 1 from core.tool_managers g where g.user_id = v_uid)) then
    perform core.fail('not_allowed', 'Only admins and tool managers can look people up.');
  end if;
  if pg_catalog.length(v_q) < 2 then
    perform core.fail('bad_request', 'Type at least 2 letters of the name or email.', 400);
  end if;
  v_q := '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', u.id, 'name', u.name, 'email', u.email) order by u.name)
      from (select p.id, p.name, p.email from core.profiles p
             where p.status = 'active' and (p.name ilike v_q or p.email ilike v_q)
             order by p.name limit 20) u), '[]'::jsonb);
end $$;

-- Space admin: his space. With p_tool: that tool, for its managers too.
create function public.dame_audit_scope_list(p_space text, p_tool text default null,
                                             p_limit integer default 100, p_before bigint default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := case when p_tool is null then core.require_space(p_space, 'admin')
                     else core.require_tool_manager(p_space, p_tool) end;
begin
  if p_space is null then
    perform core.fail('bad_request', 'Name the space.', 400);
  end if;
  return core.audit_json(p_limit, p_before, p_space, p_tool);
end $$;

-- ---------------------------------------------------------------------------
-- Shortcuts: the tools a person pinned to his hub
-- ---------------------------------------------------------------------------
-- SHORTCUTS-BEGIN
-- The caller's shortcuts, oldest first. A tool he can no longer open is left out.
create function public.dame_shortcuts_list() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_user();
begin
  return (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'space', t.space, 'space_name', sp.name, 'id', t.id, 'name', t.name,
            'icon', t.icon, 'colour', t.colour) order by s.added_at, t.name), '[]'::jsonb)
            from core.shortcuts s
            join core.tools t on t.space = s.space and t.id = s.tool
            join core.spaces sp on sp.id = t.space
           where s.user_id = v_uid and core.tool_level(v_uid, t.space, t.id) is not null);
end $$;

-- Pins a tool to the caller's hub, or takes the pin away. Only a tool he can open; at most 12.
create function public.dame_shortcut_set(p_space text, p_tool text, p_on boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_user();
begin
  if p_on is null then
    perform core.fail('bad_request', 'Pin or unpin?', 400);
  end if;
  if not p_on then
    delete from core.shortcuts where user_id = v_uid and space = p_space and tool = p_tool;
    return pg_catalog.jsonb_build_object('on', false);
  end if;
  if not core.has_tool(v_uid, p_space, p_tool, 'read') then
    perform core.fail('not_allowed', 'You do not have this tool. Ask its manager.');
  end if;
  if (select count(*) from core.shortcuts s where s.user_id = v_uid) >= 12
     and not exists (select 1 from core.shortcuts s where s.user_id = v_uid and s.space = p_space and s.tool = p_tool) then
    perform core.fail('quota_full', 'You have 12 shortcuts. Take one away first.', 400);
  end if;
  insert into core.shortcuts (user_id, space, tool) values (v_uid, p_space, p_tool) on conflict do nothing;
  return pg_catalog.jsonb_build_object('on', true);
end $$;
-- SHORTCUTS-END
