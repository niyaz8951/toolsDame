-- tests/sql/shortcuts_test.sql - allowed and refused cases for a person's shortcuts
-- on the hub (dame_shortcuts_list, dame_shortcut_set in db/05_spaces_tools.sql).
-- Serves: "Rules of work": every function has an allowed test and refused tests.
-- Must not change: the test leaves nothing behind. Everything it creates is
-- undone before the result is shown.
--
-- How to run: on a database built from db/, paste the whole file into the SQL editor and press Run.
-- First row is the summary; any row with pass = false is a failure.

drop table if exists dame_test_result;

do $test$
declare
  v_results jsonb := '[]'::jsonb;
  v_error   text;
  a   uuid := '00000000-0000-4000-8000-0000000000a8';  -- IT admin
  mem uuid := '00000000-0000-4000-8000-0000000000b8';  -- member of space one, its tool open to the space
  out uuid := '00000000-0000-4000-8000-0000000000c8';  -- approved, in no space
  ca jsonb; cm jsonb; co jsonb;
  g  integer;
begin
  begin
    create schema dame_test;
    create table dame_test.results (n serial, test text, expected text, got text);

    create function dame_test.claims(p_uid uuid, p_n integer) returns jsonb
    language sql as $f$
      select jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'email', 'x@test.dame',
               'session_id', ('28888888-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid);
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
    declare v text;
    begin
      perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
      execute 'set local role authenticated';
      begin
        execute p_sql into v;
        execute 'reset role';
        return coalesce(v, '(null)');
      exception when others then
        execute 'reset role';
        return 'error: ' || sqlerrm;
      end;
    end $f$;

    create function dame_test.expect(p_test text, p_expected text, p_got text) returns void
    language sql as $f$
      insert into dame_test.results (test, expected, got) values (p_test, p_expected, p_got);
    $f$;

    insert into core.profiles (id, email, name, status, is_it) values
      (a, 'a8@test.dame', 'Zz Ada IT', 'active', true), (mem, 'm8@test.dame', 'Zz Mem', 'active', false), (out, 'o8@test.dame', 'Zz Out', 'active', false);
    insert into core.spaces (id, name, created_by) values ('zz-one', 'Zz One', a);
    insert into core.space_members (space, user_id, added_by) values ('zz-one', mem, a);
    insert into core.tools (space, id, name, open_to_space, open_level, created_by)
      select 'zz-one', 'tool-' || x.n, 'Tool ' || x.n, true, 'read', a from generate_series(1, 13) x (n);
    insert into core.tools (space, id, name, open_to_space, open_level, created_by) values ('zz-one', 'closed', 'Closed', false, 'read', a);
    ca := dame_test.claims(a, 1); cm := dame_test.claims(mem, 2); co := dame_test.claims(out, 3);

    perform dame_test.expect('a new person has no shortcuts', '0', dame_test.val(cm, 'select jsonb_array_length(public.dame_shortcuts_list())'));
    perform dame_test.expect('a member pins a tool he can open', 'ok', dame_test.run(cm, $q$select public.dame_shortcut_set('zz-one', 'tool-1', true)$q$));
    perform dame_test.expect('pinning it twice keeps one', '1', dame_test.val(cm, $q$select public.dame_shortcut_set('zz-one', 'tool-1', true); select jsonb_array_length(public.dame_shortcuts_list())$q$));
    perform dame_test.expect('the list names the tool and its space', 'Tool 1|Zz One', dame_test.val(cm, $q$select (x ->> 'name') || '|' || (x ->> 'space_name') from jsonb_array_elements(public.dame_shortcuts_list()) x$q$));
    perform dame_test.expect('a tool he cannot open is refused', 'not_allowed', dame_test.run(cm, $q$select public.dame_shortcut_set('zz-one', 'closed', true)$q$));
    perform dame_test.expect('someone outside the space is refused', 'not_allowed', dame_test.run(co, $q$select public.dame_shortcut_set('zz-one', 'tool-1', true)$q$));
    perform dame_test.expect('a tool that does not exist is refused', 'not_allowed', dame_test.run(cm, $q$select public.dame_shortcut_set('zz-one', 'nothing', true)$q$));
    perform dame_test.expect('pin or unpin must be said', 'bad_request', dame_test.run(cm, $q$select public.dame_shortcut_set('zz-one', 'tool-1', null)$q$));
    perform dame_test.expect('each person has his own list', '0', dame_test.val(ca, 'select jsonb_array_length(public.dame_shortcuts_list())'));
    for g in 2..12 loop
      perform dame_test.run(cm, format('select public.dame_shortcut_set(%L, %L, true)', 'zz-one', 'tool-' || g));
    end loop;
    perform dame_test.expect('twelve shortcuts are kept', '12', (select count(*)::text from core.shortcuts where user_id = mem));
    perform dame_test.expect('the thirteenth is refused', 'quota_full', dame_test.run(cm, $q$select public.dame_shortcut_set('zz-one', 'tool-13', true)$q$));
    perform dame_test.expect('pinning one of the twelve again is harmless', 'ok', dame_test.run(cm, $q$select public.dame_shortcut_set('zz-one', 'tool-5', true)$q$));
    perform dame_test.expect('he takes one away', 'ok', dame_test.run(cm, $q$select public.dame_shortcut_set('zz-one', 'tool-2', false)$q$));
    perform dame_test.expect('eleven are left', '11', (select count(*)::text from core.shortcuts where user_id = mem));
    delete from core.space_members where space = 'zz-one' and user_id = mem;
    perform dame_test.expect('out of the space, the list is empty at once', '0', dame_test.val(cm, 'select jsonb_array_length(public.dame_shortcuts_list())'));
    perform dame_test.expect('he can still take a stale shortcut away', 'ok', dame_test.run(cm, $q$select public.dame_shortcut_set('zz-one', 'tool-3', false)$q$));
    perform dame_test.expect('IT deletes a pinned tool', 'ok', dame_test.run(ca, $q$select public.dame_tool_delete('zz-one', 'tool-4', 'tool-4')$q$));
    perform dame_test.expect('its shortcuts went with it', '0', (select count(*)::text from core.shortcuts where tool = 'tool-4'));
    perform dame_test.expect('the site cannot reach the table', 'denied', dame_test.run(cm, 'select count(*) from core.shortcuts'));

    -- ------------------- 9. security check
    perform dame_test.expect('core.security_check() finds nothing', '0',
      (select count(*)::text from core.security_check()));

    select coalesce(jsonb_agg(jsonb_build_object('n', r.n, 'test', r.test, 'expected', r.expected, 'got', r.got) order by r.n), '[]'::jsonb)
      into v_results from dame_test.results r;
    raise exception using errcode = 'DTEST', message = 'undo';
  exception
    when sqlstate 'DTEST' then
      null;  -- everything the test did is undone here; only v_results is kept
    when others then
      v_error := sqlstate || ': ' || sqlerrm;
  end;

  create temp table dame_test_result as
    select (r ->> 'n')::int as n, (r ->> 'expected') = (r ->> 'got') as pass,
           r ->> 'test' as test, r ->> 'expected' as expected, r ->> 'got' as got
      from jsonb_array_elements(v_results) r;
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
