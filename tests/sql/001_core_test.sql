-- tests/sql/001_core_test.sql - allowed and refused cases for db/core/001_init.sql.
-- Serves: "Rules of work": every function has an allowed test and refused tests
-- (signed out, pending, disabled, level too low, other user's session).
-- Must not change: the test leaves nothing behind. Everything it creates is
-- undone before the result is shown, including its audit rows.
--
-- How to run: paste the whole file into the Supabase SQL editor and press Run.
-- Read the result table: the first row is the summary; any row with pass =
-- false is a failure. Safe to run at any time, also on a site in use.

drop table if exists dame_test_result;

do $test$
declare
  v_results jsonb := '[]'::jsonb;
  v_error   text;
  -- people
  a uuid := '00000000-0000-4000-8000-00000000000a';  -- becomes the first IT admin
  b uuid := '00000000-0000-4000-8000-00000000000b';  -- approved member
  c uuid := '00000000-0000-4000-8000-00000000000c';  -- stays pending
  d uuid := '00000000-0000-4000-8000-00000000000d';  -- approved, then switched off
  e uuid := '00000000-0000-4000-8000-00000000000e';  -- signed in, never asked for access
  -- claims of each person's session
  ca jsonb; cb jsonb; cc jsonb; cd jsonb; ce jsonb; cx jsonb;
  f record;
  v_call text;
begin
  begin
    -- ---------------------------------------------------------------- helpers
    create schema dame_test;
    create table dame_test.results (n serial, test text, expected text, got text);

    create function dame_test.claims(p_uid uuid, p_n integer, p_email text, p_name text default null) returns jsonb
    language sql as $f$
      select jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'email', p_email,
               'session_id', ('11111111-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid,
               'user_metadata', jsonb_build_object('name', p_name));
    $f$;

    -- Runs p_sql as a role with the given sign-in. Returns 'ok', or the refusal
    -- code, or 'denied' when the database itself refuses the role.
    create function dame_test.run(p_role text, p_claims jsonb, p_sql text) returns text
    language plpgsql as $f$
    declare v_detail text; v_state text; v_msg text;
    begin
      perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
      execute format('set local role %I', p_role);
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

    -- Same, but returns the first value of the query as text.
    create function dame_test.val(p_role text, p_claims jsonb, p_sql text) returns text
    language plpgsql as $f$
    declare v text;
    begin
      perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
      execute format('set local role %I', p_role);
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

    ca := dame_test.claims(a, 1, 'a@test.dame', 'Test A');
    cb := dame_test.claims(b, 2, 'b@test.dame', 'Test B');
    cc := dame_test.claims(c, 3, 'c@test.dame', 'Test C');
    cd := dame_test.claims(d, 4, 'd@test.dame', 'Test D');
    ce := dame_test.claims(e, 5, 'e@test.dame', 'Test E');

    -- A site in use already has an IT admin; the test needs a clean start.
    -- (Undone at the end like everything else.)
    update core.profiles set is_it = false where is_it;
    -- The test people use made-up addresses: for the test, any address may ask for access.
    update core.settings set value = '' where key = 'signup_domains';

    -- ------------------------------------------------- 1. signed-out visitor
    perform dame_test.expect('visitor: dame_site_info allowed', 'ok',
      dame_test.run('anon', null, 'select public.dame_site_info()'));
    for f in select p.oid::regproc::text as name, p.pronargs from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname like 'dame\_%'
               and p.proname not in ('dame_site_info', 'dame_file_allowed')  -- the file check answers no instead of refusing; tested in 003
             order by 1
    loop
      v_call := format('select %s(%s)', f.name, array_to_string(array_fill('null'::text, array[f.pronargs]), ','));
      perform dame_test.expect('visitor: ' || f.name || ' refused by the database', 'denied',
        dame_test.run('anon', null, v_call));
      perform dame_test.expect('no sign-in: ' || f.name || ' refused', 'signed_out',
        dame_test.run('authenticated', null, v_call));
    end loop;
    perform dame_test.expect('visitor cannot read a core table', 'denied',
      dame_test.run('anon', null, 'select count(*) from core.profiles'));
    perform dame_test.expect('signed-in user cannot read a core table', 'denied',
      dame_test.run('authenticated', cb, 'select count(*) from core.profiles'));
    perform dame_test.expect('signed-in user cannot call a core function', 'denied',
      dame_test.run('authenticated', cb, 'select core.require_it()'));
    perform dame_test.expect('signed-in user cannot make himself first admin', 'denied',
      dame_test.run('authenticated', cb, $q$select core.make_first_admin('b@test.dame')$q$));

    -- --------------------------------------------- 2. request access, pending
    perform dame_test.expect('request access: A becomes pending', 'pending',
      dame_test.val('authenticated', ca, $q$select public.dame_request_access() ->> 'status'$q$));
    perform dame_test.expect('request access: B becomes pending', 'pending',
      dame_test.val('authenticated', cb, $q$select public.dame_request_access() ->> 'status'$q$));
    perform dame_test.expect('request access: C becomes pending', 'pending',
      dame_test.val('authenticated', cc, $q$select public.dame_request_access() ->> 'status'$q$));
    perform dame_test.expect('request access: D becomes pending', 'pending',
      dame_test.val('authenticated', cd, $q$select public.dame_request_access() ->> 'status'$q$));
    perform dame_test.expect('request access twice adds no second row', '1',
      dame_test.val('authenticated', cc, $q$select (public.dame_request_access() ->> 'status' = 'pending')::int$q$));
    perform dame_test.expect('one profile per person', '1',
      (select count(*)::text from core.profiles where id = c));
    perform dame_test.expect('name is taken from sign-up', 'Test C',
      (select name from core.profiles where id = c));
    perform dame_test.expect('pending user cannot be IT admin (table rule)', '23514',
      left(dame_test.run('postgres', null, format('update core.profiles set is_it = true where id = %L', c)), 5));

    -- ------------------------------------------------------ 3. first IT admin
    perform dame_test.expect('first admin: unknown email refused', 'P0001',
      left(dame_test.run('postgres', null, $q$select core.make_first_admin('nobody@test.dame')$q$), 5));
    perform dame_test.expect('first admin: made by the owner', 'ok',
      dame_test.run('postgres', null, $q$select core.make_first_admin('A@Test.dame ')$q$));
    perform dame_test.expect('first admin: works only once', 'P0001',
      left(dame_test.run('postgres', null, $q$select core.make_first_admin('b@test.dame')$q$), 5));
    perform dame_test.expect('A is IT admin', 'true',
      dame_test.val('authenticated', ca, $q$select public.dame_me() ->> 'is_it'$q$));

    -- ---------------------------------------------------- 4. approve, refuse
    perform dame_test.expect('IT admin approves B', 'ok',
      dame_test.run('authenticated', ca, format('select public.dame_user_set_status(%L, %L)', b, 'active')));
    perform dame_test.expect('IT admin approves D', 'ok',
      dame_test.run('authenticated', ca, format('select public.dame_user_set_status(%L, %L)', d, 'active')));
    perform dame_test.expect('D can work while approved', 'ok',
      dame_test.run('authenticated', cd, 'select public.dame_me()'));
    perform dame_test.expect('IT admin switches D off', 'ok',
      dame_test.run('authenticated', ca, format('select public.dame_user_set_status(%L, %L)', d, 'disabled')));
    perform dame_test.expect('D loses everything at the next request', 'session_ended',
      dame_test.run('authenticated', cd, 'select public.dame_me()'));
    cd := dame_test.claims(d, 40, 'd@test.dame');
    perform dame_test.expect('D signs in again: still refused', 'disabled',
      dame_test.run('authenticated', cd, 'select public.dame_me()'));
    perform dame_test.expect('D sees only his status', 'disabled',
      dame_test.val('authenticated', cd, $q$select public.dame_request_access() ->> 'status'$q$));

    -- -------- 5. pending, disabled, unknown: refused by every function
    for f in select p.oid::regproc::text as name, p.pronargs from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname like 'dame\_%'
               and p.proname not in ('dame_site_info', 'dame_request_access', 'dame_sign_out', 'dame_file_allowed')
             order by 1
    loop
      v_call := format('select %s(%s)', f.name, array_to_string(array_fill('null'::text, array[f.pronargs]), ','));
      perform dame_test.expect('pending: ' || f.name || ' refused', 'pending',
        dame_test.run('authenticated', cc, v_call));
      perform dame_test.expect('disabled: ' || f.name || ' refused', 'disabled',
        dame_test.run('authenticated', cd, v_call));
      perform dame_test.expect('no access request: ' || f.name || ' refused', 'no_profile',
        dame_test.run('authenticated', ce, v_call));
    end loop;

    -- ------------------------------------------ 6. member: level too low
    perform dame_test.expect('member: dame_me allowed', 'Test B',
      dame_test.val('authenticated', cb, $q$select public.dame_me() ->> 'name'$q$));
    perform dame_test.expect('member is not IT admin', 'false',
      dame_test.val('authenticated', cb, $q$select public.dame_me() ->> 'is_it'$q$));
    perform dame_test.expect('member: spaces list allowed, empty', '0',
      dame_test.val('authenticated', cb, 'select jsonb_array_length(public.dame_spaces_list())'));
    perform dame_test.expect('member: users list refused', 'not_allowed',
      dame_test.run('authenticated', cb, 'select public.dame_users_list()'));
    perform dame_test.expect('member: approve refused', 'not_allowed',
      dame_test.run('authenticated', cb, format('select public.dame_user_set_status(%L, %L)', c, 'active')));
    perform dame_test.expect('member: cannot make himself IT admin', 'not_allowed',
      dame_test.run('authenticated', cb, format('select public.dame_user_set_it(%L, true)', b)));
    perform dame_test.expect('member: setting refused', 'not_allowed',
      dame_test.run('authenticated', cb, $q$select public.dame_setting_set('ai_mode', 'off')$q$));
    perform dame_test.expect('member: audit refused', 'not_allowed',
      dame_test.run('authenticated', cb, 'select public.dame_audit_list()'));

    -- ---------------------------------------------------------- 7. IT admin
    perform dame_test.expect('IT admin: users list shows the four test people', '4',
      dame_test.val('authenticated', ca,
        $q$select count(*) from jsonb_array_elements(public.dame_users_list()) u where u ->> 'email' like '%@test.dame'$q$));
    perform dame_test.expect('IT admin: waiting accounts come first', 'pending',
      dame_test.val('authenticated', ca, $q$select public.dame_users_list() -> 0 ->> 'status'$q$));
    perform dame_test.expect('IT admin: list by status', '1',
      dame_test.val('authenticated', ca,
        $q$select count(*) from jsonb_array_elements(public.dame_users_list('pending')) u where u ->> 'email' like '%@test.dame'$q$));
    perform dame_test.expect('IT admin: unknown status refused', 'bad_request',
      dame_test.run('authenticated', ca, $q$select public.dame_users_list('boss')$q$));
    perform dame_test.expect('IT admin: cannot switch himself off', 'not_allowed',
      dame_test.run('authenticated', ca, format('select public.dame_user_set_status(%L, %L)', a, 'disabled')));
    perform dame_test.expect('IT admin: cannot change his own role', 'not_allowed',
      dame_test.run('authenticated', ca, format('select public.dame_user_set_it(%L, false)', a)));
    perform dame_test.expect('IT admin: unknown status value refused', 'bad_request',
      dame_test.run('authenticated', ca, format('select public.dame_user_set_status(%L, %L)', c, 'pending')));
    perform dame_test.expect('IT admin: unknown person refused', 'bad_request',
      dame_test.run('authenticated', ca, format('select public.dame_user_set_status(%L, %L)', e, 'active')));
    perform dame_test.expect('IT admin: pending person cannot be made IT admin', 'bad_request',
      dame_test.run('authenticated', ca, format('select public.dame_user_set_it(%L, true)', c)));
    perform dame_test.expect('IT admin: unknown setting refused', 'bad_request',
      dame_test.run('authenticated', ca, $q$select public.dame_setting_set('colour', 'red')$q$));
    perform dame_test.expect('IT admin: unknown setting value refused', 'bad_request',
      dame_test.run('authenticated', ca, $q$select public.dame_setting_set('ai_mode', 'everything')$q$));
    perform dame_test.expect('IT admin: setting changed', 'ok',
      dame_test.run('authenticated', ca, $q$select public.dame_setting_set('ai_mode', 'prompt_all')$q$));
    perform dame_test.expect('setting is seen by a member', 'prompt_all',
      dame_test.val('authenticated', cb, $q$select public.dame_me() ->> 'ai_mode'$q$));
    perform dame_test.expect('IT admin: audit shows the newest action first', 'setting.changed',
      dame_test.val('authenticated', ca, $q$select public.dame_audit_list(5) -> 0 ->> 'action'$q$));
    perform dame_test.expect('IT admin: audit page size is respected', '2',
      dame_test.val('authenticated', ca, 'select jsonb_array_length(public.dame_audit_list(2))'));
    perform dame_test.expect('audit names the actor', 'Test A',
      dame_test.val('authenticated', ca, $q$select public.dame_audit_list(1) -> 0 ->> 'actor'$q$));

    perform dame_test.expect('IT admin makes B an IT admin', 'ok',
      dame_test.run('authenticated', ca, format('select public.dame_user_set_it(%L, true)', b)));
    perform dame_test.expect('B, now IT admin, switches A off', 'ok',
      dame_test.run('authenticated', cb, format('select public.dame_user_set_status(%L, %L)', a, 'disabled')));
    perform dame_test.expect('switching off removes the IT admin role', 'false',
      (select is_it::text from core.profiles where id = a));
    perform dame_test.expect('B switches A on again', 'ok',
      dame_test.run('authenticated', cb, format('select public.dame_user_set_status(%L, %L)', a, 'active')));
    ca := dame_test.claims(a, 10, 'a@test.dame');
    perform dame_test.expect('A is back as a member, not as IT admin', 'not_allowed',
      dame_test.run('authenticated', ca, 'select public.dame_users_list()'));
    perform dame_test.expect('B gives A the role back', 'ok',
      dame_test.run('authenticated', cb, format('select public.dame_user_set_it(%L, true)', a)));
    perform dame_test.expect('B takes his own role away: refused', 'not_allowed',
      dame_test.run('authenticated', cb, format('select public.dame_user_set_it(%L, false)', b)));
    perform dame_test.expect('A takes the role from B', 'ok',
      dame_test.run('authenticated', ca, format('select public.dame_user_set_it(%L, false)', b)));

    -- ------------------------------------------- 8. one session, 12 hours
    cx := dame_test.claims(b, 20, 'b@test.dame');
    perform dame_test.expect('B signs in a second time: new session works', 'ok',
      dame_test.run('authenticated', cx, 'select public.dame_me()'));
    perform dame_test.expect('B''s older session is refused', 'session_ended',
      dame_test.run('authenticated', cb, 'select public.dame_me()'));
    perform dame_test.expect('the older session cannot come back', 'session_ended',
      dame_test.run('authenticated', cb, 'select public.dame_request_access()'));
    perform dame_test.expect('the newer session still works', 'ok',
      dame_test.run('authenticated', cx, 'select public.dame_me()'));
    perform dame_test.expect('another user''s session id is refused', 'session_ended',
      dame_test.run('authenticated', cx || jsonb_build_object('session_id', ca -> 'session_id'), 'select public.dame_me()'));
    perform dame_test.expect('a sign-in without a session id is refused', 'signed_out',
      dame_test.run('authenticated', cx - 'session_id', 'select public.dame_me()'));
    perform dame_test.expect('an anonymous sign-in is refused', 'signed_out',
      dame_test.run('authenticated', cx || '{"is_anonymous": true}', 'select public.dame_me()'));
    perform dame_test.expect('a token of another role is refused', 'signed_out',
      dame_test.run('authenticated', cx || '{"role": "anon"}', 'select public.dame_me()'));
    update core.sessions set first_seen = now() - interval '12 hours 1 minute'
     where session_id = (cx ->> 'session_id')::uuid;
    perform dame_test.expect('a session older than 12 hours is refused', 'session_ended',
      dame_test.run('authenticated', cx, 'select public.dame_me()'));
    cb := dame_test.claims(b, 21, 'b@test.dame');
    perform dame_test.expect('B signs in again after 12 hours', 'ok',
      dame_test.run('authenticated', cb, 'select public.dame_me()'));
    perform dame_test.expect('B signs out', 'ok',
      dame_test.run('authenticated', cb, 'select public.dame_sign_out()'));
    perform dame_test.expect('after sign-out the same token is refused', 'session_ended',
      dame_test.run('authenticated', cb, 'select public.dame_me()'));
    cb := dame_test.claims(b, 22, 'b@test.dame');

    -- ------------------------------------------------ 9. audit is append-only
    perform dame_test.expect('audit row cannot be changed, even by the owner', 'P0001',
      left(dame_test.run('postgres', null, $q$update core.audit set action = 'x' where action = 'user.first_admin'$q$), 5));
    perform dame_test.expect('audit row cannot be deleted, even by the owner', 'P0001',
      left(dame_test.run('postgres', null, $q$delete from core.audit where action = 'user.first_admin'$q$), 5));
    perform dame_test.expect('audit cannot be emptied, even by the owner', 'P0001',
      left(dame_test.run('postgres', null, 'truncate core.audit'), 5));
    perform dame_test.expect('every admin action above was written to the audit', 'true',
      (select (count(*) >= 12)::text from core.audit where actor in (a, b, c, d) or target in (a::text, b::text, c::text, d::text)));

    -- ------------------------------- 10. spaces, tools and levels (for phase 2)
    insert into core.spaces (id, name, created_by) values ('test-space-zz', 'Test space', a), ('test-other-zz', 'Other', a);
    insert into core.tools (space, id, name, created_by, open_to_space, open_level)
      values ('test-space-zz', 'open-tool', 'Open tool', a, true, 'contribute'),
             ('test-space-zz', 'closed-tool', 'Closed tool', a, false, 'read');
    insert into core.space_members (space, user_id, added_by) values ('test-space-zz', b, a);

    perform dame_test.expect('bad id refused by the table: capitals', '23514',
      left(dame_test.run('postgres', null, format($q$insert into core.spaces (id, name, created_by) values ('Sales', 'x', %L)$q$, a)), 5));
    perform dame_test.expect('bad id refused by the table: double dash', '23514',
      left(dame_test.run('postgres', null, format($q$insert into core.spaces (id, name, created_by) values ('a--b', 'x', %L)$q$, a)), 5));
    perform dame_test.expect('bad id refused by the table: too short', '23514',
      left(dame_test.run('postgres', null, format($q$insert into core.spaces (id, name, created_by) values ('ab', 'x', %L)$q$, a)), 5));

    perform dame_test.expect('member sees his space on the hub', 'test-space-zz',
      dame_test.val('authenticated', cb, $q$select public.dame_spaces_list() -> 0 ->> 'id'$q$));
    perform dame_test.expect('member does not see the other space', '1',
      dame_test.val('authenticated', cb, 'select jsonb_array_length(public.dame_spaces_list())'));
    perform dame_test.expect('IT admin does not get a space by being IT admin', '0',
      dame_test.val('authenticated', ca,
        $q$select count(*) from jsonb_array_elements(public.dame_spaces_list()) s where s ->> 'id' like 'test-%-zz'$q$));

    perform dame_test.expect('member of the space is let in as member', 'ok',
      dame_test.run('postgres', cb, $q$select core.require_space('test-space-zz', 'member')$q$));
    perform dame_test.expect('member is not let in as admin', 'not_allowed',
      dame_test.run('postgres', cb, $q$select core.require_space('test-space-zz', 'admin')$q$));
    perform dame_test.expect('member is not let into another space', 'not_allowed',
      dame_test.run('postgres', cb, $q$select core.require_space('test-other-zz', 'member')$q$));
    perform dame_test.expect('a space that does not exist looks the same as a refused one', 'not_allowed',
      dame_test.run('postgres', cb, $q$select core.require_space('test-none-zz', 'member')$q$));

    perform dame_test.expect('tool open to the space gives its level', 'contribute',
      core.tool_level(b, 'test-space-zz', 'open-tool'));
    perform dame_test.expect('being in the space does not open a closed tool', '(none)',
      coalesce(core.tool_level(b, 'test-space-zz', 'closed-tool'), '(none)'));
    perform dame_test.expect('closed tool refused', 'not_allowed',
      dame_test.run('postgres', cb, $q$select core.require_tool('test-space-zz', 'closed-tool', 'read')$q$));
    perform dame_test.expect('level too low refused', 'not_allowed',
      dame_test.run('postgres', cb, $q$select core.require_tool('test-space-zz', 'open-tool', 'edit')$q$));
    perform dame_test.expect('level high enough allowed', 'ok',
      dame_test.run('postgres', cb, $q$select core.require_tool('test-space-zz', 'open-tool', 'contribute')$q$));
    insert into core.tool_access (space, tool, user_id, level, added_by) values ('test-space-zz', 'closed-tool', b, 'edit', a);
    perform dame_test.expect('access given by name opens the closed tool', 'edit',
      core.tool_level(b, 'test-space-zz', 'closed-tool'));
    update core.tools set active = false where space = 'test-space-zz' and id = 'closed-tool';
    perform dame_test.expect('a tool switched off is closed to members', '(none)',
      coalesce(core.tool_level(b, 'test-space-zz', 'closed-tool'), '(none)'));
    insert into core.tool_managers (space, tool, user_id, added_by) values ('test-space-zz', 'closed-tool', b, a);
    perform dame_test.expect('its manager still has the top level', 'approve',
      core.tool_level(b, 'test-space-zz', 'closed-tool'));
    perform dame_test.expect('a pending person has no level anywhere', '(none)',
      coalesce(core.tool_level(c, 'test-space-zz', 'open-tool'), '(none)'));
    insert into core.space_admins (space, user_id, added_by) values ('test-other-zz', b, a);
    perform dame_test.expect('space admin is let in as admin of his space', 'ok',
      dame_test.run('postgres', cb, $q$select core.require_space('test-other-zz', 'admin')$q$));
    perform dame_test.expect('unknown level refused', 'bad_request',
      dame_test.run('postgres', cb, $q$select core.require_tool('test-space-zz', 'open-tool', 'owner')$q$));

    -- ------------------------------------------------------ 11. security check
    perform dame_test.expect('core.security_check() finds nothing', '0',
      (select count(*)::text from core.security_check()));

    select coalesce(jsonb_agg(jsonb_build_object('n', n, 'test', test, 'expected', expected, 'got', got) order by n), '[]'::jsonb)
      into v_results from dame_test.results;
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
