-- db/core/004_tables.sql - phase 4: a tool's tables and the one data service.
-- Tables are made from the site (a name, columns from a fixed list of types,
-- a sharing preset). Every tool reads and writes rows through the same five
-- functions. Nobody types SQL.
-- Serves: contract 5 (Data) and SECURITY "Database" 5 (dynamic SQL only here:
-- every identifier checked against a pattern and against core.tool_tables,
-- then quoted with format('%I'); every value passed as a parameter).
-- Must not change: once run, never edited; a fix is a new file. A tool's
-- tables live in its own schema t_<space>__<tool>; the preview has its own
-- copy p_<space>__<tool>. No table is reachable except through dame_rows_*.
-- The five standard columns are set by these functions, never by a tool.
--
-- How to run: after 003. Paste the whole file into the Supabase SQL editor and
-- press Run. It finishes completely or changes nothing. The last result must
-- be an empty table.

begin;

do $$
begin
  if pg_catalog.to_regclass('core.tool_versions') is null then
    raise exception 'Run db/core/003_versions.sql first.';
  end if;
  if pg_catalog.to_regclass('core.tool_tables') is not null then
    raise exception '004 was already run. Do not run it twice.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. What the platform knows about a tool's tables
-- ---------------------------------------------------------------------------

-- columns: [{ "name": "status", "type": "choice", "choices": ["open", "won"] }, ...] in order.
create table core.tool_tables (
  space       text not null,
  tool        text not null,
  name        text not null,
  sharing     text not null check (sharing in ('private', 'team', 'reference')),
  columns     jsonb not null,
  created_at  timestamptz not null default pg_catalog.now(),
  created_by  uuid not null references core.profiles (id),
  primary key (space, tool, name),
  foreign key (space, tool) references core.tools (space, id)
);
alter table core.tool_tables enable row level security;
alter table core.tool_tables force row level security;
revoke all on table core.tool_tables from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------

-- A table or column name: a small letter, then small letters, digits, underscore.
create function core.name_ok(p_name text) returns boolean
language sql immutable set search_path = '' as $$
  select p_name is not null and p_name ~ '^[a-z][a-z0-9_]{1,40}$';
$$;

create function core.is_standard_column(p_name text) returns boolean
language sql immutable set search_path = '' as $$
  select p_name in ('id', 'owner', 'created_at', 'updated_at', 'updated_by');
$$;

-- The schema that holds a tool's tables (live) or its preview copy.
create function core.tool_schema(p_space text, p_tool text, p_preview boolean) returns text
language sql immutable set search_path = '' as $$
  select case when p_preview then 'p_' else 't_' end
      || pg_catalog.replace(p_space, '-', '_') || '__' || pg_catalog.replace(p_tool, '-', '_');
$$;

-- The database type behind each of the platform's column types. Fixed list.
create function core.type_sql(p_type text) returns text
language sql immutable set search_path = '' as $$
  select case p_type
    when 'text' then 'text' when 'longtext' then 'text' when 'choice' then 'text'
    when 'number' then 'numeric' when 'bool' then 'boolean' when 'date' then 'date'
    when 'person' then 'uuid' when 'json' then 'jsonb' end;
$$;

