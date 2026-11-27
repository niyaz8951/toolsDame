-- db/08_quotas.sql - how much of the database a space may use.
-- Four limits per space, set by IT:
--   rows    : rows in the whole space, all its tools, live and preview together
--   tools   : tools in the space
--   tables  : tables in one tool
--   columns : own columns in one table
-- Every space starts with the site's default (settings quota_rows 10,000,
-- quota_tools 10, quota_tables 10, quota_columns 60). IT changes the default or
-- gives one space its own limits. An admin of a space asks IT for more; IT
-- grants, changes or declines.
-- Serves: contracts 2 (Structure), 3 (Access), 5 (Data) and 7 (Audit).
-- Must not change: the limits are enforced in the database (dame_tool_create,
-- dame_table_*, dame_rows_add), the pages only show them. A full space still
-- reads, changes and deletes; only something new is refused. Nobody raises his
-- own limit: asking and deciding are two different roles.
-- How to run: as part of db/install.sql (psql), or pasted in number
-- order. Only into an empty database; see db/README.md.

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------

-- A whole number inside its bounds, or a refusal in plain words.
create function core.quota_number(p_value bigint, p_min bigint, p_max bigint, p_what text) returns bigint
language plpgsql immutable set search_path = '' as $$
begin
  if p_value is null or p_value < p_min or p_value > p_max then
    perform core.fail('bad_request', p_what || ' must be a whole number from ' || p_min || ' to ' || p_max || '.', 400);
  end if;
  return p_value;
end $$;

-- The limits that hold for a space right now: its own, else the site's default.
create function core.quota_limits(p_space text, out max_rows bigint, out max_tables integer, out max_columns integer,
                                  out own boolean, out max_tools integer) returns record
language plpgsql stable set search_path = '' as $$
declare
  q core.space_quotas;
begin
  select * into q from core.space_quotas x where x.space = p_space;
  max_rows := coalesce(q.max_rows, (select s.value::bigint from core.settings s where s.key = 'quota_rows'));
  max_tables := coalesce(q.max_tables, (select s.value::integer from core.settings s where s.key = 'quota_tables'));
  max_columns := coalesce(q.max_columns, (select s.value::integer from core.settings s where s.key = 'quota_columns'));
  max_tools := coalesce(q.max_tools, (select s.value::integer from core.settings s where s.key = 'quota_tools'));
  own := q.max_rows is not null or q.max_tables is not null or q.max_columns is not null or q.max_tools is not null;
end $$;

-- Counts the rows of a space again, table by table, and keeps the number.
create function core.quota_recount(p_space text) returns bigint
language plpgsql volatile set search_path = '' as $$
declare
  v_total bigint := 0;
  v_n     bigint;
  t       core.tool_tables;
  s       text;
begin
  if not exists (select 1 from core.spaces x where x.id = p_space) then
    return 0;
  end if;
  insert into core.space_quotas (space) values (p_space) on conflict (space) do nothing;
  perform 1 from core.space_quotas q where q.space = p_space for update;
  for t in select * from core.tool_tables x where x.space = p_space loop
    foreach s in array array[core.tool_schema(p_space, t.tool, false), core.tool_schema(p_space, t.tool, true)] loop
      execute pg_catalog.format('select count(*) from %I.%I', s, t.name) into v_n;
      v_total := v_total + v_n;
    end loop;
  end loop;
  update core.space_quotas set rows_used = v_total where space = p_space;
  return v_total;
end $$;

-- What a space uses and may use, as the pages show it.
create function core.quota_json(p_space text) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  l record := core.quota_limits(p_space);
  r core.quota_requests;
  v_open jsonb;
