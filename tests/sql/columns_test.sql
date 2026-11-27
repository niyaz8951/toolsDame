-- tests/sql/columns_test.sql - allowed and refused cases for removing a column
-- (dame_table_drop_column, db/07_data.sql): who may remove one, what is never
-- removed, and that the rows keep their other values.
-- Serves: contract 5 (Data), 3 (Access) and 7 (Audit).
-- Must not change: the test leaves nothing behind. Everything it does is undone
-- before the result is shown.
--
-- How to run: paste the whole file into the Supabase SQL editor and press Run.
-- First row is the summary; any row with pass = false is a failure.

drop table if exists dame_test_result;

do $test$
declare
  v_results jsonb := '[]'::jsonb;
  v_error   text;
  a  uuid := '00000000-0000-4000-8000-0000000000bd';  -- admin of the space
  m  uuid := '00000000-0000-4000-8000-0000000000cd';  -- manager of the tool
  e  uuid := '00000000-0000-4000-8000-0000000000dd';  -- level edit on the tool
  ap uuid := '00000000-0000-4000-8000-0000000000ed';  -- level approve on the tool
  x  uuid := '00000000-0000-4000-8000-0000000000fd';  -- approved, has nothing
  o  uuid := '00000000-0000-4000-8000-00000000010d';  -- admin of another space
  p  uuid := '00000000-0000-4000-8000-00000000011d';  -- pending
  d  uuid := '00000000-0000-4000-8000-00000000012d';  -- disabled, was a manager
  ca jsonb; cm jsonb; ce jsonb; cap jsonb; cx jsonb; co jsonb; cp jsonb; cd jsonb;
  s  text := 'zz-test-dropcol';
  s2 text := 'zz-test-dropcol2';
  dc text := $q$select public.dame_table_drop_column(%L, %L, %L, %L, %L)$q$;
  q    text;
  got  text;
