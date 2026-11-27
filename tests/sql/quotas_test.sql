-- tests/sql/quotas_test.sql - allowed and refused cases for the limits of a space on rows, tables
-- and columns at work, who sees them, who sets them, who asks for more and who
-- answers (db/08_quotas.sql).
-- Serves: contract 5 (Data), 3 (Access) and 7 (Audit).
-- Must not change: the test leaves nothing behind. Everything it does, the
-- site's default limits included, is undone before the result is shown.
--
-- How to run: on a database built from db/, paste the whole file into the SQL editor and press Run.
-- First row is the summary; any row with pass = false is a failure.

drop table if exists dame_test_result;

do $test$
declare
  v_results jsonb := '[]'::jsonb;
  v_error   text;
  i  uuid := '00000000-0000-4000-8000-0000000000a9';  -- IT admin, in no space
  a  uuid := '00000000-0000-4000-8000-0000000000b9';  -- admin of the space
  m  uuid := '00000000-0000-4000-8000-0000000000c9';  -- manager of the tool
  c  uuid := '00000000-0000-4000-8000-0000000000d9';  -- level contribute
  x  uuid := '00000000-0000-4000-8000-0000000000e9';  -- approved, has nothing
  o  uuid := '00000000-0000-4000-8000-0000000000f9';  -- admin of another space
  p  uuid := '00000000-0000-4000-8000-000000000019';  -- pending
  d  uuid := '00000000-0000-4000-8000-000000000029';  -- switched off
  ci jsonb; ca jsonb; cm jsonb; cc jsonb; cx jsonb; co jsonb; cp jsonb; cd jsonb;
  s  text := 'zz-test-quota';
  s2 text := 'zz-test-other';
  cols jsonb := '[{"name":"title","type":"text"},{"name":"qty","type":"number"},{"name":"done","type":"bool"}]';
  q    text;
  n    integer := 0;
  k    integer;
  got  text;
  rid  text;
