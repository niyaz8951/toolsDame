-- db/core/011_quotas.sql - quotas: how much of the database a space may use.
-- Three limits per space, set by IT:
--   rows    : rows in the whole space, all its tools, live and preview together
--   tables  : tables in one tool
--   columns : own columns in one table
-- Every space starts with the site's default (10,000 rows, 10 tables a tool,
-- 60 columns a table). IT changes the default or gives one space its own
-- limits. An admin of a space asks IT for more; IT grants, changes or declines.
-- Serves: contract 5 (Data), 3 (Access) and 7 (Audit); SECURITY "Database".
-- Must not change: once run, never edited; a fix is a new file. The limits are
-- enforced here, in the database: the pages only show them. A full space still
-- reads, changes and deletes; only a new row is refused. Nobody raises his own
-- limit: asking and deciding are two different roles.
--
-- How to run: after 010. Paste the whole file into the Supabase SQL editor and
-- press Run. It finishes completely or changes nothing. The last result must
-- be an empty table.

begin;

do $$
begin
  if pg_catalog.to_regprocedure('public.dame_account_get()') is null then
    raise exception 'Run db/core/010_accounts.sql first.';
  end if;
  if pg_catalog.to_regclass('core.space_quotas') is not null then
    raise exception '011 was already run. Do not run it twice.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. What is kept
-- ---------------------------------------------------------------------------

-- The site's defaults: what a space gets until IT gives it limits of its own.
insert into core.settings (key, value) values ('quota_rows', '10000'), ('quota_tables', '10'), ('quota_columns', '60');

-- One line per space. An empty limit means: the site's default.
-- rows_used is kept by the row service; core.quota_recount() counts it again.
create table core.space_quotas (
  space        text primary key references core.spaces (id) on delete cascade,
  max_rows     bigint  check (max_rows between 100 and 10000000),
  max_tables   integer check (max_tables between 1 and 100),
  max_columns  integer check (max_columns between 1 and 200),
  rows_used    bigint not null default 0 check (rows_used >= 0),
  set_at       timestamptz,
  set_by       uuid references core.profiles (id)
);
alter table core.space_quotas enable row level security;
alter table core.space_quotas force row level security;
revoke all on table core.space_quotas from public, anon, authenticated;

-- A space admin's request for more. One open request per space.
create table core.quota_requests (
  id            bigint generated always as identity primary key,
  space         text not null references core.spaces (id) on delete cascade,
  asked_by      uuid not null references core.profiles (id),
  asked_at      timestamptz not null default pg_catalog.now(),
  want_rows     bigint not null,
  want_tables   integer not null,
  want_columns  integer not null,
  reason        text not null,
  status        text not null default 'open' check (status in ('open', 'granted', 'declined', 'taken_back')),
  answered_by   uuid references core.profiles (id),
  answered_at   timestamptz,
  answer        text
);
create unique index quota_requests_one_open on core.quota_requests (space) where status = 'open';
alter table core.quota_requests enable row level security;
alter table core.quota_requests force row level security;
revoke all on table core.quota_requests from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Helpers
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
                                  out own boolean) returns record
language plpgsql stable set search_path = '' as $$
declare
  q core.space_quotas;
begin
  select * into q from core.space_quotas x where x.space = p_space;
  max_rows := coalesce(q.max_rows, (select s.value::bigint from core.settings s where s.key = 'quota_rows'));
  max_tables := coalesce(q.max_tables, (select s.value::integer from core.settings s where s.key = 'quota_tables'));
  max_columns := coalesce(q.max_columns, (select s.value::integer from core.settings s where s.key = 'quota_columns'));
  own := q.max_rows is not null or q.max_tables is not null or q.max_columns is not null;
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
                'reason', r.reason, 'asked_at', r.asked_at, 'asked_by', core.person_json(r.asked_by));
  end if;
  return pg_catalog.jsonb_build_object(
    'space', p_space,
    'rows_used', coalesce((select q.rows_used from core.space_quotas q where q.space = p_space), 0),
    'max_rows', l.max_rows, 'max_tables', l.max_tables, 'max_columns', l.max_columns, 'own', l.own,
    'tables', (select count(*) from core.tool_tables t where t.space = p_space),
    'most_tables', coalesce((select max(n) from (select count(*) as n from core.tool_tables t where t.space = p_space group by t.tool) z), 0),
    'request', v_open);
