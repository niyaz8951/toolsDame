-- tests/sql/008_space_look_test.sql - allowed and refused cases for
-- db/core/008_space_look.sql: who may change the icon and colour of a space.
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
  u_a uuid := '00000000-0000-4000-8000-0000000000a8';  -- space admin of zz-one
  u_m uuid := '00000000-0000-4000-8000-0000000000b8';  -- manager of the tool
  u_r uuid := '00000000-0000-4000-8000-0000000000c8';  -- has the tool at read
  u_o uuid := '00000000-0000-4000-8000-0000000000d8';  -- admin of another space
  u_p uuid := '00000000-0000-4000-8000-0000000000e8';  -- pending
  u_d uuid := '00000000-0000-4000-8000-0000000000f8';  -- disabled
  ca jsonb; cm jsonb; cr jsonb; co jsonb; cp jsonb; cd jsonb;
  q  text;
begin
  begin
    create schema dame_test;
    create table dame_test.results (n serial, test text, expected text, got text);

    create function dame_test.claims(p_uid uuid, p_n integer, p_email text default 'x@test.dame') returns jsonb
    language sql as $f$
      select jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'email', p_email,
               'session_id', ('88888888-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid);
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

    update core.profiles set is_it = false where is_it;
    insert into core.profiles (id, email, name, status, is_it) values
      (u_a, 'a8@zz.test', 'Zz Ada', 'active', false), (u_m, 'm8@zz.test', 'Zz Mo IT', 'active', true), (u_r, 'r8@zz.test', 'Zz Rae', 'active', false),
      (u_o, 'o8@zz.test', 'Zz Oz', 'active', false), (u_p, 'p8@zz.test', 'Zz Pen', 'pending', false), (u_d, 'd8@zz.test', 'Zz Dis', 'disabled', false);
    insert into core.spaces (id, name, created_by) values ('zz-one', 'Zz One', u_a), ('zz-two', 'Zz Two', u_o);
    insert into core.space_admins (space, user_id, added_by) values ('zz-one', u_a, u_a), ('zz-two', u_o, u_o);
    insert into core.space_members (space, user_id, added_by) values ('zz-one', u_r, u_a);
    ca := dame_test.claims(u_a, 1); cm := dame_test.claims(u_m, 2); cr := dame_test.claims(u_r, 3); co := dame_test.claims(u_o, 4); cp := dame_test.claims(u_p, 5); cd := dame_test.claims(u_d, 6);
    q := $q$select public.dame_space_look_set('zz-one', 'Z', '#0e8f8a')$q$;
    perform dame_test.expect('signed out: cannot change a space''s look', 'signed_out', dame_test.run(null, q));
    perform dame_test.expect('pending: cannot', 'pending', dame_test.run(cp, q));
    perform dame_test.expect('disabled: cannot', 'disabled', dame_test.run(cd, q));
    perform dame_test.expect('a member of the space cannot', 'not_allowed', dame_test.run(cr, q));
    perform dame_test.expect('the admin of another space cannot', 'not_allowed', dame_test.run(co, q));
    perform dame_test.expect('a member cannot read it through the admin function', 'not_allowed', dame_test.run(cr, $q$select public.dame_space_look_get('zz-one')$q$));
    foreach q in array array['red', '#12345', '#GGGGGG', '#0E8F8A', 'url(x)', '#0e8f8a; x'] loop
      perform dame_test.expect('colour refused: ' || q, 'bad_request', dame_test.run(ca, format('select public.dame_space_look_set(%L, %L, %L)', 'zz-one', 'Z', q)));
    end loop;
    perform dame_test.expect('an icon longer than 8 characters is refused', 'bad_request', dame_test.run(ca, $q$select public.dame_space_look_set('zz-one', '123456789', '')$q$));
    perform dame_test.expect('nothing was changed by all that', '|', (select icon || '|' || colour from core.spaces where id = 'zz-one'));
    perform dame_test.expect('the space admin changes icon and colour', 'ok', dame_test.run(ca, $q$select public.dame_space_look_set('zz-one', 'Z', '#0e8f8a')$q$));
    perform dame_test.expect('they are stored', 'Z|#0e8f8a', (select icon || '|' || colour from core.spaces where id = 'zz-one'));
    perform dame_test.expect('the admin reads them back', '#0e8f8a', dame_test.val(ca, $q$select public.dame_space_look_get('zz-one') ->> 'colour'$q$));
    perform dame_test.expect('a member sees the colour on his hub tile', '#0e8f8a', dame_test.val(cr, $q$select x ->> 'colour' from jsonb_array_elements(public.dame_spaces_list()) x where x ->> 'id' = 'zz-one'$q$));
    perform dame_test.expect('an IT admin can change it too', 'ok', dame_test.run(cm, $q$select public.dame_space_look_set('zz-one', '', '')$q$));
    perform dame_test.expect('empty brings the site''s own colour back', '|', (select icon || '|' || colour from core.spaces where id = 'zz-one'));
    perform dame_test.expect('the other space was never touched', '|', (select icon || '|' || colour from core.spaces where id = 'zz-two'));
    perform dame_test.expect('each change is in the audit', '2', (select count(*)::text from core.audit where action = 'space.changed' and space = 'zz-one'));

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
