-- tests/sql/data_test.sql - allowed and refused cases for making tables from the site and the
-- data service with its three sharing presets, for every role and level (db/07_data.sql).
-- Serves: contract 5 (Data), SECURITY "Database" 5, and the phase 4 test
-- ("saves shared rows; every refused case fails correctly").
-- Must not change: the test leaves nothing behind. Everything it creates,
-- tables included, is undone before the result is shown.
--
-- How to run: on a database built from db/, paste the whole file into the SQL editor and press Run.
-- First row is the summary; any row with pass = false is a failure.

drop table if exists dame_test_result;

do $test$
declare
  v_results jsonb := '[]'::jsonb;
  v_error   text;
  a  uuid := '00000000-0000-4000-8000-0000000000a4';  -- admin of the space
  m  uuid := '00000000-0000-4000-8000-0000000000b4';  -- manager of the tool
  r  uuid := '00000000-0000-4000-8000-0000000000c4';  -- level read
  c  uuid := '00000000-0000-4000-8000-0000000000d4';  -- level contribute
  e  uuid := '00000000-0000-4000-8000-0000000000e4';  -- level edit
  ap uuid := '00000000-0000-4000-8000-0000000000f4';  -- level approve (not a manager)
  x  uuid := '00000000-0000-4000-8000-000000000014';  -- approved, has nothing
  o  uuid := '00000000-0000-4000-8000-000000000024';  -- admin of another space
  ca jsonb; cm jsonb; cr jsonb; cc jsonb; ce jsonb; cap jsonb; cx jsonb; co jsonb;
  s  text := 'zz-test-five';
  s2 text := 'zz-test-six';
  cols jsonb := '[{"name":"project","type":"text"},{"name":"capacity_kw","type":"number"},{"name":"due","type":"date"},
                  {"name":"status","type":"choice","choices":["open","won","lost"]},{"name":"lead","type":"person"},
                  {"name":"notes","type":"longtext"},{"name":"extra","type":"json"},{"name":"urgent","type":"bool"}]';
  live text := 't_zz_test_five__trk';
  prev text := 'p_zz_test_five__trk';
  q    text;
  n    integer := 0;
  id_c text; id_e text; id_p text; id_ref text; id_prev text;
