-- tests/sql/006_help_test.sql - allowed and refused cases for
-- db/core/006_help.sql: who reads and who writes the usage guide of a tool.
-- Serves: contract 3 (Access) and 7 (Audit).
-- Must not change: the test leaves nothing behind. Everything it does
-- is undone before the result is shown.
--
-- How to run: paste the whole file into the Supabase SQL editor and press Run.
-- First row is the summary; any row with pass = false is a failure.

drop table if exists dame_test_result;

do $test$
declare
  v_results jsonb := '[]'::jsonb;
  v_error   text;
  u_a uuid := '00000000-0000-4000-8000-0000000000a6';  -- space admin of zz-one
  u_m uuid := '00000000-0000-4000-8000-0000000000b6';  -- manager of the tool
  u_r uuid := '00000000-0000-4000-8000-0000000000c6';  -- has the tool at read
  u_o uuid := '00000000-0000-4000-8000-0000000000d6';  -- admin of another space
  u_p uuid := '00000000-0000-4000-8000-0000000000e6';  -- pending
  u_d uuid := '00000000-0000-4000-8000-0000000000f6';  -- disabled
  ca jsonb; cm jsonb; cr jsonb; co jsonb; cp jsonb; cd jsonb;
  q  text;
begin
  begin
    create schema dame_test;
    create table dame_test.results (n serial, test text, expected text, got text);

    create function dame_test.claims(p_uid uuid, p_n integer, p_email text default 'x@test.dame') returns jsonb
    language sql as $f$
      select jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'email', p_email,
               'session_id', ('66666666-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid);
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
      (u_a, 'a6@zz.test', 'Zz Ada', 'active', false), (u_m, 'm6@zz.test', 'Zz Mo', 'active', false), (u_r, 'r6@zz.test', 'Zz Rae', 'active', false),
      (u_o, 'o6@zz.test', 'Zz Oz', 'active', false), (u_p, 'p6@zz.test', 'Zz Pen', 'pending', false), (u_d, 'd6@zz.test', 'Zz Dis', 'disabled', false);
    insert into core.spaces (id, name, created_by) values ('zz-one', 'Zz One', u_a), ('zz-two', 'Zz Two', u_o);
    insert into core.space_admins (space, user_id, added_by) values ('zz-one', u_a, u_a), ('zz-two', u_o, u_o);
    insert into core.tools (space, id, name, description, open_to_space, open_level, created_by) values
      ('zz-one', 'zz-calc', 'Zz Calc', 'Adds things', false, 'read', u_a), ('zz-two', 'zz-other', 'Zz Other', '', false, 'read', u_o);
    insert into core.tool_managers (space, tool, user_id, added_by) values ('zz-one', 'zz-calc', u_m, u_a);
    insert into core.tool_access (space, tool, user_id, level, added_by) values ('zz-one', 'zz-calc', u_r, 'read', u_a), ('zz-one', 'zz-calc', u_d, 'approve', u_a);
    ca := dame_test.claims(u_a, 1); cm := dame_test.claims(u_m, 2); cr := dame_test.claims(u_r, 3); co := dame_test.claims(u_o, 4); cp := dame_test.claims(u_p, 5); cd := dame_test.claims(u_d, 6);
    q := $q$select public.dame_tool_help_set('zz-one', 'zz-calc', 'x')$q$;

    -- ------------------------------------------------ 1. who writes the guide
    perform dame_test.expect('signed out: cannot write the guide', 'signed_out', dame_test.run(null, q));
    perform dame_test.expect('pending: cannot write the guide', 'pending', dame_test.run(cp, q));
    perform dame_test.expect('disabled (even with the top level): cannot write the guide', 'disabled', dame_test.run(cd, q));
    perform dame_test.expect('a reader of the tool cannot write its guide', 'not_allowed', dame_test.run(cr, q));
    perform dame_test.expect('the admin of another space cannot write it', 'not_allowed', dame_test.run(co, q));
    perform dame_test.expect('a tool that does not exist: refused the same way', 'not_allowed',
      dame_test.run(ca, $q$select public.dame_tool_help_set('zz-one', 'zz-none', 'x')$q$));
    perform dame_test.expect('a guide longer than 4000 characters is refused', 'bad_request',
      dame_test.run(cm, format('select public.dame_tool_help_set(%L, %L, %L)', 'zz-one', 'zz-calc', repeat('a', 4001))));
    perform dame_test.expect('nothing was written by all that', '', (select help_text from core.tools where space = 'zz-one' and id = 'zz-calc'));
    perform dame_test.expect('the manager writes the guide', 'ok',
      dame_test.run(cm, format('select public.dame_tool_help_set(%L, %L, %L)', 'zz-one', 'zz-calc', E'  1. Type the load.\r\n2. Read the result.\x07 <b>bold</b>  ')));
    perform dame_test.expect('it is stored as plain text: trimmed, no control characters, tags kept as text', E'1. Type the load.\n2. Read the result. <b>bold</b>',
      (select help_text from core.tools where space = 'zz-one' and id = 'zz-calc'));
    perform dame_test.expect('the space admin can write it too', 'ok',
      dame_test.run(ca, $q$select public.dame_tool_help_set('zz-one', 'zz-calc', 'Guide by the admin')$q$));
    perform dame_test.expect('writing the guide is in the audit, without its text', '{"characters": 18}',
      (select detail::text from core.audit where action = 'tool.help_set' and space = 'zz-one' and tool = 'zz-calc' order by id desc limit 1));

    -- ------------------------------------------------ 2. who reads the guide
    q := $q$select public.dame_tool_help_get('zz-one', 'zz-calc')$q$;
    perform dame_test.expect('signed out: cannot read the guide', 'signed_out', dame_test.run(null, q));
    perform dame_test.expect('pending: cannot read the guide', 'pending', dame_test.run(cp, q));
    perform dame_test.expect('disabled: cannot read the guide', 'disabled', dame_test.run(cd, q));
    perform dame_test.expect('the admin of another space cannot read it', 'not_allowed', dame_test.run(co, q));
    perform dame_test.expect('a reader of the tool reads the guide', 'Guide by the admin', dame_test.val(cr, q || $q$ ->> 'text'$q$));
    perform dame_test.expect('with who wrote it', 'Zz Ada', dame_test.val(cr, q || $q$ ->> 'by'$q$));
    perform dame_test.expect('and that the tool is not live yet', 'false', dame_test.val(cr, q || $q$ ->> 'live'$q$));
    perform dame_test.expect('and his own level', 'read', dame_test.val(cr, q || $q$ ->> 'level'$q$));
    perform dame_test.expect('a manager reads it', 'Guide by the admin', dame_test.val(cm, q || $q$ ->> 'text'$q$));
    perform dame_test.expect('a reader of one tool cannot read the guide of a tool in another space', 'not_allowed',
      dame_test.run(cr, $q$select public.dame_tool_help_get('zz-two', 'zz-other')$q$));
    perform dame_test.expect('an empty text brings the site''s own guide back', 'ok',
      dame_test.run(cm, $q$select public.dame_tool_help_set('zz-one', 'zz-calc', '   ')$q$));
    perform dame_test.expect('the stored guide is empty again', '', dame_test.val(cr, q || $q$ ->> 'text'$q$));
    update core.tools set active = false where space = 'zz-one' and id = 'zz-calc';
    perform dame_test.expect('a tool switched off: a reader no longer reads its guide', 'not_allowed', dame_test.run(cr, q));
    perform dame_test.expect('its manager still does', 'ok', dame_test.run(cm, q));

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
