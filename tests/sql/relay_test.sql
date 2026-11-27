-- tests/sql/relay_test.sql - allowed and refused cases for Relay (db/09_relay.sql):
-- setting up a flow, who sees it, who starts, picks up, ticks, passes on,
-- answers back, sends back, takes over, closes and cancels, what a flow may
-- change while items are open, a team switched off, and the history that
-- cannot be changed.
-- Serves: "Rules of work": every function has an allowed test and refused tests.
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
  a   uuid := '00000000-0000-4000-8000-0000000000a9';  -- IT admin, in no space
  sam uuid := '00000000-0000-4000-8000-0000000000b9';  -- member of Sales
  sia uuid := '00000000-0000-4000-8000-0000000000c9';  -- admin of Sales
  abe uuid := '00000000-0000-4000-8000-0000000000d9';  -- member of Application
  hal uuid := '00000000-0000-4000-8000-0000000000e9';  -- member of HQ-AES
  fay uuid := '00000000-0000-4000-8000-0000000000f9';  -- admin of Factory
  xan uuid := '00000000-0000-4000-8000-000000000019';  -- member of a space that is on no flow
  ca jsonb; csam jsonb; csia jsonb; cabe jsonb; chal jsonb; cfay jsonb; cxan jsonb;
  st jsonb;
  i1 bigint; i2 bigint; i3 bigint;
  v  text;
