-- tests/sql/new_user_test.sql - allowed and refused cases for an IT admin makes an account with a
-- username and a temporary password; the person must choose his own before
-- anything opens (db/04_people.sql).
-- Serves: contract 1 (Identity) and 7 (Audit).
-- Must not change: the test leaves nothing behind. Everything it does,
-- the rows in the sign-in tables included, is undone before the result is shown.
--
-- How to run: on a database built from db/, paste the whole file into the SQL editor and press Run.
-- First row is the summary; any row with pass = false is a failure.

drop table if exists dame_test_result;

do $test$
declare
  v_results jsonb := '[]'::jsonb;
  v_error   text;
  a uuid := '00000000-0000-4000-8000-0000000000a9';  -- IT admin
  b uuid := '00000000-0000-4000-8000-0000000000b9';  -- approved member
  w uuid := '00000000-0000-4000-8000-0000000000c9';  -- new, work email
  g uuid := '00000000-0000-4000-8000-0000000000d9';  -- new, private email
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
               'session_id', ('99999999-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid);
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
      (a, 'a9@zz-work.test', 'Zz Ada IT', 'active', true), (b, 'b9@zz-work.test', 'Zz Ben', 'active', false);
    ca := dame_test.claims(a, 1, 'a9@zz-work.test'); cb := dame_test.claims(b, 2, 'b9@zz-work.test');

    -- ------------------------------------------------ 1. who may make an account, and what it may be
    q := $q$select public.dame_user_create('zz.sara', 'Zz Sara', 'Temp-Pass-12345')$q$;
    perform dame_test.expect('signed out: cannot make an account', 'signed_out', dame_test.run(null, q));
    perform dame_test.expect('a member cannot make an account', 'not_allowed', dame_test.run(cb, q));
    foreach q in array array['ab', 'has space', 'UPPER!', '.startsdot', repeat('a', 31), 'x@y.z', 'a''; drop table core.profiles; --'] loop
      n := n + 1;
      perform dame_test.expect('bad username refused, case ' || n, 'bad_request', dame_test.run(ca, format('select public.dame_user_create(%L, %L, %L)', q, 'X', 'Temp-Pass-12345')));
    end loop;
    foreach q in array array['short1A', 'alllowercase123', 'ALLUPPERCASE123', 'NoDigitsInHere', ''] loop
      n := n + 1;
      perform dame_test.expect('weak temporary password refused, case ' || n, 'bad_request', dame_test.run(ca, format('select public.dame_user_create(%L, %L, %L)', 'zz.sara', 'X', q)));
    end loop;
    perform dame_test.expect('nothing was made by all that', '0', (select count(*)::text from auth.users where email like 'zz.%' or email like '%drop%'));
    perform dame_test.expect('IT admin makes an account (capitals in the username are tidied)', 'zz.sara',
      dame_test.val(ca, $q$select public.dame_user_create('  ZZ.Sara ', '  Zz Sara  ', 'Temp-Pass-12345') ->> 'username'$q$));
    w := (select id from core.profiles where username = 'zz.sara');
    perform dame_test.expect('the same username again is refused', 'bad_request', dame_test.run(ca, $q$select public.dame_user_create('zz.sara', 'Other', 'Temp-Pass-12345')$q$));
    perform dame_test.expect('the account is active, under the name IT wrote, and must choose a password', 'active|Zz Sara|true',
      (select status || '|' || name || '|' || must_change::text from core.profiles where id = w));
    perform dame_test.expect('it is not an IT admin', 'false', (select is_it::text from core.profiles where id = w));
    perform dame_test.expect('the sign-in service has the account, confirmed, with a hashed password', 'true',
      (select (email = 'zz.sara@users.dame.internal' and email_confirmed_at is not null and encrypted_password not like '%Temp-Pass%')::text from auth.users where id = w));
    perform dame_test.expect('the temporary password is nowhere readable: not in the profile, not in the audit', '0',
      (select (select count(*) from core.profiles where temp_hash like '%Temp-Pass%') + (select count(*) from core.audit where detail::text like '%Temp-Pass%'))::text);
    perform dame_test.expect('making it is in the audit, with who and the username', 'Zz Ada IT|zz.sara',
      (select p.name || '|' || (x.detail ->> 'username') from core.audit x join core.profiles p on p.id = x.actor where x.action = 'user.created' and x.target = w::text));

    -- ------------------------------------------------ 2. first sign-in: nothing opens before the password is his own
    cw := dame_test.claims(w, 3, 'zz.sara@users.dame.internal');
    perform dame_test.expect('the start page is told: active, choose a password first', 'active|true',
      dame_test.val(cw, $q$select (r ->> 'status') || '|' || (r ->> 'must_change') from public.dame_request_access() r$q$));
    foreach q in array array['select public.dame_me()', 'select public.dame_spaces_list()', $q$select public.dame_people_find('zz')$q$, $q$select public.dame_space_get('anything')$q$] loop
      perform dame_test.expect('refused until then: ' || q, 'must_change', dame_test.run(cw, q));
    end loop;
    perform dame_test.expect('saying "done" while the temporary password is still in place is refused', 'bad_request', dame_test.run(cw, 'select public.dame_password_done()'));
    perform dame_test.expect('still refused everywhere', 'must_change', dame_test.run(cw, 'select public.dame_me()'));
    update auth.users set encrypted_password = extensions.crypt('My-Own-Pass-777', extensions.gen_salt('bf')) where id = w;  -- what the sign-in service does when he chooses
    -- "done" asks for the temporary password (the branch keeps the test usable on an older database).
    perform dame_test.expect('after he chose his own password, "done" is accepted', 'ok', dame_test.run(cw,
      case when to_regprocedure('public.dame_password_done(text)') is not null then $q$select public.dame_password_done('Temp-Pass-12345')$q$ else 'select public.dame_password_done()' end));
    perform dame_test.expect('now he is in', 'Zz Sara', dame_test.val(cw, $q$select public.dame_me() ->> 'name'$q$));
    perform dame_test.expect('the start page no longer asks', 'active|false',
      dame_test.val(cw, $q$select (r ->> 'status') || '|' || (r ->> 'must_change') from public.dame_request_access() r$q$));
    perform dame_test.expect('the stored hash of the temporary password is gone', 'true', (select (temp_hash is null)::text from core.profiles where id = w));
    perform dame_test.expect('choosing the password is in the audit', '1', (select count(*)::text from core.audit where action = 'user.password_chosen' and actor = w));
    perform dame_test.expect('"done" a second time changes nothing', 'ok', dame_test.run(cw, 'select public.dame_password_done()'));
    perform dame_test.expect('a person without an account cannot use "done"', 'no_profile',
      dame_test.run(dame_test.claims('00000000-0000-4000-8000-0000000000e9', 9, 'ghost@zz.test'), 'select public.dame_password_done()'));

    -- ------------------------------------------------ 3. the rest is as before
    perform dame_test.expect('people with their own sign-up are not asked to change anything', 'Zz Ben', dame_test.val(cb, $q$select public.dame_me() ->> 'name'$q$));
    perform dame_test.expect('IT can switch the new account off like any other', 'ok', dame_test.run(ca, format('select public.dame_user_set_status(%L, %L)', w, 'disabled')));
    perform dame_test.expect('switched off: his session is ended at once', 'session_ended', dame_test.run(cw, 'select public.dame_me()'));

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
