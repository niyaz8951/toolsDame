-- tests/sql/spaces_tools_test.sql - allowed and refused cases for spaces and tools, their admins,
-- members, managers and access (db/05_spaces_tools.sql).
-- Serves: phase 2 test: "an admin acts alone inside his space; every action
-- outside it is refused". Also: IT admin, tool manager, member, last admin,
-- ids never reused, delete with cleanup.
-- Must not change: the test leaves nothing behind. Everything it creates is
-- undone before the result is shown, including its audit rows.
--
-- How to run: on a database built from db/, paste the whole file into the SQL editor and press Run.
-- First row is the summary; any row with pass = false is a failure.

drop table if exists dame_test_result;

do $test$
declare
  v_results jsonb := '[]'::jsonb;
  v_error   text;
  a uuid := '00000000-0000-4000-8000-0000000000a2';  -- IT admin, in no space
  b uuid := '00000000-0000-4000-8000-0000000000b2';  -- admin of space one
  c uuid := '00000000-0000-4000-8000-0000000000c2';  -- member of space one
  d uuid := '00000000-0000-4000-8000-0000000000d2';  -- manager of the tool "closed" in space one
  e uuid := '00000000-0000-4000-8000-0000000000e2';  -- admin of space two
  f uuid := '00000000-0000-4000-8000-0000000000f2';  -- approved, gets access to one tool by name
  p uuid := '00000000-0000-4000-8000-000000000092';  -- pending
  ca jsonb; cb jsonb; cc jsonb; cd jsonb; ce jsonb; cf jsonb;
  s1 text := 'zz-test-one';
  s2 text := 'zz-test-two';
  q  text;
  n  integer := 0;