begin
  begin
    create schema dame_test;
    create table dame_test.results (n serial, test text, expected text, got text);

    create function dame_test.claims(p_uid uuid, p_n integer) returns jsonb
    language sql as $f$
      select jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'email', 'x@test.dame',
               'session_id', ('29999999-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid);
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
      (a,   'a9@test.dame',   'Zz Ada IT', 'active', true),
      (sam, 'sam9@test.dame', 'Zz Sam Sales', 'active', false),
      (sia, 'sia9@test.dame', 'Zz Sia Sales admin', 'active', false),
      (abe, 'abe9@test.dame', 'Zz Abe Application', 'active', false),
      (hal, 'hal9@test.dame', 'Zz Hal HQ', 'active', false),
      (fay, 'fay9@test.dame', 'Zz Fay Factory', 'active', false),
      (xan, 'xan9@test.dame', 'Zz Xan Outside', 'active', false);
    insert into core.spaces (id, name, created_by) values
      ('zz-sales', 'Zz Sales', a), ('zz-app', 'Zz Application', a), ('zz-hq', 'Zz HQ-AES', a),
      ('zz-prod', 'Zz Product team', a), ('zz-fact', 'Zz Factory', a), ('zz-other', 'Zz Other', a);
    insert into core.space_admins (space, user_id, added_by) values ('zz-sales', sia, a), ('zz-fact', fay, a);
    insert into core.space_members (space, user_id, added_by) values
      ('zz-sales', sam, a), ('zz-app', abe, a), ('zz-hq', hal, a), ('zz-other', xan, a);
    ca := dame_test.claims(a, 1); csam := dame_test.claims(sam, 2); csia := dame_test.claims(sia, 3);
    cabe := dame_test.claims(abe, 4); chal := dame_test.claims(hal, 5); cfay := dame_test.claims(fay, 6);
    cxan := dame_test.claims(xan, 7);

    st := jsonb_build_array(
      jsonb_build_object('space', 'zz-sales', 'name', ' Raise the query ', 'hours', 8,
                         'checks', jsonb_build_array('Customer and project named', '  ', 'Model and quantity given')),
      jsonb_build_object('space', 'zz-app', 'name', 'Technical review', 'hours', 24, 'checks', jsonb_build_array('Selection checked')),
      jsonb_build_object('space', 'zz-hq', 'name', 'Engineering support', 'hours', 48),
      jsonb_build_object('space', 'zz-prod', 'name', 'Product decision', 'optional', true, 'hours', 48),
      jsonb_build_object('space', 'zz-fact', 'name', 'Factory answer', 'hours', 72));

    -- ------------------------------------------------ 1. IT sets up a flow
    perform dame_test.expect('a member cannot set up a flow', 'not_allowed',
      dame_test.run(csia, format('select public.dame_relay_flow_save(%L, %L, %L, %L, %L, %L)', 'zz-mto', 'MTO', 'MTO query', 'ZMTO', '', st)));
    perform dame_test.expect('a member cannot list every flow', 'not_allowed',
      dame_test.run(csam, 'select public.dame_relay_flows_all()'));
    perform dame_test.expect('a bad flow id is refused', 'bad_request',
      dame_test.run(ca, format('select public.dame_relay_flow_save(%L, %L, %L, %L, %L, %L)', 'Zz MTO', 'MTO', 'MTO query', 'ZMTO', '', st)));
    perform dame_test.expect('one stage is too few', 'bad_request',
      dame_test.run(ca, format('select public.dame_relay_flow_save(%L, %L, %L, %L, %L, %L)', 'zz-mto', 'MTO', 'MTO query', 'ZMTO', '', jsonb_build_array(st -> 0))));
    perform dame_test.expect('a stage with an unknown team is refused', 'bad_request',
      dame_test.run(ca, format('select public.dame_relay_flow_save(%L, %L, %L, %L, %L, %L)', 'zz-mto', 'MTO', 'MTO query', 'ZMTO', '',
        jsonb_set(st, '{1,space}', '"zz-nowhere"'))));
    perform dame_test.expect('a first stage that may be skipped is refused', 'bad_request',
      dame_test.run(ca, format('select public.dame_relay_flow_save(%L, %L, %L, %L, %L, %L)', 'zz-mto', 'MTO', 'MTO query', 'ZMTO', '',
        jsonb_set(st, '{0,optional}', 'true'))));
    perform dame_test.expect('bad number letters are refused', 'bad_request',
      dame_test.run(ca, format('select public.dame_relay_flow_save(%L, %L, %L, %L, %L, %L)', 'zz-mto', 'MTO', 'MTO query', '1-x', '', st)));
    perform dame_test.expect('hours out of range are refused', 'bad_request',
      dame_test.run(ca, format('select public.dame_relay_flow_save(%L, %L, %L, %L, %L, %L)', 'zz-mto', 'MTO', 'MTO query', 'ZMTO', '',
        jsonb_set(st, '{2,hours}', '0'))));
    perform dame_test.expect('11 checklist lines are refused', 'bad_request',
      dame_test.run(ca, format('select public.dame_relay_flow_save(%L, %L, %L, %L, %L, %L)', 'zz-mto', 'MTO', 'MTO query', 'ZMTO', '',
        jsonb_set(st, '{2,checks}', (select jsonb_agg('line ' || g) from generate_series(1, 11) g)))));
    perform dame_test.expect('a hostile item word is refused', 'bad_request',
      dame_test.run(ca, format('select public.dame_relay_flow_save(%L, %L, %L, %L, %L, %L)', 'zz-mto', 'MTO', '<b>x</b>', 'ZMTO', '', st)));
    perform dame_test.expect('IT sets up the MTO flow with five stages', 'ok',
      dame_test.run(ca, format('select public.dame_relay_flow_save(%L, %L, %L, %L, %L, %L)', 'zz-mto', ' MTO escalation ', 'MTO query', 'zmto', 'Special units', st)));
    perform dame_test.expect('five stages are kept', '5', (select count(*)::text from core.relay_stages where flow = 'zz-mto'));
    perform dame_test.expect('names are trimmed, empty checklist lines dropped', 'Raise the query|2',
      (select name || '|' || jsonb_array_length(checks) from core.relay_stages where flow = 'zz-mto' and pos = 1));
    perform dame_test.expect('the number letters are made capitals', 'ZMTO', (select prefix from core.relay_flows where id = 'zz-mto'));
    perform dame_test.expect('another flow cannot take the same letters', 'bad_request',
      dame_test.run(ca, format('select public.dame_relay_flow_save(%L, %L, %L, %L, %L, %L)', 'zz-other-flow', 'Other', 'request', 'ZMTO', '', st)));
    perform dame_test.expect('IT lists the flow', 'MTO escalation',
      dame_test.val(ca, $q$select f ->> 'name' from jsonb_array_elements(public.dame_relay_flows_all()) f where f ->> 'id' = 'zz-mto'$q$));
    perform dame_test.expect('making the flow is in the audit', '1',
      (select count(*)::text from core.audit where action = 'relay.flow_created' and target = 'zz-mto'));

    -- ------------------------------------------------ 2. who sees it, who starts
    perform dame_test.expect('someone on no stage sees no flow', '0',
      dame_test.val(cxan, $q$select jsonb_array_length(public.dame_relay_home() -> 'flows')$q$));
    perform dame_test.expect('someone on no stage cannot open the board', 'not_allowed',
      dame_test.run(cxan, $q$select public.dame_relay_board('zz-mto')$q$));
    perform dame_test.expect('someone on no stage cannot start', 'not_allowed',
      dame_test.run(cxan, $q$select public.dame_relay_start('zz-mto', 'A query', '', '', 'normal', null)$q$));
    perform dame_test.expect('Sales sees the flow and may start', 'true',
      dame_test.val(csam, $q$select f ->> 'can_start' from jsonb_array_elements(public.dame_relay_home() -> 'flows') f where f ->> 'id' = 'zz-mto'$q$));
    perform dame_test.expect('Application sees the flow but may not start', 'false',
      dame_test.val(cabe, $q$select f ->> 'can_start' from jsonb_array_elements(public.dame_relay_home() -> 'flows') f where f ->> 'id' = 'zz-mto'$q$));
    perform dame_test.expect('Application cannot start', 'not_allowed',
      dame_test.run(cabe, $q$select public.dame_relay_start('zz-mto', 'A query', '', '', 'normal', null)$q$));
    perform dame_test.expect('a title of 2 characters is refused', 'bad_request',
      dame_test.run(csam, $q$select public.dame_relay_start('zz-mto', ' ab ', '', '', 'normal', null)$q$));
    perform dame_test.expect('a needed-by date in the past is refused', 'bad_request',
      dame_test.run(csam, $q$select public.dame_relay_start('zz-mto', 'A query', '', '', 'normal', current_date - 1)$q$));
    perform dame_test.expect('an unknown priority is refused', 'bad_request',
      dame_test.run(csam, $q$select public.dame_relay_start('zz-mto', 'A query', '', '', 'whenever', null)$q$));
    perform dame_test.expect('Sales starts an MTO query', 'ZMTO-0001',
      dame_test.val(csam, $q$select public.dame_relay_start('zz-mto', 'AHU with double skin 50 mm', 'Stadium, Riyadh', 'Spec 2.3.1 asks for it', 'urgent', current_date + 10) ->> 'ref'$q$));
    i1 := (select id from core.relay_items where flow = 'zz-mto' and ref_no = 1);
    perform dame_test.expect('the starter has it at once', 'working|' || sam,
      (select status || '|' || picked_by from core.relay_items where id = i1));
    perform dame_test.expect('someone on no stage cannot open the item', 'not_allowed',
      dame_test.run(cxan, format('select public.dame_relay_item(%s)', i1)));
    perform dame_test.expect('someone on no stage cannot write a note', 'not_allowed',
      dame_test.run(cxan, format('select public.dame_relay_note(%s, %L)', i1, 'hello')));
    perform dame_test.expect('an item that does not exist says the same', 'not_allowed',
      dame_test.run(csam, 'select public.dame_relay_item(999999999)'));

    -- ------------------------------------------------ 3. the checklist, passing on
    perform dame_test.expect('passing on with the checklist undone is refused', 'not_ready',
      dame_test.run(csam, format('select public.dame_relay_pass(%s, null, %L)', i1, '')));
    perform dame_test.expect('the admin of Sales cannot tick: Sam has it', 'not_allowed',
      dame_test.run(csia, format('select public.dame_relay_tick(%s, 1, true)', i1)));
    perform dame_test.expect('a line that is not on the checklist is refused', 'bad_request',
      dame_test.run(csam, format('select public.dame_relay_tick(%s, 3, true)', i1)));
    perform dame_test.expect('Sam ticks line 1', 'ok', dame_test.run(csam, format('select public.dame_relay_tick(%s, 1, true)', i1)));
    perform dame_test.expect('one line ticked is not enough', 'not_ready',
      dame_test.run(csam, format('select public.dame_relay_pass(%s, null, %L)', i1, '')));
    perform dame_test.expect('Sam ticks line 2 twice: kept once', '[1, 2]',
      dame_test.val(csam, format('select public.dame_relay_tick(%s, 2, true); select public.dame_relay_tick(%s, 2, true) ->> %L', i1, i1, 'ticks')));
    perform dame_test.expect('Sam cannot jump to HQ-AES: Application cannot be skipped', 'bad_request',
      dame_test.run(csam, format('select public.dame_relay_pass(%s, 3, %L)', i1, '')));
    perform dame_test.expect('Sam passes it to Application', 'Technical review',
      dame_test.val(csam, format('select public.dame_relay_pass(%s, null, %L) ->> %L', i1, 'Please check', 'to')));
    perform dame_test.expect('it waits at Application, nobody has it, checklist empty', 'waiting||[]|{1,2}',
      (select status || '|' || coalesce(picked_by::text, '') || '|' || ticks::text || '|' || path::text from core.relay_items where id = i1));
    perform dame_test.expect('Sam can no longer pick it up', 'not_allowed',
      dame_test.run(csam, format('select public.dame_relay_pick(%s)', i1)));
    perform dame_test.expect('Sam still sees it among what he started', '1',
      dame_test.val(csam, $q$select jsonb_array_length(public.dame_relay_home() -> 'started')$q$));
    perform dame_test.expect('Application sees it waiting in its inbox', '1',
      dame_test.val(cabe, $q$select public.dame_relay_home() ->> 'waiting'$q$));
    perform dame_test.expect('HQ-AES has nothing yet', '0',
      dame_test.val(chal, $q$select public.dame_relay_home() ->> 'waiting'$q$));
    perform dame_test.expect('Abe cannot pass it before he picks it up', 'not_allowed',
      dame_test.run(cabe, format('select public.dame_relay_pass(%s, null, %L)', i1, '')));
    perform dame_test.expect('HQ-AES cannot pick it up', 'not_allowed',
      dame_test.run(chal, format('select public.dame_relay_pick(%s)', i1)));
    perform dame_test.expect('Abe picks it up', 'ok', dame_test.run(cabe, format('select public.dame_relay_pick(%s)', i1)));
    perform dame_test.expect('the item says Abe may pass it on to one stage', '1',
      dame_test.val(cabe, format($q$select jsonb_array_length(public.dame_relay_item(%s) -> 'can' -> 'pass')$q$, i1)));

    -- ------------------------------------------------ 4. something is missing
    perform dame_test.expect('sending back without saying what is missing is refused', 'bad_request',
      dame_test.run(cabe, format('select public.dame_relay_back(%s, %L, %L)', i1, 'missing', '  ')));
    perform dame_test.expect('an unknown way back is refused', 'bad_request',
      dame_test.run(cabe, format('select public.dame_relay_back(%s, %L, %L)', i1, 'skip', 'x x x')));
    perform dame_test.expect('Abe sends it back: the drawing is missing', 'Zz Sam Sales',
      dame_test.val(cabe, format('select public.dame_relay_back(%s, %L, %L) ->> %L', i1, 'missing', 'Send the GA drawing', 'person')));
    perform dame_test.expect('it is back with Sam himself, counted as sent back', 'working|' || sam || '|missing|1|{1}',
      (select status || '|' || picked_by || '|' || last_move || '|' || sent_back || '|' || path::text from core.relay_items where id = i1));
    perform dame_test.expect('the checklist starts again', 'not_ready',
      dame_test.run(csam, format('select public.dame_relay_pass(%s, null, %L)', i1, '')));
    perform dame_test.expect('Sam cannot close it: the answer is not back', 'bad_request',
      dame_test.run(csam, format('select public.dame_relay_close(%s, %L)', i1, '')));
    perform dame_test.expect('Sam cannot go back from the first stage', 'bad_request',
      dame_test.run(csam, format('select public.dame_relay_back(%s, %L, %L)', i1, 'answer', 'nothing')));
    perform dame_test.expect('Sam fixes it and passes it again', 'ok',
      dame_test.run(csam, format('select public.dame_relay_tick(%s, 1, true); select public.dame_relay_tick(%s, 2, true); select public.dame_relay_pass(%s, null, %L)', i1, i1, i1, 'Drawing attached')));

    -- ------------------------------------------------ 5. up the chain and the answer back down
    perform dame_test.expect('Abe picks it up, ticks, passes to HQ-AES', 'ok',
      dame_test.run(cabe, format('select public.dame_relay_pick(%s); select public.dame_relay_tick(%s, 1, true); select public.dame_relay_pass(%s, null, %L)', i1, i1, i1, 'Needs the factory')));
    perform dame_test.expect('Hal picks it up', 'ok', dame_test.run(chal, format('select public.dame_relay_pick(%s)', i1)));
    perform dame_test.expect('Hal may pass to the Product team or straight to the Factory', '[4, 5]',
      dame_test.val(chal, format($q$select jsonb_agg((x ->> 'pos')::int)::text from jsonb_array_elements(public.dame_relay_item(%s) -> 'can' -> 'pass') x$q$, i1)));
    perform dame_test.expect('Hal passes straight to the Factory (Product team skipped)', 'Factory answer',
      dame_test.val(chal, format('select public.dame_relay_pass(%s, 5, %L) ->> %L', i1, '', 'to')));
    perform dame_test.expect('Fay (Factory admin) picks it up', 'ok', dame_test.run(cfay, format('select public.dame_relay_pick(%s)', i1)));
    perform dame_test.expect('an answer needs text', 'bad_request',
      dame_test.run(cfay, format('select public.dame_relay_back(%s, %L, %L)', i1, 'answer', '')));
    perform dame_test.expect('the Factory answers back to HQ-AES, to Hal', 'Zz Hal HQ',
      dame_test.val(cfay, format('select public.dame_relay_back(%s, %L, %L) ->> %L', i1, 'answer', 'Feasible, 6 weeks extra', 'person')));
    perform dame_test.expect('Hal answers back to Application, to Abe', 'Zz Abe Application',
      dame_test.val(chal, format('select public.dame_relay_back(%s, %L, %L) ->> %L', i1, 'answer', 'Factory says feasible', 'person')));
    perform dame_test.expect('Hal can no longer move it, only write a note', 'not_allowed|not_allowed|ok',
      dame_test.run(chal, format('select public.dame_relay_release(%s)', i1)) || '|' || dame_test.run(chal, format('select public.dame_relay_back(%s, %L, %L)', i1, 'answer', 'again'))
      || '|' || dame_test.run(chal, format('select public.dame_relay_note(%s, %L)', i1, 'Factory confirmed by phone')));
    perform dame_test.expect('Abe answers back to Sales, to Sam', 'Zz Sam Sales',
      dame_test.val(cabe, format('select public.dame_relay_back(%s, %L, %L) ->> %L', i1, 'answer', 'Yes, with 6 weeks extra', 'person')));
    perform dame_test.expect('the item says Sam may close it now', 'true',
      dame_test.val(csam, format($q$select public.dame_relay_item(%s) -> 'can' ->> 'close'$q$, i1)));
    perform dame_test.expect('Sam closes it', 'ok', dame_test.run(csam, format('select public.dame_relay_close(%s, %L)', i1, 'Offer revised')));
    perform dame_test.expect('it is closed, nobody holds it, not sent back again', 'closed||1',
      (select status || '|' || coalesce(picked_by::text, '') || '|' || sent_back from core.relay_items where id = i1));
    perform dame_test.expect('a closed item cannot be picked up', 'bad_request',
      dame_test.run(csam, format('select public.dame_relay_pick(%s)', i1)));
    perform dame_test.expect('a closed item cannot be cancelled', 'bad_request',
      dame_test.run(csam, format('select public.dame_relay_cancel(%s, %L)', i1, 'too late')));
    perform dame_test.expect('a closed item still takes a note', 'ok',
      dame_test.run(cabe, format('select public.dame_relay_note(%s, %L)', i1, 'Customer accepted')));
    perform dame_test.expect('the history tells the whole story', 'started,passed,picked,sent_back,passed,picked,passed,picked,passed,picked,answered,answered,note,answered,closed,note',
      (select string_agg(kind, ',' order by id) from core.relay_events where item = i1));
    perform dame_test.expect('Hal sees the whole history', '16',
      dame_test.val(chal, format($q$select jsonb_array_length(public.dame_relay_item(%s) -> 'history')$q$, i1)));
    perform dame_test.expect('every move is in the audit of the space where it happened', '5|2|3|4',
      (select string_agg(n::text, '|' order by s) from (select space as s, count(*) as n from core.audit
         where action like 'relay.%' and space in ('zz-sales', 'zz-app', 'zz-hq', 'zz-fact') group by space) q));
    perform dame_test.expect('the board knows the Application stage sent one back', '1',
      dame_test.val(csam, $q$select s ->> 'sent_back' from jsonb_array_elements(public.dame_relay_board('zz-mto') -> 'stats') s where (s ->> 'pos')::int = 2$q$));
    perform dame_test.expect('the board shows the finished item', 'ZMTO-0001',
      dame_test.val(cfay, $q$select public.dame_relay_board('zz-mto') -> 'done' -> 0 ->> 'ref'$q$));
    perform dame_test.expect('the site cannot reach the history table', 'denied',
      dame_test.run(csam, format('update core.relay_events set text = %L where item = %s', 'x', i1)));
    begin
      update core.relay_events set text = 'changed' where item = i1;
      perform dame_test.expect('the owner cannot change the history either', 'refused', 'changed');
    exception when others then
      perform dame_test.expect('the owner cannot change the history either', 'refused', 'refused');
    end;
    begin
      delete from core.relay_events where item = i1;
      perform dame_test.expect('the owner cannot delete the history either', 'refused', 'deleted');
    exception when others then
      perform dame_test.expect('the owner cannot delete the history either', 'refused', 'refused');
    end;

    -- ------------------------------------------------ 6. taking over, putting back, cancelling
    i2 := (dame_test.val(csam, $q$select public.dame_relay_start('zz-mto', 'FCU with EC motor', '', '', 'normal', null) ->> 'id'$q$))::bigint;
    perform dame_test.expect('Sam passes the second query on', 'ok',
      dame_test.run(csam, format('select public.dame_relay_tick(%s, 1, true); select public.dame_relay_tick(%s, 2, true); select public.dame_relay_pass(%s, null, %L)', i2, i2, i2, '')));
    perform dame_test.expect('Abe picks it up', 'ok', dame_test.run(cabe, format('select public.dame_relay_pick(%s)', i2)));
    perform dame_test.expect('picking it up again is harmless', 'ok', dame_test.run(cabe, format('select public.dame_relay_pick(%s)', i2)));
    perform dame_test.expect('IT takes it over from Abe', 'ok', dame_test.run(ca, format('select public.dame_relay_pick(%s)', i2)));
    perform dame_test.expect('the history says IT acted, and from whom', 'taken_over|true|From Zz Abe Application',
      (select kind || '|' || as_it || '|' || text from core.relay_events where item = i2 order by id desc limit 1));
    perform dame_test.expect('Abe, a member, cannot take it back', 'not_allowed',
      dame_test.run(cabe, format('select public.dame_relay_pick(%s)', i2)));
    perform dame_test.expect('IT puts it back for the team', 'ok', dame_test.run(ca, format('select public.dame_relay_release(%s)', i2)));
    perform dame_test.expect('it waits for the team again', 'waiting', (select status from core.relay_items where id = i2));
    perform dame_test.expect('Abe cannot cancel it: he did not start it', 'not_allowed',
      dame_test.run(cabe, format('select public.dame_relay_cancel(%s, %L)', i2, 'not needed')));
    perform dame_test.expect('cancelling needs a reason', 'bad_request',
      dame_test.run(csia, format('select public.dame_relay_cancel(%s, %L)', i2, '')));
    perform dame_test.expect('the admin of Sales cancels it with a reason', 'ok',
      dame_test.run(csia, format('select public.dame_relay_cancel(%s, %L)', i2, 'Customer chose another unit')));
    perform dame_test.expect('it is cancelled', 'cancelled', (select status from core.relay_items where id = i2));

    -- ------------------------------------------------ 7. changing a flow while items are open
    i3 := (dame_test.val(csam, $q$select public.dame_relay_start('zz-mto', 'Chiller with low noise kit', '', '', 'normal', null) ->> 'id'$q$))::bigint;
    perform dame_test.expect('Sam ticks line 1 of the third query', 'ok', dame_test.run(csam, format('select public.dame_relay_tick(%s, 1, true)', i3)));
    perform dame_test.expect('a stage cannot be removed while items are open', 'bad_request',
      dame_test.run(ca, format('select public.dame_relay_flow_save(%L, %L, %L, %L, %L, %L)', 'zz-mto', 'MTO escalation', 'MTO query', 'ZMTO', '', st - 3)));
    perform dame_test.expect('a stage cannot go to another team while items are open', 'bad_request',
      dame_test.run(ca, format('select public.dame_relay_flow_save(%L, %L, %L, %L, %L, %L)', 'zz-mto', 'MTO escalation', 'MTO query', 'ZMTO', '',
        jsonb_set(st, '{2,space}', '"zz-prod"'))));
    perform dame_test.expect('the number letters cannot change once items exist', 'bad_request',
      dame_test.run(ca, format('select public.dame_relay_flow_save(%L, %L, %L, %L, %L, %L)', 'zz-mto', 'MTO escalation', 'MTO query', 'ZMTX', '', st)));
    perform dame_test.expect('a changed checklist is fine', 'ok',
      dame_test.run(ca, format('select public.dame_relay_flow_save(%L, %L, %L, %L, %L, %L)', 'zz-mto', 'MTO escalation', 'MTO query', 'ZMTO', '',
        jsonb_set(st, '{0,checks}', '["Customer and project named", "Model and quantity given", "Spec clause quoted"]'))));
    perform dame_test.expect('the checklist starts again for the item at that stage', '[]', (select ticks::text from core.relay_items where id = i3));

    -- ------------------------------------------------ 8. a team switched off, a flow switched off
    update core.spaces set active = false where id = 'zz-app';
    perform dame_test.expect('Sam ticks the three lines', 'ok',
      dame_test.run(csam, format('select public.dame_relay_tick(%s, 1, true); select public.dame_relay_tick(%s, 2, true); select public.dame_relay_tick(%s, 3, true)', i3, i3, i3)));
    perform dame_test.expect('nothing is passed to a team that is switched off', 'not_allowed',
      dame_test.run(csam, format('select public.dame_relay_pass(%s, null, %L)', i3, '')));
    perform dame_test.expect('the stage says its team is switched off', 'false',
      dame_test.val(ca, $q$select f -> 'stages' -> 1 ->> 'team_ok' from jsonb_array_elements(public.dame_relay_flows_all()) f where f ->> 'id' = 'zz-mto'$q$));
    update core.spaces set active = true where id = 'zz-app';
    perform dame_test.expect('a member cannot switch a flow off', 'not_allowed',
      dame_test.run(csia, $q$select public.dame_relay_flow_active('zz-mto', false)$q$));
    perform dame_test.expect('IT switches the flow off', 'ok', dame_test.run(ca, $q$select public.dame_relay_flow_active('zz-mto', false)$q$));
    perform dame_test.expect('nothing new starts in a flow that is off', 'not_allowed',
      dame_test.run(csam, $q$select public.dame_relay_start('zz-mto', 'One more', '', '', 'normal', null)$q$));
    perform dame_test.expect('an open item still finishes its way', 'ok',
      dame_test.run(csam, format('select public.dame_relay_pass(%s, null, %L)', i3, '')));
    perform dame_test.expect('IT switches it on again', 'ok', dame_test.run(ca, $q$select public.dame_relay_flow_active('zz-mto', true)$q$));

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
