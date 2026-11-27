-- tests/sql/tools_quota_test.sql - allowed and refused cases for how many tools a space may have, who
-- sets the limit, asking for more, and calls that leave the tools number out
-- (db/08_quotas.sql).
-- Serves: contract 2 (Structure), 3 (Access) and 7 (Audit).
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
  i  uuid := '00000000-0000-4000-8000-0000000000aa';  -- IT admin, in no space
  a  uuid := '00000000-0000-4000-8000-0000000000ba';  -- admin of the space
  m  uuid := '00000000-0000-4000-8000-0000000000ca';  -- member of the space
  x  uuid := '00000000-0000-4000-8000-0000000000ea';  -- approved, has nothing
  o  uuid := '00000000-0000-4000-8000-0000000000fa';  -- admin of another space
  p  uuid := '00000000-0000-4000-8000-00000000001a';  -- pending
  ci jsonb; ca jsonb; cm jsonb; cx jsonb; co jsonb; cp jsonb;
  s  text := 'zz-test-tools';
  s2 text := 'zz-test-other';
  mk text := $q$select public.dame_tool_create(%L, %L, 'Tool', '', '', '', false, 'read')$q$;
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

    insert into core.profiles (id, email, name, status, is_it) values
      (i, 'i12@test.dame', 'Zz Ida IT', 'active', true), (a, 'a12@test.dame', 'Zz Ada', 'active', false),
      (m, 'm12@test.dame', 'Zz Max', 'active', false), (x, 'x12@test.dame', 'Zz Xan', 'active', false),
      (o, 'o12@test.dame', 'Zz Oto', 'active', false), (p, 'p12@test.dame', 'Zz Pen', 'pending', false);
    insert into core.spaces (id, name, created_by) values (s, 'Tools', a), (s2, 'Other', o);
    insert into core.space_admins (space, user_id, added_by) values (s, a, a), (s2, o, o);
    insert into core.space_members (space, user_id, added_by) values (s, m, a);
    ci := dame_test.claims(i, 1); ca := dame_test.claims(a, 2); cm := dame_test.claims(m, 3);
    cx := dame_test.claims(x, 5); co := dame_test.claims(o, 6); cp := dame_test.claims(p, 7);
    update core.settings set value = '10000' where key = 'quota_rows';
    update core.settings set value = '10' where key = 'quota_tables';
    update core.settings set value = '60' where key = 'quota_columns';
    update core.settings set value = '10' where key = 'quota_tools';

    -- ------------------------------------------------ 1. the default: 10 tools a space
    perform dame_test.expect('a new space may have 10 tools and has none', '10/0/false',
      dame_test.val(ca, format($q$select (j ->> 'max_tools') || '/' || (j ->> 'tools_used') || '/' || (j ->> 'own') from public.dame_quota_get(%L) j$q$, s)));
    foreach q in array array['cm', 'cx', 'co', 'ci'] loop
      perform dame_test.expect('only an admin of the space makes a tool: refused for ' || q, 'not_allowed',
        dame_test.run(case q when 'cm' then cm when 'cx' then cx when 'co' then co else ci end, format(mk, s, 'not-mine')));
    end loop;
    for k in 1..10 loop
      got := dame_test.run(ca, format(mk, s, 'tool-' || k));
      exit when got <> 'ok';
    end loop;
    perform dame_test.expect('the admin makes 10 tools', 'ok/10', got || '/' || (select count(*) from core.tools where space = s));
    perform dame_test.expect('tool 11 is refused', 'quota_full', dame_test.run(ca, format(mk, s, 'tool-11')));
    perform dame_test.expect('nothing was made by the refused try', '10/0',
      (select count(*) from core.tools where space = s) || '/' || (select count(*) from core.audit where space = s and tool = 'tool-11'));
    perform dame_test.expect('a wrong id is still told as a wrong id, not as a full space', 'bad_request', dame_test.run(ca, format(mk, s, 'Bad Id')));
    perform dame_test.expect('the other space is not held by this one', 'ok', dame_test.run(co, format(mk, s2, 'tool-1')));
    perform dame_test.expect('the admin sees 10 of 10', '10/10', dame_test.val(ca, format($q$select (j ->> 'tools_used') || '/' || (j ->> 'max_tools') from public.dame_quota_get(%L) j$q$, s)));
    perform dame_test.expect('IT sees it in the list of spaces', '10/10',
      dame_test.val(ci, format($q$select (e ->> 'tools_used') || '/' || (e ->> 'max_tools') from jsonb_array_elements(public.dame_quota_list() -> 'spaces') e where e ->> 'space' = %L$q$, s)));
    got := dame_test.run(ca, format('select public.dame_tool_delete(%L, %L, %L)', s, 'tool-10', 'tool-10'));
    perform dame_test.expect('after deleting a tool there is room for one', 'ok/ok/quota_full',
      got || '/' || dame_test.run(ca, format(mk, s, 'tool-new')) || '/' || dame_test.run(ca, format(mk, s, 'tool-more')));

    -- ------------------------------------------------ 2. who sets the limit
    foreach q in array array['ca', 'cm', 'cx', 'co'] loop
      perform dame_test.expect('only IT sets the tools of a space: refused for ' || q, 'not_allowed',
        dame_test.run(case q when 'ca' then ca when 'cm' then cm when 'cx' then cx else co end, format('select public.dame_quota_set(%L, null, null, null, 200)', s)));
      perform dame_test.expect('only IT sets the default: refused for ' || q, 'not_allowed',
        dame_test.run(case q when 'ca' then ca when 'cm' then cm when 'cx' then cx else co end, 'select public.dame_quota_default_set(10000, 10, 60, 200)'));
    end loop;
    perform dame_test.expect('signed out: no setting', 'signed_out', dame_test.run(null, format('select public.dame_quota_set(%L, null, null, null, 200)', s)));
    perform dame_test.expect('pending: no setting', 'pending', dame_test.run(cp, format('select public.dame_quota_set(%L, null, null, null, 200)', s)));
    foreach q in array array['0', '201', '-3'] loop
      perform dame_test.expect('a tools limit outside the bounds is refused: ' || q, 'bad_request',
        dame_test.run(ci, format('select public.dame_quota_set(%L, null, null, null, %s)', s, q)));
      perform dame_test.expect('a tools default outside the bounds is refused: ' || q, 'bad_request',
        dame_test.run(ci, format('select public.dame_quota_default_set(10000, 10, 60, %s)', q)));
    end loop;
    perform dame_test.expect('IT gives the space 12 tools and nothing else', 'ok', dame_test.run(ci, format('select public.dame_quota_set(%L, null, null, null, 12)', s)));
    perform dame_test.expect('the space has its own tools limit, the rest by default', '10000/10/60/12/true',
      dame_test.val(ca, format($q$select (j ->> 'max_rows') || '/' || (j ->> 'max_tables') || '/' || (j ->> 'max_columns') || '/' || (j ->> 'max_tools') || '/' || (j ->> 'own') from public.dame_quota_get(%L) j$q$, s)));
    perform dame_test.expect('tools 11 and 12 are made, 13 is refused', 'ok/ok/quota_full',
      dame_test.run(ca, format(mk, s, 'tool-b1')) || '/' || dame_test.run(ca, format(mk, s, 'tool-b2')) || '/' || dame_test.run(ca, format(mk, s, 'tool-b3')));
    got := dame_test.run(ci, format('select public.dame_quota_set(%L, null, null, null, 5)', s));
    perform dame_test.expect('IT lowers the limit below what is there: no tool is deleted, no new one is made', 'ok/12/quota_full',
      got || '/' || (select count(*) from core.tools where space = s) || '/' || dame_test.run(ca, format(mk, s, 'tool-b3')));
    perform dame_test.expect('the tools that are there still work: one is changed', 'ok',
      dame_test.run(ca, format($q$select public.dame_tool_update(%L, 'tool-1', 'Renamed', '', '', '', false, 'read')$q$, s)));

    -- ------------------------------------------------ 3. asking and answering, with tools
    perform dame_test.expect('a request for fewer tools is refused', 'bad_request',
      dame_test.run(ca, format($q$select public.dame_quota_request(%L, 10000, 10, 60, 'We want fewer tools, oddly.', 4)$q$, s)));
    perform dame_test.expect('a request for more than 200 tools is refused', 'bad_request',
      dame_test.run(ca, format($q$select public.dame_quota_request(%L, 10000, 10, 60, 'We want very many tools.', 201)$q$, s)));
    perform dame_test.expect('a request that changes nothing is refused', 'bad_request',
      dame_test.run(ca, format($q$select public.dame_quota_request(%L, 10000, 10, 60, 'We want what we have.', 5)$q$, s)));
    perform dame_test.expect('a member cannot ask', 'not_allowed',
      dame_test.run(cm, format($q$select public.dame_quota_request(%L, 10000, 10, 60, 'I would like more tools.', 20)$q$, s)));
    perform dame_test.expect('the admin asks for 20 tools only', 'ok',
      dame_test.run(ca, format($q$select public.dame_quota_request(%L, 10000, 10, 60, 'Each team needs its own tracker.', 20)$q$, s)));
    perform dame_test.expect('IT sees the tools asked for', '20', dame_test.val(ci, format($q$select e -> 'request' ->> 'tools' from jsonb_array_elements(public.dame_quota_list() -> 'spaces') e where e ->> 'space' = %L$q$, s)));
    select id::text into rid from core.quota_requests where space = s and status = 'open';
    perform dame_test.expect('the admin cannot grant it himself', 'not_allowed', dame_test.run(ca, format('select public.dame_quota_answer(%s, true, null, null, null, null, 20)', rid)));
    perform dame_test.expect('granting 500 tools is refused', 'bad_request', dame_test.run(ci, format('select public.dame_quota_answer(%s, true, null, null, null, null, 500)', rid)));
    perform dame_test.expect('IT grants 15 where 20 were asked', 'ok', dame_test.run(ci, format($q$select public.dame_quota_answer(%s, true, null, null, null, 'Fifteen for now.', 15)$q$, rid)));
    perform dame_test.expect('the space has 15 tools now', '15', dame_test.val(ca, format($q$select public.dame_quota_get(%L) ->> 'max_tools'$q$, s)));
    perform dame_test.expect('the admin reads what was asked', '20', dame_test.val(ca, format($q$select public.dame_quota_get(%L) -> 'answers' -> 0 ->> 'tools'$q$, s)));
    perform dame_test.expect('and tool 13 is made', 'ok', dame_test.run(ca, format(mk, s, 'tool-b3')));

    -- ------------------------------------------------ 4. calls that leave the tools number out
    perform dame_test.expect('a request without the tools number asks for the tools the space has', 'ok',
      dame_test.run(ca, format($q$select public.dame_quota_request(%L, 20000, 10, 60, 'More rows, the old way of asking.')$q$, s)));
    perform dame_test.expect('it is kept with 15 tools', '15', (select want_tools::text from core.quota_requests where space = s and status = 'open'));
    select id::text into rid from core.quota_requests where space = s and status = 'open';
    perform dame_test.expect('an answer without the tools number gives what was asked', 'ok', dame_test.run(ci, format('select public.dame_quota_answer(%s, true, null, null, null, null)', rid)));
    perform dame_test.expect('rows went up, tools stayed', '20000/15',
      dame_test.val(ca, format($q$select (j ->> 'max_rows') || '/' || (j ->> 'max_tools') from public.dame_quota_get(%L) j$q$, s)));
    perform dame_test.expect('the default set the old way leaves the tools default alone', 'ok', dame_test.run(ci, 'select public.dame_quota_default_set(5000, 5, 20)'));
    perform dame_test.expect('tools default is still 10', '5000/5/20/10',
      dame_test.val(co, format($q$select (j ->> 'max_rows') || '/' || (j ->> 'max_tables') || '/' || (j ->> 'max_columns') || '/' || (j ->> 'max_tools') from public.dame_quota_get(%L) j$q$, s2)));

    -- ------------------------------------------------ 5. the default and the audit
    perform dame_test.expect('IT sets the default to 3 tools a space', 'ok', dame_test.run(ci, 'select public.dame_quota_default_set(5000, 5, 20, 3)'));
    perform dame_test.expect('a space on the default follows: third tool made, fourth refused', 'ok/ok/quota_full',
      dame_test.run(co, format(mk, s2, 'tool-2')) || '/' || dame_test.run(co, format(mk, s2, 'tool-3')) || '/' || dame_test.run(co, format(mk, s2, 'tool-4')));
    perform dame_test.expect('a space with its own limits does not', '15', dame_test.val(ca, format($q$select public.dame_quota_get(%L) ->> 'max_tools'$q$, s)));
    perform dame_test.expect('IT puts the space back on the default', 'ok', dame_test.run(ci, format('select public.dame_quota_set(%L, null, null, null, null)', s)));
    perform dame_test.expect('now it has the default, and keeps its 13 tools', '3/13/false',
      dame_test.val(ca, format($q$select (j ->> 'max_tools') || '/' || (j ->> 'tools_used') || '/' || (j ->> 'own') from public.dame_quota_get(%L) j$q$, s)));
    perform dame_test.expect('the audit shows four numbers', 'true',
      (select bool_and(detail ->> 'to' ~ '^\d+ / \d+ / \d+ / \d+$')::text from core.audit where actor = i and action in ('quota.set', 'quota.default_set')));
    got := dame_test.run(ci, format('select public.dame_space_delete(%L, %L)', s, s));
    perform dame_test.expect('deleting the space removes its quota', 'ok/0', got || '/' || (select count(*) from core.space_quotas where space = s));
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
