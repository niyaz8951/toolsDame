-- tests/sql/accounts_test.sql - allowed and refused cases for a person's own account, IT correcting
-- an account, IT resetting a password, and what a temporary password must go
-- through (db/04_people.sql).
-- Serves: contract 1 (Identity), 3 (Access) and 7 (Audit).
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
  a uuid := '00000000-0000-4000-8000-0000000000a0';  -- IT admin
  b uuid := '00000000-0000-4000-8000-0000000000b0';  -- approved member
  c uuid := '00000000-0000-4000-8000-0000000000c0';  -- waiting
  d uuid := '00000000-0000-4000-8000-0000000000d0';  -- switched off
  w uuid;                                            -- an account made by IT
  ca jsonb; cb jsonb; cc jsonb; cd jsonb; cw jsonb; cw2 jsonb; cw3 jsonb;
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
      (a, 'a0@zz-work.test', 'Zz Ada IT', 'active', true), (b, 'b0@zz-work.test', 'Zz Ben', 'active', false),
      (c, 'c0@zz-work.test', 'Zz Cy', 'pending', false), (d, 'd0@zz-work.test', 'Zz Dee', 'disabled', false);
    -- Ben signed up himself: the sign-in service holds his password.
    insert into auth.users (id, email, encrypted_password) values (b, 'b0@zz-work.test', extensions.crypt('Ben-First-Pass-1', extensions.gen_salt('bf')));
    update core.profiles set pw_mark = md5((select encrypted_password from auth.users where id = b)) where id = b;
    ca := dame_test.claims(a, 1, 'a0@zz-work.test'); cb := dame_test.claims(b, 2, 'b0@zz-work.test');
    cc := dame_test.claims(c, 3, 'c0@zz-work.test'); cd := dame_test.claims(d, 4, 'd0@zz-work.test');
    insert into core.spaces (id, name, created_by) values ('zz-acct', 'Zz Accounts', a);
    insert into core.space_members (space, user_id, added_by) values ('zz-acct', b, a);
    insert into core.tools (space, id, name, open_to_space, open_level, created_by) values ('zz-acct', 'zz-book', 'Zz Book', true, 'contribute', a);

    -- ------------------------------------------------ 1. the person's own account
    q := 'select public.dame_account_get()';
    perform dame_test.expect('signed out: no account page', 'signed_out', dame_test.run(null, q));
    perform dame_test.expect('waiting: no account page', 'pending', dame_test.run(cc, q));
    perform dame_test.expect('switched off: no account page', 'disabled', dame_test.run(cd, q));
    perform dame_test.expect('a person reads his own account', 'Zz Ben|b0@zz-work.test|active',
      dame_test.val(cb, $q$select (r ->> 'name') || '|' || (r ->> 'email') || '|' || (r ->> 'status') from public.dame_account_get() r$q$));
    perform dame_test.expect('it lists his spaces and his tools with his level', 'zz-acct:member|zz-book:contribute',
      dame_test.val(cb, $q$select (r -> 'spaces' -> 0 ->> 'id') || ':' || (r -> 'spaces' -> 0 ->> 'role') || '|' || (r -> 'tools' -> 0 ->> 'tool') || ':' || (r -> 'tools' -> 0 ->> 'level') from public.dame_account_get() r$q$));
    perform dame_test.expect('it lists his own sign-ins', 'true',
      dame_test.val(cb, $q$select (jsonb_array_length(r -> 'sign_ins') >= 1)::text from public.dame_account_get() r$q$));
    perform dame_test.expect('it does not hold what only IT sees, nor any password field', 'true',
      dame_test.val(cb, $q$select (not (r ? 'must_change') and not (r ? 'temp_set_at') and r::text !~* 'hash|pw_mark|encrypted')::text from public.dame_account_get() r$q$));

    q := $q$select public.dame_account_set('  Sales   Engineer ', 'Applied', 'Dubai', '+971 4 123 4567')$q$;
    perform dame_test.expect('signed out: cannot change details', 'signed_out', dame_test.run(null, q));
    perform dame_test.expect('waiting: cannot change details', 'pending', dame_test.run(cc, q));
    perform dame_test.expect('switched off: cannot change details', 'disabled', dame_test.run(cd, q));
    perform dame_test.expect('a person changes his own work details', 'ok', dame_test.run(cb, q));
    perform dame_test.expect('they are stored tidied', 'Sales Engineer|Applied|Dubai|+971 4 123 4567',
      (select job_title || '|' || department || '|' || office || '|' || phone from core.profiles where id = b));
    perform dame_test.expect('nobody else was changed', '0', (select count(*)::text from core.profiles where id <> b and (job_title <> '' or department <> '')));
    perform dame_test.expect('the change is in the audit, by its field names', 'job title, department, office, phone',
      (select detail ->> 'name' from core.audit where action = 'user.details_changed' and actor = b order by id desc limit 1));
    perform dame_test.run(cb, q);
    perform dame_test.expect('saving the same again adds no audit line', '1', (select count(*)::text from core.audit where action = 'user.details_changed' and actor = b));
    foreach q in array array['call me maybe', '<script>', repeat('1', 31)] loop
      n := n + 1;
      perform dame_test.expect('bad phone refused, case ' || n, 'bad_request', dame_test.run(cb, format('select public.dame_account_set(%L, %L, %L, %L)', 'x', 'x', 'x', q)));
    end loop;
    perform dame_test.run(cb, format('select public.dame_account_set(%L, %L, %L, %L)', repeat('<b>x</b>', 20), E'a\nb', 'x', ''));
    perform dame_test.expect('hostile text is stored as plain text, cut to 80', '80|true',
      (select length(job_title)::text || '|' || (job_title like '<b>x</b>%')::text from core.profiles where id = b));
    perform dame_test.expect('line breaks become spaces', 'a b', (select department from core.profiles where id = b));
    perform dame_test.expect('the person has no function to change his own name, username or staff number', '0',
      (select count(*)::text from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public' and p.proname = 'dame_account_set' and (p.proargnames && array['p_name', 'p_username', 'p_staff_no'])));

    -- ------------------------------------------------ 2. IT opens and corrects an account
    q := format('select public.dame_user_get(%L)', b);
    perform dame_test.expect('signed out: cannot open a person', 'signed_out', dame_test.run(null, q));
    perform dame_test.expect('a member cannot open a person, not even himself', 'not_allowed', dame_test.run(cb, q));
    perform dame_test.expect('IT opens a person, with what only IT sees', 'Zz Ben|false',
      dame_test.val(ca, format($q$select (r ->> 'name') || '|' || (r ->> 'must_change') from public.dame_user_get(%L) r$q$, b)));
    perform dame_test.expect('no password field in it either', 'true',
      dame_test.val(ca, format($q$select (r::text !~* 'hash|pw_mark|encrypted')::text from public.dame_user_get(%L) r$q$, b)));
    perform dame_test.expect('a person that does not exist', 'bad_request', dame_test.run(ca, $q$select public.dame_user_get('00000000-0000-4000-8000-00000000ffff')$q$));

    q := format('select public.dame_user_details_set(%L, %L, %L, %L, %L, %L, %L)', b, 'Zz Benjamin', 'Engineer', 'Applied', 'Dubai', '', 'E-1042');
    perform dame_test.expect('signed out: cannot correct a person', 'signed_out', dame_test.run(null, q));
    perform dame_test.expect('a member cannot correct a person', 'not_allowed', dame_test.run(cb, q));
    perform dame_test.expect('IT corrects name, details and staff number', 'ok', dame_test.run(ca, q));
    perform dame_test.expect('stored', 'Zz Benjamin|Engineer|E-1042', (select name || '|' || job_title || '|' || staff_no from core.profiles where id = b));
    perform dame_test.expect('a changed name is in the audit with old and new', 'Zz Ben > Zz Benjamin',
      (select (detail ->> 'from') || ' > ' || (detail ->> 'to') from core.audit where action = 'user.details_set' and target = b::text order by id desc limit 1));
    perform dame_test.expect('an empty name is refused', 'bad_request', dame_test.run(ca, format('select public.dame_user_details_set(%L, %L, %L, %L, %L, %L, %L)', b, '   ', '', '', '', '', '')));
    perform dame_test.expect('a bad staff number is refused', 'bad_request', dame_test.run(ca, format('select public.dame_user_details_set(%L, %L, %L, %L, %L, %L, %L)', b, 'X', '', '', '', '', 'no spaces; drop')));
    perform dame_test.expect('the people list shows username, department and who must choose a password', 'true',
      dame_test.val(ca, $q$select bool_and(u ? 'username' and u ? 'department' and u ? 'must_change')::text from jsonb_array_elements(public.dame_users_list()) u$q$));

    -- ------------------------------------------------ 3. the person changes his own password
    perform dame_test.expect('saying "changed" while the password is the same is refused', 'bad_request', dame_test.run(cb, 'select public.dame_password_changed()'));
    update auth.users set encrypted_password = extensions.crypt('Ben-Second-Pass-2', extensions.gen_salt('bf')) where id = b;  -- what the sign-in service does
    perform dame_test.expect('signed out: cannot say "changed"', 'signed_out', dame_test.run(null, 'select public.dame_password_changed()'));
    perform dame_test.expect('after he changed it, "changed" is accepted', 'ok', dame_test.run(cb, 'select public.dame_password_changed()'));
    perform dame_test.expect('the date is kept and it is in the audit', 'true|1',
      (select (pw_changed_at is not null)::text from core.profiles where id = b) || '|' || (select count(*)::text from core.audit where action = 'user.password_changed' and actor = b));
    perform dame_test.expect('a second "changed" without a new password is refused', 'bad_request', dame_test.run(cb, 'select public.dame_password_changed()'));

    -- ------------------------------------------------ 4. IT resets a password
    q := format('select public.dame_user_password_reset(%L, %L)', b, 'Reset-Pass-98765');
    perform dame_test.expect('signed out: cannot reset', 'signed_out', dame_test.run(null, q));
    perform dame_test.expect('a member cannot reset anyone', 'not_allowed', dame_test.run(cb, q));
    perform dame_test.expect('waiting: cannot reset', 'pending', dame_test.run(cc, q));
    perform dame_test.expect('IT cannot reset his own password here', 'not_allowed', dame_test.run(ca, format('select public.dame_user_password_reset(%L, %L)', a, 'Reset-Pass-98765')));
    perform dame_test.expect('a waiting account cannot be reset', 'bad_request', dame_test.run(ca, format('select public.dame_user_password_reset(%L, %L)', c, 'Reset-Pass-98765')));
    perform dame_test.expect('a switched-off account cannot be reset', 'bad_request', dame_test.run(ca, format('select public.dame_user_password_reset(%L, %L)', d, 'Reset-Pass-98765')));
    perform dame_test.expect('an account that does not exist', 'bad_request', dame_test.run(ca, $q$select public.dame_user_password_reset('00000000-0000-4000-8000-00000000ffff', 'Reset-Pass-98765')$q$));
    foreach q in array array['short1A', 'alllowercase123', 'ALLUPPERCASE123', 'NoDigitsInHere', ''] loop
      n := n + 1;
      perform dame_test.expect('weak temporary password refused, case ' || n, 'bad_request', dame_test.run(ca, format('select public.dame_user_password_reset(%L, %L)', b, q)));
    end loop;
    perform dame_test.expect('none of that touched his password or his session', 'false|Zz Benjamin',
      (select must_change::text from core.profiles where id = b) || '|' || dame_test.val(cb, $q$select public.dame_me() ->> 'name'$q$));
    insert into auth.sessions (user_id) values (b);
    perform dame_test.expect('IT resets the password', 'ok', dame_test.run(ca, format('select public.dame_user_password_reset(%L, %L)', b, 'Reset-Pass-98765')));
    perform dame_test.expect('the sign-in service holds the temporary password, hashed', 'true',
      (select (encrypted_password = extensions.crypt('Reset-Pass-98765', encrypted_password) and encrypted_password not like '%Reset-Pass%')::text from auth.users where id = b));
    perform dame_test.expect('his session is ended at once', 'session_ended', dame_test.run(cb, 'select public.dame_me()'));
    perform dame_test.expect('the sign-in service''s own sessions of him are gone', '0', (select count(*)::text from auth.sessions where user_id = b));
    perform dame_test.expect('the temporary password is nowhere readable: not in the profile, not in the audit', '0',
      (select (select count(*) from core.profiles where temp_hash like '%Reset-Pass%') + (select count(*) from core.audit where detail::text like '%Reset-Pass%'))::text);
    perform dame_test.expect('the reset is in the audit, with who and whom', 'Zz Ada IT|Zz Benjamin',
      (select p.name || '|' || (x.detail ->> 'name') from core.audit x join core.profiles p on p.id = x.actor where x.action = 'user.password_reset' and x.target = b::text));
    perform dame_test.expect('IT sees that he must choose a password', 'true|false',
      dame_test.val(ca, format($q$select (r ->> 'must_change') || '|' || (r ->> 'temp_expired') from public.dame_user_get(%L) r$q$, b)));

    -- ------------------------------------------------ 5. after a reset: nothing opens without the temporary password
    cb := dame_test.claims(b, 5, 'b0@zz-work.test');   -- he signs in again, with the temporary password
    perform dame_test.expect('the start page is told: a reset, by whom', 'true|reset|Zz Ada IT|false',
      dame_test.val(cb, $q$select (r ->> 'must_change') || '|' || (r ->> 'temp_kind') || '|' || (r ->> 'temp_by') || '|' || (r ->> 'temp_expired') from public.dame_request_access() r$q$));
    foreach q in array array['select public.dame_me()', 'select public.dame_account_get()', $q$select public.dame_account_set('a', 'b', 'c', '')$q$, 'select public.dame_password_changed()', 'select public.dame_spaces_list()'] loop
      perform dame_test.expect('refused until then: ' || q, 'must_change', dame_test.run(cb, q));
    end loop;
    perform dame_test.expect('"done" while the temporary password is still in place is refused', 'bad_request', dame_test.run(cb, $q$select public.dame_password_done('Reset-Pass-98765')$q$));
    -- A stranger who still held a sign-in changes the password in the sign-in service behind IT's back:
    update auth.users set encrypted_password = extensions.crypt('Stranger-Pass-666', extensions.gen_salt('bf')) where id = b;
    perform dame_test.expect('"done" without the temporary password is refused', 'temp_needed', dame_test.run(cb, 'select public.dame_password_done()'));
    perform dame_test.expect('"done" with a guessed temporary password is refused', 'temp_wrong', dame_test.run(cb, $q$select public.dame_password_done('Stranger-Pass-666')$q$));
    perform dame_test.expect('still nothing opens', 'must_change', dame_test.run(cb, 'select public.dame_me()'));
    perform dame_test.expect('the person, who knows the temporary password, finishes', 'ok', dame_test.run(cb, $q$select public.dame_password_done('Reset-Pass-98765')$q$));
    perform dame_test.expect('now he is in again, with everything he had', 'Zz Benjamin|zz-acct',
      dame_test.val(cb, $q$select (r ->> 'name') || '|' || (r -> 'spaces' -> 0 ->> 'id') from public.dame_account_get() r$q$));
    perform dame_test.expect('nothing of the temporary password is kept', 'true',
      (select (temp_hash is null and temp_set_at is null and temp_set_by is null and temp_kind is null and pw_changed_at is not null)::text from core.profiles where id = b));

    -- ------------------------------------------------ 6. a temporary password lasts 7 days
    perform dame_test.expect('IT makes an account', 'zz.tim', dame_test.val(ca, $q$select public.dame_user_create('zz.tim', 'Zz Tim', 'Temp-Pass-12345') ->> 'username'$q$));
    w := (select id from core.profiles where username = 'zz.tim');
    cw := dame_test.claims(w, 6, 'zz.tim@users.dame.internal');
    perform dame_test.expect('the start page is told: a new account, by whom', 'new|Zz Ada IT|false',
      dame_test.val(cw, $q$select (r ->> 'temp_kind') || '|' || (r ->> 'temp_by') || '|' || (r ->> 'temp_expired') from public.dame_request_access() r$q$));
    update core.profiles set temp_set_at = now() - interval '8 days' where id = w;
    perform dame_test.expect('after 8 days the start page is told it is too old', 'true',
      dame_test.val(cw, $q$select public.dame_request_access() ->> 'temp_expired'$q$));
    update auth.users set encrypted_password = extensions.crypt('Tim-Own-Pass-777', extensions.gen_salt('bf')) where id = w;
    perform dame_test.expect('and "done" is refused, even with the right temporary password', 'temp_expired', dame_test.run(cw, $q$select public.dame_password_done('Temp-Pass-12345')$q$));
    perform dame_test.expect('IT sees it as too old', 'true', dame_test.val(ca, format($q$select public.dame_user_get(%L) ->> 'temp_expired'$q$, w)));
    perform dame_test.expect('IT gives a new temporary password', 'ok', dame_test.run(ca, format('select public.dame_user_password_reset(%L, %L)', w, 'Fresh-Temp-24680')));
    cw := dame_test.claims(w, 7, 'zz.tim@users.dame.internal');
    update auth.users set encrypted_password = extensions.crypt('Tim-Own-Pass-888', extensions.gen_salt('bf')) where id = w;
    perform dame_test.expect('the old temporary password no longer counts', 'temp_wrong', dame_test.run(cw, $q$select public.dame_password_done('Temp-Pass-12345')$q$));
    perform dame_test.expect('the new one does', 'ok', dame_test.run(cw, $q$select public.dame_password_done('Fresh-Temp-24680')$q$));
    perform dame_test.expect('the bar shows an account made by IT by its username', 'zz.tim', dame_test.val(cw, $q$select public.dame_me() ->> 'username'$q$));
    perform dame_test.expect('his account page shows the username and no inner address', 'zz.tim|(null)',
      dame_test.val(cw, $q$select (r ->> 'username') || '|' || coalesce(r ->> 'email', '(null)') from public.dame_account_get() r$q$));

    -- ------------------------------------------------ 7. one person never reaches another
    perform dame_test.expect('no function of a person takes another person''s id', '0',
      (select count(*)::text from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public' and p.proname in ('dame_account_get', 'dame_account_set', 'dame_password_changed', 'dame_password_done')
          and coalesce(p.proargnames, '{}') && array['p_user', 'p_id']));
    perform dame_test.expect('a signed-out visitor can run none of the new functions', '0',
      (select count(*)::text from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public' and p.proname in ('dame_account_get', 'dame_account_set', 'dame_password_changed', 'dame_password_done', 'dame_user_get', 'dame_user_details_set', 'dame_user_password_reset')
          and has_function_privilege('anon', p.oid, 'execute')));

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