begin
  begin
    create schema dame_test;
    create table dame_test.results (n serial, test text, expected text, got text);

    create function dame_test.claims(p_uid uuid, p_n integer) returns jsonb
    language sql as $f$
      select jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'email', 'x@test.dame',
               'session_id', ('11111111-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid);
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

    insert into core.profiles (id, email, name, status, is_it) values
      (i, 'i11@test.dame', 'Zz Ida IT', 'active', true), (a, 'a11@test.dame', 'Zz Ada', 'active', false),
      (m, 'm11@test.dame', 'Zz Max', 'active', false), (c, 'c11@test.dame', 'Zz Cat', 'active', false),
      (x, 'x11@test.dame', 'Zz Xan', 'active', false), (o, 'o11@test.dame', 'Zz Oto', 'active', false),
      (p, 'p11@test.dame', 'Zz Pen', 'pending', false), (d, 'd11@test.dame', 'Zz Dis', 'disabled', false);
    insert into core.spaces (id, name, created_by) values (s, 'Quota', a), (s2, 'Other', o);
    insert into core.space_admins (space, user_id, added_by) values (s, a, a), (s2, o, o);
    insert into core.tools (space, id, name, created_by) values (s, 'trk', 'Tracker', a), (s, 'two', 'Second', a), (s2, 'trk', 'Tracker other', o);
    insert into core.tool_managers (space, tool, user_id, added_by) values (s, 'trk', m, a);
    insert into core.tool_access (space, tool, user_id, level, added_by) values (s, 'trk', c, 'contribute', a);
    ci := dame_test.claims(i, 1); ca := dame_test.claims(a, 2); cm := dame_test.claims(m, 3); cc := dame_test.claims(c, 4);
    cx := dame_test.claims(x, 5); co := dame_test.claims(o, 6); cp := dame_test.claims(p, 7); cd := dame_test.claims(d, 8);
    update core.settings set value = '10000' where key = 'quota_rows';
    update core.settings set value = '10' where key = 'quota_tables';
    update core.settings set value = '60' where key = 'quota_columns';

    -- ------------------------------------------------ 1. who may look
    perform dame_test.expect('signed out: the quota is not shown', 'signed_out', dame_test.run(null, format('select public.dame_quota_get(%L)', s)));
    perform dame_test.expect('pending: the quota is not shown', 'pending', dame_test.run(cp, format('select public.dame_quota_get(%L)', s)));
    perform dame_test.expect('switched off: the quota is not shown', 'disabled', dame_test.run(cd, format('select public.dame_quota_get(%L)', s)));
    foreach q in array array['cm', 'cc', 'cx', 'co'] loop
      perform dame_test.expect('only the space''s admin or IT sees its quota: refused for ' || q, 'not_allowed',
        dame_test.run(case q when 'cm' then cm when 'cc' then cc when 'cx' then cx else co end, format('select public.dame_quota_get(%L)', s)));
    end loop;
    perform dame_test.expect('a new space has the site''s default', '10000/10/60/false/0',
      dame_test.val(ca, format($q$select (j ->> 'max_rows') || '/' || (j ->> 'max_tables') || '/' || (j ->> 'max_columns') || '/' || (j ->> 'own') || '/' || (j ->> 'rows_used') from public.dame_quota_get(%L) j$q$, s)));
    perform dame_test.expect('IT sees the quota of a space it is not in', '10000', dame_test.val(ci, format($q$select public.dame_quota_get(%L) ->> 'max_rows'$q$, s)));
    perform dame_test.expect('IT cannot look at a space that does not exist', 'bad_request', dame_test.run(ci, $q$select public.dame_quota_get('zz-no-such')$q$));
    foreach q in array array['ca', 'cm', 'cc', 'cx'] loop
      perform dame_test.expect('only IT lists every space''s quota: refused for ' || q, 'not_allowed',
        dame_test.run(case q when 'ca' then ca when 'cm' then cm when 'cc' then cc else cx end, 'select public.dame_quota_list()'));
    end loop;
    perform dame_test.expect('signed out: no list', 'signed_out', dame_test.run(null, 'select public.dame_quota_list()'));
    perform dame_test.expect('IT lists both spaces', '2',
      dame_test.val(ci, $q$select count(*) from jsonb_array_elements(public.dame_quota_list() -> 'spaces') e where e ->> 'space' like 'zz-test-%'$q$));

    -- ------------------------------------------------ 2. who may set
    foreach q in array array['ca', 'cm', 'cc', 'cx', 'co'] loop
      perform dame_test.expect('only IT sets a space''s limits: refused for ' || q, 'not_allowed',
        dame_test.run(case q when 'ca' then ca when 'cm' then cm when 'cc' then cc when 'cx' then cx else co end,
          format('select public.dame_quota_set(%L, 5000000, 50, 100)', s)));
      perform dame_test.expect('only IT sets the default: refused for ' || q, 'not_allowed',
        dame_test.run(case q when 'ca' then ca when 'cm' then cm when 'cc' then cc when 'cx' then cx else co end,
          'select public.dame_quota_default_set(5000000, 50, 100)'));
    end loop;
    perform dame_test.expect('signed out: no setting', 'signed_out', dame_test.run(null, format('select public.dame_quota_set(%L, 5000, 5, 5)', s)));
    perform dame_test.expect('pending: no setting', 'pending', dame_test.run(cp, 'select public.dame_quota_default_set(5000, 5, 5)'));
    perform dame_test.expect('nothing was changed by the refused tries', '10000/0',
      (select value from core.settings where key = 'quota_rows') || '/' || (select count(*) from core.space_quotas where space = s and max_rows is not null));
    foreach q in array array['99, 2, 3', '10000001, 2, 3', '100, 0, 3', '100, 101, 3', '100, 2, 0', '100, 2, 201', '-5, 2, 3'] loop
      n := n + 1;
      perform dame_test.expect('limits outside the bounds are refused, case ' || n, 'bad_request',
        dame_test.run(ci, format('select public.dame_quota_set(%L, %s)', s, q)));
      perform dame_test.expect('a default outside the bounds is refused, case ' || n, 'bad_request',
        dame_test.run(ci, format('select public.dame_quota_default_set(%s)', q)));
    end loop;
    perform dame_test.expect('a default with a number missing is refused', 'bad_request', dame_test.run(ci, 'select public.dame_quota_default_set(null, 2, 3)'));
    perform dame_test.expect('limits for a space that does not exist are refused', 'bad_request', dame_test.run(ci, $q$select public.dame_quota_set('zz-no-such', 100, 2, 3)$q$));
    perform dame_test.expect('IT gives the space 100 rows, 2 tables a tool, 3 columns', 'ok', dame_test.run(ci, format('select public.dame_quota_set(%L, 100, 2, 3)', s)));
    perform dame_test.expect('the admin sees his own limits', '100/2/3/true',
      dame_test.val(ca, format($q$select (j ->> 'max_rows') || '/' || (j ->> 'max_tables') || '/' || (j ->> 'max_columns') || '/' || (j ->> 'own') from public.dame_quota_get(%L) j$q$, s)));
    perform dame_test.expect('the other space keeps the default', '10000', dame_test.val(co, format($q$select public.dame_quota_get(%L) ->> 'max_rows'$q$, s2)));

    -- ------------------------------------------------ 3. columns and tables
    perform dame_test.expect('a table with 4 columns is refused where 3 are allowed', 'quota_full',
      dame_test.run(cm, format('select public.dame_table_create(%L, %L, %L, %L, %L)', s, 'trk', 'wide', 'team', cols || '[{"name":"extra","type":"text"}]'::jsonb)));
    perform dame_test.expect('a table with 3 columns is made', 'ok',
      dame_test.run(cm, format('select public.dame_table_create(%L, %L, %L, %L, %L)', s, 'trk', 'items', 'team', cols)));
    perform dame_test.expect('a 4th column is refused', 'quota_full',
      dame_test.run(cm, format('select public.dame_table_add_column(%L, %L, %L, %L)', s, 'trk', 'items', '{"name":"extra","type":"text"}')));
    perform dame_test.expect('the second table of the tool is made', 'ok',
      dame_test.run(cm, format('select public.dame_table_create(%L, %L, %L, %L, %L)', s, 'trk', 'notes', 'private', cols)));
    perform dame_test.expect('the third table of the tool is refused', 'quota_full',
      dame_test.run(cm, format('select public.dame_table_create(%L, %L, %L, %L, %L)', s, 'trk', 'more', 'team', cols)));
    perform dame_test.expect('nothing was made by the refused tries', 'none/none/2',
      coalesce(to_regclass('t_zz_test_quota__trk.more')::text, 'none') || '/' || coalesce(to_regclass('t_zz_test_quota__trk.wide')::text, 'none')
      || '/' || (select count(*) from core.tool_tables where space = s));
    perform dame_test.expect('the limit is per tool: another tool of the space makes its own table', 'ok',
      dame_test.run(ca, format('select public.dame_table_create(%L, %L, %L, %L, %L)', s, 'two', 'items', 'team', cols)));
    perform dame_test.expect('the other space is not held by this space''s limits: 4 columns', 'ok',
      dame_test.run(co, format('select public.dame_table_create(%L, %L, %L, %L, %L)', s2, 'trk', 'items', 'team', cols || '[{"name":"extra","type":"text"}]'::jsonb)));
    perform dame_test.expect('with the default, 61 columns are still refused', 'bad_request',
      dame_test.run(co, format('select public.dame_table_create(%L, %L, %L, %L, %L)', s2, 'trk', 'huge', 'team',
        (select jsonb_agg(jsonb_build_object('name', 'c' || g, 'type', 'text')) from generate_series(1, 61) g))));
    perform dame_test.expect('IT raises the columns to 4', 'ok', dame_test.run(ci, format('select public.dame_quota_set(%L, 100, 2, 4)', s)));
    perform dame_test.expect('now the 4th column is added', 'ok',
      dame_test.run(cm, format('select public.dame_table_add_column(%L, %L, %L, %L)', s, 'trk', 'items', '{"name":"extra","type":"text"}')));
    perform dame_test.expect('and a 5th is refused', 'quota_full',
      dame_test.run(cm, format('select public.dame_table_add_column(%L, %L, %L, %L)', s, 'trk', 'items', '{"name":"extra2","type":"text"}')));

    -- ------------------------------------------------ 4. rows
    for k in 1..97 loop
      got := dame_test.run(cc, format($q$select public.dame_rows_add(%L, 'trk', 'items', '{"title":"row %s"}')$q$, s, k));
      exit when got <> 'ok';
    end loop;
    perform dame_test.expect('a member adds 97 rows', 'ok/97', got || '/' || (select count(*) from t_zz_test_quota__trk.items));
    perform dame_test.expect('a row in a private table counts', 'ok', dame_test.run(cc, format($q$select public.dame_rows_add(%L, 'trk', 'notes', '{"title":"mine"}')$q$, s)));
    perform dame_test.expect('a row in the preview counts', 'ok', dame_test.run(cm, format($q$select public.dame_rows_add(%L, 'trk', 'items', '{"title":"trial"}', true)$q$, s)));
    perform dame_test.expect('a row in another tool of the space counts', 'ok', dame_test.run(ca, format($q$select public.dame_rows_add(%L, 'two', 'items', '{"title":"second"}')$q$, s)));
    perform dame_test.expect('the admin sees 100 of 100 used', '100/100', dame_test.val(ca, format($q$select (j ->> 'rows_used') || '/' || (j ->> 'max_rows') from public.dame_quota_get(%L) j$q$, s)));
    perform dame_test.expect('row 101 is refused', 'quota_full', dame_test.run(cc, format($q$select public.dame_rows_add(%L, 'trk', 'items', '{"title":"too many"}')$q$, s)));
    perform dame_test.expect('also for the admin', 'quota_full', dame_test.run(ca, format($q$select public.dame_rows_add(%L, 'trk', 'items', '{"title":"too many"}')$q$, s)));
    perform dame_test.expect('also in the preview', 'quota_full', dame_test.run(cm, format($q$select public.dame_rows_add(%L, 'trk', 'items', '{"title":"too many"}', true)$q$, s)));
    perform dame_test.expect('also in another tool of the space', 'quota_full', dame_test.run(ca, format($q$select public.dame_rows_add(%L, 'two', 'items', '{"title":"too many"}')$q$, s)));
    perform dame_test.expect('nothing was added by the refused tries', '97/1/1', (select count(*) from t_zz_test_quota__trk.items) || '/' || (select count(*) from p_zz_test_quota__trk.items) || '/' || (select count(*) from t_zz_test_quota__two.items));
    perform dame_test.expect('a full space still reads', '97', dame_test.val(cc, format($q$select jsonb_array_length(public.dame_rows_list(%L, 'trk', 'items', '{"limit":1000}'))$q$, s)));
    select id::text into rid from t_zz_test_quota__trk.items where title = 'row 1';
    perform dame_test.expect('a full space still changes rows', 'ok', dame_test.run(cc, format($q$select public.dame_rows_update(%L, 'trk', 'items', %L, '{"qty":5}')$q$, s, rid)));
    perform dame_test.expect('the other space is not full', 'ok', dame_test.run(co, format($q$select public.dame_rows_add(%L, 'trk', 'items', '{"title":"free"}')$q$, s2)));
    perform dame_test.expect('a full space still deletes', 'ok', dame_test.run(ca, format($q$select public.dame_rows_remove(%L, 'trk', 'items', %L)$q$, s, rid)));
    perform dame_test.expect('after a delete there is room for one row', 'ok', dame_test.run(cc, format($q$select public.dame_rows_add(%L, 'trk', 'items', '{"title":"fits"}')$q$, s)));
    perform dame_test.expect('and for one only', 'quota_full', dame_test.run(cc, format($q$select public.dame_rows_add(%L, 'trk', 'items', '{"title":"too many"}')$q$, s)));
    got := dame_test.run(ca, format($q$select public.dame_rows_remove(%L, 'trk', 'items', %L)$q$, s, rid));
    perform dame_test.expect('deleting a row that is already gone does not change the count', 'bad_request/100', got || '/' || (select rows_used from core.space_quotas where space = s));
    got := dame_test.run(ci, format('select public.dame_quota_set(%L, 100, 2, 4)', s)) || '/' || dame_test.run(ci, format('select public.dame_quota_set(%L, 149, 2, 4)', s));
    got := dame_test.run(cc, format($q$select public.dame_rows_add(%L, 'trk', 'items', '{"qty":"many"}')$q$, s));
    perform dame_test.expect('a row refused for its content is not counted', 'bad_request/100', got || '/' || (select rows_used from core.space_quotas where space = s));
    got := dame_test.run(ci, format('select public.dame_quota_set(%L, 100, 1, 4)', s));
    perform dame_test.expect('IT lowers a limit below what is used: nothing is deleted', 'ok/100/2', got || '/' || (select rows_used from core.space_quotas where space = s)
      || '/' || (select count(*) from core.tool_tables where space = s and tool = 'trk'));
    perform dame_test.expect('IT raises the rows to 150', 'ok', dame_test.run(ci, format('select public.dame_quota_set(%L, 150, 2, 4)', s)));
    perform dame_test.expect('now a row is added', 'ok', dame_test.run(cc, format($q$select public.dame_rows_add(%L, 'trk', 'items', '{"title":"room"}')$q$, s)));
    update core.space_quotas set rows_used = 3 where space = s;
    perform dame_test.expect('a wrong count is put right when the admin looks', '101', dame_test.val(ca, format($q$select public.dame_quota_get(%L) ->> 'rows_used'$q$, s)));
    perform dame_test.expect('the admin sees where the rows are', '99/1/2/4',
      dame_test.val(ca, format($q$select (e ->> 'rows') || '/' || (e ->> 'preview_rows') || '/' || (e ->> 'tables') || '/' || (e ->> 'most_columns') from jsonb_array_elements(public.dame_quota_get(%L) -> 'tools') e where e ->> 'id' = 'trk'$q$, s)));
    got := dame_test.run(cm, format('select public.dame_table_drop(%L, %L, %L, %L)', s, 'trk', 'items', 'items'));
    perform dame_test.expect('deleting a table gives its rows back', 'ok/2', got || '/' || (select rows_used from core.space_quotas where space = s));
    perform dame_test.expect('after it a table can be made again', 'ok',
      dame_test.run(cm, format('select public.dame_table_create(%L, %L, %L, %L, %L)', s, 'trk', 'items', 'team', cols)));

    -- ------------------------------------------------ 5. asking for more
    foreach q in array array['ci', 'cm', 'cc', 'cx', 'co'] loop
      perform dame_test.expect('only an admin of the space asks for more: refused for ' || q, 'not_allowed',
        dame_test.run(case q when 'ci' then ci when 'cm' then cm when 'cc' then cc when 'cx' then cx else co end,
          format($q$select public.dame_quota_request(%L, 5000, 5, 10, 'We need more room for the bids.')$q$, s)));
    end loop;
    perform dame_test.expect('signed out: no request', 'signed_out', dame_test.run(null, format($q$select public.dame_quota_request(%L, 5000, 5, 10, 'We need more room for the bids.')$q$, s)));
    foreach q in array array[
      $q$149, 2, 4, 'We need more room for the bids.'$q$, $q$150, 1, 4, 'We need more room for the bids.'$q$,
      $q$150, 2, 3, 'We need more room for the bids.'$q$, $q$150, 2, 4, 'We need more room for the bids.'$q$,
      $q$5000, 5, 10, 'more'$q$, $q$5000, 5, 10, null$q$, $q$10000001, 5, 10, 'We need more room for the bids.'$q$,
      $q$5000, 101, 10, 'We need more room for the bids.'$q$, $q$5000, 5, 201, 'We need more room for the bids.'$q$,
      $q$null, 5, 10, 'We need more room for the bids.'$q$] loop
      n := n + 1;
      perform dame_test.expect('a request that makes no sense is refused, case ' || n, 'bad_request',
        dame_test.run(ca, format('select public.dame_quota_request(%L, %s)', s, q)));
    end loop;
    perform dame_test.expect('a reason as long as a book is refused', 'bad_request',
      dame_test.run(ca, format('select public.dame_quota_request(%L, 5000, 5, 10, %L)', s, repeat('x', 501))));
    perform dame_test.expect('the admin asks for 5000 rows, 5 tables, 10 columns', 'ok',
      dame_test.run(ca, format($q$select public.dame_quota_request(%L, 5000, 5, 10, 'We need more room for the bids.')$q$, s)));
    perform dame_test.expect('asking does not change the limits', '150', dame_test.val(ca, format($q$select public.dame_quota_get(%L) ->> 'max_rows'$q$, s)));
    perform dame_test.expect('a second request while one waits is refused', 'bad_request',
      dame_test.run(ca, format($q$select public.dame_quota_request(%L, 6000, 5, 10, 'We need even more room.')$q$, s)));
    perform dame_test.expect('the admin sees his waiting request', '5000', dame_test.val(ca, format($q$select public.dame_quota_get(%L) -> 'request' ->> 'rows'$q$, s)));
    perform dame_test.expect('IT sees it with who asked and why', 'Zz Ada/We need more room for the bids.',
      dame_test.val(ci, format($q$select (e -> 'request' -> 'asked_by' ->> 'name') || '/' || (e -> 'request' ->> 'reason') from jsonb_array_elements(public.dame_quota_list() -> 'spaces') e where e ->> 'space' = %L$q$, s)));
    select id::text into rid from core.quota_requests where space = s and status = 'open';

    -- ------------------------------------------------ 6. answering
    foreach q in array array['ca', 'cm', 'cc', 'cx', 'co'] loop
      perform dame_test.expect('only IT answers a request: refused for ' || q, 'not_allowed',
        dame_test.run(case q when 'ca' then ca when 'cm' then cm when 'cc' then cc when 'cx' then cx else co end,
          format('select public.dame_quota_answer(%s, true, null, null, null, null)', rid)));
    end loop;
    perform dame_test.expect('signed out: no answer', 'signed_out', dame_test.run(null, format('select public.dame_quota_answer(%s, true, null, null, null, null)', rid)));
    perform dame_test.expect('the admin did not grant himself anything', '150/open',
      (select max_rows from core.space_quotas where space = s) || '/' || (select status from core.quota_requests where id = rid::bigint));
    perform dame_test.expect('declining without a reason is refused', 'bad_request', dame_test.run(ci, format('select public.dame_quota_answer(%s, false, null, null, null, null)', rid)));
    perform dame_test.expect('an answer that is neither yes nor no is refused', 'bad_request', dame_test.run(ci, format('select public.dame_quota_answer(%s, null, null, null, null, null)', rid)));
    perform dame_test.expect('granting a number outside the bounds is refused', 'bad_request', dame_test.run(ci, format('select public.dame_quota_answer(%s, true, 99999999, null, null, null)', rid)));
    perform dame_test.expect('a request that does not exist is refused', 'bad_request', dame_test.run(ci, 'select public.dame_quota_answer(-1, true, null, null, null, null)'));
    perform dame_test.expect('IT declines with a reason', 'ok', dame_test.run(ci, format($q$select public.dame_quota_answer(%s, false, null, null, null, 'Archive the old bids first.')$q$, rid)));
    perform dame_test.expect('the limits stay', '150', dame_test.val(ca, format($q$select public.dame_quota_get(%L) ->> 'max_rows'$q$, s)));
    perform dame_test.expect('the admin reads the answer', 'declined/Archive the old bids first./Zz Ida IT',
      dame_test.val(ca, format($q$select (j -> 'answers' -> 0 ->> 'status') || '/' || (j -> 'answers' -> 0 ->> 'answer') || '/' || (j -> 'answers' -> 0 -> 'answered_by' ->> 'name') from public.dame_quota_get(%L) j$q$, s)));
    perform dame_test.expect('an answered request cannot be answered again', 'bad_request', dame_test.run(ci, format('select public.dame_quota_answer(%s, true, null, null, null, null)', rid)));
    perform dame_test.expect('nothing waits: taking back is refused', 'bad_request', dame_test.run(ca, format('select public.dame_quota_request_cancel(%L)', s)));
    perform dame_test.expect('the admin asks again', 'ok', dame_test.run(ca, format($q$select public.dame_quota_request(%L, 5000, 5, 10, 'The old bids are archived now.')$q$, s)));
    foreach q in array array['ci', 'cm', 'cc', 'cx', 'co'] loop
      perform dame_test.expect('only an admin of the space takes a request back: refused for ' || q, 'not_allowed',
        dame_test.run(case q when 'ci' then ci when 'cm' then cm when 'cc' then cc when 'cx' then cx else co end, format('select public.dame_quota_request_cancel(%L)', s)));
    end loop;
    perform dame_test.expect('the admin takes it back', 'ok', dame_test.run(ca, format('select public.dame_quota_request_cancel(%L)', s)));
    perform dame_test.expect('and asks once more', 'ok', dame_test.run(ca, format($q$select public.dame_quota_request(%L, 5000, 5, 10, 'The old bids are archived now.')$q$, s)));
    select id::text into rid from core.quota_requests where space = s and status = 'open';
    perform dame_test.expect('IT grants, with fewer rows than asked', 'ok', dame_test.run(ci, format($q$select public.dame_quota_answer(%s, true, 2000, null, null, 'Half for now.')$q$, rid)));
    perform dame_test.expect('the space has what IT gave', '2000/5/10/(null)',
      dame_test.val(ca, format($q$select (j ->> 'max_rows') || '/' || (j ->> 'max_tables') || '/' || (j ->> 'max_columns') || '/' || coalesce(j ->> 'request', '(null)') from public.dame_quota_get(%L) j$q$, s)));
    perform dame_test.expect('and the third table of the tool is made now', 'ok',
      dame_test.run(cm, format('select public.dame_table_create(%L, %L, %L, %L, %L)', s, 'trk', 'more', 'team', cols)));

    -- ------------------------------------------------ 7. the default, the audit, deleting
    perform dame_test.expect('IT changes the site''s default', 'ok', dame_test.run(ci, 'select public.dame_quota_default_set(500, 3, 20)'));
    perform dame_test.expect('a space without limits of its own follows it', '500/3/20/false',
      dame_test.val(co, format($q$select (j ->> 'max_rows') || '/' || (j ->> 'max_tables') || '/' || (j ->> 'max_columns') || '/' || (j ->> 'own') from public.dame_quota_get(%L) j$q$, s2)));
    perform dame_test.expect('a space with its own limits does not', '2000', dame_test.val(ca, format($q$select public.dame_quota_get(%L) ->> 'max_rows'$q$, s)));
    perform dame_test.expect('IT puts the space back on the default', 'ok', dame_test.run(ci, format('select public.dame_quota_set(%L, null, null, null)', s)));
    perform dame_test.expect('now it follows the default too', '500/3/20/false',
      dame_test.val(ca, format($q$select (j ->> 'max_rows') || '/' || (j ->> 'max_tables') || '/' || (j ->> 'max_columns') || '/' || (j ->> 'own') from public.dame_quota_get(%L) j$q$, s)));
    perform dame_test.expect('every step is in the audit', '7/1/3/1/1/1',
      (select count(*) filter (where action = 'quota.set') || '/' || count(*) filter (where action = 'quota.default_set') || '/' ||
              count(*) filter (where action = 'quota.requested') || '/' || count(*) filter (where action = 'quota.declined') || '/' ||
              count(*) filter (where action = 'quota.granted') || '/' || count(*) filter (where action = 'quota.request_taken_back')
         from core.audit where actor in (i, a)));
    perform dame_test.expect('the space admin sees the quota lines of his space in the audit', 'true',
      dame_test.val(ca, format($q$select (count(*) >= 5)::text from jsonb_array_elements(public.dame_audit_scope_list(%L, null, 100, null)) e where e ->> 'action' like 'quota.%%'$q$, s)));
    got := dame_test.run(ca, format('select public.dame_tool_delete(%L, %L, %L)', s, 'trk', 'trk'));
    perform dame_test.expect('deleting a tool gives its rows back', 'ok/1', got || '/' || (select rows_used from core.space_quotas where space = s));
    got := dame_test.run(ci, format('select public.dame_space_delete(%L, %L)', s, s));
    perform dame_test.expect('deleting the space removes its quota and its requests', 'ok/0/0', got || '/' || (select count(*) from core.space_quotas where space = s)
      || '/' || (select count(*) from core.quota_requests where space = s));
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
