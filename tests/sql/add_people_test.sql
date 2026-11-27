-- tests/sql/add_people_test.sql - allowed and refused cases for an IT admin adds a person by email
-- (db/04_people.sql).
-- Serves: contract 1 (Identity) and 7 (Audit).
-- Must not change: the test leaves nothing behind. Everything it does,
-- the setting included, is undone before the result is shown.
--
-- How to run: on a database built from db/, paste the whole file into the SQL editor and press Run.
-- First row is the summary; any row with pass = false is a failure.

drop table if exists dame_test_result;

do $test$
declare
  v_results jsonb := '[]'::jsonb;
  v_error   text;
  a uuid := '00000000-0000-4000-8000-0000000000a7';  -- IT admin
  b uuid := '00000000-0000-4000-8000-0000000000b7';  -- approved member
  w uuid := '00000000-0000-4000-8000-0000000000c7';  -- new, work email
  g uuid := '00000000-0000-4000-8000-0000000000d7';  -- new, private email
  ca jsonb; cb jsonb; cw jsonb; cg jsonb;
  q  text;
  n  integer := 0;
begin
  begin
    create schema dame_test;
    create table dame_test.results (n serial, test text, expected text, got text);

    create function dame_test.claims(p_uid uuid, p_n integer, p_email text default 'x@test.dame') returns jsonb
    language sql as $f$
      select jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'email', p_email,
               'session_id', ('77777777-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid);
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
    update core.settings set value = 'zz-work.test' where key = 'signup_domains';
    insert into core.profiles (id, email, name, status, is_it) values
      (a, 'a7@zz-work.test', 'Zz Ada IT', 'active', true), (b, 'b7@zz-work.test', 'Zz Ben', 'active', false);
    ca := dame_test.claims(a, 1, 'a7@zz-work.test'); cb := dame_test.claims(b, 2, 'b7@zz-work.test');
    cw := dame_test.claims(w, 3, 'New.Person@ZZ-Work.test'); cg := dame_test.claims(g, 4, 'partner@zz-outside.test');

    -- ------------------------------------------------ 1. who may add a person
    q := $q$select public.dame_user_add('new.person@zz-work.test', 'New Person')$q$;
    perform dame_test.expect('signed out: cannot add a person', 'signed_out', dame_test.run(null, q));
    perform dame_test.expect('a member cannot add a person', 'not_allowed', dame_test.run(cb, q));
    perform dame_test.expect('a member cannot list the added addresses', 'not_allowed', dame_test.run(cb, 'select public.dame_users_added()'));
    perform dame_test.expect('a member cannot take an added address back', 'not_allowed', dame_test.run(cb, $q$select public.dame_user_add_remove('new.person@zz-work.test')$q$));
    foreach q in array array['not an email', 'a@b', '@zz-work.test', 'x y@zz-work.test', 'a@zz-work.test; drop table core.profiles', repeat('a', 70) || '@zz-work.test', ''] loop
      n := n + 1;
      perform dame_test.expect('bad address refused, case ' || n, 'bad_request', dame_test.run(ca, format('select public.dame_user_add(%L, %L)', q, 'X')));
    end loop;
    perform dame_test.expect('a person who already has an account cannot be added again', 'bad_request',
      dame_test.run(ca, $q$select public.dame_user_add('B7@zz-work.test', 'Ben')$q$));
    perform dame_test.expect('IT admin adds a person (capitals and spaces are tidied)', 'ok',
      dame_test.run(ca, $q$select public.dame_user_add('  New.Person@ZZ-work.test ', '  New Person  ')$q$));
    perform dame_test.expect('adding the same address twice is refused', 'bad_request',
      dame_test.run(ca, $q$select public.dame_user_add('new.person@zz-work.test', 'Again')$q$));
    perform dame_test.expect('IT admin adds a partner from outside the work domains', 'ok',
      dame_test.run(ca, $q$select public.dame_user_add('partner@zz-outside.test', 'Partner Pat')$q$));
    perform dame_test.expect('IT admin sees both waiting', '2', dame_test.val(ca, 'select jsonb_array_length(public.dame_users_added())'));
    perform dame_test.expect('adding is in the audit', 'New Person',
      (select detail ->> 'name' from core.audit where action = 'user.added' and target = 'new.person@zz-work.test'));
    perform dame_test.expect('no account exists yet: nothing was made in advance', '0',
      (select count(*)::text from core.profiles where email in ('new.person@zz-work.test', 'partner@zz-outside.test')));

    -- ------------------------------------------------ 2. the person signs up
    perform dame_test.expect('the added person signs up and is in at once', 'active',
      dame_test.val(cw, $q$select public.dame_request_access() ->> 'status'$q$));
    perform dame_test.expect('with the name IT wrote', 'New Person', dame_test.val(cw, $q$select public.dame_me() ->> 'name'$q$));
    perform dame_test.expect('not as IT admin', 'false', dame_test.val(cw, $q$select public.dame_me() ->> 'is_it'$q$));
    perform dame_test.expect('the added partner is in too, although outside the work domains', 'active',
      dame_test.val(cg, $q$select public.dame_request_access() ->> 'status'$q$));
    perform dame_test.expect('the audit says who let him in', 'Zz Ada IT',
      (select p.name from core.audit x join core.profiles p on p.id = x.actor where x.action = 'user.status_changed' and x.target = g::text));
    perform dame_test.expect('nobody is waiting any more', '0', dame_test.val(ca, 'select jsonb_array_length(public.dame_users_added())'));
    perform dame_test.expect('an address that was used cannot be taken back', 'bad_request',
      dame_test.run(ca, $q$select public.dame_user_add_remove('new.person@zz-work.test')$q$));
    perform dame_test.expect('asking again changes nothing', 'active', dame_test.val(cw, $q$select public.dame_request_access() ->> 'status'$q$));

    -- ------------------------------------------------ 3. everyone else is treated as before
    g := '00000000-0000-4000-8000-0000000000e7';
    cg := dame_test.claims(g, 5, 'stranger@zz-outside.test');
    perform dame_test.expect('a stranger outside the work domains still gets nothing', 'not_allowed', dame_test.run(cg, 'select public.dame_request_access()'));
    cg := dame_test.claims(g, 6, 'colleague@zz-work.test');
    perform dame_test.expect('a colleague who was not added still waits for approval', 'pending',
      dame_test.val(cg, $q$select public.dame_request_access() ->> 'status'$q$));
    perform dame_test.expect('IT admin adds an address and takes it back', 'ok',
      dame_test.run(ca, $q$select public.dame_user_add('late@zz-work.test', 'Late'), public.dame_user_add_remove('LATE@zz-work.test')$q$));
    g := '00000000-0000-4000-8000-0000000000f7';
    cg := dame_test.claims(g, 7, 'late@zz-work.test');
    perform dame_test.expect('the person whose address was taken back waits like anyone', 'pending',
      dame_test.val(cg, $q$select public.dame_request_access() ->> 'status'$q$));
    perform dame_test.expect('a disabled person is not let in again by being added', 'bad_request',
      dame_test.run(ca, $q$select public.dame_user_add('b7@zz-work.test', 'Ben')$q$));

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
