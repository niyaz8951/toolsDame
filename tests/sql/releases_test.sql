-- tests/sql/releases_test.sql - allowed and refused cases for uploads, the file rules, preview,
-- make live, roll back, versions that never change (db/06_releases.sql).
-- Serves: contract 6 (Releases) and SECURITY "Database" 6.
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
  a uuid := '00000000-0000-4000-8000-0000000000a3';  -- admin of the space
  m uuid := '00000000-0000-4000-8000-0000000000b3';  -- manager of the tool "app"
  u uuid := '00000000-0000-4000-8000-0000000000c3';  -- has "app" at read
  x uuid := '00000000-0000-4000-8000-0000000000d3';  -- approved, has nothing
  o uuid := '00000000-0000-4000-8000-0000000000e3';  -- admin of another space
  ca jsonb; cm jsonb; cu jsonb; cx jsonb; co jsonb;
  s  text := 'zz-test-three';
  s2 text := 'zz-test-four';
  sha text := repeat('ab', 32);
  one jsonb;
  two jsonb;
  q  text;
  n  integer := 0;
  v_store boolean := true;
begin
  begin
    create schema dame_test;
    create table dame_test.results (n serial, test text, expected text, got text);

    create function dame_test.claims(p_uid uuid, p_n integer) returns jsonb
    language sql as $f$
      select jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'email', 'x@test.dame',
               'session_id', ('33333333-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid);
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

    -- May this person read / write this file? 'true' or 'false'.
    create function dame_test.file(p_claims jsonb, p_name text, p_action text) returns text
    language sql as $f$
      select dame_test.val(p_claims, format('select public.dame_file_allowed(%L, %L)::text', p_name, p_action));
    $f$;

    insert into core.profiles (id, email, name, status) values
      (a, 'a3@test.dame', 'Zz Ada', 'active'), (m, 'm3@test.dame', 'Zz Max', 'active'),
      (u, 'u3@test.dame', 'Zz Uma', 'active'), (x, 'x3@test.dame', 'Zz Xan', 'active'),
      (o, 'o3@test.dame', 'Zz Oto', 'active');
    insert into core.spaces (id, name, created_by) values (s, 'Three', a), (s2, 'Four', o);
    insert into core.space_admins (space, user_id, added_by) values (s, a, a), (s2, o, o);
    insert into core.tools (space, id, name, created_by) values (s, 'app', 'App', a), (s, 'other', 'Other', a), (s2, 'app', 'App four', o);
    insert into core.tool_managers (space, tool, user_id, added_by) values (s, 'app', m, a);
    insert into core.tool_access (space, tool, user_id, level, added_by) values (s, 'app', u, 'read', a);
    ca := dame_test.claims(a, 1); cm := dame_test.claims(m, 2); cu := dame_test.claims(u, 3);
    cx := dame_test.claims(x, 4); co := dame_test.claims(o, 5);
    -- each person has clicked once, so the platform knows his session
    perform dame_test.run(ca, 'select public.dame_me()'); perform dame_test.run(cm, 'select public.dame_me()');
    perform dame_test.run(cu, 'select public.dame_me()'); perform dame_test.run(cx, 'select public.dame_me()');
    perform dame_test.run(co, 'select public.dame_me()');

    one := jsonb_build_array(jsonb_build_object('name', 'index.html', 'size', 100, 'sha256', sha),
                             jsonb_build_object('name', 'help.html', 'size', 50, 'sha256', sha));
    two := jsonb_build_array(jsonb_build_object('name', 'index.html', 'size', 200, 'sha256', sha));

    -- ------------------------------------------------ 1. who may start an upload
    perform dame_test.expect('person with the tool at read cannot upload', 'not_allowed',
      dame_test.run(cu, format('select public.dame_version_begin(%L, %L, %L, %L)', s, 'app', one, '')));
    perform dame_test.expect('person without the tool cannot upload', 'not_allowed',
      dame_test.run(cx, format('select public.dame_version_begin(%L, %L, %L, %L)', s, 'app', one, '')));
    perform dame_test.expect('admin of another space cannot upload', 'not_allowed',
      dame_test.run(co, format('select public.dame_version_begin(%L, %L, %L, %L)', s, 'app', one, '')));
    perform dame_test.expect('manager cannot upload to another tool', 'not_allowed',
      dame_test.run(cm, format('select public.dame_version_begin(%L, %L, %L, %L)', s, 'other', one, '')));

    -- ------------------------------------------------ 2. what an upload may hold
    foreach q in array array[
      '[]',
      '{"name": "index.html"}',
      jsonb_build_array(jsonb_build_object('name', 'home.html', 'size', 10, 'sha256', sha))::text,
      jsonb_build_array(jsonb_build_object('name', 'index.html', 'size', 10, 'sha256', sha), jsonb_build_object('name', 'Index2.html', 'size', 10, 'sha256', sha))::text,
      jsonb_build_array(jsonb_build_object('name', 'index.html', 'size', 10, 'sha256', sha), jsonb_build_object('name', 'app.js', 'size', 10, 'sha256', sha))::text,
      jsonb_build_array(jsonb_build_object('name', 'index.html', 'size', 10, 'sha256', sha), jsonb_build_object('name', '../x.html', 'size', 10, 'sha256', sha))::text,
      jsonb_build_array(jsonb_build_object('name', 'index.html', 'size', 10, 'sha256', sha), jsonb_build_object('name', 'a/b.html', 'size', 10, 'sha256', sha))::text,
      jsonb_build_array(jsonb_build_object('name', 'index.html', 'size', 10, 'sha256', sha), jsonb_build_object('name', 'index.html', 'size', 10, 'sha256', sha))::text,
      jsonb_build_array(jsonb_build_object('name', 'index.html', 'size', 10, 'sha256', 'short'))::text,
      jsonb_build_array(jsonb_build_object('name', 'index.html', 'size', 0, 'sha256', sha))::text,
      jsonb_build_array(jsonb_build_object('name', 'index.html', 'size', -5, 'sha256', sha))::text,
      jsonb_build_array(jsonb_build_object('name', 'index.html', 'size', 20971521, 'sha256', sha))::text,
      (select jsonb_agg(jsonb_build_object('name', case when g = 1 then 'index.html' else 'p' || g || '.html' end, 'size', 20971520, 'sha256', sha))::text from generate_series(1, 11) g),
      (select jsonb_agg(jsonb_build_object('name', case when g = 1 then 'index.html' else 'p' || g || '.html' end, 'size', 10, 'sha256', sha))::text from generate_series(1, 51) g)
    ] loop
      n := n + 1;
      perform dame_test.expect('upload refused, case ' || n || ' (' || left(q, 40) || ')', 'bad_request',
        dame_test.run(cm, format('select public.dame_version_begin(%L, %L, %L::jsonb, %L)', s, 'app', q, '')));
    end loop;
    perform dame_test.expect('no version was created by the refused uploads', '0',
      (select count(*)::text from core.tool_versions where space = s));

    -- ------------------------------------------------ 3. uploading
    perform dame_test.expect('manager starts version 1', '1',
      dame_test.val(cm, format('select public.dame_version_begin(%L, %L, %L, %L)', s, 'app', one, 'first')));
    perform dame_test.expect('the uploader may send an announced page', 'true', dame_test.file(cm, s || '/app/1/index.html', 'write'));
    perform dame_test.expect('the uploader may not send a page he did not announce', 'false', dame_test.file(cm, s || '/app/1/extra.html', 'write'));
    perform dame_test.expect('another manager may not send into his upload', 'false', dame_test.file(ca, s || '/app/1/index.html', 'write'));
    perform dame_test.expect('a reader may not send a page', 'false', dame_test.file(cu, s || '/app/1/index.html', 'write'));
    perform dame_test.expect('a reader may not read an upload in progress', 'false', dame_test.file(cu, s || '/app/1/index.html', 'read'));
    perform dame_test.expect('nobody may send into a version that does not exist', 'false', dame_test.file(cm, s || '/app/7/index.html', 'write'));
    n := 0;
    foreach q in array array[s || '/app/1/../index.html', s || '/app/1', s || '/app/01/index.html', s || '/app/1/sub/index.html',
                             '/' || s || '/app/1/index.html', s || '/App/1/index.html', s || '/app/1/index.htm', s || '/app/x/index.html', ''] loop
      n := n + 1;
      perform dame_test.expect('odd file name ' || n || ' is refused: ' || q, 'false/false',
        dame_test.file(cm, q, 'read') || '/' || dame_test.file(cm, q, 'write'));
    end loop;
    perform dame_test.expect('an unknown action is refused', 'false', dame_test.file(cm, s || '/app/1/index.html', 'delete'));
    perform dame_test.expect('closing an upload whose files did not arrive is refused', 'bad_request',
      dame_test.run(cm, format('select public.dame_version_seal(%L, %L, 1)', s, 'app')));
    perform dame_test.expect('another manager cannot close his upload', 'bad_request',
      dame_test.run(ca, format('select public.dame_version_seal(%L, %L, 1)', s, 'app')));
    perform dame_test.expect('a reader cannot close an upload', 'not_allowed',
      dame_test.run(cu, format('select public.dame_version_seal(%L, %L, 1)', s, 'app')));

    -- The files arrive. (If this project does not let the SQL editor write to
    -- the file list, the test marks the version ready itself and goes on.)
    begin
      insert into storage.objects (bucket_id, name, metadata) values
        ('tools', s || '/app/1/index.html', '{"size": 100}'), ('tools', s || '/app/1/help.html', '{"size": 50}');
    exception when others then
      v_store := false;
    end;
    if v_store then
      perform dame_test.expect('manager closes version 1', 'ok',
        dame_test.run(cm, format('select public.dame_version_seal(%L, %L, 1)', s, 'app')));
    else
      update core.tool_versions set state = 'ready', sealed_at = now() where space = s and tool = 'app' and version = 1;
      update core.tools set preview_version = 1 where space = s and id = 'app';
    end if;
    perform dame_test.expect('version 1 is ready and is the preview', 'ready/1',
      (select v.state || '/' || t.preview_version from core.tool_versions v join core.tools t on t.space = v.space and t.id = v.tool
        where v.space = s and v.tool = 'app' and v.version = 1));

    -- ------------------------------------------------ 4. a ready version never changes
    perform dame_test.expect('nobody may send a page into a ready version', 'false/false',
      dame_test.file(cm, s || '/app/1/index.html', 'write') || '/' || dame_test.file(ca, s || '/app/1/index.html', 'write'));
    perform dame_test.expect('closing it twice is refused', 'bad_request',
      dame_test.run(cm, format('select public.dame_version_seal(%L, %L, 1)', s, 'app')));
    begin
      update core.tool_versions set files = two where space = s and tool = 'app' and version = 1;
      perform dame_test.expect('even the owner cannot change a ready version', 'refused', 'CHANGED');
    exception when others then
      perform dame_test.expect('even the owner cannot change a ready version', 'refused', 'refused');
    end;
    begin
      update core.tool_versions set state = 'uploading' where space = s and tool = 'app' and version = 1;
      perform dame_test.expect('a ready version cannot be opened again', 'refused', 'CHANGED');
    exception when others then
      perform dame_test.expect('a ready version cannot be opened again', 'refused', 'refused');
    end;

    -- ------------------------------------------------ 5. preview: managers only
    perform dame_test.expect('manager opens the preview', '1',
      dame_test.val(cm, format($q$select public.dame_tool_open(%L, %L, true) ->> 'version'$q$, s, 'app')));
    perform dame_test.expect('space admin opens the preview', 'true',
      dame_test.val(ca, format($q$select public.dame_tool_open(%L, %L, true) ->> 'preview'$q$, s, 'app')));
    perform dame_test.expect('a reader cannot open the preview', 'not_allowed',
      dame_test.run(cu, format('select public.dame_tool_open(%L, %L, true)', s, 'app')));
    perform dame_test.expect('a reader is told the tool is not published', 'not_live',
      dame_test.run(cu, format('select public.dame_tool_open(%L, %L, false)', s, 'app')));
    perform dame_test.expect('a reader cannot read the preview files', 'false', dame_test.file(cu, s || '/app/1/index.html', 'read'));
    perform dame_test.expect('a manager reads the preview files', 'true', dame_test.file(cm, s || '/app/1/help.html', 'read'));
    perform dame_test.expect('a reader cannot choose the preview', 'not_allowed',
      dame_test.run(cu, format('select public.dame_version_preview(%L, %L, 1)', s, 'app')));
    perform dame_test.expect('a reader cannot list versions', 'not_allowed',
      dame_test.run(cu, format('select public.dame_versions_list(%L, %L)', s, 'app')));

    -- ------------------------------------------------ 6. make live
    perform dame_test.expect('a reader cannot make a version live', 'not_allowed',
      dame_test.run(cu, format('select public.dame_version_make_live(%L, %L, 1)', s, 'app')));
    perform dame_test.expect('a version that does not exist cannot go live', 'bad_request',
      dame_test.run(cm, format('select public.dame_version_make_live(%L, %L, 9)', s, 'app')));
    perform dame_test.expect('manager makes version 1 live', 'ok',
      dame_test.run(cm, format('select public.dame_version_make_live(%L, %L, 1)', s, 'app')));
    perform dame_test.expect('the reader now gets version 1 with his level', '1/read',
      dame_test.val(cu, format($q$select (r ->> 'version') || '/' || (r ->> 'level') from public.dame_tool_open(%L, %L, false) r$q$, s, 'app')));
    perform dame_test.expect('he is told who he is, nothing more', 'Zz Uma',
      dame_test.val(cu, format($q$select public.dame_tool_open(%L, %L) -> 'me' ->> 'name'$q$, s, 'app')));
    perform dame_test.expect('the reader may read the live files', 'true', dame_test.file(cu, s || '/app/1/index.html', 'read'));
    perform dame_test.expect('the reader still may not write', 'false', dame_test.file(cu, s || '/app/1/index.html', 'write'));
    perform dame_test.expect('a person without the tool cannot open it', 'not_allowed',
      dame_test.run(cx, format('select public.dame_tool_open(%L, %L)', s, 'app')));
    perform dame_test.expect('a person without the tool cannot read its files', 'false', dame_test.file(cx, s || '/app/1/index.html', 'read'));
    perform dame_test.expect('an admin of another space cannot read its files', 'false', dame_test.file(co, s || '/app/1/index.html', 'read'));
    perform dame_test.expect('the same path in another space opens nothing', 'false', dame_test.file(cu, s2 || '/app/1/index.html', 'read'));

    -- ------------------------------------------------ 7. version 2, roll back
    perform dame_test.expect('manager starts version 2', '2',
      dame_test.val(cm, format('select public.dame_version_begin(%L, %L, %L, %L)', s, 'app', two, 'second')));
    update core.tool_versions set state = 'ready', sealed_at = now() where space = s and tool = 'app' and version = 2;
    update core.tools set preview_version = 2 where space = s and id = 'app';
    perform dame_test.expect('readers still get version 1 while 2 is in preview', '1',
      dame_test.val(cu, format($q$select public.dame_tool_open(%L, %L) ->> 'version'$q$, s, 'app')));
    perform dame_test.expect('a reader cannot read the files of version 2 yet', 'false', dame_test.file(cu, s || '/app/2/index.html', 'read'));
    perform dame_test.expect('manager makes version 2 live', 'ok',
      dame_test.run(cm, format('select public.dame_version_make_live(%L, %L, 2)', s, 'app')));
    perform dame_test.expect('readers get version 2', '2',
      dame_test.val(cu, format($q$select public.dame_tool_open(%L, %L) ->> 'version'$q$, s, 'app')));
    perform dame_test.expect('readers lose the files of version 1', 'false', dame_test.file(cu, s || '/app/1/index.html', 'read'));
    perform dame_test.expect('manager rolls back to version 1', 'ok',
      dame_test.run(cm, format('select public.dame_version_make_live(%L, %L, 1)', s, 'app')));
    perform dame_test.expect('readers get version 1 again', '1',
      dame_test.val(cu, format($q$select public.dame_tool_open(%L, %L) ->> 'version'$q$, s, 'app')));
    perform dame_test.expect('the roll back is in the audit', 'version.rolled_back: 2 > 1',
      (select action || ': ' || (detail ->> 'from') || ' > ' || (detail ->> 'to') from core.audit where space = s order by id desc limit 1));
    perform dame_test.expect('manager lists both versions, live is 1', '2/1',
      dame_test.val(cm, format($q$select jsonb_array_length(r -> 'versions') || '/' || (r ->> 'live') from public.dame_versions_list(%L, %L) r$q$, s, 'app')));

    -- ------------------------------------------------ 8. an upload given up
    perform dame_test.expect('manager starts version 3 and leaves it', '3',
      dame_test.val(cm, format('select public.dame_version_begin(%L, %L, %L, %L)', s, 'app', two, '')));
    perform dame_test.expect('admin starts version 4', '4',
      dame_test.val(ca, format('select public.dame_version_begin(%L, %L, %L, %L)', s, 'app', two, '')));
    perform dame_test.expect('the unfinished version 3 is given up', 'discarded',
      (select state from core.tool_versions where space = s and tool = 'app' and version = 3));
    perform dame_test.expect('nothing can be sent into a version given up', 'false', dame_test.file(cm, s || '/app/3/index.html', 'write'));
    perform dame_test.expect('a version given up cannot go live', 'bad_request',
      dame_test.run(cm, format('select public.dame_version_make_live(%L, %L, 3)', s, 'app')));

    -- ------------------------------------------------ 9. switched off, signed out, deleted
    update core.tools set active = false where space = s and id = 'app';
    perform dame_test.expect('tool switched off: reader cannot open it', 'not_allowed',
      dame_test.run(cu, format('select public.dame_tool_open(%L, %L)', s, 'app')));
    perform dame_test.expect('tool switched off: reader cannot read its files', 'false', dame_test.file(cu, s || '/app/1/index.html', 'read'));
    perform dame_test.expect('tool switched off: its manager still opens it', 'ok',
      dame_test.run(cm, format('select public.dame_tool_open(%L, %L)', s, 'app')));
    update core.tools set active = true where space = s and id = 'app';
    perform dame_test.expect('after signing out, the old token reads no file', 'ok/false',
      dame_test.run(cu, 'select public.dame_sign_out()') || '/' || dame_test.file(cu, s || '/app/1/index.html', 'read'));
    cu := dame_test.claims(u, 30);
    perform dame_test.expect('a session the platform has not seen reads no file', 'false', dame_test.file(cu, s || '/app/1/index.html', 'read'));
    perform dame_test.run(cu, 'select public.dame_me()');
    perform dame_test.expect('after signing in again he reads the live files', 'true', dame_test.file(cu, s || '/app/1/index.html', 'read'));
    update core.profiles set status = 'disabled' where id = u;
    perform dame_test.expect('a switched-off account reads no file', 'false', dame_test.file(cu, s || '/app/1/index.html', 'read'));
    update core.profiles set status = 'active' where id = u;
    perform dame_test.expect('no sign-in at all reads no file', 'false', dame_test.file(null, s || '/app/1/index.html', 'read'));
    perform dame_test.expect('admin deletes the tool', 'ok',
      dame_test.run(ca, format('select public.dame_tool_delete(%L, %L, %L)', s, 'app', 'app')));
    perform dame_test.expect('its versions are forgotten', '0', (select count(*)::text from core.tool_versions where space = s and tool = 'app'));
    perform dame_test.expect('its files open for nobody', 'false/false/false',
      dame_test.file(cu, s || '/app/1/index.html', 'read') || '/' || dame_test.file(cm, s || '/app/1/index.html', 'read') || '/' || dame_test.file(ca, s || '/app/1/index.html', 'read'));

    -- ------------------------------------------------ 10. the file store itself
    perform dame_test.expect('the bucket "tools" is private', 'false',
      (select public::text from storage.buckets where id = 'tools'));
    perform dame_test.expect('the file store has exactly the two DAME rules, none to change or delete', 'INSERT,SELECT',
      (select string_agg(cmd, ',' order by cmd) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'dame\_%'));
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