begin
  begin
    create schema dame_test;
    create table dame_test.results (n serial, test text, expected text, got text);

    create function dame_test.claims(p_uid uuid, p_n integer) returns jsonb
    language sql as $f$
      select jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'email', 'x@test.dame',
               'session_id', ('12121212-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid);
    $f$;

    create function dame_test.run(p_claims jsonb, p_sql text) returns text
    language plpgsql as $f$
    declare v_detail text; v_state text; v_msg text;
    begin
      perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
      execute 'set local role authenticated';
      begin
        execute p_sql;
        execute 'reset role';
        return 'ok';
      exception when others then
        get stacked diagnostics v_detail = pg_exception_detail, v_state = returned_sqlstate, v_msg = message_text;
        execute 'reset role';
        return case when v_state = '42501' then 'denied'
                    when v_state like 'PT%' and v_detail <> '' then v_detail
                    else v_state || ': ' || v_msg end;
      end;
    end $f$;

    create function dame_test.val(p_claims jsonb, p_sql text) returns text
    language plpgsql as $f$
    declare v text; v_detail text;
    begin
      perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
      execute 'set local role authenticated';
      begin
        execute p_sql into v;
        execute 'reset role';
        return coalesce(v, '(null)');
      exception when others then
        get stacked diagnostics v_detail = pg_exception_detail;
        execute 'reset role';
        return 'refused: ' || coalesce(nullif(v_detail, ''), sqlerrm);
      end;
    end $f$;

    create function dame_test.expect(p_test text, p_expected text, p_got text) returns void
    language sql as $f$
      insert into dame_test.results (test, expected, got) values (p_test, p_expected, p_got);
    $f$;

    insert into core.profiles (id, email, name, status) values
      (a, 'a13@test.dame', 'Zz Ada', 'active'), (m, 'm13@test.dame', 'Zz Max', 'active'), (e, 'e13@test.dame', 'Zz Edi', 'active'),
      (ap, 'ap13@test.dame', 'Zz App', 'active'), (x, 'x13@test.dame', 'Zz Xan', 'active'), (o, 'o13@test.dame', 'Zz Oto', 'active'),
      (p, 'p13@test.dame', 'Zz Pen', 'pending'), (d, 'd13@test.dame', 'Zz Dis', 'disabled');
    insert into core.spaces (id, name, created_by) values (s, 'Drop', a), (s2, 'Other', o);
    insert into core.space_admins (space, user_id, added_by) values (s, a, a), (s2, o, o);
    insert into core.tools (space, id, name, created_by) values (s, 'trk', 'Tracker', a), (s, 'other', 'Other', a), (s2, 'trk', 'Tracker two', o);
    insert into core.tool_managers (space, tool, user_id, added_by) values (s, 'trk', m, a), (s, 'trk', d, a);
    insert into core.tool_access (space, tool, user_id, level, added_by) values (s, 'trk', e, 'edit', a), (s, 'trk', ap, 'approve', a);
    ca := dame_test.claims(a, 1); cm := dame_test.claims(m, 2); ce := dame_test.claims(e, 3); cap := dame_test.claims(ap, 4);
    cx := dame_test.claims(x, 5); co := dame_test.claims(o, 6); cp := dame_test.claims(p, 7); cd := dame_test.claims(d, 8);

    perform dame_test.expect('the manager makes a table with four columns', 'ok',
      dame_test.run(cm, format('select public.dame_table_create(%L, %L, %L, %L, %L)', s, 'trk', 'tasks', 'team',
        '[{"name":"title","type":"text"},{"name":"due","type":"date"},{"name":"prio","type":"choice","choices":["High","Low"]},{"name":"note","type":"longtext"}]')));
    perform dame_test.expect('and a table with one column', 'ok',
      dame_test.run(cm, format('select public.dame_table_create(%L, %L, %L, %L, %L)', s, 'trk', 'solo', 'private', '[{"name":"only_one","type":"text"}]')));
    perform dame_test.expect('the other space has a table of the same name', 'ok',
      dame_test.run(co, format('select public.dame_table_create(%L, %L, %L, %L, %L)', s2, 'trk', 'tasks', 'team', '[{"name":"title","type":"text"},{"name":"due","type":"date"}]')));
    perform dame_test.expect('two rows, one with a due date', 'ok/ok',
      dame_test.run(cm, format($q$select public.dame_rows_add(%L, 'trk', 'tasks', '{"title":"One","due":"2026-12-01","prio":"High"}')$q$, s)) || '/' ||
      dame_test.run(cm, format($q$select public.dame_rows_add(%L, 'trk', 'tasks', '{"title":"Two"}')$q$, s)));

    -- ------------------------------------------------ 1. who may remove a column
    foreach q in array array['ce', 'cap', 'cx', 'co'] loop
      perform dame_test.expect('only a manager removes a column: refused for ' || q, 'not_allowed',
        dame_test.run(case q when 'ce' then ce when 'cap' then cap when 'cx' then cx else co end, format(dc, s, 'trk', 'tasks', 'note', 'note')));
    end loop;
    perform dame_test.expect('signed out: refused', 'signed_out', dame_test.run(null, format(dc, s, 'trk', 'tasks', 'note', 'note')));
    perform dame_test.expect('pending: refused', 'pending', dame_test.run(cp, format(dc, s, 'trk', 'tasks', 'note', 'note')));
    perform dame_test.expect('disabled, though named a manager: refused', 'disabled', dame_test.run(cd, format(dc, s, 'trk', 'tasks', 'note', 'note')));
    perform dame_test.expect('the admin of the other space cannot reach this one through his own', 'bad_request',
      dame_test.run(co, format(dc, s2, 'trk', 'tasks', 'note', 'note')));
    perform dame_test.expect('nothing was removed by the refused tries', '4',
      (select jsonb_array_length(columns)::text from core.tool_tables where space = s and tool = 'trk' and name = 'tasks'));

    -- ------------------------------------------------ 2. what is refused even for a manager
    perform dame_test.expect('without the typed name: refused', 'bad_request', dame_test.run(cm, format(dc, s, 'trk', 'tasks', 'note', null)));
    perform dame_test.expect('a wrong typed name: refused', 'bad_request', dame_test.run(cm, format(dc, s, 'trk', 'tasks', 'note', 'Note')));
    foreach q in array array['id', 'owner', 'created_at', 'updated_at', 'updated_by'] loop
      perform dame_test.expect('a standard column is never removed: ' || q, 'bad_request', dame_test.run(cm, format(dc, s, 'trk', 'tasks', q, q)));
    end loop;
    perform dame_test.expect('a column the table does not have', 'bad_request', dame_test.run(cm, format(dc, s, 'trk', 'tasks', 'nope', 'nope')));
    perform dame_test.expect('a name made to break the SQL', 'bad_request',
      dame_test.run(cm, format(dc, s, 'trk', 'tasks', 'note"; drop table core.audit; --', 'note"; drop table core.audit; --')));
    perform dame_test.expect('a table the tool does not have', 'bad_request', dame_test.run(cm, format(dc, s, 'trk', 'nope', 'note', 'note')));
    perform dame_test.expect('the same table name on another tool', 'not_allowed', dame_test.run(cm, format(dc, s, 'other', 'tasks', 'note', 'note')));
    perform dame_test.expect('the last column of its own stays', 'bad_request', dame_test.run(cm, format(dc, s, 'trk', 'solo', 'only_one', 'only_one')));
    perform dame_test.expect('the audit is still there', 'true', (to_regclass('core.audit') is not null)::text);

    -- ------------------------------------------------ 3. the manager removes columns
    perform dame_test.expect('the manager removes due', 'ok', dame_test.run(cm, format(dc, s, 'trk', 'tasks', 'due', 'due')));
    perform dame_test.expect('the list of columns keeps its order', 'title,prio,note',
      (select string_agg(c ->> 'name', ',' order by k) from core.tool_tables t, jsonb_array_elements(t.columns) with ordinality z (c, k)
        where t.space = s and t.tool = 'trk' and t.name = 'tasks'));
    perform dame_test.expect('the column is gone from the live table and from the preview', '0/0',
      (select count(*) from information_schema.columns where table_schema = core.tool_schema(s, 'trk', false) and table_name = 'tasks' and column_name = 'due') || '/' ||
      (select count(*) from information_schema.columns where table_schema = core.tool_schema(s, 'trk', true) and table_name = 'tasks' and column_name = 'due'));
    perform dame_test.expect('the rows stay, with their other values', '2/One',
      dame_test.val(cm, format($q$select jsonb_array_length(public.dame_rows_list(%L, 'trk', 'tasks')) || '/' ||
        (select r ->> 'title' from jsonb_array_elements(public.dame_rows_list(%L, 'trk', 'tasks')) r where r ->> 'prio' = 'High')$q$, s, s)));
    perform dame_test.expect('a row no longer shows the removed column', 'false',
      dame_test.val(cm, format($q$select bool_or(r ? 'due')::text from jsonb_array_elements(public.dame_rows_list(%L, 'trk', 'tasks')) r$q$, s)));
    perform dame_test.expect('a tool that still sends the removed column is told so, and nothing is saved', 'bad_request',
      dame_test.run(cm, format($q$select public.dame_rows_add(%L, 'trk', 'tasks', '{"title":"Three","due":"2026-12-02"}')$q$, s)));
    perform dame_test.expect('the audit says what went and how many rows had a value', 'tasks/due/date/1',
      (select (detail ->> 'table') || '/' || (detail ->> 'column') || '/' || (detail ->> 'type') || '/' || (detail ->> 'filled_rows')
         from core.audit where space = s and tool = 'trk' and action = 'table.column_removed' and actor = m));
    perform dame_test.expect('removing it twice: refused', 'bad_request', dame_test.run(cm, format(dc, s, 'trk', 'tasks', 'due', 'due')));
    perform dame_test.expect('the admin of the space removes a choice column', 'ok', dame_test.run(ca, format(dc, s, 'trk', 'tasks', 'prio', 'prio')));
    perform dame_test.expect('a column of the same name can be added again, empty', 'ok/0',
      dame_test.run(cm, format($q$select public.dame_table_add_column(%L, 'trk', 'tasks', '{"name":"due","type":"text"}')$q$, s)) || '/' ||
      dame_test.val(cm, format($q$select count(*) filter (where r ->> 'due' is not null) from jsonb_array_elements(public.dame_rows_list(%L, 'trk', 'tasks')) r$q$, s)));
    perform dame_test.expect('the other space''s table is untouched', 'title,due',
      (select string_agg(c ->> 'name', ',' order by k) from core.tool_tables t, jsonb_array_elements(t.columns) with ordinality z (c, k)
        where t.space = s2 and t.tool = 'trk' and t.name = 'tasks'));
    perform dame_test.expect('core.security_check() finds nothing', '0', (select count(*)::text from core.security_check()));
    select coalesce(jsonb_agg(jsonb_build_object('n', z.n, 'test', z.test, 'expected', z.expected, 'got', z.got) order by z.n), '[]'::jsonb)
      into v_results from dame_test.results z;
    raise exception using errcode = 'DTEST', message = 'undo';
  exception
    when sqlstate 'DTEST' then
      null;  -- everything the test did is undone here; only v_results is kept
    when others then
      v_error := sqlstate || ': ' || sqlerrm;
  end;

  create temp table dame_test_result as
    select (z ->> 'n')::int as n, (z ->> 'expected') = (z ->> 'got') as pass,
           z ->> 'test' as test, z ->> 'expected' as expected, z ->> 'got' as got
      from jsonb_array_elements(v_results) z;
  if v_error is not null then
    insert into dame_test_result values (-1, false, 'THE TEST ITSELF STOPPED', 'runs to the end', v_error);
  end if;
  insert into dame_test_result
    select 0, count(*) filter (where not pass) = 0 and count(*) > 0,
           'SUMMARY', 'all pass',
           count(*) filter (where pass) || ' passed, ' || count(*) filter (where not pass) || ' failed'
      from dame_test_result;
end $test$;

select n, pass, test, expected, got from dame_test_result order by (n = 0) desc, pass, n;
