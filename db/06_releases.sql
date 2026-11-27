-- db/06_releases.sql - a tool's versions and its files.
-- Upload > check > preview > make live > roll back; the private file store.
-- Serves: contract 6 (Releases: versions immutable) and SECURITY "Database"
-- (bucket tools private; the preview readable by managers only).
-- Must not change: a ready version is never changed (its file list and the
-- fingerprint of every file are fixed). Files are reached only through the
-- two policies below. There is no update and no delete policy: a stored file
-- is never changed or removed from the site.
-- SUPABASE: the bucket and the policies are on Supabase Storage (storage.*).
-- How to run: as part of db/install.sql (psql), or pasted in number
-- order. Only into an empty database; see db/README.md.

do $$
begin
  if pg_catalog.to_regclass('storage.buckets') is null or pg_catalog.to_regclass('storage.objects') is null then
    raise exception 'Supabase Storage (storage.buckets, storage.objects) was not found. See db/README.md.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The file store: one private bucket, two policies
-- ---------------------------------------------------------------------------

-- A page of a tool: small letters, digits, dot, dash, underscore, ending in .html
create function core.page_ok(p_name text) returns boolean
language sql immutable set search_path = '' as $$
  select p_name is not null and p_name ~ '^[a-z0-9][a-z0-9._-]{0,59}\.html$' and p_name !~ '\.\.';
$$;

