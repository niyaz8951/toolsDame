-- db/core/006_help.sql - the usage guide of a tool: the text behind the
-- information button, written by the tool's manager for the people who use it.
-- Serves: "On every page" (info icon) and contract 3 (Access): everyone with
-- the tool reads the guide, only its managers and the space admins write it.
-- Must not change: once run, never edited; a fix is a new file. The guide is
-- plain text, at most 4000 characters, and is shown as text, never as HTML.
--
-- How to run: after 005. Paste the whole file into the Supabase SQL editor and
-- press Run. It finishes completely or changes nothing. The last result must
-- be an empty table.

begin;

do $$
begin
  if not exists (select 1 from core.settings s where s.key = 'signup_domains') then
    raise exception 'Run db/core/005_hardening.sql first.';
  end if;
  if exists (select 1 from pg_catalog.pg_attribute a
             where a.attrelid = 'core.tools'::regclass and a.attname = 'help_text' and not a.attisdropped) then
    raise exception '006 was already run. Do not run it twice.';
  end if;
end $$;

alter table core.tools add column help_text text not null default ''
  constraint tools_help_len check (pg_catalog.char_length(help_text) <= 4000);
alter table core.tools add column help_by uuid references core.profiles (id);
alter table core.tools add column help_at timestamptz;

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