begin
  begin
    create schema dame_test;
    create table dame_test.results (n serial, test text, expected text, got text);

    create function dame_test.claims(p_uid uuid, p_n integer) returns jsonb
    language sql as $f$
      select jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'email', 'x@test.dame',
               'session_id', ('44444444-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid);
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
      (a, 'a4@test.dame', 'Zz Ada', 'active'), (m, 'm4@test.dame', 'Zz Max', 'active'), (r, 'r4@test.dame', 'Zz Ray', 'active'),
      (c, 'c4@test.dame', 'Zz Cat', 'active'), (e, 'e4@test.dame', 'Zz Edi', 'active'), (ap, 'p4@test.dame', 'Zz App', 'active'),
      (x, 'x4@test.dame', 'Zz Xan', 'active'), (o, 'o4@test.dame', 'Zz Oto', 'active');
    insert into core.spaces (id, name, created_by) values (s, 'Five', a), (s2, 'Six', o);
    insert into core.space_admins (space, user_id, added_by) values (s, a, a), (s2, o, o);
    insert into core.tools (space, id, name, created_by) values (s, 'trk', 'Tracker', a), (s, 'other', 'Other', a), (s2, 'trk', 'Tracker six', o);
    insert into core.tool_managers (space, tool, user_id, added_by) values (s, 'trk', m, a);
    insert into core.tool_access (space, tool, user_id, level, added_by) values
      (s, 'trk', r, 'read', a), (s, 'trk', c, 'contribute', a), (s, 'trk', e, 'edit', a), (s, 'trk', ap, 'approve', a);
    ca := dame_test.claims(a, 1); cm := dame_test.claims(m, 2); cr := dame_test.claims(r, 3); cc := dame_test.claims(c, 4);
    ce := dame_test.claims(e, 5); cap := dame_test.claims(ap, 6); cx := dame_test.claims(x, 7); co := dame_test.claims(o, 8);

    -- ------------------------------------------------ 1. who may make a table
    foreach q in array array['cr', 'cc', 'ce', 'cap', 'cx', 'co'] loop
      perform dame_test.expect('only a manager makes a table: refused for ' || q, 'not_allowed',
        dame_test.run(case q when 'cr' then cr when 'cc' then cc when 'ce' then ce when 'cap' then cap when 'cx' then cx else co end,
          format('select public.dame_table_create(%L, %L, %L, %L, %L)', s, 'trk', 'bids', 'team', cols)));
    end loop;

    -- ------------------------------------------------ 2. what a table may be
    foreach q in array array[
      format('(%L, %L, %L, %L, %L)', s, 'trk', 'Bids', 'team', cols),
      format('(%L, %L, %L, %L, %L)', s, 'trk', '1bids', 'team', cols),
      format('(%L, %L, %L, %L, %L)', s, 'trk', 'b', 'team', cols),
      format('(%L, %L, %L, %L, %L)', s, 'trk', 'bids; drop table core.profiles; --', 'team', cols),
      format('(%L, %L, %L, %L, %L)', s, 'trk', 'bids"x', 'team', cols),
      format('(%L, %L, %L, %L, %L)', s, 'trk', 'core.profiles', 'team', cols),
      format('(%L, %L, %L, %L, %L)', s, 'trk', 'bids', 'everyone', cols),
      format('(%L, %L, %L, %L, %L)', s, 'trk', 'bids', 'team', '[]'),
      format('(%L, %L, %L, %L, %L)', s, 'trk', 'bids', 'team', '{"name":"a1","type":"text"}'),
      format('(%L, %L, %L, %L, %L)', s, 'trk', 'bids', 'team', '[{"name":"id","type":"text"}]'),
      format('(%L, %L, %L, %L, %L)', s, 'trk', 'bids', 'team', '[{"name":"owner","type":"person"}]'),
      format('(%L, %L, %L, %L, %L)', s, 'trk', 'bids', 'team', '[{"name":"Name","type":"text"}]'),
      format('(%L, %L, %L, %L, %L)', s, 'trk', 'bids', 'team', '[{"name":"a1\" text); drop table core.profiles; --","type":"text"}]'),
      format('(%L, %L, %L, %L, %L)', s, 'trk', 'bids', 'team', '[{"name":"a1","type":"varchar(10)"}]'),
      format('(%L, %L, %L, %L, %L)', s, 'trk', 'bids', 'team', '[{"name":"a1","type":"text); drop table core.profiles; --"}]'),
      format('(%L, %L, %L, %L, %L)', s, 'trk', 'bids', 'team', '[{"name":"a1","type":"file"}]'),
      format('(%L, %L, %L, %L, %L)', s, 'trk', 'bids', 'team', '[{"name":"a1","type":"choice"}]'),
      format('(%L, %L, %L, %L, %L)', s, 'trk', 'bids', 'team', '[{"name":"a1","type":"choice","choices":[]}]'),
      format('(%L, %L, %L, %L, %L)', s, 'trk', 'bids', 'team', '[{"name":"a1","type":"choice","choices":["x","x"]}]'),
      format('(%L, %L, %L, %L, %L)', s, 'trk', 'bids', 'team', '[{"name":"a1","type":"choice","choices":[1,2]}]'),
      format('(%L, %L, %L, %L, %L)', s, 'trk', 'bids', 'team', '[{"name":"a1","type":"text"},{"name":"a1","type":"number"}]'),
      format('(%L, %L, %L, %L, %L)', s, 'trk', 'bids', 'team', (select jsonb_agg(jsonb_build_object('name', 'c' || g, 'type', 'text')) from generate_series(1, 61) g))
    ] loop
      n := n + 1;
      perform dame_test.expect('table refused, case ' || n || ': ' || left(q, 70), 'bad_request',
        dame_test.run(cm, 'select public.dame_table_create' || q));
    end loop;
    perform dame_test.expect('nothing was made by the refused tries', '0/none',
      (select count(*)::text from core.tool_tables where space = s) || '/' || coalesce(to_regnamespace(live)::text, 'none'));
    perform dame_test.expect('the people table is still there after the injection tries', 'yes',
      case when to_regclass('core.profiles') is not null then 'yes' else 'GONE' end);

    -- ------------------------------------------------ 3. three tables, one per preset
    perform dame_test.expect('manager makes the team table "bids"', 'ok',
      dame_test.run(cm, format('select public.dame_table_create(%L, %L, %L, %L, %L)', s, 'trk', 'bids', 'team', cols)));
    perform dame_test.expect('space admin makes the private table "notes"', 'ok',
      dame_test.run(ca, format('select public.dame_table_create(%L, %L, %L, %L, %L)', s, 'trk', 'notes', 'private', '[{"name":"note","type":"text"}]')));
    perform dame_test.expect('manager makes the reference table "prices"', 'ok',
      dame_test.run(cm, format('select public.dame_table_create(%L, %L, %L, %L, %L)', s, 'trk', 'prices', 'reference', '[{"name":"item","type":"text"},{"name":"price","type":"number"}]')));
    perform dame_test.expect('the same name twice is refused', 'bad_request',
      dame_test.run(cm, format('select public.dame_table_create(%L, %L, %L, %L, %L)', s, 'trk', 'bids', 'team', cols)));
    perform dame_test.expect('each table exists twice: live and preview', 'yes/yes',
      case when to_regclass(live || '.bids') is not null then 'yes' else 'no' end || '/' || case when to_regclass(prev || '.bids') is not null then 'yes' else 'no' end);
    perform dame_test.expect('it has the five standard columns and its own', 'id,owner,created_at,updated_at,updated_by,project,capacity_kw,due,status,lead,notes,extra,urgent',
      (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = live and table_name = 'bids'));
    perform dame_test.expect('row security is on and forced on a tool''s table', 'true/true',
      (select relrowsecurity::text || '/' || relforcerowsecurity::text from pg_class where oid = to_regclass(live || '.bids')));
    perform dame_test.expect('a signed-in person cannot read a tool''s table directly', 'denied',
      dame_test.run(cap, format('select count(*) from %I.bids', live)));
    perform dame_test.expect('manager lists the tables', 'bids,notes,prices',
      dame_test.val(cm, format($q$select string_agg(t ->> 'name', ',') from jsonb_array_elements(public.dame_tables_list(%L, %L)) t$q$, s, 'trk')));
    perform dame_test.expect('a contributor cannot list the tables', 'not_allowed',
      dame_test.run(cc, format('select public.dame_tables_list(%L, %L)', s, 'trk')));

    -- ------------------------------------------------ 4. team: who may add
    id_c := dame_test.val(cc, format($q$select public.dame_rows_add(%L, %L, 'bids', %L) ->> 'id'$q$, s, 'trk',
      format('{"project":"Alpha","capacity_kw":120.5,"due":"2026-12-31","status":"open","lead":"%s","notes":"n","extra":{"a":[1,2]},"urgent":true,"owner":"%s","id":"00000000-0000-4000-8000-000000000001","updated_by":"%s"}', m, x, x)));
    perform dame_test.expect('contributor adds a row', 'ok', case when id_c ~ '^[0-9a-f-]{36}$' then 'ok' else id_c end);
    perform dame_test.expect('the platform sets owner, id and updated_by, whatever the tool sent', 'true',
      (select (j ->> 'owner' = c::text and j ->> 'updated_by' = c::text and j ->> 'id' <> '00000000-0000-4000-8000-000000000001' and j ->> 'capacity_kw' = '120.5' and j -> 'extra' -> 'a' ->> 1 = '2' and j ->> 'urgent' = 'true')::text
         from (select dame_test.val(cc, format($q$select public.dame_rows_get(%L, %L, 'bids', %L)::text$q$, s, 'trk', id_c))::jsonb as j) z));
    id_e := dame_test.val(ce, format($q$select public.dame_rows_add(%L, %L, 'bids', '{"project":"Beta","capacity_kw":80,"status":"won"}') ->> 'id'$q$, s, 'trk'));
    perform dame_test.expect('editor adds a row', 'ok', case when id_e ~ '^[0-9a-f-]{36}$' then 'ok' else id_e end);
    perform dame_test.expect('reader cannot add', 'not_allowed',
      dame_test.run(cr, format($q$select public.dame_rows_add(%L, %L, 'bids', '{"project":"x"}')$q$, s, 'trk')));
    perform dame_test.expect('a person without the tool cannot add', 'not_allowed',
      dame_test.run(cx, format($q$select public.dame_rows_add(%L, %L, 'bids', '{"project":"x"}')$q$, s, 'trk')));
    perform dame_test.expect('an admin of another space cannot add', 'not_allowed',
      dame_test.run(co, format($q$select public.dame_rows_add(%L, %L, 'bids', '{"project":"x"}')$q$, s, 'trk')));

    -- ------------------------------------------------ 5. values that do not fit
    n := 0;
    foreach q in array array[
      '{"project": 12}', '{"capacity_kw": "many"}', '{"capacity_kw": "120"}', '{"due": "31/12/2026"}', '{"due": "2026-02-30"}', '{"status": "maybe"}',
      '{"status": 1}', '{"urgent": "yes"}', '{"lead": "nobody"}', '{"lead": "00000000-0000-4000-8000-00000000dead"}',
      '{"nosuch": 1}', '{"project\"; drop table core.profiles; --": "x"}', '[1,2]', '"text"',
      jsonb_build_object('project', repeat('x', 1001))::text, jsonb_build_object('notes', repeat('x', 20001))::text
    ] loop
      n := n + 1;
      perform dame_test.expect('value refused, case ' || n || ': ' || left(q, 50), 'bad_request',
        dame_test.run(cc, format($q$select public.dame_rows_add(%L, %L, 'bids', %L)$q$, s, 'trk', q)));
    end loop;
    perform dame_test.expect('an empty value is allowed', 'ok',
      dame_test.run(cc, format($q$select public.dame_rows_add(%L, %L, 'bids', '{"project":"Gamma","capacity_kw":null,"status":"lost"}')$q$, s, 'trk')));
    perform dame_test.expect('three rows are stored, none from the refused tries', '3',
      (select dame_test.val(cm, format($q$select jsonb_array_length(public.dame_rows_list(%L, %L, 'bids'))$q$, s, 'trk'))));

    -- ------------------------------------------------ 6. team: reading, filtering, sorting
    perform dame_test.expect('reader sees all rows of a team table', '3',
      dame_test.val(cr, format($q$select jsonb_array_length(public.dame_rows_list(%L, %L, 'bids'))$q$, s, 'trk')));
    perform dame_test.expect('filter on a choice', 'Beta',
      dame_test.val(cr, format($q$select string_agg(x ->> 'project', ',') from jsonb_array_elements(public.dame_rows_list(%L, %L, 'bids', '{"where":{"status":"won"}}')) x$q$, s, 'trk')));
    perform dame_test.expect('filter on a number and on true/false together', 'Alpha',
      dame_test.val(cr, format($q$select string_agg(x ->> 'project', ',') from jsonb_array_elements(public.dame_rows_list(%L, %L, 'bids', '{"where":{"capacity_kw":120.5,"urgent":true}}')) x$q$, s, 'trk')));
    perform dame_test.expect('filter on an empty value', 'Gamma',
      dame_test.val(cr, format($q$select string_agg(x ->> 'project', ',') from jsonb_array_elements(public.dame_rows_list(%L, %L, 'bids', '{"where":{"capacity_kw":null}}')) x$q$, s, 'trk')));
    perform dame_test.expect('filter on who added the row', 'Beta',
      dame_test.val(cr, format($q$select string_agg(x ->> 'project', ',') from jsonb_array_elements(public.dame_rows_list(%L, %L, 'bids', %L)) x$q$, s, 'trk', format('{"where":{"owner":"%s"}}', e))));
    perform dame_test.expect('sort down by a number, empty last', 'Alpha,Beta,Gamma',
      dame_test.val(cr, format($q$select string_agg(x ->> 'project', ',' order by o) from jsonb_array_elements(public.dame_rows_list(%L, %L, 'bids', '{"sort":"-capacity_kw"}')) with ordinality as z(x, o)$q$, s, 'trk'))
        || '');
    perform dame_test.expect('limit and offset', 'Beta',
      dame_test.val(cr, format($q$select string_agg(x ->> 'project', ',') from jsonb_array_elements(public.dame_rows_list(%L, %L, 'bids', '{"sort":"project","limit":1,"offset":1}')) x$q$, s, 'trk')));
    perform dame_test.expect('a filter value that looks like SQL is only a value', '0',
      dame_test.val(cr, format($q$select jsonb_array_length(public.dame_rows_list(%L, %L, 'bids', %L))$q$, s, 'trk', '{"where":{"project":"x'' or ''1''=''1"}}')));
    n := 0;
    foreach q in array array[
      '{"where":{"nosuch":1}}', '{"where":{"project = ''x'' or 1=1 --":"x"}}', '{"where":{"extra":"x"}}', '{"where":{"project":{"$ne":1}}}',
      '{"where":"1=1"}', '{"where":{"capacity_kw":"many"}}', '{"where":{"due":"soon"}}', '{"where":{"id":"not-an-id"}}',
      '{"sort":"nosuch"}', '{"sort":"project; drop table core.profiles"}', '{"sort":"extra"}', '{"limit":"all"}', '[]'
    ] loop
      n := n + 1;
      perform dame_test.expect('list refused, case ' || n || ': ' || left(q, 50), 'bad_request',
        dame_test.run(cr, format($q$select public.dame_rows_list(%L, %L, 'bids', %L)$q$, s, 'trk', q)));
    end loop;
    perform dame_test.expect('a huge limit is cut to 1000, not refused', 'ok',
      dame_test.run(cr, format($q$select public.dame_rows_list(%L, %L, 'bids', '{"limit":99999999}')$q$, s, 'trk')));
    foreach q in array array['nosuch', 'Bids', 'bids; drop table core.profiles', 'core.profiles', '../bids', ''] loop
      perform dame_test.expect('a table the tool does not have is refused: ' || q, 'bad_request',
        dame_test.run(cap, format('select public.dame_rows_list(%L, %L, %L)', s, 'trk', q)));
    end loop;
    perform dame_test.expect('the tool "other" has none of these tables', 'bad_request',
      dame_test.run(ca, format($q$select public.dame_rows_list(%L, %L, 'bids')$q$, s, 'other')));
    perform dame_test.expect('the same tool id in another space is another tool', 'not_allowed',
      dame_test.run(cap, format($q$select public.dame_rows_list(%L, %L, 'bids')$q$, s2, 'trk')));

    -- ------------------------------------------------ 7. team: changing and deleting
    perform dame_test.expect('contributor changes his own row', 'won',
      dame_test.val(cc, format($q$select public.dame_rows_update(%L, %L, 'bids', %L, '{"status":"won","owner":"%s"}') ->> 'status'$q$, s, 'trk', id_c, x)));
    perform dame_test.expect('the owner of a row never changes', c::text,
      dame_test.val(cr, format($q$select public.dame_rows_get(%L, %L, 'bids', %L) ->> 'owner'$q$, s, 'trk', id_c)));
    perform dame_test.expect('contributor cannot change another person''s row', 'not_allowed',
      dame_test.run(cc, format($q$select public.dame_rows_update(%L, %L, 'bids', %L, '{"status":"lost"}')$q$, s, 'trk', id_e)));
    perform dame_test.expect('editor changes another person''s row', 'ok',
      dame_test.run(ce, format($q$select public.dame_rows_update(%L, %L, 'bids', %L, '{"notes":"checked"}')$q$, s, 'trk', id_c)));
    perform dame_test.expect('the row says who changed it last, and keeps the rest', e::text || '/won/Alpha',
      dame_test.val(cr, format($q$select (j ->> 'updated_by') || '/' || (j ->> 'status') || '/' || (j ->> 'project') from public.dame_rows_get(%L, %L, 'bids', %L) j$q$, s, 'trk', id_c)));
    perform dame_test.expect('reader cannot change', 'not_allowed',
      dame_test.run(cr, format($q$select public.dame_rows_update(%L, %L, 'bids', %L, '{"status":"lost"}')$q$, s, 'trk', id_c)));
    perform dame_test.expect('a change with a value that does not fit is refused', 'bad_request',
      dame_test.run(ce, format($q$select public.dame_rows_update(%L, %L, 'bids', %L, '{"status":"maybe"}')$q$, s, 'trk', id_c)));
    perform dame_test.expect('a row that does not exist cannot be changed', 'bad_request',
      dame_test.run(ce, format($q$select public.dame_rows_update(%L, %L, 'bids', %L, '{"status":"lost"}')$q$, s, 'trk', gen_random_uuid())));
    perform dame_test.expect('contributor cannot delete, not even his own row', 'not_allowed',
      dame_test.run(cc, format($q$select public.dame_rows_remove(%L, %L, 'bids', %L)$q$, s, 'trk', id_c)));
    perform dame_test.expect('editor cannot delete', 'not_allowed',
      dame_test.run(ce, format($q$select public.dame_rows_remove(%L, %L, 'bids', %L)$q$, s, 'trk', id_c)));
    perform dame_test.expect('approver deletes', 'ok',
      dame_test.run(cap, format($q$select public.dame_rows_remove(%L, %L, 'bids', %L)$q$, s, 'trk', id_c)));
    perform dame_test.expect('the deleted row is gone', 'bad_request',
      dame_test.run(cr, format($q$select public.dame_rows_get(%L, %L, 'bids', %L)$q$, s, 'trk', id_c)));
    perform dame_test.expect('deleting it twice is refused', 'bad_request',
      dame_test.run(cap, format($q$select public.dame_rows_remove(%L, %L, 'bids', %L)$q$, s, 'trk', id_c)));

    -- ------------------------------------------------ 8. private: each person, his own rows only
    id_p := dame_test.val(cc, format($q$select public.dame_rows_add(%L, %L, 'notes', '{"note":"mine"}') ->> 'id'$q$, s, 'trk'));
    perform dame_test.expect('contributor adds a private row', 'ok', case when id_p ~ '^[0-9a-f-]{36}$' then 'ok' else id_p end);
    perform dame_test.expect('he sees it', '1', dame_test.val(cc, format($q$select jsonb_array_length(public.dame_rows_list(%L, %L, 'notes'))$q$, s, 'trk')));
    perform dame_test.expect('an approver does not', '0', dame_test.val(cap, format($q$select jsonb_array_length(public.dame_rows_list(%L, %L, 'notes'))$q$, s, 'trk')));
    perform dame_test.expect('the tool''s manager does not either', '0', dame_test.val(cm, format($q$select jsonb_array_length(public.dame_rows_list(%L, %L, 'notes'))$q$, s, 'trk')));
    perform dame_test.expect('filtering on the owner does not open it', '0',
      dame_test.val(cap, format($q$select jsonb_array_length(public.dame_rows_list(%L, %L, 'notes', %L))$q$, s, 'trk', format('{"where":{"owner":"%s"}}', c))));
    perform dame_test.expect('another person cannot get it by its id', 'bad_request',
      dame_test.run(cap, format($q$select public.dame_rows_get(%L, %L, 'notes', %L)$q$, s, 'trk', id_p)));
    perform dame_test.expect('another person cannot change it', 'bad_request',
      dame_test.run(cap, format($q$select public.dame_rows_update(%L, %L, 'notes', %L, '{"note":"yours"}')$q$, s, 'trk', id_p)));
    perform dame_test.expect('another person cannot delete it', 'bad_request',
      dame_test.run(cm, format($q$select public.dame_rows_remove(%L, %L, 'notes', %L)$q$, s, 'trk', id_p)));
    perform dame_test.expect('a reader cannot add a private row', 'not_allowed',
      dame_test.run(cr, format($q$select public.dame_rows_add(%L, %L, 'notes', '{"note":"x"}')$q$, s, 'trk')));
    perform dame_test.expect('its owner changes it', 'better',
      dame_test.val(cc, format($q$select public.dame_rows_update(%L, %L, 'notes', %L, '{"note":"better"}') ->> 'note'$q$, s, 'trk', id_p)));
    perform dame_test.expect('its owner deletes it, with the level contribute', 'ok',
      dame_test.run(cc, format($q$select public.dame_rows_remove(%L, %L, 'notes', %L)$q$, s, 'trk', id_p)));

    -- ------------------------------------------------ 9. reference: everyone reads, managers change
    foreach q in array array['cc', 'ce', 'cap'] loop
      perform dame_test.expect('reference table: adding is refused for ' || q, 'not_allowed',
        dame_test.run(case q when 'cc' then cc when 'ce' then ce else cap end,
          format($q$select public.dame_rows_add(%L, %L, 'prices', '{"item":"x","price":1}')$q$, s, 'trk')));
    end loop;
    id_ref := dame_test.val(cm, format($q$select public.dame_rows_add(%L, %L, 'prices', '{"item":"Valve","price":10}') ->> 'id'$q$, s, 'trk'));
    perform dame_test.expect('the manager adds a reference row', 'ok', case when id_ref ~ '^[0-9a-f-]{36}$' then 'ok' else id_ref end);
    perform dame_test.expect('a reader reads it', 'Valve',
      dame_test.val(cr, format($q$select public.dame_rows_list(%L, %L, 'prices') -> 0 ->> 'item'$q$, s, 'trk')));
    perform dame_test.expect('an approver cannot change it', 'not_allowed',
      dame_test.run(cap, format($q$select public.dame_rows_update(%L, %L, 'prices', %L, '{"price":1}')$q$, s, 'trk', id_ref)));
    perform dame_test.expect('an approver cannot delete it', 'not_allowed',
      dame_test.run(cap, format($q$select public.dame_rows_remove(%L, %L, 'prices', %L)$q$, s, 'trk', id_ref)));
    perform dame_test.expect('the space admin changes it', '12',
      dame_test.val(ca, format($q$select public.dame_rows_update(%L, %L, 'prices', %L, '{"price":12}') ->> 'price'$q$, s, 'trk', id_ref)));
    perform dame_test.expect('the manager deletes it', 'ok',
      dame_test.run(cm, format($q$select public.dame_rows_remove(%L, %L, 'prices', %L)$q$, s, 'trk', id_ref)));

    -- ------------------------------------------------ 10. the preview has its own rows
    id_prev := dame_test.val(cm, format($q$select public.dame_rows_add(%L, %L, 'bids', '{"project":"Trial"}', true) ->> 'id'$q$, s, 'trk'));
    perform dame_test.expect('a manager adds a row in the preview', 'ok', case when id_prev ~ '^[0-9a-f-]{36}$' then 'ok' else id_prev end);
    perform dame_test.expect('the preview row is not among the live rows', '0',
      dame_test.val(cr, format($q$select count(*) from jsonb_array_elements(public.dame_rows_list(%L, %L, 'bids')) x where x ->> 'project' = 'Trial'$q$, s, 'trk')));
    perform dame_test.expect('the live rows are not in the preview', 'Trial',
      dame_test.val(cm, format($q$select string_agg(x ->> 'project', ',') from jsonb_array_elements(public.dame_rows_list(%L, %L, 'bids', '{}', true)) x$q$, s, 'trk')));
    perform dame_test.expect('in the preview a manager may delete at once', 'ok',
      dame_test.run(cm, format($q$select public.dame_rows_remove(%L, %L, 'bids', %L, true)$q$, s, 'trk', id_prev)));
    foreach q in array array['list', 'add'] loop
      perform dame_test.expect('an approver who is not a manager has no preview data: ' || q, 'not_allowed',
        dame_test.run(cap, case q when 'list' then format($q$select public.dame_rows_list(%L, %L, 'bids', '{}', true)$q$, s, 'trk')
                                 else format($q$select public.dame_rows_add(%L, %L, 'bids', '{"project":"x"}', true)$q$, s, 'trk') end));
    end loop;
    perform dame_test.expect('the manager sees the row counts, live and preview', '2/0',
      dame_test.val(cm, format($q$select (t ->> 'rows') || '/' || (t ->> 'preview_rows') from jsonb_array_elements(public.dame_tables_list(%L, %L)) t where t ->> 'name' = 'bids'$q$, s, 'trk')));

    -- ------------------------------------------------ 11. adding a column
    perform dame_test.expect('a contributor cannot add a column', 'not_allowed',
      dame_test.run(cc, format($q$select public.dame_table_add_column(%L, %L, 'bids', '{"name":"region","type":"text"}')$q$, s, 'trk')));
    perform dame_test.expect('the manager adds a column', 'ok',
      dame_test.run(cm, format($q$select public.dame_table_add_column(%L, %L, 'bids', '{"name":"region","type":"choice","choices":["north","south"]}')$q$, s, 'trk')));
    perform dame_test.expect('the new column takes values at once, live and preview', 'north/ok',
      dame_test.val(cc, format($q$select public.dame_rows_add(%L, %L, 'bids', '{"project":"Delta","region":"north"}') ->> 'region'$q$, s, 'trk'))
      || '/' || dame_test.run(cm, format($q$select public.dame_rows_add(%L, %L, 'bids', '{"region":"south"}', true)$q$, s, 'trk')));
    perform dame_test.expect('older rows have it empty', '(null)',
      dame_test.val(cr, format($q$select public.dame_rows_get(%L, %L, 'bids', %L) ->> 'region'$q$, s, 'trk', id_e)));
    foreach q in array array['{"name":"region","type":"text"}', '{"name":"id","type":"text"}', '{"name":"x y","type":"text"}', '{"name":"zz","type":"blob"}'] loop
      perform dame_test.expect('column refused: ' || q, 'bad_request',
        dame_test.run(cm, format('select public.dame_table_add_column(%L, %L, %L, %L)', s, 'trk', 'bids', q)));
    end loop;

    -- ------------------------------------------------ 12. the people of a tool
    perform dame_test.expect('a reader gets the people who have the tool, by name', 'Zz Ada,Zz App,Zz Cat,Zz Edi,Zz Max,Zz Ray',
      dame_test.val(cr, format($q$select string_agg(p ->> 'name', ',') from jsonb_array_elements(public.dame_tool_people(%L, %L)) p$q$, s, 'trk')));
    perform dame_test.expect('no email is given out with them', 'id,name',
      dame_test.val(cr, format($q$select string_agg(k, ',' order by k) from jsonb_object_keys(public.dame_tool_people(%L, %L) -> 0) k$q$, s, 'trk')));
    perform dame_test.expect('a person without the tool gets nobody', 'not_allowed',
      dame_test.run(cx, format('select public.dame_tool_people(%L, %L)', s, 'trk')));

    -- ------------------------------------------------ 13. switched off, deleted
    update core.profiles set status = 'disabled' where id = c;
    cc := dame_test.claims(c, 40);
    perform dame_test.expect('a switched-off account reads no row', 'disabled',
      dame_test.run(cc, format($q$select public.dame_rows_list(%L, %L, 'bids')$q$, s, 'trk')));
    update core.profiles set status = 'active' where id = c;
    update core.tools set active = false where space = s and id = 'trk';
    perform dame_test.expect('tool switched off: no rows for its users', 'not_allowed',
      dame_test.run(cap, format($q$select public.dame_rows_list(%L, %L, 'bids')$q$, s, 'trk')));
    update core.tools set active = true where space = s and id = 'trk';
    perform dame_test.expect('deleting a table: wrong word refused', 'bad_request',
      dame_test.run(cm, format($q$select public.dame_table_drop(%L, %L, 'notes', 'yes')$q$, s, 'trk')));
    perform dame_test.expect('deleting a table: refused for an approver', 'not_allowed',
      dame_test.run(cap, format($q$select public.dame_table_drop(%L, %L, 'notes', 'notes')$q$, s, 'trk')));
    perform dame_test.expect('deleting a table: its name typed', 'ok',
      dame_test.run(cm, format($q$select public.dame_table_drop(%L, %L, 'notes', 'notes')$q$, s, 'trk')));
    perform dame_test.expect('it is gone, live and preview, and from the list', 'none/none/0',
      coalesce(to_regclass(live || '.notes')::text, 'none') || '/' || coalesce(to_regclass(prev || '.notes')::text, 'none') || '/'
      || (select count(*) from core.tool_tables where space = s and tool = 'trk' and name = 'notes'));
    perform dame_test.expect('its rows cannot be asked for any more', 'bad_request',
      dame_test.run(cap, format($q$select public.dame_rows_list(%L, %L, 'notes')$q$, s, 'trk')));
    perform dame_test.expect('making and deleting tables is in the audit', 'true',
      (select (count(*) filter (where action = 'table.created') = 3 and count(*) filter (where action = 'table.deleted') = 1
               and count(*) filter (where action = 'table.column_added') = 1)::text from core.audit where space = s));
    perform dame_test.expect('admin deletes the tool', 'ok',
      dame_test.run(ca, format('select public.dame_tool_delete(%L, %L, %L)', s, 'trk', 'trk')));
    perform dame_test.expect('its tables and rows are gone with it', 'none/none/0',
      coalesce(to_regnamespace(live)::text, 'none') || '/' || coalesce(to_regnamespace(prev)::text, 'none') || '/'
      || (select count(*) from core.tool_tables where space = s));

    -- ------------------------------------------------ 14. nothing else was touched
    perform dame_test.expect('the people table is still there', 'yes',
      case when to_regclass('core.profiles') is not null then 'yes' else 'GONE' end);
    perform dame_test.expect('core.security_check() finds nothing', '0',
      (select count(*)::text from core.security_check()));

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