-- May the caller read or write this file? The name is <space>/<tool>/<version>/<page>.
--   read : managers, any version; everyone else, the live version of a tool he has.
--   write: the manager who started this upload, while it is still uploading,
--          and only the pages he announced.
-- Used by the two policies on storage.objects below.
create function public.dame_file_allowed(p_name text, p_action text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid     uuid := core.peek_user();
  v_parts   text[];
  v_version integer;
  v_row     core.tool_versions;
  v_manager boolean;
begin
  if v_uid is null or p_name is null then
    return false;
  end if;
  v_parts := pg_catalog.string_to_array(p_name, '/');
  if pg_catalog.array_length(v_parts, 1) is distinct from 4
     or not core.id_ok(v_parts[1]) or not core.id_ok(v_parts[2])
     or v_parts[3] !~ '^[1-9][0-9]{0,8}$' or not core.page_ok(v_parts[4]) then
    return false;
  end if;
  v_version := v_parts[3]::integer;
  select * into v_row from core.tool_versions v
   where v.space = v_parts[1] and v.tool = v_parts[2] and v.version = v_version;
  if v_row.version is null or v_row.state = 'discarded'
     or not exists (select 1 from pg_catalog.jsonb_array_elements(v_row.files) f where f ->> 'name' = v_parts[4]) then
    return false;
  end if;
  v_manager := core.is_tool_manager(v_uid, v_parts[1], v_parts[2]);

  if p_action = 'read' then
    return v_manager
        or (v_row.state = 'ready'
            and exists (select 1 from core.tools t
                         where t.space = v_parts[1] and t.id = v_parts[2] and t.live_version = v_version)
            and core.has_tool(v_uid, v_parts[1], v_parts[2], 'read'));
  elsif p_action = 'write' then
    return v_manager and v_row.state = 'uploading' and v_row.created_by = v_uid;
  end if;
  return false;
exception when others then
  return false;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tools', 'tools', false, 20971520, array['text/html'])
on conflict (id) do update set public = false, file_size_limit = 20971520, allowed_mime_types = array['text/html'];

create policy dame_tools_read on storage.objects for select to authenticated
  using (bucket_id = 'tools' and public.dame_file_allowed(name, 'read'));

create policy dame_tools_write on storage.objects for insert to authenticated
  with check (bucket_id = 'tools' and public.dame_file_allowed(name, 'write'));

-- ---------------------------------------------------------------------------
-- 2. Versions: the tool's managers and the admins of its space
-- ---------------------------------------------------------------------------

-- Step 1 of an upload: announce the pages. Returns the new version number.
create function public.dame_version_begin(p_space text, p_tool text, p_files jsonb, p_note text) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := core.require_tool_manager(p_space, p_tool);
  v_total   bigint := 0;
  v_clean   jsonb := '[]'::jsonb;
  v_names   text[] := '{}';
  v_version integer;
  f         jsonb;
  v_size    bigint;
begin
  if p_files is null or pg_catalog.jsonb_typeof(p_files) <> 'array'
     or pg_catalog.jsonb_array_length(p_files) not between 1 and 50 then
    perform core.fail('bad_request', 'A version has 1 to 50 pages.', 400);
  end if;
  for f in select * from pg_catalog.jsonb_array_elements(p_files) loop
    if pg_catalog.jsonb_typeof(f) <> 'object' or not core.page_ok(f ->> 'name') then
      perform core.fail('bad_request', 'A page name uses small letters, digits, dot, dash or underscore and ends in .html.', 400);
    end if;
    if (f ->> 'name') = any (v_names) then
      perform core.fail('bad_request', 'Two pages have the same name: ' || (f ->> 'name'), 400);
    end if;
    if coalesce(f ->> 'sha256', '') !~ '^[0-9a-f]{64}$' or coalesce(f ->> 'size', '') !~ '^[0-9]{1,12}$' then
      perform core.fail('bad_request', 'The upload is not in the expected form. Reload the page and try again.', 400);
    end if;
    v_size := (f ->> 'size')::bigint;
    if v_size < 1 or v_size > 20971520 then
      perform core.fail('bad_request', 'The page ' || (f ->> 'name') || ' is larger than 20 MB.', 400);
    end if;
    v_total := v_total + v_size;
    v_names := v_names || (f ->> 'name');
    v_clean := v_clean || pg_catalog.jsonb_build_object('name', f ->> 'name', 'size', v_size, 'sha256', f ->> 'sha256');
  end loop;
  if not ('index.html' = any (v_names)) then
    perform core.fail('bad_request', 'A tool needs a page named index.html.', 400);
  end if;
  if v_total > 209715200 then
    perform core.fail('bad_request', 'The version is larger than 200 MB.', 400);
  end if;

  perform 1 from core.tools t where t.space = p_space and t.id = p_tool for update;
  -- An upload that was started and never finished is given up.
  update core.tool_versions set state = 'discarded'
   where space = p_space and tool = p_tool and state = 'uploading';
  select coalesce(max(v.version), 0) + 1 into v_version from core.tool_versions v
   where v.space = p_space and v.tool = p_tool;
  insert into core.tool_versions (space, tool, version, note, files, total_bytes, created_by)
  values (p_space, p_tool, v_version, core.clean_text(p_note, 200), v_clean, v_total, v_uid);
  return v_version;
end $$;

-- Step 3 of an upload (step 2 is sending the files): close the version. From
-- here on it can never change. It becomes the preview.
-- SUPABASE: checks the files in storage.objects.
create function public.dame_version_seal(p_space text, p_tool text, p_version integer) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := core.require_tool_manager(p_space, p_tool);
  v_row     core.tool_versions;
  v_missing text;
begin
  select * into v_row from core.tool_versions v
   where v.space = p_space and v.tool = p_tool and v.version = p_version for update;
  if v_row.version is null or v_row.state <> 'uploading' or v_row.created_by <> v_uid then
    perform core.fail('bad_request', 'This upload was not found or was replaced by a newer one. Upload again.', 400);
  end if;
  select pg_catalog.string_agg(f ->> 'name', ', ') into v_missing
    from pg_catalog.jsonb_array_elements(v_row.files) f
   where not exists (
     select 1 from storage.objects o
      where o.bucket_id = 'tools'
        and o.name = p_space || '/' || p_tool || '/' || p_version::text || '/' || (f ->> 'name')
        and coalesce(o.metadata ->> 'size', f ->> 'size') = (f ->> 'size'));
  if v_missing is not null then
    perform core.fail('bad_request', 'These pages did not arrive completely: ' || v_missing || '. Upload again.', 400);
  end if;
  update core.tool_versions set state = 'ready', sealed_at = pg_catalog.now()
   where space = p_space and tool = p_tool and version = p_version;
  update core.tools set preview_version = p_version where space = p_space and id = p_tool;
  perform core.audit_add(v_uid, 'version.uploaded', null,
    pg_catalog.jsonb_build_object('version', p_version, 'pages', pg_catalog.jsonb_array_length(v_row.files),
                                  'note', v_row.note), p_space, p_tool);
end $$;

-- Choose which ready version the managers preview. null = no preview.
create function public.dame_version_preview(p_space text, p_tool text, p_version integer) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_tool_manager(p_space, p_tool);
begin
  if p_version is not null and not exists (
       select 1 from core.tool_versions v
        where v.space = p_space and v.tool = p_tool and v.version = p_version and v.state = 'ready') then
    perform core.fail('bad_request', 'This version was not found. Reload the page.', 400);
  end if;
  update core.tools set preview_version = p_version where space = p_space and id = p_tool;
end $$;

-- Make a ready version the one everybody gets. An older number = roll back.
create function public.dame_version_make_live(p_space text, p_tool text, p_version integer) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_tool_manager(p_space, p_tool);
  v_old integer;
begin
  select t.live_version into v_old from core.tools t where t.space = p_space and t.id = p_tool for update;
  if p_version is null or not exists (
       select 1 from core.tool_versions v
        where v.space = p_space and v.tool = p_tool and v.version = p_version and v.state = 'ready') then
    perform core.fail('bad_request', 'This version was not found. Reload the page.', 400);
  end if;
  if v_old is not distinct from p_version then
    return;
  end if;
  update core.tools
     set live_version = p_version,
         preview_version = case when preview_version = p_version then null else preview_version end
   where space = p_space and id = p_tool;
  perform core.audit_add(v_uid,
    case when v_old is not null and p_version < v_old then 'version.rolled_back' else 'version.made_live' end,
    null, pg_catalog.jsonb_build_object('from', coalesce(v_old::text, 'none'), 'to', p_version::text), p_space, p_tool);
end $$;

-- The ready versions of a tool, newest first, with which is live and which is the preview.
create function public.dame_versions_list(p_space text, p_tool text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_tool_manager(p_space, p_tool);
begin
  return (
    select pg_catalog.jsonb_build_object(
      'live', t.live_version, 'preview', t.preview_version,
      'versions', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                 'version', v.version, 'note', v.note, 'pages', pg_catalog.jsonb_array_length(v.files),
                 'bytes', v.total_bytes, 'at', v.sealed_at,
                 'by', (select p.name from core.profiles p where p.id = v.created_by)) order by v.version desc)
          from core.tool_versions v
         where v.space = t.space and v.tool = t.id and v.state = 'ready'), '[]'::jsonb))
      from core.tools t where t.space = p_space and t.id = p_tool);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Opening a tool: everyone with at least "read"; the preview for managers
-- ---------------------------------------------------------------------------

-- Opens a tool: everyone with at least "read" gets the live version; managers may ask for the preview.
create function public.dame_tool_open(p_space text, p_tool text, p_preview boolean default false) returns jsonb
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
