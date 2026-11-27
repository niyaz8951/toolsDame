-- db/upgrade.sql - brings the live demo database from the version before to
-- the final version in db/. Only the change: a tool's manager removes one
-- column of a table (dame_table_drop_column, the same function as in
-- db/07_data.sql).
-- Serves: contract 5 (Data), 3 (Access) and 7 (Audit); SECURITY "Database".
-- Must not change: only for a database that db/check.sql called final before
-- this delivery; never for a new database (db/install.sql has it already).
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
  if pg_catalog.to_regprocedure('public.dame_table_drop_column(text, text, text, text, text)') is not null then
    raise exception 'This upgrade was already run. db/check.sql says whether the database is final.';
  end if;
end $$;

-- Removes one column of a table (live and preview copy) and what was saved in it.
create function public.dame_table_drop_column(p_space text, p_tool text, p_table text, p_column text, p_confirm text) returns void
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
select case when t.fingerprint = '4ac1befe93896baa4ce2e3557b74ec7a' then 'yes' else 'no' end as final_version,
       t.fingerprint, '4ac1befe93896baa4ce2e3557b74ec7a' as expected, t.parts
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
