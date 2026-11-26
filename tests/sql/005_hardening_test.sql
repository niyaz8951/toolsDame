-- tests/sql/005_hardening_test.sql - allowed and refused cases for
-- db/core/005_hardening.sql: who may ask for access, sign-ins in the audit.
-- Serves: contract 1 (Identity) and 7 (Audit).
-- Must not change: the test leaves nothing behind. Everything it does,
-- the setting included, is undone before the result is shown.
--
-- How to run: paste the whole file into the Supabase SQL editor and press Run.
-- First row is the summary; any row with pass = false is a failure.

drop table if exists dame_test_result;

do $test$
declare
  v_results jsonb := '[]'::jsonb;
  v_error   text;
  a uuid := '00000000-0000-4000-8000-0000000000a5';  -- IT admin
  b uuid := '00000000-0000-4000-8000-0000000000b5';  -- approved member
  w uuid := '00000000-0000-4000-8000-0000000000c5';  -- new, work email
  g uuid := '00000000-0000-4000-8000-0000000000d5';  -- new, private email
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
               'session_id', ('55555555-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid);
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
    update core.settings set value = '' where key = 'signup_domains';
    insert into core.profiles (id, email, name, status, is_it) values
      (a, 'a5@zz-work.test', 'Zz Ada IT', 'active', true), (b, 'b5@zz-work.test', 'Zz Ben', 'active', false);
    ca := dame_test.claims(a, 1, 'a5@zz-work.test'); cb := dame_test.claims(b, 2, 'b5@zz-work.test');
    cw := dame_test.claims(w, 3, 'new@ZZ-Work.test'); cg := dame_test.claims(g, 4, 'someone@zz-private.test');

    -- ------------------------------------------------ 1. the setting
    perform dame_test.expect('a member cannot read the site settings', 'not_allowed', dame_test.run(cb, 'select public.dame_settings_get()'));
    perform dame_test.expect('a member cannot set who may ask for access', 'not_allowed',
      dame_test.run(cb, $q$select public.dame_setting_set('signup_domains', 'zz-private.test')$q$));
    perform dame_test.expect('IT admin reads the settings: any address may ask', '',
      dame_test.val(ca, $q$select public.dame_settings_get() ->> 'signup_domains'$q$));
    foreach q in array array['not a domain', 'company', 'a..b.com', 'x.com; drop table core.profiles', '-x.com', repeat('a', 700) || '.com'] loop
      n := n + 1;
      perform dame_test.expect('domain list refused, case ' || n, 'bad_request',
        dame_test.run(ca, format('select public.dame_setting_set(%L, %L)', 'signup_domains', q)));
    end loop;
    perform dame_test.expect('an unknown setting is still refused', 'bad_request',
      dame_test.run(ca, $q$select public.dame_setting_set('anything', 'x')$q$));
    perform dame_test.expect('the AI setting still works', 'ok',
      dame_test.run(ca, $q$select public.dame_setting_set('ai_mode', 'prompt')$q$));

    -- ------------------------------------------------ 2. any address, then work addresses only
    perform dame_test.expect('while any address may ask: a private address gets a request', 'pending',
      dame_test.val(cg, $q$select public.dame_request_access() ->> 'status'$q$));
    perform dame_test.expect('IT admin allows two work domains (spaces, capitals and @ are tidied)', 'ok',
      dame_test.run(ca, $q$select public.dame_setting_set('signup_domains', ' ZZ-Work.test, @zz-other.test ')$q$));
    perform dame_test.expect('the setting is stored tidy', 'zz-work.test,zz-other.test',
      dame_test.val(ca, $q$select public.dame_settings_get() ->> 'signup_domains'$q$));
    perform dame_test.expect('a new person with a work address gets a request', 'pending',
      dame_test.val(cw, $q$select public.dame_request_access() ->> 'status'$q$));
    g := '00000000-0000-4000-8000-0000000000e5';
    cg := dame_test.claims(g, 5, 'other@zz-private.test');
    perform dame_test.expect('a new person with a private address gets none', 'not_allowed',
      dame_test.run(cg, 'select public.dame_request_access()'));
    perform dame_test.expect('and no row is made for him', '0', (select count(*)::text from core.profiles where id = g));
    cg := dame_test.claims(g, 6, 'boss@zz-work.test.evil.test');
    perform dame_test.expect('an address that only starts like a work domain gets none', 'not_allowed',
      dame_test.run(cg, 'select public.dame_request_access()'));
    cg := dame_test.claims(g, 7, 'zz-work.test@zz-private.test');
    perform dame_test.expect('a work domain before the @ does not count', 'not_allowed',
      dame_test.run(cg, 'select public.dame_request_access()'));
    perform dame_test.expect('the person who already had a request keeps it', 'pending',
      dame_test.val(dame_test.claims('00000000-0000-4000-8000-0000000000d5', 4, 'someone@zz-private.test'), $q$select public.dame_request_access() ->> 'status'$q$));
    perform dame_test.expect('approved people are not touched by the rule', 'Zz Ben',
      dame_test.val(cb, $q$select public.dame_me() ->> 'name'$q$));
    perform dame_test.expect('changing the rule is in the audit, readably', 'any > zz-work.test,zz-other.test',
      (select (detail ->> 'from') || ' > ' || (detail ->> 'to') from core.audit where action = 'setting.changed' and target = 'signup_domains' order by id desc limit 1));

    -- ------------------------------------------------ 3. sign-ins in the audit
    perform dame_test.expect('each sign-in of a known person is written once', '1',
      (select count(*)::text from core.audit where action = 'user.signed_in' and actor = b));
    perform dame_test.run(cb, 'select public.dame_me()');
    perform dame_test.run(cb, 'select public.dame_spaces_list()');
    perform dame_test.expect('more clicks in the same session add nothing', '1',
      (select count(*)::text from core.audit where action = 'user.signed_in' and actor = b));
    cb := dame_test.claims(b, 20, 'b5@zz-work.test');
    perform dame_test.run(cb, 'select public.dame_me()');
    perform dame_test.expect('a new sign-in is written again', '2',
      (select count(*)::text from core.audit where action = 'user.signed_in' and actor = b));
    perform dame_test.expect('the IT admin sees sign-ins in the audit, with the name', 'Zz Ben',
      dame_test.val(ca, $q$select x ->> 'actor' from jsonb_array_elements(public.dame_audit_list(50)) x where x ->> 'action' = 'user.signed_in' limit 1$q$));
    perform dame_test.expect('a refused address leaves no sign-in in the audit', '0',
      (select count(*)::text from core.audit where actor = g));

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