end $$;

-- ---------------------------------------------------------------------------
-- 3. The limits at work: the table maker and the row service
-- ---------------------------------------------------------------------------

-- Deleting a tool also deletes its tables; the space's row count follows.
create or replace function core.tool_remove(p_space text, p_tool text) returns void
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

-- As in 004, with the space's limits in place of the fixed 30 tables and 60 columns.
create or replace function public.dame_table_create(p_space text, p_tool text, p_name text, p_sharing text, p_columns jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := core.require_tool_manager(p_space, p_tool);
  l       record := core.quota_limits(p_space);
  v_clean jsonb := '[]'::jsonb;
  v_names text[] := '{}';
  c       jsonb;
begin
  if not core.name_ok(p_name) then
    perform core.fail('bad_request', 'A table name starts with a small letter and uses small letters, digits and underscore (2 to 41 characters), like bids or price_list.', 400);
  end if;
  if p_sharing is null or p_sharing not in ('private', 'team', 'reference') then
    perform core.fail('bad_request', 'Choose who shares the rows: private, team or reference.', 400);
  end if;
  if exists (select 1 from core.tool_tables t where t.space = p_space and t.tool = p_tool and t.name = p_name) then
    perform core.fail('bad_request', 'This tool already has a table named ' || p_name || '.', 400);
  end if;
  perform 1 from core.tools t where t.space = p_space and t.id = p_tool for update;
  if (select count(*) from core.tool_tables t where t.space = p_space and t.tool = p_tool) >= l.max_tables then
    perform core.fail('quota_full', 'This tool has ' || l.max_tables || ' tables, the limit IT set for this space. '
      || 'Delete a table you do not need, or ask the admin of the space to ask IT for more.', 400);
  end if;
  if p_columns is null or pg_catalog.jsonb_typeof(p_columns) <> 'array' or pg_catalog.jsonb_array_length(p_columns) < 1 then
    perform core.fail('bad_request', 'A table has at least one column of its own.', 400);
  end if;
  if pg_catalog.jsonb_array_length(p_columns) > l.max_columns then
    perform core.fail(case when l.max_columns = 60 then 'bad_request' else 'quota_full' end,
      'A table has ' || l.max_columns || ' columns of its own at most in this space. '
      || 'Use fewer columns, or ask the admin of the space to ask IT for more.', 400);
  end if;
  for c in select * from pg_catalog.jsonb_array_elements(p_columns) loop
    c := core.column_clean(c);
    if (c ->> 'name') = any (v_names) then
      perform core.fail('bad_request', 'Two columns are named ' || (c ->> 'name') || '.', 400);
    end if;
    v_names := v_names || (c ->> 'name');
    v_clean := v_clean || c;
  end loop;

  perform core.table_make(core.tool_schema(p_space, p_tool, false), p_name, v_clean);
  perform core.table_make(core.tool_schema(p_space, p_tool, true), p_name, v_clean);
  insert into core.tool_tables (space, tool, name, sharing, columns, created_by)
  values (p_space, p_tool, p_name, p_sharing, v_clean, v_uid);
  perform core.audit_add(v_uid, 'table.created', null,
    pg_catalog.jsonb_build_object('table', p_name, 'sharing', p_sharing, 'columns', pg_catalog.array_to_string(v_names, ', ')), p_space, p_tool);
end $$;

create or replace function public.dame_table_add_column(p_space text, p_tool text, p_table text, p_column jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_tool_manager(p_space, p_tool);
  l     record := core.quota_limits(p_space);
  v_def core.tool_tables;
  v_col jsonb;
  s     text;
begin
  perform 1 from core.tools t where t.space = p_space and t.id = p_tool for update;
  v_def := core.table_def(p_space, p_tool, p_table);
  v_col := core.column_clean(p_column);
  if core.column_sql(v_def.columns, v_col ->> 'name') is not null then
    perform core.fail('bad_request', 'This table already has a column named ' || (v_col ->> 'name') || '.', 400);
  end if;
  if pg_catalog.jsonb_array_length(v_def.columns) >= l.max_columns then
    perform core.fail('quota_full', 'This table has ' || l.max_columns || ' columns of its own, the limit IT set for this space. '
      || 'Ask the admin of the space to ask IT for more.', 400);
  end if;
  foreach s in array array[core.tool_schema(p_space, p_tool, false), core.tool_schema(p_space, p_tool, true)] loop
    execute pg_catalog.format('alter table %I.%I add column %I %s', s, v_def.name, v_col ->> 'name', core.type_sql(v_col ->> 'type'));
  end loop;
  update core.tool_tables set columns = columns || v_col where space = p_space and tool = p_tool and name = v_def.name;
  perform core.audit_add(v_uid, 'table.column_added', null,
    pg_catalog.jsonb_build_object('table', v_def.name, 'column', v_col ->> 'name', 'type', v_col ->> 'type'), p_space, p_tool);
end $$;

-- As in 004; the rows that went with the table are taken off the space's count.
create or replace function public.dame_table_drop(p_space text, p_tool text, p_table text, p_confirm text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := core.require_tool_manager(p_space, p_tool);
  v_def  core.tool_tables;
  v_rows bigint;
  s      text;
begin
  perform 1 from core.tools t where t.space = p_space and t.id = p_tool for update;
  v_def := core.table_def(p_space, p_tool, p_table);
  if p_confirm is distinct from v_def.name then
    perform core.fail('bad_request', 'To delete the table and all its rows, type its name exactly: ' || v_def.name, 400);
  end if;
  execute pg_catalog.format('select count(*) from %I.%I', core.tool_schema(p_space, p_tool, false), v_def.name) into v_rows;
  foreach s in array array[core.tool_schema(p_space, p_tool, false), core.tool_schema(p_space, p_tool, true)] loop
    execute pg_catalog.format('drop table %I.%I', s, v_def.name);
  end loop;
  delete from core.tool_tables where space = p_space and tool = p_tool and name = v_def.name;
  perform core.quota_recount(p_space);
  perform core.audit_add(v_uid, 'table.deleted', null,
    pg_catalog.jsonb_build_object('table', v_def.name, 'rows', v_rows), p_space, p_tool);
end $$;

-- As in 004; a new row is counted first, and refused when the space is full.
create or replace function public.dame_rows_add(p_space text, p_tool text, p_table text, p_row jsonb, p_preview boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  g      record := core.rows_gate(p_space, p_tool, p_preview);
  v_def  core.tool_tables := core.table_def(p_space, p_tool, p_table);
  v_max  bigint;
  v_used bigint;
  v_new  jsonb;
  v_row  jsonb;
begin
  if v_def.sharing = 'reference' and not g.manager then
    perform core.fail('not_allowed', 'Only the tool''s managers can change this table.');
  end if;
  if g.rank < 2 then
    perform core.fail('not_allowed', 'Your level on this tool lets you read, not add. Ask the tool''s manager for the level "contribute".');
  end if;
  v_new := core.row_clean(v_def.columns, p_row)
        || pg_catalog.jsonb_build_object('id', pg_catalog.gen_random_uuid(), 'owner', g.uid,
             'created_at', pg_catalog.now(), 'updated_at', pg_catalog.now(), 'updated_by', g.uid);

  -- One statement counts and checks, so two people adding at once cannot both take the last free row.
  v_max := (core.quota_limits(p_space)).max_rows;
  insert into core.space_quotas (space) values (p_space) on conflict (space) do nothing;
  update core.space_quotas q set rows_used = q.rows_used + 1
   where q.space = p_space and q.rows_used < v_max returning q.rows_used into v_used;
  if v_used is null then
    perform core.fail('quota_full', 'This cannot be saved: the space has reached its limit of ' || v_max || ' rows in the database. '
      || 'Nothing is lost. Tell the admin of the space: he can delete rows that are not needed, or ask IT for more.', 400);
  end if;

  execute pg_catalog.format(
    'insert into %1$I.%2$I as t select * from pg_catalog.jsonb_populate_record(null::%1$I.%2$I, $1) returning pg_catalog.to_jsonb(t)',
    core.tool_schema(p_space, p_tool, coalesce(p_preview, false)), v_def.name)
    into v_row using v_new;
  return v_row;
end $$;

create or replace function public.dame_rows_remove(p_space text, p_tool text, p_table text, p_id uuid, p_preview boolean default false) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  g        record := core.rows_gate(p_space, p_tool, p_preview);
  v_def    core.tool_tables := core.table_def(p_space, p_tool, p_table);
  v_schema text := core.tool_schema(p_space, p_tool, coalesce(p_preview, false));
  v_owner  uuid;
begin
  execute pg_catalog.format('select t.owner from %I.%I t where t.id = $1 for update', v_schema, v_def.name)
    into v_owner using p_id;
  if v_owner is null or (v_def.sharing = 'private' and v_owner <> g.uid) then
    perform core.fail('bad_request', 'This row was not found. It may have been deleted already: reload the list.', 400);
  end if;
  if v_def.sharing = 'reference' and not g.manager then
    perform core.fail('not_allowed', 'Only the tool''s managers can change this table.');
  end if;
  if v_def.sharing = 'private' and g.rank < 2 then
    perform core.fail('not_allowed', 'Your level on this tool lets you read, not delete. Ask the tool''s manager for the level "contribute".');
  end if;
  if v_def.sharing = 'team' and g.rank < 4 then
    perform core.fail('not_allowed', 'Deleting a row needs the level "approve". Ask the tool''s manager.');
  end if;
  execute pg_catalog.format('delete from %I.%I t where t.id = $1', v_schema, v_def.name) using p_id;
  update core.space_quotas q set rows_used = case when q.rows_used > 0 then q.rows_used - 1 else 0 end where q.space = p_space;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Looking at the quota
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
      'columns', (select s.value::integer from core.settings s where s.key = 'quota_columns')),
    'answers', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('status', r.status, 'rows', r.want_rows, 'tables', r.want_tables,
               'columns', r.want_columns, 'reason', r.reason, 'asked_at', r.asked_at, 'answer', r.answer, 'answered_at', r.answered_at,
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
      'columns', (select s.value::integer from core.settings s where s.key = 'quota_columns')),
    'spaces', coalesce((
      select pg_catalog.jsonb_agg(core.quota_json(s.id) || pg_catalog.jsonb_build_object('name', s.name, 'active', s.active) order by s.name)
        from core.spaces s), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 5. IT sets the limits
-- ---------------------------------------------------------------------------

-- The site's default, for every space without limits of its own.
create function public.dame_quota_default_set(p_rows bigint, p_tables integer, p_columns integer) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := core.require_it();
  v_rows bigint := core.quota_number(p_rows, 100, 10000000, 'Rows in a space');
  v_tabs bigint := core.quota_number(p_tables, 1, 100, 'Tables in a tool');
  v_cols bigint := core.quota_number(p_columns, 1, 200, 'Columns in a table');
  v_old  text;
begin
  select pg_catalog.string_agg(s.value, ' / ' order by s.key desc) into v_old
    from core.settings s where s.key in ('quota_rows', 'quota_tables', 'quota_columns');
  perform 1 from core.settings s where s.key like 'quota\_%' for update;
  update core.settings set value = v_rows::text, updated_at = pg_catalog.now(), updated_by = v_uid where key = 'quota_rows';
  update core.settings set value = v_tabs::text, updated_at = pg_catalog.now(), updated_by = v_uid where key = 'quota_tables';
  update core.settings set value = v_cols::text, updated_at = pg_catalog.now(), updated_by = v_uid where key = 'quota_columns';
  perform core.audit_add(v_uid, 'quota.default_set', null,
    pg_catalog.jsonb_build_object('from', v_old, 'to', v_rows || ' / ' || v_tabs || ' / ' || v_cols, 'order', 'rows / tables a tool / columns a table'));
end $$;

-- One space's own limits. All three empty = back to the site's default.
-- A limit below what the space already uses is allowed: nothing is deleted,
-- only new rows, tables or columns are refused until there is room again.
create function public.dame_quota_set(p_space text, p_rows bigint, p_tables integer, p_columns integer) returns void
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
  o := core.quota_limits(p_space);
  insert into core.space_quotas (space) values (p_space) on conflict (space) do nothing;
  update core.space_quotas set max_rows = p_rows, max_tables = p_tables, max_columns = p_columns,
         set_at = pg_catalog.now(), set_by = v_uid where space = p_space;
  n := core.quota_limits(p_space);
  perform core.audit_add(v_uid, 'quota.set', null,
    pg_catalog.jsonb_build_object('from', o.max_rows || ' / ' || o.max_tables || ' / ' || o.max_columns,
      'to', n.max_rows || ' / ' || n.max_tables || ' / ' || n.max_columns,
      'kind', case when n.own then 'own limits' else 'site default' end), p_space);
end $$;

-- ---------------------------------------------------------------------------
-- 6. A space admin asks for more; IT answers
-- ---------------------------------------------------------------------------

-- Only an admin of the space asks (IT sets limits directly, it does not ask itself).
create function public.dame_quota_request(p_space text, p_rows bigint, p_tables integer, p_columns integer, p_reason text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := core.require_space(p_space, 'admin');
  l        record := core.quota_limits(p_space);
  v_reason text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_reason, ''), '[[:cntrl:]]+', ' ', 'g'));
begin
  perform core.quota_number(p_rows, 100, 10000000, 'Rows in the space');
  perform core.quota_number(p_tables, 1, 100, 'Tables in a tool');
  perform core.quota_number(p_columns, 1, 200, 'Columns in a table');
  if p_rows < l.max_rows or p_tables < l.max_tables or p_columns < l.max_columns then
    perform core.fail('bad_request', 'A request asks for more, not less. Leave a number as it is if you do not need more of it.', 400);
  end if;
  if p_rows = l.max_rows and p_tables = l.max_tables and p_columns = l.max_columns then
    perform core.fail('bad_request', 'These are the limits the space already has. Raise the number you need more of.', 400);
  end if;
  if pg_catalog.length(v_reason) not between 10 and 500 then
    perform core.fail('bad_request', 'Say in a sentence why the space needs more (10 to 500 characters). IT decides from it.', 400);
  end if;
  perform 1 from core.spaces s where s.id = p_space for update;
  if exists (select 1 from core.quota_requests r where r.space = p_space and r.status = 'open') then
    perform core.fail('bad_request', 'A request of this space is already waiting for IT. Take it back first if you want to change it.', 400);
  end if;
  insert into core.quota_requests (space, asked_by, want_rows, want_tables, want_columns, reason)
  values (p_space, v_uid, p_rows, p_tables, p_columns, v_reason);
  perform core.audit_add(v_uid, 'quota.requested', null,
    pg_catalog.jsonb_build_object('rows', p_rows, 'tables', p_tables, 'columns', p_columns, 'reason', v_reason), p_space);
end $$;

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
                                         p_note text) returns void
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
    insert into core.space_quotas (space) values (r.space) on conflict (space) do nothing;
    update core.space_quotas set max_rows = coalesce(p_rows, r.want_rows), max_tables = coalesce(p_tables, r.want_tables),
           max_columns = coalesce(p_columns, r.want_columns), set_at = pg_catalog.now(), set_by = v_uid where space = r.space;
    update core.quota_requests set status = 'granted', answered_by = v_uid, answered_at = pg_catalog.now(), answer = nullif(v_note, '')
     where id = r.id;
    perform core.audit_add(v_uid, 'quota.granted', r.asked_by::text,
      pg_catalog.jsonb_build_object('asked', r.want_rows || ' / ' || r.want_tables || ' / ' || r.want_columns,
        'given', coalesce(p_rows, r.want_rows) || ' / ' || coalesce(p_tables, r.want_tables) || ' / ' || coalesce(p_columns, r.want_columns)), r.space);
  else
    if pg_catalog.length(v_note) < 3 then
      perform core.fail('bad_request', 'Say in a few words why the request is declined. The admin of the space reads it.', 400);
    end if;
    update core.quota_requests set status = 'declined', answered_by = v_uid, answered_at = pg_catalog.now(), answer = v_note
     where id = r.id;
    perform core.audit_add(v_uid, 'quota.declined', r.asked_by::text,
      pg_catalog.jsonb_build_object('asked', r.want_rows || ' / ' || r.want_tables || ' / ' || r.want_columns, 'why', v_note), r.space);
  end if;
end $$;

-- The rows that are already there are counted once, now.
do $$
declare s record;
begin
  for s in select id from core.spaces loop
    perform core.quota_recount(s.id);
  end loop;
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