begin
  select * into r from core.quota_requests x where x.space = p_space and x.status = 'open';
  if r.id is not null then
    v_open := pg_catalog.jsonb_build_object('id', r.id, 'rows', r.want_rows, 'tables', r.want_tables, 'columns', r.want_columns,
                'tools', r.want_tools, 'reason', r.reason, 'asked_at', r.asked_at, 'asked_by', core.person_json(r.asked_by));
  end if;
  return pg_catalog.jsonb_build_object(
    'space', p_space,
    'rows_used', coalesce((select q.rows_used from core.space_quotas q where q.space = p_space), 0),
    'max_rows', l.max_rows, 'max_tables', l.max_tables, 'max_columns', l.max_columns, 'max_tools', l.max_tools, 'own', l.own,
    'tools_used', (select count(*) from core.tools t where t.space = p_space),
    'tables', (select count(*) from core.tool_tables t where t.space = p_space),
    'most_tables', coalesce((select max(n) from (select count(*) as n from core.tool_tables t where t.space = p_space group by t.tool) z), 0),
    'request', v_open);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Looking, setting, asking, answering
-- ---------------------------------------------------------------------------

-- An admin of the space, or IT: what the space uses, its limits, where the
-- rows are, the open request and the last answers. Counts the rows again.
create function public.dame_quota_get(p_space text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := core.require_space_or_it(p_space);
  v_tools jsonb := '[]'::jsonb;
  v_live  bigint;
  v_prev  bigint;
  v_n     bigint;
  t       record;
  x       core.tool_tables;
begin
  perform core.quota_recount(p_space);
  for t in select o.id, o.name from core.tools o where o.space = p_space order by o.name loop
    v_live := 0; v_prev := 0;
    for x in select * from core.tool_tables y where y.space = p_space and y.tool = t.id loop
      execute pg_catalog.format('select count(*) from %I.%I', core.tool_schema(p_space, t.id, false), x.name) into v_n;
      v_live := v_live + v_n;
      execute pg_catalog.format('select count(*) from %I.%I', core.tool_schema(p_space, t.id, true), x.name) into v_n;
      v_prev := v_prev + v_n;
    end loop;
    v_tools := v_tools || pg_catalog.jsonb_build_object('id', t.id, 'name', t.name, 'rows', v_live, 'preview_rows', v_prev,
      'tables', (select count(*) from core.tool_tables y where y.space = p_space and y.tool = t.id),
      'most_columns', coalesce((select max(pg_catalog.jsonb_array_length(y.columns)) from core.tool_tables y where y.space = p_space and y.tool = t.id), 0));
  end loop;
  return core.quota_json(p_space) || pg_catalog.jsonb_build_object(
    'tools', v_tools,
    'defaults', pg_catalog.jsonb_build_object(
      'rows', (select s.value::bigint from core.settings s where s.key = 'quota_rows'),
      'tables', (select s.value::integer from core.settings s where s.key = 'quota_tables'),
      'columns', (select s.value::integer from core.settings s where s.key = 'quota_columns'),
      'tools', (select s.value::integer from core.settings s where s.key = 'quota_tools')),
    'answers', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('status', r.status, 'rows', r.want_rows, 'tables', r.want_tables,
               'columns', r.want_columns, 'tools', r.want_tools, 'reason', r.reason, 'asked_at', r.asked_at, 'answer', r.answer, 'answered_at', r.answered_at,
               'answered_by', case when r.answered_by is null then null else core.person_json(r.answered_by) end) order by r.id desc)
        from (select * from core.quota_requests q where q.space = p_space and q.status in ('granted', 'declined')
               order by q.id desc limit 5) r), '[]'::jsonb));
end $$;

-- IT admin: every space with what it uses, its limits and its open request.
create function public.dame_quota_list() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_it();
begin
  return pg_catalog.jsonb_build_object(
    'defaults', pg_catalog.jsonb_build_object(
      'rows', (select s.value::bigint from core.settings s where s.key = 'quota_rows'),
      'tables', (select s.value::integer from core.settings s where s.key = 'quota_tables'),
      'columns', (select s.value::integer from core.settings s where s.key = 'quota_columns'),
      'tools', (select s.value::integer from core.settings s where s.key = 'quota_tools')),
    'spaces', coalesce((
      select pg_catalog.jsonb_agg(core.quota_json(s.id) || pg_catalog.jsonb_build_object('name', s.name, 'active', s.active) order by s.name)
        from core.spaces s), '[]'::jsonb));