begin
  begin
    create schema dame_test;
    create table dame_test.results (n serial, test text, expected text, got text);

    create function dame_test.claims(p_uid uuid, p_n integer) returns jsonb
    language sql as $f$
      select jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'email', 'x@test.dame',
               'session_id', ('22222222-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid);
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
      (a, 'a2@test.dame', 'Zz Ada IT', 'active', true),
      (b, 'b2@test.dame', 'Zz Ben Admin', 'active', false),
      (c, 'c2@test.dame', 'Zz Cy Member', 'active', false),
      (d, 'd2@test.dame', 'Zz Di Manager', 'active', false),
      (e, 'e2@test.dame', 'Zz Eve Other', 'active', false),
      (f, 'f2@test.dame', 'Zz Fay Named', 'active', false),
      (p, 'p2@test.dame', 'Zz Pat Pending', 'pending', false);
    ca := dame_test.claims(a, 1); cb := dame_test.claims(b, 2); cc := dame_test.claims(c, 3);
    cd := dame_test.claims(d, 4); ce := dame_test.claims(e, 5); cf := dame_test.claims(f, 6);

    -- ------------------------------------------------ 1. IT admin makes spaces
    perform dame_test.expect('member cannot create a space', 'not_allowed',
      dame_test.run(cb, format('select public.dame_space_create(%L, %L, %L, %L)', s1, 'One', '', b)));
    perform dame_test.expect('IT admin creates space one, admin Ben', 'ok',
      dame_test.run(ca, format('select public.dame_space_create(%L, %L, %L, %L)', s1, ' Space One ', 'First', b)));
    perform dame_test.expect('IT admin creates space two, admin Eve', 'ok',
      dame_test.run(ca, format('select public.dame_space_create(%L, %L, %L, %L)', s2, 'Space Two', '', e)));
    perform dame_test.expect('the name is trimmed', 'Space One', (select name from core.spaces where id = s1));
    perform dame_test.expect('same id twice refused', 'bad_request',
      dame_test.run(ca, format('select public.dame_space_create(%L, %L, %L, %L)', s1, 'Again', '', b)));
    perform dame_test.expect('id with capitals refused', 'bad_request',
      dame_test.run(ca, format('select public.dame_space_create(%L, %L, %L, %L)', 'Zz-Test', 'x', '', b)));
    perform dame_test.expect('id too short refused', 'bad_request',
      dame_test.run(ca, format('select public.dame_space_create(%L, %L, %L, %L)', 'zz', 'x', '', b)));
    perform dame_test.expect('empty name refused', 'bad_request',
      dame_test.run(ca, format('select public.dame_space_create(%L, %L, %L, %L)', 'zz-test-x', '  ', '', b)));
    perform dame_test.expect('pending person cannot be first admin', 'bad_request',
      dame_test.run(ca, format('select public.dame_space_create(%L, %L, %L, %L)', 'zz-test-x', 'x', '', p)));
    perform dame_test.expect('unknown person cannot be first admin', 'bad_request',
      dame_test.run(ca, format('select public.dame_space_create(%L, %L, %L, %L)', 'zz-test-x', 'x', '', gen_random_uuid())));
    perform dame_test.expect('IT admin lists all spaces with their admins', 'Zz Ben Admin',
      dame_test.val(ca, format($q$select s -> 'admins' -> 0 ->> 'name' from jsonb_array_elements(public.dame_spaces_all()) s where s ->> 'id' = %L$q$, s1)));
    perform dame_test.expect('space admin cannot list all spaces', 'not_allowed',
      dame_test.run(cb, 'select public.dame_spaces_all()'));

    -- ------------------------------------- 2. the admin works inside his space
    perform dame_test.expect('admin adds a member', 'ok',
      dame_test.run(cb, format('select public.dame_space_member_add(%L, %L)', s1, c)));
    perform dame_test.expect('adding the same member twice is harmless', 'ok',
      dame_test.run(cb, format('select public.dame_space_member_add(%L, %L)', s1, c)));
    perform dame_test.expect('one membership row', '1',
      (select count(*)::text from core.space_members where space = s1 and user_id = c));
    perform dame_test.expect('pending person cannot be added', 'bad_request',
      dame_test.run(cb, format('select public.dame_space_member_add(%L, %L)', s1, p)));
    perform dame_test.expect('admin creates a tool open to the space', 'ok',
      dame_test.run(cb, format('select public.dame_tool_create(%L, %L, %L, %L, %L, %L, true, %L)', s1, 'bids', 'Bids', 'Bid tracker', 'B', '#0b63ce', 'contribute')));
    perform dame_test.expect('admin creates a closed tool', 'ok',
      dame_test.run(cb, format('select public.dame_tool_create(%L, %L, %L, %L, %L, %L, false, %L)', s1, 'closed', 'Closed', '', '', '', 'read')));
    perform dame_test.expect('same tool id twice refused', 'bad_request',
      dame_test.run(cb, format('select public.dame_tool_create(%L, %L, %L, %L, %L, %L, false, %L)', s1, 'bids', 'x', '', '', '', 'read')));
    perform dame_test.expect('the same tool id in another space is fine', 'ok',
      dame_test.run(ce, format('select public.dame_tool_create(%L, %L, %L, %L, %L, %L, false, %L)', s2, 'bids', 'Bids two', '', '', '', 'read')));
    perform dame_test.expect('bad colour refused', 'bad_request',
      dame_test.run(cb, format('select public.dame_tool_create(%L, %L, %L, %L, %L, %L, false, %L)', s1, 'tool-x', 'x', '', '', 'red; x', 'read')));
    perform dame_test.expect('unknown level refused', 'bad_request',
      dame_test.run(cb, format('select public.dame_tool_create(%L, %L, %L, %L, %L, %L, true, %L)', s1, 'tool-x', 'x', '', '', '', 'owner')));
    perform dame_test.expect('bad tool id refused', 'bad_request',
      dame_test.run(cb, format('select public.dame_tool_create(%L, %L, %L, %L, %L, %L, false, %L)', s1, 'a--b', 'x', '', '', '', 'read')));
    perform dame_test.expect('ids too long together refused', 'bad_request',
      dame_test.run(cb, format('select public.dame_tool_create(%L, %L, %L, %L, %L, %L, false, %L)', s1, repeat('t', 30) || repeat('u', 19), 'x', '', '', '', 'read')));
    perform dame_test.expect('admin names a manager', 'ok',
      dame_test.run(cb, format('select public.dame_tool_manager_add(%L, %L, %L)', s1, 'closed', d)));
    perform dame_test.expect('admin gives access by name', 'ok',
      dame_test.run(cb, format('select public.dame_tool_access_set(%L, %L, %L, %L)', s1, 'closed', f, 'edit')));
    perform dame_test.expect('admin changes a tool', 'ok',
      dame_test.run(cb, format('select public.dame_tool_update(%L, %L, %L, %L, %L, %L, true, %L)', s1, 'bids', 'Bids', 'Tracker', 'B', '', 'contribute')));
    perform dame_test.expect('admin renames his space', 'ok',
      dame_test.run(cb, format('select public.dame_space_update(%L, %L, %L)', s1, 'Space One', 'Changed')));
    perform dame_test.expect('admin reads his space page', '2',
      dame_test.val(cb, format($q$select jsonb_array_length(public.dame_space_admin_get(%L) -> 'tools')$q$, s1)));
    perform dame_test.expect('admin reads the audit of his space only', 'true',
      dame_test.val(cb, format($q$select bool_and(x ->> 'space' = %L) and count(*) >= 8 from jsonb_array_elements(public.dame_audit_scope_list(%L)) x$q$, s1, s1)));
    perform dame_test.expect('admin finds a person by name', 'Zz Fay Named',
      dame_test.val(cb, $q$select public.dame_people_find('zz fay') -> 0 ->> 'name'$q$));
    perform dame_test.expect('pending people are not found', '0',
      dame_test.val(cb, $q$select jsonb_array_length(public.dame_people_find('Zz Pat'))$q$));
    perform dame_test.expect('a search sign matches nothing by itself', '0',
      dame_test.val(cb, $q$select jsonb_array_length(public.dame_people_find('%%'))$q$));
    perform dame_test.expect('a one-letter search is refused', 'bad_request',
      dame_test.run(cb, $q$select public.dame_people_find('z')$q$));

    -- ------------------- 3. the same admin outside his space: all refused
    foreach q in array array[
      format('select public.dame_space_member_add(%L, %L)', s2, c),
      format('select public.dame_space_member_remove(%L, %L)', s2, c),
      format('select public.dame_tool_create(%L, %L, %L, %L, %L, %L, false, %L)', s2, 'intruder', 'x', '', '', '', 'read'),
      format('select public.dame_tool_update(%L, %L, %L, %L, %L, %L, true, %L)', s2, 'bids', 'x', '', '', '', 'approve'),
      format('select public.dame_tool_set_active(%L, %L, false)', s2, 'bids'),
      format('select public.dame_tool_delete(%L, %L, %L)', s2, 'bids', 'bids'),
      format('select public.dame_tool_manager_add(%L, %L, %L)', s2, 'bids', b),
      format('select public.dame_tool_manager_remove(%L, %L, %L)', s2, 'bids', e),
      format('select public.dame_tool_access_set(%L, %L, %L, %L)', s2, 'bids', b, 'approve'),
      format('select public.dame_tool_admin_get(%L, %L)', s2, 'bids'),
      format('select public.dame_space_admin_get(%L)', s2),
      format('select public.dame_space_admin_add(%L, %L)', s2, b),
      format('select public.dame_space_admin_remove(%L, %L)', s2, e),
      format('select public.dame_space_update(%L, %L, %L)', s2, 'Mine now', ''),
      format('select public.dame_audit_scope_list(%L)', s2),
      format('select public.dame_audit_scope_list(%L, %L)', s2, 'bids'),
      format('select public.dame_space_get(%L)', s2),
      format('select public.dame_space_set_active(%L, false)', s2),
      format('select public.dame_space_delete(%L, %L)', s2, s2),
      format('select public.dame_space_set_active(%L, false)', s1),
      format('select public.dame_space_delete(%L, %L)', s1, s1),
      'select public.dame_audit_list()'
    ] loop
      n := n + 1;
      perform dame_test.expect('admin of space one, outside it, case ' || n || ': ' || split_part(split_part(q, 'public.', 2), '(', 1),
        'not_allowed', dame_test.run(cb, q));
    end loop;
    perform dame_test.expect('nothing changed in space two', '1/0/1/0',
      (select count(*) from core.space_admins where space = s2) || '/' || (select count(*) from core.space_members where space = s2)
      || '/' || (select count(*) from core.tools where space = s2) || '/' || (select count(*) from core.tool_access where space = s2));
    perform dame_test.expect('a space that does not exist looks the same as a refused one', 'not_allowed',
      dame_test.run(cb, $q$select public.dame_space_get('zz-test-none')$q$));

    -- ------------------- 4. IT admin acts as admin of every space (owner, 2026-11-27)
    perform dame_test.expect('IT admin opens a space he is not named in, as admin', 'true/bids,closed',
      dame_test.val(ca, format($q$select (public.dame_space_get(%L) ->> 'is_admin') || '/' || (select string_agg(t ->> 'id', ',') from jsonb_array_elements(public.dame_space_get(%L) -> 'tools') t)$q$, s1, s1)));
    perform dame_test.expect('IT admin has the top level on every tool', 'approve/approve',
      core.tool_level(a, s1, 'bids') || '/' || core.tool_level(a, s1, 'closed'));
    perform dame_test.expect('IT admin is still not counted as a named admin', 'false',
      core.is_space_admin(a, s1)::text);
    perform dame_test.expect('IT admin creates a tool in that space', 'ok',
      dame_test.run(ca, format('select public.dame_tool_create(%L, %L, %L, %L, %L, %L, false, %L)', s1, 'it-tool', 'x', '', '', '', 'read')));
    perform dame_test.expect('IT admin opens that tool''s admin page', 'ok',
      dame_test.run(ca, format('select public.dame_tool_admin_get(%L, %L)', s1, 'it-tool')));
    perform dame_test.expect('IT admin gives and takes access on a tool', 'ok/ok',
      dame_test.run(ca, format('select public.dame_tool_access_set(%L, %L, %L, %L)', s1, 'it-tool', f, 'read'))
      || '/' || dame_test.run(ca, format('select public.dame_tool_access_set(%L, %L, %L, null)', s1, 'it-tool', f)));
    perform dame_test.expect('IT admin deletes the tool he made', 'ok',
      dame_test.run(ca, format('select public.dame_tool_delete(%L, %L, %L)', s1, 'it-tool', 'it-tool')));
    perform dame_test.expect('what IT did is in the space''s audit under his name', 'true',
      ((select count(*) from core.audit where space = s1 and tool = 'it-tool' and actor = a) >= 4)::text);
    perform dame_test.expect('IT admin reads the space''s audit', 'ok',
      dame_test.run(ca, format('select public.dame_audit_scope_list(%L)', s1)));
    perform dame_test.expect('IT admin on a space that does not exist: told so', 'bad_request',
      dame_test.run(ca, format('select public.dame_space_admin_add(%L, %L)', 'zz-test-none', f)));

    -- ------------------- 5. tool manager: his tool only
    perform dame_test.expect('manager gives access on his tool', 'ok',
      dame_test.run(cd, format('select public.dame_tool_access_set(%L, %L, %L, %L)', s1, 'closed', c, 'read')));
    perform dame_test.expect('manager raises it', 'ok',
      dame_test.run(cd, format('select public.dame_tool_access_set(%L, %L, %L, %L)', s1, 'closed', c, 'contribute')));
    perform dame_test.expect('one access row, at the new level', 'contribute',
      (select string_agg(level, ',') from core.tool_access where space = s1 and tool = 'closed' and user_id = c));
    perform dame_test.expect('manager takes it away', 'ok',
      dame_test.run(cd, format('select public.dame_tool_access_set(%L, %L, %L, null)', s1, 'closed', c)));
    perform dame_test.expect('manager: unknown level refused', 'bad_request',
      dame_test.run(cd, format('select public.dame_tool_access_set(%L, %L, %L, %L)', s1, 'closed', c, 'boss')));
    perform dame_test.expect('manager: pending person refused', 'bad_request',
      dame_test.run(cd, format('select public.dame_tool_access_set(%L, %L, %L, %L)', s1, 'closed', p, 'read')));
    perform dame_test.expect('manager reads his tool page', 'Zz Fay Named',
      dame_test.val(cd, format($q$select public.dame_tool_admin_get(%L, %L) -> 'access' -> 0 ->> 'name'$q$, s1, 'closed')));
    perform dame_test.expect('manager reads the audit of his tool', 'true',
      dame_test.val(cd, format($q$select bool_and(x ->> 'tool' = 'closed') and count(*) >= 4 from jsonb_array_elements(public.dame_audit_scope_list(%L, %L)) x$q$, s1, 'closed')));
    perform dame_test.expect('manager may look people up', 'ok',
      dame_test.run(cd, $q$select public.dame_people_find('zz')$q$));
    perform dame_test.expect('manager has the top level on his tool', 'approve',
      core.tool_level(d, s1, 'closed'));
    n := 0;
    foreach q in array array[
      format('select public.dame_tool_access_set(%L, %L, %L, %L)', s1, 'bids', d, 'approve'),
      format('select public.dame_tool_admin_get(%L, %L)', s1, 'bids'),
      format('select public.dame_audit_scope_list(%L, %L)', s1, 'bids'),
      format('select public.dame_audit_scope_list(%L)', s1),
      format('select public.dame_tool_update(%L, %L, %L, %L, %L, %L, true, %L)', s1, 'closed', 'x', '', '', '', 'approve'),
      format('select public.dame_tool_set_active(%L, %L, false)', s1, 'closed'),
      format('select public.dame_tool_delete(%L, %L, %L)', s1, 'closed', 'closed'),
      format('select public.dame_tool_manager_add(%L, %L, %L)', s1, 'closed', c),
      format('select public.dame_tool_manager_remove(%L, %L, %L)', s1, 'closed', d),
      format('select public.dame_tool_create(%L, %L, %L, %L, %L, %L, false, %L)', s1, 'mgr-tool', 'x', '', '', '', 'read'),
      format('select public.dame_space_member_add(%L, %L)', s1, d),
      format('select public.dame_space_admin_add(%L, %L)', s1, d),
      format('select public.dame_space_admin_get(%L)', s1),
      format('select public.dame_tool_access_set(%L, %L, %L, %L)', s2, 'bids', d, 'read')
    ] loop
      n := n + 1;
      perform dame_test.expect('manager beyond his tool, case ' || n || ': ' || split_part(split_part(q, 'public.', 2), '(', 1),
        'not_allowed', dame_test.run(cd, q));
    end loop;

    -- ------------------- 6. member and a person with one tool by name
    perform dame_test.expect('member opens the space and sees the open tool only', 'bids',
      dame_test.val(cc, format($q$select string_agg(t ->> 'id', ',') from jsonb_array_elements(public.dame_space_get(%L) -> 'tools') t$q$, s1)));
    perform dame_test.expect('member gets the level of the open tool', 'contribute',
      dame_test.val(cc, format($q$select public.dame_space_get(%L) -> 'tools' -> 0 ->> 'level'$q$, s1)));
    perform dame_test.expect('person with one tool by name sees that tool only', 'closed',
      dame_test.val(cf, format($q$select string_agg(t ->> 'id', ',') from jsonb_array_elements(public.dame_space_get(%L) -> 'tools') t$q$, s1)));
    perform dame_test.expect('that person sees the space on the hub', s1,
      dame_test.val(cf, $q$select string_agg(x ->> 'id', ',') from jsonb_array_elements(public.dame_spaces_list()) x where x ->> 'id' like 'zz-test-%'$q$));
    perform dame_test.expect('admin sees every tool of his space', 'bids,closed',
      dame_test.val(cb, format($q$select string_agg(t ->> 'id', ',') from jsonb_array_elements(public.dame_space_get(%L) -> 'tools') t$q$, s1)));
    n := 0;
    foreach q in array array[
      format('select public.dame_space_member_add(%L, %L)', s1, f),
      format('select public.dame_tool_access_set(%L, %L, %L, %L)', s1, 'bids', c, 'approve'),
      format('select public.dame_tool_create(%L, %L, %L, %L, %L, %L, false, %L)', s1, 'my-tool', 'x', '', '', '', 'read'),
      format('select public.dame_tool_manager_add(%L, %L, %L)', s1, 'bids', c),
      format('select public.dame_space_admin_add(%L, %L)', s1, c),
      format('select public.dame_space_admin_get(%L)', s1),
      format('select public.dame_tool_admin_get(%L, %L)', s1, 'bids'),
      format('select public.dame_audit_scope_list(%L)', s1),
      format('select public.dame_space_get(%L)', s2),
      $q$select public.dame_people_find('zz')$q$
    ] loop
      n := n + 1;
      perform dame_test.expect('member, case ' || n || ': ' || split_part(split_part(q, 'public.', 2), '(', 1),
        'not_allowed', dame_test.run(cc, q));
    end loop;

    -- ------------------- 7. switched off
    perform dame_test.expect('admin switches a tool off', 'ok',
      dame_test.run(cb, format('select public.dame_tool_set_active(%L, %L, false)', s1, 'bids')));
    perform dame_test.expect('member no longer sees it', '0',
      dame_test.val(cc, format($q$select jsonb_array_length(public.dame_space_get(%L) -> 'tools')$q$, s1)));
    perform dame_test.expect('admin switches it on again', 'ok',
      dame_test.run(cb, format('select public.dame_tool_set_active(%L, %L, true)', s1, 'bids')));
    perform dame_test.expect('IT admin switches the space off', 'ok',
      dame_test.run(ca, format('select public.dame_space_set_active(%L, false)', s1)));
    perform dame_test.expect('member cannot open a space that is off', 'not_allowed',
      dame_test.run(cc, format('select public.dame_space_get(%L)', s1)));
    perform dame_test.expect('member has no level in a space that is off', '(none)',
      coalesce(core.tool_level(c, s1, 'bids'), '(none)'));
    perform dame_test.expect('its admin can still open it', 'ok',
      dame_test.run(cb, format('select public.dame_space_get(%L)', s1)));
    perform dame_test.expect('IT admin switches the space on', 'ok',
      dame_test.run(ca, format('select public.dame_space_set_active(%L, true)', s1)));

    -- ------------------- 8. a space always has an admin
    perform dame_test.expect('the last admin cannot remove himself', 'bad_request',
      dame_test.run(cb, format('select public.dame_space_admin_remove(%L, %L)', s1, b)));
    perform dame_test.expect('IT admin cannot remove the last admin either', 'bad_request',
      dame_test.run(ca, format('select public.dame_space_admin_remove(%L, %L)', s1, b)));
    perform dame_test.expect('admin names a second admin', 'ok',
      dame_test.run(cb, format('select public.dame_space_admin_add(%L, %L)', s1, c)));
    update core.profiles set status = 'disabled' where id = c;
    perform dame_test.expect('a switched-off account does not count as an admin', 'bad_request',
      dame_test.run(cb, format('select public.dame_space_admin_remove(%L, %L)', s1, b)));
    update core.profiles set status = 'active' where id = c;
    perform dame_test.expect('IT admin names an admin', 'ok',
      dame_test.run(ca, format('select public.dame_space_admin_add(%L, %L)', s1, f)));
    perform dame_test.expect('IT admin removes an admin', 'ok',
      dame_test.run(ca, format('select public.dame_space_admin_remove(%L, %L)', s1, f)));
    perform dame_test.expect('now the first admin can step down', 'ok',
      dame_test.run(cb, format('select public.dame_space_admin_remove(%L, %L)', s1, b)));
    perform dame_test.expect('and is outside at once', 'not_allowed',
      dame_test.run(cb, format('select public.dame_space_admin_get(%L)', s1)));
    cc := dame_test.claims(c, 30);

    -- ------------------- 9. delete with cleanup, ids never reused
    perform dame_test.expect('delete a tool: wrong word refused', 'bad_request',
      dame_test.run(cc, format('select public.dame_tool_delete(%L, %L, %L)', s1, 'closed', 'yes')));
    perform dame_test.expect('delete a tool: its id typed', 'ok',
      dame_test.run(cc, format('select public.dame_tool_delete(%L, %L, %L)', s1, 'closed', 'closed')));
    perform dame_test.expect('its managers and access are gone', '0',
      (select ((select count(*) from core.tool_managers where space = s1 and tool = 'closed')
             + (select count(*) from core.tool_access where space = s1 and tool = 'closed'))::text));
    perform dame_test.expect('the old manager is outside at once', 'not_allowed',
      dame_test.run(cd, format('select public.dame_tool_admin_get(%L, %L)', s1, 'closed')));
    perform dame_test.expect('a deleted tool id cannot be used again', 'bad_request',
      dame_test.run(cc, format('select public.dame_tool_create(%L, %L, %L, %L, %L, %L, false, %L)', s1, 'closed', 'x', '', '', '', 'read')));
    perform dame_test.expect('delete a space: wrong word refused', 'bad_request',
      dame_test.run(ca, format('select public.dame_space_delete(%L, %L)', s1, 'delete')));
    perform dame_test.expect('delete a space: its id typed', 'ok',
      dame_test.run(ca, format('select public.dame_space_delete(%L, %L)', s1, s1)));
    perform dame_test.expect('everything of the space is gone', '0',
      (select ((select count(*) from core.spaces where id = s1) + (select count(*) from core.tools where space = s1)
             + (select count(*) from core.space_admins where space = s1) + (select count(*) from core.space_members where space = s1)
             + (select count(*) from core.tool_managers where space = s1) + (select count(*) from core.tool_access where space = s1))::text));
    perform dame_test.expect('a deleted space id cannot be used again', 'bad_request',
      dame_test.run(ca, format('select public.dame_space_create(%L, %L, %L, %L)', s1, 'Back', '', b)));
    perform dame_test.expect('its old admin is outside at once', 'not_allowed',
      dame_test.run(cc, format('select public.dame_space_get(%L)', s1)));
    perform dame_test.expect('space two is untouched', '1',
      (select count(*)::text from core.tools where space = s2));
    perform dame_test.expect('the audit still tells the story of the deleted space', 'true',
      dame_test.val(ca, format($q$select count(*) >= 15 from jsonb_array_elements(public.dame_audit_list(500)) x where x ->> 'space' = %L$q$, s1)));

    -- ------------------- 10. security check
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