-- The database type of a column of this table, standard columns included; null if there is none.
create function core.column_sql(p_columns jsonb, p_name text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_name in ('id', 'owner', 'updated_by') then 'uuid'
    when p_name in ('created_at', 'updated_at') then 'timestamptz'
    else (select core.type_sql(c ->> 'type') from pg_catalog.jsonb_array_elements(p_columns) c where c ->> 'name' = p_name)
  end;
$$;

-- Checks one column as a person or a dame.json wrote it; returns it in the stored form.
create function core.column_clean(p_col jsonb) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  v_name    text := p_col ->> 'name';
  v_type    text := p_col ->> 'type';
  v_choices jsonb := p_col -> 'choices';
  c         jsonb;
begin
  if p_col is null or pg_catalog.jsonb_typeof(p_col) <> 'object' then
    perform core.fail('bad_request', 'A column needs a name and a type.', 400);
  end if;
  if not core.name_ok(v_name) then
    perform core.fail('bad_request', 'A column name starts with a small letter and uses small letters, digits and underscore (2 to 41 characters): ' || coalesce(pg_catalog.left(v_name, 50), '(empty)'), 400);
  end if;
  if core.is_standard_column(v_name) then
    perform core.fail('bad_request', 'Every table already has the columns id, owner, created_at, updated_at and updated_by. Choose another name than ' || v_name || '.', 400);
  end if;
  if v_type = 'file' then
    perform core.fail('bad_request', 'File columns are not built yet. Leave ' || v_name || ' out for now.', 400);
  end if;
  if core.type_sql(v_type) is null then
    perform core.fail('bad_request', 'The column ' || v_name || ' needs one of these types: text, longtext, number, bool, date, choice, person, json.', 400);
  end if;
  if v_type <> 'choice' then
    return pg_catalog.jsonb_build_object('name', v_name, 'type', v_type);
  end if;
  if v_choices is null or pg_catalog.jsonb_typeof(v_choices) <> 'array'
     or pg_catalog.jsonb_array_length(v_choices) not between 1 and 50 then
    perform core.fail('bad_request', 'The choice column ' || v_name || ' needs 1 to 50 choices.', 400);
  end if;
  for c in select * from pg_catalog.jsonb_array_elements(v_choices) loop
    if pg_catalog.jsonb_typeof(c) <> 'string' or pg_catalog.length(c #>> '{}') not between 1 and 60
       or (c #>> '{}') ~ '[[:cntrl:]]' then
      perform core.fail('bad_request', 'Each choice of ' || v_name || ' is a text of 1 to 60 characters.', 400);
    end if;
  end loop;
  if (select count(distinct x) from pg_catalog.jsonb_array_elements_text(v_choices) x) <> pg_catalog.jsonb_array_length(v_choices) then
    perform core.fail('bad_request', 'The choices of ' || v_name || ' must all be different.', 400);
  end if;
  return pg_catalog.jsonb_build_object('name', v_name, 'type', v_type, 'choices', v_choices);
end $$;

-- The stored definition of a tool's table, or a refusal that names the tables there are.
create function core.table_def(p_space text, p_tool text, p_table text) returns core.tool_tables
language plpgsql stable set search_path = '' as $$
declare
  v_def core.tool_tables;
begin
  if core.name_ok(p_table) then
    select * into v_def from core.tool_tables t where t.space = p_space and t.tool = p_tool and t.name = p_table;
  end if;
  if v_def.name is null then
    perform core.fail('bad_request', 'This tool has no table named ' || coalesce(pg_catalog.left(p_table, 50), '(none)') || '. Its tables: '
      || coalesce((select pg_catalog.string_agg(t.name, ', ' order by t.name) from core.tool_tables t where t.space = p_space and t.tool = p_tool), 'none yet')
      || '. Tables are made on the tool''s admin page, under Data.', 400);
  end if;
  return v_def;
end $$;

-- Checks the values a tool sent for one row against the table's columns.
-- Returns only known columns, in a form the database can store. The five
-- standard columns are ignored: the platform sets them.
create function core.row_clean(p_columns jsonb, p_in jsonb) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  v_out  jsonb := '{}'::jsonb;
  v_key  text;
  v_val  jsonb;
  v_col  jsonb;
  v_kind text;
  v_text text;
  v_ok   boolean;
begin
  if p_in is null or pg_catalog.jsonb_typeof(p_in) <> 'object' then
    perform core.fail('bad_request', 'A row is given as { "column": value }.', 400);
  end if;
  if pg_catalog.length(p_in::text) > 300000 then
    perform core.fail('bad_request', 'This row is too large to save.', 400);
  end if;
  for v_key, v_val in select * from pg_catalog.jsonb_each(p_in) loop
    if core.is_standard_column(v_key) then
      continue;
    end if;
    select c into v_col from pg_catalog.jsonb_array_elements(p_columns) c where c ->> 'name' = v_key;
    if v_col is null then
      perform core.fail('bad_request', 'This table has no column named ' || pg_catalog.left(v_key, 50) || '. Its columns: '
        || (select pg_catalog.string_agg(c ->> 'name', ', ') from pg_catalog.jsonb_array_elements(p_columns) c) || '.', 400);
    end if;
    v_kind := pg_catalog.jsonb_typeof(v_val);
    if v_kind = 'null' then
      v_out := v_out || pg_catalog.jsonb_build_object(v_key, null);
      continue;
    end if;
    v_text := v_val #>> '{}';
    case v_col ->> 'type'
      when 'text' then v_ok := v_kind = 'string' and pg_catalog.length(v_text) <= 1000;
      when 'longtext' then v_ok := v_kind = 'string' and pg_catalog.length(v_text) <= 20000;
      when 'number' then v_ok := v_kind = 'number';
      when 'bool' then v_ok := v_kind = 'boolean';
      when 'choice' then v_ok := v_kind = 'string' and (v_col -> 'choices') ? v_text;
      when 'json' then v_ok := pg_catalog.length(v_val::text) <= 100000;
      when 'date' then
        v_ok := v_kind = 'string' and v_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
        if v_ok then
          begin
            perform v_text::date;
          exception when others then
            v_ok := false;
          end;
        end if;
      when 'person' then
        v_ok := v_kind = 'string' and v_text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                and exists (select 1 from core.profiles p where p.id = v_text::uuid);
      else v_ok := false;
    end case;
    if not v_ok then
      perform core.fail('bad_request', 'The value for ' || v_key || ' does not fit. It must be ' || case v_col ->> 'type'
        when 'text' then 'text of at most 1000 characters'
        when 'longtext' then 'text of at most 20000 characters'
        when 'number' then 'a number'
        when 'bool' then 'true or false'
        when 'date' then 'a date written as 2026-12-31'
        when 'choice' then 'one of: ' || (select pg_catalog.string_agg(x, ', ') from pg_catalog.jsonb_array_elements_text(v_col -> 'choices') x)
        when 'person' then 'the id of a person on this site'
        else 'smaller' end || '.', 400);
    end if;
    v_out := v_out || pg_catalog.jsonb_build_object(v_key, v_val);
  end loop;
  return v_out;
end $$;

-- Who is calling and what may he do here. The preview is for managers and
-- works on the preview copy of the tables; there a manager may do everything.
--   rank: 1 read, 2 contribute, 3 edit, 4 approve.
create function core.rows_gate(p_space text, p_tool text, p_preview boolean,
                               out uid uuid, out rank integer, out manager boolean) returns record
language plpgsql volatile set search_path = '' as $$
begin
  if coalesce(p_preview, false) then
    uid := core.require_tool_manager(p_space, p_tool);
    rank := 4;
    manager := true;
  else
    uid := core.require_tool(p_space, p_tool, 'read');
    rank := core.level_rank(core.tool_level(uid, p_space, p_tool));
    manager := core.is_tool_manager(uid, p_space, p_tool);
  end if;
end $$;

-- Makes one table in one schema, locked away from every role of the site.
create function core.table_make(p_schema text, p_table text, p_columns jsonb) returns void
language plpgsql volatile set search_path = '' as $$
declare
  v_cols text := '';
  c      jsonb;
begin
  for c in select * from pg_catalog.jsonb_array_elements(p_columns) loop
    v_cols := v_cols || pg_catalog.format(', %I %s', c ->> 'name', core.type_sql(c ->> 'type'));
  end loop;
  execute pg_catalog.format('create schema if not exists %I', p_schema);
  execute pg_catalog.format('revoke all on schema %I from public, anon, authenticated', p_schema);
  execute pg_catalog.format(
    'create table %I.%I (id uuid primary key default pg_catalog.gen_random_uuid(), owner uuid not null, '
    || 'created_at timestamptz not null default pg_catalog.now(), updated_at timestamptz not null default pg_catalog.now(), '
    || 'updated_by uuid not null%s)', p_schema, p_table, v_cols);
  execute pg_catalog.format('alter table %I.%I enable row level security', p_schema, p_table);
  execute pg_catalog.format('alter table %I.%I force row level security', p_schema, p_table);
  execute pg_catalog.format('revoke all on table %I.%I from public, anon, authenticated', p_schema, p_table);
  execute pg_catalog.format('create index on %I.%I (owner)', p_schema, p_table);
end $$;

-- Deleting a tool also deletes its tables, live and preview, with their rows.
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
end $$;

-- ---------------------------------------------------------------------------
-- 3. Making tables: the tool's managers and the admins of its space
-- ---------------------------------------------------------------------------

create function public.dame_table_create(p_space text, p_tool text, p_name text, p_sharing text, p_columns jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := core.require_tool_manager(p_space, p_tool);
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
  if (select count(*) from core.tool_tables t where t.space = p_space and t.tool = p_tool) >= 30 then
    perform core.fail('bad_request', 'A tool has 30 tables at most.', 400);
  end if;
  if p_columns is null or pg_catalog.jsonb_typeof(p_columns) <> 'array'
     or pg_catalog.jsonb_array_length(p_columns) not between 1 and 60 then
    perform core.fail('bad_request', 'A table has 1 to 60 columns of its own.', 400);
  end if;
  for c in select * from pg_catalog.jsonb_array_elements(p_columns) loop
    c := core.column_clean(c);
    if (c ->> 'name') = any (v_names) then
      perform core.fail('bad_request', 'Two columns are named ' || (c ->> 'name') || '.', 400);
    end if;
    v_names := v_names || (c ->> 'name');
    v_clean := v_clean || c;
  end loop;

  perform 1 from core.tools t where t.space = p_space and t.id = p_tool for update;
  perform core.table_make(core.tool_schema(p_space, p_tool, false), p_name, v_clean);
  perform core.table_make(core.tool_schema(p_space, p_tool, true), p_name, v_clean);
  insert into core.tool_tables (space, tool, name, sharing, columns, created_by)
  values (p_space, p_tool, p_name, p_sharing, v_clean, v_uid);
  perform core.audit_add(v_uid, 'table.created', null,
    pg_catalog.jsonb_build_object('table', p_name, 'sharing', p_sharing, 'columns', pg_catalog.array_to_string(v_names, ', ')), p_space, p_tool);
end $$;

create function public.dame_table_add_column(p_space text, p_tool text, p_table text, p_column jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_tool_manager(p_space, p_tool);
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
  if pg_catalog.jsonb_array_length(v_def.columns) >= 60 then
    perform core.fail('bad_request', 'A table has 60 columns of its own at most.', 400);
  end if;
  foreach s in array array[core.tool_schema(p_space, p_tool, false), core.tool_schema(p_space, p_tool, true)] loop
    execute pg_catalog.format('alter table %I.%I add column %I %s', s, v_def.name, v_col ->> 'name', core.type_sql(v_col ->> 'type'));
  end loop;
  update core.tool_tables set columns = columns || v_col where space = p_space and tool = p_tool and name = v_def.name;
  perform core.audit_add(v_uid, 'table.column_added', null,
    pg_catalog.jsonb_build_object('table', v_def.name, 'column', v_col ->> 'name', 'type', v_col ->> 'type'), p_space, p_tool);
end $$;

-- p_confirm must be the name of the table, typed by the manager. The rows go with it.
create function public.dame_table_drop(p_space text, p_tool text, p_table text, p_confirm text) returns void
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
  perform core.audit_add(v_uid, 'table.deleted', null,
    pg_catalog.jsonb_build_object('table', v_def.name, 'rows', v_rows), p_space, p_tool);
end $$;

-- The tool's tables with their columns and how many rows each holds.
create function public.dame_tables_list(p_space text, p_tool text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := core.require_tool_manager(p_space, p_tool);
  v_out  jsonb := '[]'::jsonb;
  v_live bigint;
  v_prev bigint;
  t      core.tool_tables;
begin
  for t in select * from core.tool_tables x where x.space = p_space and x.tool = p_tool order by x.name loop
    execute pg_catalog.format('select count(*) from %I.%I', core.tool_schema(p_space, p_tool, false), t.name) into v_live;
    execute pg_catalog.format('select count(*) from %I.%I', core.tool_schema(p_space, p_tool, true), t.name) into v_prev;
    v_out := v_out || pg_catalog.jsonb_build_object('name', t.name, 'sharing', t.sharing, 'columns', t.columns,
                                                    'rows', v_live, 'preview_rows', v_prev);
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The data service: the same five functions for every tool
-- ---------------------------------------------------------------------------
-- Who may do what (the three presets of docs/BEDROCK.md):
--   private   : each person, his own rows only (read: read; write: contribute).
--   team      : read all rows (read); add, change own (contribute); change any (edit); delete (approve).
--   reference : read all rows (read); every change: the tool's managers only.

-- p_options: { "where": { "column": value }, "sort": "column" or "-column", "limit": 100, "offset": 0 }
create function public.dame_rows_list(p_space text, p_tool text, p_table text,
                                      p_options jsonb default '{}'::jsonb, p_preview boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  g        record := core.rows_gate(p_space, p_tool, p_preview);
  v_def    core.tool_tables := core.table_def(p_space, p_tool, p_table);
  v_opts   jsonb := coalesce(p_options, '{}'::jsonb);
  v_where  text := '';
  v_sort   text;
  v_dir    text := 'asc';
  v_limit  integer := 100;
  v_offset integer := 0;
  v_key    text;
  v_type   text;
  v_out    jsonb;
begin
  if pg_catalog.jsonb_typeof(v_opts) <> 'object' then
    perform core.fail('bad_request', 'The options of a list are given as { "where": ..., "sort": ..., "limit": ... }.', 400);
  end if;
  if v_opts ? 'where' and pg_catalog.jsonb_typeof(v_opts -> 'where') <> 'null' then
    if pg_catalog.jsonb_typeof(v_opts -> 'where') <> 'object' then
      perform core.fail('bad_request', 'A filter is given as { "column": value }.', 400);
    end if;
    for v_key in select pg_catalog.jsonb_object_keys(v_opts -> 'where') loop
      v_type := core.column_sql(v_def.columns, v_key);
      if v_type is null or v_type = 'jsonb' or pg_catalog.jsonb_typeof(v_opts -> 'where' -> v_key) in ('object', 'array') then
        perform core.fail('bad_request', 'The list cannot be filtered on ' || pg_catalog.left(v_key, 50) || '. Filter on a column of the table, with one plain value.', 400);
      end if;
      -- The column name was just found in the table's definition; the value stays a parameter ($1).
      v_where := v_where || pg_catalog.format(' and t.%I is not distinct from ($1 ->> %L)::%s', v_key, v_key, v_type);
    end loop;
  end if;

  v_sort := coalesce(v_opts ->> 'sort', '-created_at');
  if pg_catalog.left(v_sort, 1) = '-' then
    v_dir := 'desc';
    v_sort := pg_catalog.substr(v_sort, 2);
  end if;
  if core.column_sql(v_def.columns, v_sort) is null or core.column_sql(v_def.columns, v_sort) = 'jsonb' then
    perform core.fail('bad_request', 'The list cannot be sorted on ' || pg_catalog.left(v_sort, 50) || '. Sort on a column of the table.', 400);
  end if;
  if (v_opts ? 'limit' and pg_catalog.jsonb_typeof(v_opts -> 'limit') <> 'number')
     or (v_opts ? 'offset' and pg_catalog.jsonb_typeof(v_opts -> 'offset') <> 'number') then
    perform core.fail('bad_request', 'limit and offset are numbers.', 400);
  end if;
  v_limit := least(greatest(coalesce((v_opts ->> 'limit')::numeric, 100), 1), 1000)::integer;
  v_offset := least(greatest(coalesce((v_opts ->> 'offset')::numeric, 0), 0), 10000000)::integer;

  if v_def.sharing = 'private' then
    v_where := v_where || ' and t.owner = $2';
  end if;
  begin
    execute pg_catalog.format(
      'select coalesce(pg_catalog.jsonb_agg(q.j order by q.n), ''[]''::jsonb) from ('
      || 'select pg_catalog.to_jsonb(t) as j, pg_catalog.row_number() over (order by t.%I %s nulls last, t.id) as n '
      || 'from %I.%I t where true%s order by t.%I %s nulls last, t.id limit $3 offset $4) q',
      v_sort, v_dir, core.tool_schema(p_space, p_tool, coalesce(p_preview, false)), v_def.name, v_where, v_sort, v_dir)
      into v_out using v_opts -> 'where', g.uid, v_limit, v_offset;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
    perform core.fail('bad_request', 'A filter value does not fit its column (for example text where a number is expected).', 400);
  end;
  return v_out;
end $$;

create function public.dame_rows_get(p_space text, p_tool text, p_table text, p_id uuid, p_preview boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  g     record := core.rows_gate(p_space, p_tool, p_preview);
  v_def core.tool_tables := core.table_def(p_space, p_tool, p_table);
  v_row jsonb;
begin
  execute pg_catalog.format('select pg_catalog.to_jsonb(t) from %I.%I t where t.id = $1',
                            core.tool_schema(p_space, p_tool, coalesce(p_preview, false)), v_def.name)
    into v_row using p_id;
  if v_row is null or (v_def.sharing = 'private' and (v_row ->> 'owner')::uuid <> g.uid) then
    perform core.fail('bad_request', 'This row was not found. It may have been deleted: reload the list.', 400);
  end if;
  return v_row;
end $$;

create function public.dame_rows_add(p_space text, p_tool text, p_table text, p_row jsonb, p_preview boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  g     record := core.rows_gate(p_space, p_tool, p_preview);
  v_def core.tool_tables := core.table_def(p_space, p_tool, p_table);
  v_new jsonb;
  v_row jsonb;
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
  execute pg_catalog.format(
    'insert into %1$I.%2$I as t select * from pg_catalog.jsonb_populate_record(null::%1$I.%2$I, $1) returning pg_catalog.to_jsonb(t)',
    core.tool_schema(p_space, p_tool, coalesce(p_preview, false)), v_def.name)
    into v_row using v_new;
  return v_row;
end $$;

create function public.dame_rows_update(p_space text, p_tool text, p_table text, p_id uuid, p_patch jsonb, p_preview boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  g        record := core.rows_gate(p_space, p_tool, p_preview);
  v_def    core.tool_tables := core.table_def(p_space, p_tool, p_table);
  v_schema text := core.tool_schema(p_space, p_tool, coalesce(p_preview, false));
  v_old    jsonb;
  v_patch  jsonb;
  v_mine   boolean;
  v_set    text;
  v_row    jsonb;
begin
  execute pg_catalog.format('select pg_catalog.to_jsonb(t) from %I.%I t where t.id = $1 for update', v_schema, v_def.name)
    into v_old using p_id;
  v_mine := v_old is not null and (v_old ->> 'owner')::uuid = g.uid;
  if v_old is null or (v_def.sharing = 'private' and not v_mine) then
    perform core.fail('bad_request', 'This row was not found. It may have been deleted: reload the list.', 400);
  end if;
  if v_def.sharing = 'reference' and not g.manager then
    perform core.fail('not_allowed', 'Only the tool''s managers can change this table.');
  end if;
  if g.rank < 2 then
    perform core.fail('not_allowed', 'Your level on this tool lets you read, not change. Ask the tool''s manager for the level "contribute".');
  end if;
  if v_def.sharing = 'team' and not v_mine and g.rank < 3 then
    perform core.fail('not_allowed', 'Your level lets you change your own rows only. Changing another person''s row needs the level "edit".');
  end if;

  v_patch := core.row_clean(v_def.columns, p_patch);
  if v_patch = '{}'::jsonb then
    return v_old;
  end if;
  select pg_catalog.string_agg(pg_catalog.format('%1$I = n.%1$I', k), ', ') into v_set
    from pg_catalog.jsonb_object_keys(v_patch) k;
  execute pg_catalog.format(
    'update %1$I.%2$I t set %3$s, updated_at = pg_catalog.now(), updated_by = $3 '
    || 'from pg_catalog.jsonb_populate_record(null::%1$I.%2$I, $1) n where t.id = $2 returning pg_catalog.to_jsonb(t)',
    v_schema, v_def.name, v_set)
    into v_row using v_old || v_patch, p_id, g.uid;
  return v_row;
end $$;

create function public.dame_rows_remove(p_space text, p_tool text, p_table text, p_id uuid, p_preview boolean default false) returns void
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
end $$;

-- The people who have this tool: for showing who added a row and for choosing a person.
create function public.dame_tool_people(p_space text, p_tool text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_tool(p_space, p_tool, 'read');
begin
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
      from (select p.id, p.name from core.profiles p
             where p.status = 'active' and core.tool_level(p.id, p_space, p_tool) is not null
             order by p.name limit 500) u), '[]'::jsonb);
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