end $$;

-- IT admin: the site's default, for every space without limits of its own.
-- p_tools may be left out: then the default for tools stays as it is.
create function public.dame_quota_default_set(p_rows bigint, p_tables integer, p_columns integer,
                                              p_tools integer default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := core.require_it();
  v_rows bigint := core.quota_number(p_rows, 100, 10000000, 'Rows in a space');
  v_tabs bigint := core.quota_number(p_tables, 1, 100, 'Tables in a tool');
  v_cols bigint := core.quota_number(p_columns, 1, 200, 'Columns in a table');
  v_tools bigint;
  v_old  text;
begin
  -- Tools left out (a page from before this file): the default for tools stays as it is.
  v_tools := core.quota_number(coalesce(p_tools, (select s.value::integer from core.settings s where s.key = 'quota_tools')), 1, 200, 'Tools in a space');
  select (select s.value from core.settings s where s.key = 'quota_rows') || ' / ' || (select s.value from core.settings s where s.key = 'quota_tables')
      || ' / ' || (select s.value from core.settings s where s.key = 'quota_columns') || ' / ' || (select s.value from core.settings s where s.key = 'quota_tools') into v_old;
  perform 1 from core.settings s where s.key like 'quota\_%' for update;
  update core.settings set value = v_rows::text, updated_at = pg_catalog.now(), updated_by = v_uid where key = 'quota_rows';
  update core.settings set value = v_tabs::text, updated_at = pg_catalog.now(), updated_by = v_uid where key = 'quota_tables';
  update core.settings set value = v_cols::text, updated_at = pg_catalog.now(), updated_by = v_uid where key = 'quota_columns';
  update core.settings set value = v_tools::text, updated_at = pg_catalog.now(), updated_by = v_uid where key = 'quota_tools';
  perform core.audit_add(v_uid, 'quota.default_set', null,
    pg_catalog.jsonb_build_object('from', v_old, 'to', v_rows || ' / ' || v_tabs || ' / ' || v_cols || ' / ' || v_tools, 'order', 'rows / tables a tool / columns a table / tools a space'));
end $$;

-- One space's own limits. All four empty = back to the site's default.
-- A limit below what the space already uses is allowed: nothing is deleted,
-- only new rows, tables or columns are refused until there is room again.
create function public.dame_quota_set(p_space text, p_rows bigint, p_tables integer, p_columns integer,
                                      p_tools integer default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_it();
  o     record;
  n     record;
begin
  if not exists (select 1 from core.spaces s where s.id = p_space) then
    perform core.fail('bad_request', 'This space was not found. Reload the page.', 400);
  end if;
  if p_rows is not null then perform core.quota_number(p_rows, 100, 10000000, 'Rows in the space'); end if;
  if p_tables is not null then perform core.quota_number(p_tables, 1, 100, 'Tables in a tool'); end if;
  if p_columns is not null then perform core.quota_number(p_columns, 1, 200, 'Columns in a table'); end if;
  if p_tools is not null then perform core.quota_number(p_tools, 1, 200, 'Tools in the space'); end if;
  o := core.quota_limits(p_space);
  insert into core.space_quotas (space) values (p_space) on conflict (space) do nothing;
  update core.space_quotas set max_rows = p_rows, max_tables = p_tables, max_columns = p_columns, max_tools = p_tools,
         set_at = pg_catalog.now(), set_by = v_uid where space = p_space;
  n := core.quota_limits(p_space);
  perform core.audit_add(v_uid, 'quota.set', null,
    pg_catalog.jsonb_build_object('from', o.max_rows || ' / ' || o.max_tables || ' / ' || o.max_columns || ' / ' || o.max_tools,
      'to', n.max_rows || ' / ' || n.max_tables || ' / ' || n.max_columns || ' / ' || n.max_tools,
      'kind', case when n.own then 'own limits' else 'site default' end), p_space);
end $$;

-- Only an admin of the space asks (IT sets limits directly, it does not ask itself).
create function public.dame_quota_request(p_space text, p_rows bigint, p_tables integer, p_columns integer, p_reason text,
                                          p_tools integer default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := core.require_space(p_space, 'admin');
  l        record := core.quota_limits(p_space);
  v_tools  integer := coalesce(p_tools, l.max_tools);
  v_reason text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_reason, ''), '[[:cntrl:]]+', ' ', 'g'));
begin
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
create function public.dame_quota_request_cancel(p_space text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_space(p_space, 'admin');
  v_id  bigint;
begin
  update core.quota_requests set status = 'taken_back', answered_at = pg_catalog.now(), answered_by = v_uid
   where space = p_space and status = 'open' returning id into v_id;
  if v_id is null then
    perform core.fail('bad_request', 'No request of this space is waiting. Reload the page.', 400);
  end if;
  perform core.audit_add(v_uid, 'quota.request_taken_back', null, '{}'::jsonb, p_space);
end $$;

-- IT answers. Granting sets the space's own limits to the numbers given here
-- (IT may give less or more than was asked); declining needs a sentence.
create function public.dame_quota_answer(p_request bigint, p_grant boolean, p_rows bigint, p_tables integer, p_columns integer,
                                         p_note text, p_tools integer default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := core.require_it();
  r      core.quota_requests;
  v_note text := pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]+', ' ', 'g')), 500);
begin
  select * into r from core.quota_requests x where x.id = p_request for update;
  if r.id is null or r.status <> 'open' then
    perform core.fail('bad_request', 'This request is not waiting any more. Reload the page.', 400);
  end if;
  if p_grant is null then
    perform core.fail('bad_request', 'Say whether the request is granted or declined.', 400);
  end if;
  if p_grant then
    perform core.quota_number(coalesce(p_rows, r.want_rows), 100, 10000000, 'Rows in the space');
    perform core.quota_number(coalesce(p_tables, r.want_tables), 1, 100, 'Tables in a tool');
    perform core.quota_number(coalesce(p_columns, r.want_columns), 1, 200, 'Columns in a table');
    perform core.quota_number(coalesce(p_tools, r.want_tools), 1, 200, 'Tools in the space');
    insert into core.space_quotas (space) values (r.space) on conflict (space) do nothing;
    update core.space_quotas set max_rows = coalesce(p_rows, r.want_rows), max_tables = coalesce(p_tables, r.want_tables),
           max_columns = coalesce(p_columns, r.want_columns), max_tools = coalesce(p_tools, r.want_tools), set_at = pg_catalog.now(), set_by = v_uid where space = r.space;
    update core.quota_requests set status = 'granted', answered_by = v_uid, answered_at = pg_catalog.now(), answer = nullif(v_note, '')
     where id = r.id;
    perform core.audit_add(v_uid, 'quota.granted', r.asked_by::text,
      pg_catalog.jsonb_build_object('asked', r.want_rows || ' / ' || r.want_tables || ' / ' || r.want_columns || ' / ' || r.want_tools,
        'given', coalesce(p_rows, r.want_rows) || ' / ' || coalesce(p_tables, r.want_tables) || ' / ' || coalesce(p_columns, r.want_columns) || ' / ' || coalesce(p_tools, r.want_tools)), r.space);
  else
    if pg_catalog.length(v_note) < 3 then
      perform core.fail('bad_request', 'Say in a few words why the request is declined. The admin of the space reads it.', 400);
    end if;
    update core.quota_requests set status = 'declined', answered_by = v_uid, answered_at = pg_catalog.now(), answer = v_note
     where id = r.id;
    perform core.audit_add(v_uid, 'quota.declined', r.asked_by::text,
      pg_catalog.jsonb_build_object('asked', r.want_rows || ' / ' || r.want_tables || ' / ' || r.want_columns || ' / ' || r.want_tools, 'why', v_note), r.space);
  end if;
end $$;
