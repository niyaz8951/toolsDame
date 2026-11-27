-- db/upgrade.sql - brings the live database (the version with Relay) to the
-- final version in db/. It works whether or not the upgrade of the delivery
-- before (shortcuts, tools on the chain) was run: it adds what is missing.
--   1. Shortcuts and tools on the chain, if they are not there yet.
--   2. Need to know: a team sees only the items it holds or has held
--      (new column seen on the items, filled from their history).
--   3. Pull: a stage may have a limit of items at once (new column max_open).
--   4. "I am blocked": a flag on an item (two new columns, two new functions).
-- No row is removed. Existing items keep their history.
-- Serves: contracts 2 (Structure), 3 (Access), 7 (Audit).
-- Must not change: only for a database that has Relay; never for a new
-- database (db/install.sql has it). The next delivery after it ran removes this file.
--
-- How to run: paste the whole file into the SQL editor and press Run. It
-- finishes completely or changes nothing. The security check must show no
-- rows, and the last result (the question of db/check.sql) must say yes.

begin;

do $$
begin
  if pg_catalog.to_regclass('core.relay_flows') is null then
    raise exception 'This database has no Relay yet: it is older than this upgrade expects. Send this message.';
  end if;
  if exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = 'core.relay_items'::regclass and a.attname = 'seen') then
    raise exception 'This upgrade was already run. db/check.sql says whether the database is final.';
  end if;
end $$;

-- 1. Shortcuts and tools on the chain (the delivery before), only if missing.
do $$
begin
  if pg_catalog.to_regclass('core.shortcuts') is null then
    execute $sql$
create table core.shortcuts (
  user_id   uuid not null references core.profiles (id),
  space     text not null,
  tool      text not null,
  added_at  timestamptz not null default pg_catalog.now(),
  primary key (user_id, space, tool),
  foreign key (space, tool) references core.tools (space, id) on delete cascade
);
    $sql$;
    execute 'alter table core.shortcuts enable row level security';
    execute 'alter table core.shortcuts force row level security';
    execute 'revoke all on table core.shortcuts from public, anon, authenticated';
    execute $sql$alter table core.relay_stages add column tools jsonb not null default '[]'::jsonb
      check (pg_catalog.jsonb_typeof(tools) = 'array' and pg_catalog.jsonb_array_length(tools) <= 6)$sql$;
  end if;
end $$;
drop function if exists core.relay_counts_json(text);

-- SHORTCUTS-BEGIN
-- The caller's shortcuts, oldest first. A tool he can no longer open is left out.
create or replace function public.dame_shortcuts_list() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_user();
begin
  return (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'space', t.space, 'space_name', sp.name, 'id', t.id, 'name', t.name,
            'icon', t.icon, 'colour', t.colour) order by s.added_at, t.name), '[]'::jsonb)
            from core.shortcuts s
            join core.tools t on t.space = s.space and t.id = s.tool
            join core.spaces sp on sp.id = t.space
           where s.user_id = v_uid and core.tool_level(v_uid, t.space, t.id) is not null);
end $$;

-- Pins a tool to the caller's hub, or takes the pin away. Only a tool he can open; at most 12.
create or replace function public.dame_shortcut_set(p_space text, p_tool text, p_on boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_user();
begin
  if p_on is null then
    perform core.fail('bad_request', 'Pin or unpin?', 400);
  end if;
  if not p_on then
    delete from core.shortcuts where user_id = v_uid and space = p_space and tool = p_tool;
    return pg_catalog.jsonb_build_object('on', false);
  end if;
  if not core.has_tool(v_uid, p_space, p_tool, 'read') then
    perform core.fail('not_allowed', 'You do not have this tool. Ask its manager.');
  end if;
  if (select count(*) from core.shortcuts s where s.user_id = v_uid) >= 12
     and not exists (select 1 from core.shortcuts s where s.user_id = v_uid and s.space = p_space and s.tool = p_tool) then
    perform core.fail('quota_full', 'You have 12 shortcuts. Take one away first.', 400);
  end if;
  insert into core.shortcuts (user_id, space, tool) values (v_uid, p_space, p_tool) on conflict do nothing;
  return pg_catalog.jsonb_build_object('on', true);
end $$;

-- 2. to 4. New columns.
alter table core.relay_stages add column max_open integer check (max_open between 1 and 500);
alter table core.relay_items add column seen integer[] not null default '{1}'::integer[];
alter table core.relay_items add column blocked_at timestamptz;
alter table core.relay_items add column blocked_by uuid references core.profiles (id);
-- Every stage an item ever reached, from its history.
update core.relay_items i
   set seen = (select pg_catalog.array_agg(x.p order by x.p)
                 from (select 1 as p union select e.to_pos from core.relay_events e
                        where e.item = i.id and e.kind = 'passed' and e.to_pos is not null) x);
alter table core.relay_events drop constraint relay_events_kind_check;
alter table core.relay_events add constraint relay_events_kind_check
  check (kind in ('started', 'picked', 'released', 'taken_over', 'passed',
                  'answered', 'sent_back', 'closed', 'cancelled', 'note',
                  'blocked', 'unblocked'));

-- The Relay functions, as in db/09_relay.sql (word for word).
-- ---------------------------------------------------------------------------
-- 2. Helpers: who is the team, who sees what
-- ---------------------------------------------------------------------------

-- Named in the team of a space: its admin or its member, and the space is on.
create or replace function core.relay_named(p_uid uuid, p_space text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from core.spaces s where s.id = p_space and s.active)
     and exists (select 1 from core.profiles p where p.id = p_uid and p.status = 'active')
     and (core.is_space_admin(p_uid, p_space)
          or exists (select 1 from core.space_members m where m.space = p_space and m.user_id = p_uid));
$$;

-- May act at a stage of this space: its team, or an IT admin (who acts as admin
-- of every space, owner 2026-11-27; the history marks it).
create or replace function core.relay_can_act(p_uid uuid, p_space text) returns boolean
language sql stable set search_path = '' as $$
  select core.relay_named(p_uid, p_space) or core.is_it(p_uid);
$$;

-- Sees that a flow exists and which teams are on it: everyone named in the team
-- of one of its stages, and IT. Which ITEMS he sees is decided per item, below.
create or replace function core.relay_sees(p_uid uuid, p_flow text) returns boolean
language sql stable set search_path = '' as $$
  select core.is_it(p_uid)
      or exists (select 1 from core.relay_stages s where s.flow = p_flow and core.relay_named(p_uid, s.space));
$$;

-- The number people use: MTO-0007.
create or replace function core.relay_ref(p_prefix text, p_no integer) returns text
language sql immutable set search_path = '' as $$
  select p_prefix || '-' || pg_catalog.lpad(p_no::text, 4, '0');
$$;

-- An item the caller may see, or a refusal that does not say whether it exists.
-- p_lock: the row is locked until the end of the call (for every change).
create or replace function core.relay_item_get(p_uid uuid, p_item bigint, p_lock boolean) returns core.relay_items
language plpgsql volatile set search_path = '' as $$
declare
  v core.relay_items;
begin
  if p_lock then
    select * into v from core.relay_items i where i.id = p_item for update;
  else
    select * into v from core.relay_items i where i.id = p_item;
  end if;
  -- Need to know: his team holds it or has held it, or he started it, or he is IT.
  if v.id is null or not (core.is_it(p_uid) or v.created_by = p_uid or v.seen && core.relay_my_pos(p_uid, v.flow)) then
    perform core.fail('not_allowed', 'This item was not found, or it is not for you. Open Relay again.');
  end if;
  return v;
end $$;

-- The stage holding an item now.
create or replace function core.relay_stage_of(p_item core.relay_items) returns core.relay_stages
language sql stable set search_path = '' as $$
  select s.* from core.relay_stages s
   where s.flow = p_item.flow and s.pos = p_item.path[pg_catalog.cardinality(p_item.path)];
$$;

-- The caller must hold this item: it is open, at a stage he may act at, and he picked it up.
create or replace function core.relay_require_holder(p_uid uuid, p_item core.relay_items) returns core.relay_stages
language plpgsql stable set search_path = '' as $$
declare
  v_stage core.relay_stages := core.relay_stage_of(p_item);
begin
  if p_item.status not in ('waiting', 'working') then
    perform core.fail('bad_request', 'This item is finished: nothing can be moved any more.', 400);
  end if;
  if not core.relay_can_act(p_uid, v_stage.space) then
    perform core.fail('not_allowed', 'This item is with another team. Only the team holding it can move it.');
  end if;
  if p_item.status <> 'working' or p_item.picked_by <> p_uid then
    perform core.fail('not_allowed', 'Pick the item up first: only the person working on it can do this.');
  end if;
  return v_stage;
end $$;

-- Writes one line of history and one line of the audit (in the audit of the
-- space where it happened).
create or replace function core.relay_log(p_uid uuid, p_item core.relay_items, p_kind text, p_from integer, p_to integer,
                               p_text text, p_space text) returns void
language plpgsql volatile set search_path = '' as $$
declare
  v_held numeric;
  v_ref  text;
begin
  if p_kind in ('passed', 'answered', 'sent_back', 'closed', 'cancelled') then
    v_held := pg_catalog.round((extract(epoch from (pg_catalog.now() - p_item.stage_since)) / 3600)::numeric, 2);
  end if;
  insert into core.relay_events (item, actor, kind, from_pos, to_pos, held_hours, text, as_it)
  values (p_item.id, p_uid, p_kind, p_from, p_to, v_held, coalesce(p_text, ''),
          core.is_it(p_uid) and not core.relay_named(p_uid, p_space));
  select core.relay_ref(f.prefix, p_item.ref_no) into v_ref from core.relay_flows f where f.id = p_item.flow;
  if p_kind <> 'note' then
    perform core.audit_add(p_uid, 'relay.' || p_kind, v_ref,
      pg_catalog.jsonb_build_object('flow', p_item.flow, 'item', p_item.id, 'from_stage', p_from, 'to_stage', p_to),
      p_space, null);
  end if;
end $$;

-- The stages of a flow in full, for IT (the setup page).
create or replace function core.relay_stages_json(p_flow text) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'pos', s.pos, 'name', s.name, 'space', s.space,
           'space_name', coalesce(sp.name, s.space),
           'team_ok', coalesce(sp.active, false),
           'team_gone', sp.id is null,
           'optional', s.optional, 'hours', s.hours, 'checks', s.checks, 'max_open', s.max_open) order by s.pos), '[]'::jsonb)
    from core.relay_stages s left join core.spaces sp on sp.id = s.space
   where s.flow = p_flow;
$$;

-- The stages where this person is named in the team. An IT admin who is in no
-- team gets an empty list here; what IT sees is decided by core.is_it beside it.
create or replace function core.relay_my_pos(p_uid uuid, p_flow text) returns integer[]
language sql stable set search_path = '' as $$
  select coalesce(pg_catalog.array_agg(s.pos order by s.pos), '{}'::integer[])
    from core.relay_stages s where s.flow = p_flow and core.relay_named(p_uid, s.space);
$$;

-- A stage holds as many items as it may (its limit; no limit = never full).
create or replace function core.relay_full(p_flow text, p_pos integer) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select s.max_open is not null and s.max_open <=
                     (select count(*) from core.relay_items i where i.flow = s.flow and i.status in ('waiting', 'working')
                        and i.path[pg_catalog.cardinality(i.path)] = s.pos)
                     from core.relay_stages s where s.flow = p_flow and s.pos = p_pos), false);
$$;

-- The chain of a flow as one person sees it: every team by name, and whether it
-- is full. The checklist, the target time and the limit only of his own stages.
create or replace function core.relay_chain_json(p_uid uuid, p_flow text) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'pos', s.pos, 'name', s.name, 'space', s.space,
             'space_name', coalesce(sp.name, s.space),
             'team_ok', coalesce(sp.active, false), 'team_gone', sp.id is null,
             'optional', s.optional, 'mine', m.own,
             'full', core.relay_full(s.flow, s.pos))
           || case when m.own or m.it then pg_catalog.jsonb_build_object('hours', s.hours, 'checks', s.checks, 'max_open', s.max_open)
                   else '{}'::jsonb end order by s.pos), '[]'::jsonb)
    from core.relay_stages s
    left join core.spaces sp on sp.id = s.space
    cross join lateral (select core.relay_named(p_uid, s.space) as own, core.is_it(p_uid) as it) m
   where s.flow = p_flow;
$$;

-- The tools hung on the person's own stages of a flow (IT: on every stage).
-- can_open says whether he may open each. A tool that was deleted since is left out.
create or replace function core.relay_tools_json(p_uid uuid, p_flow text) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'pos', s.pos, 'space', t.space, 'id', t.id, 'name', t.name, 'icon', t.icon, 'colour', t.colour,
           'can_open', core.tool_level(p_uid, t.space, t.id) is not null) order by s.pos, x.o), '[]'::jsonb)
    from core.relay_stages s
    cross join lateral pg_catalog.jsonb_array_elements_text(s.tools) with ordinality x (id, o)
    join core.tools t on t.space = s.space and t.id = x.id
   where s.flow = p_flow and (core.relay_named(p_uid, s.space) or core.is_it(p_uid));
$$;

-- How many items the person's own stages hold now, how many are late and how
-- many are blocked (IT: every stage). Other teams' numbers are not given.
create or replace function core.relay_counts_json(p_uid uuid, p_flow text) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('pos', s.pos,
           'open', (select count(*) from core.relay_items i where i.flow = s.flow and i.status in ('waiting', 'working')
                      and i.path[pg_catalog.cardinality(i.path)] = s.pos),
           'late', (select count(*) from core.relay_items i where i.flow = s.flow and i.status in ('waiting', 'working')
                      and i.path[pg_catalog.cardinality(i.path)] = s.pos
                      and pg_catalog.now() > i.stage_since + pg_catalog.make_interval(hours => s.hours)),
           'blocked', (select count(*) from core.relay_items i where i.flow = s.flow and i.status in ('waiting', 'working')
                      and i.path[pg_catalog.cardinality(i.path)] = s.pos and i.blocked_at is not null)) order by s.pos), '[]'::jsonb)
    from core.relay_stages s
   where s.flow = p_flow and (core.relay_named(p_uid, s.space) or core.is_it(p_uid));
$$;

-- Where an item is, as far as this person may know: the stage holding it when
-- that is his own (or he is IT); otherwise the neighbour his team passed it to,
-- however far it has gone since; null when his team has passed it back.
create or replace function core.relay_shown(p_mine integer[], p_all boolean, p_path integer[]) returns integer
language plpgsql immutable set search_path = '' as $$
declare
  n integer := pg_catalog.cardinality(p_path);
  k integer;
begin
  if p_all or p_path[n] = any (p_mine) then
    return p_path[n];
  end if;
  for k in reverse n - 1 .. 1 loop
    if p_path[k] = any (p_mine) then
      return p_path[k + 1];
    end if;
  end loop;
  return null;
end $$;

-- The first hand-over (project, details, needed by) is for the first team and
-- the team it passed the item to. Later teams get only what is written to them.
create or replace function core.relay_front(p_uid uuid, p_mine integer[], p_all boolean, p_item core.relay_items) returns boolean
language sql stable set search_path = '' as $$
  select p_all or 1 = any (p_mine) or p_item.created_by = p_uid
      or exists (select 1 from core.relay_events e
                  where e.item = p_item.id and e.kind = 'passed' and e.from_pos = 1 and e.to_pos = any (p_mine));
$$;

-- An item as a card: what a list or the board shows, cut to what this person may know.
create or replace function core.relay_card_json(p_uid uuid, p_item core.relay_items) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_mine  integer[] := core.relay_my_pos(p_uid, p_item.flow);
  v_all   boolean := core.is_it(p_uid);
  v_cur   integer := p_item.path[pg_catalog.cardinality(p_item.path)];
  v_shown integer := core.relay_shown(v_mine, v_all, p_item.path);
  v_here  boolean := v_all or v_cur = any (v_mine);
  v_open  boolean := p_item.status in ('waiting', 'working');
  v_front boolean := core.relay_front(p_uid, v_mine, v_all, p_item);
  v_flow  core.relay_flows;
  v_stage core.relay_stages;
  v_team  text;
begin
  select * into v_flow from core.relay_flows f where f.id = p_item.flow;
  select * into v_stage from core.relay_stages s where s.flow = p_item.flow and s.pos = v_shown;
  select coalesce(sp.name, v_stage.space) into v_team from (select 1) x left join core.spaces sp on sp.id = v_stage.space;
  return pg_catalog.jsonb_build_object(
    'id', p_item.id,
    'ref', core.relay_ref(v_flow.prefix, p_item.ref_no),
    'flow', v_flow.id, 'flow_name', v_flow.name, 'word', v_flow.item_word,
    'title', p_item.title, 'priority', p_item.priority, 'status', p_item.status,
    -- here: at one of his stages; next: with the team his team passed it to (or beyond); back: his team passed it back
    'view', case when v_here then 'here' when v_shown is not null then 'next' else 'back' end,
    'pos', v_shown, 'stage', v_stage.name, 'space', v_stage.space, 'space_name', v_team,
    'started_at', p_item.created_at, 'closed_at', p_item.closed_at,
    -- the flag is seen by the team holding the item and by the team that passed it to them
    'blocked', v_open and p_item.blocked_at is not null and v_shown = v_cur)
    || case when v_front then pg_catalog.jsonb_build_object('project', p_item.project, 'needed_by', p_item.needed_by,
              'started_by', (select p.name from core.profiles p where p.id = p_item.created_by))
            else '{}'::jsonb end
    || case when v_here then pg_catalog.jsonb_build_object(
              'picked_by', (select p.name from core.profiles p where p.id = p_item.picked_by),
              'mine', coalesce(p_item.picked_by = p_uid, false),
              'last_move', p_item.last_move, 'since', p_item.stage_since,
              'due', p_item.stage_since + pg_catalog.make_interval(hours => v_stage.hours),
              'late', v_open and pg_catalog.now() > p_item.stage_since + pg_catalog.make_interval(hours => v_stage.hours))
            else pg_catalog.jsonb_build_object('mine', false, 'late', false) end
    || case when v_all then pg_catalog.jsonb_build_object('sent_back', p_item.sent_back) else '{}'::jsonb end;
end $$;

-- The order of a list: urgent first, then the oldest at its stage.
create or replace function core.relay_rank(p_item core.relay_items) returns text
language sql stable set search_path = '' as $$
  select case when p_item.priority = 'urgent' then '0' else '1' end
      || pg_catalog.to_char(p_item.stage_since, 'YYYYMMDDHH24MISSUS');
$$;

-- Who last passed this item on from a stage: the person who will get the answer back.
create or replace function core.relay_worker_at(p_item bigint, p_pos integer) returns uuid
language sql stable set search_path = '' as $$
  select e.actor from core.relay_events e
   where e.item = p_item and e.from_pos = p_pos and e.kind = 'passed'
   order by e.id desc limit 1;
$$;

-- Text typed by a person, required: at least p_min characters after cleaning.
create or replace function core.relay_text(p_text text, p_min integer, p_max integer, p_what text) returns text
language plpgsql volatile set search_path = '' as $$
declare
  v text := core.clean_text(p_text, p_max);
begin
  if pg_catalog.length(v) < p_min then
    perform core.fail('bad_request', p_what, 400);
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- 3. For everyone: the inbox, a flow's board, one item
-- ---------------------------------------------------------------------------

-- The caller's Relay: the flows he is on, what waits for his teams, what he works
-- on, what he started that is still open, and what is blocked in teams he leads.
create or replace function public.dame_relay_home() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := core.require_user();
  v_it     boolean := core.is_it(v_uid);
  v_flows  jsonb;
  v_inbox  jsonb;
  v_mine   jsonb;
  v_flags  jsonb;
begin
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id', f.id, 'name', f.name, 'word', f.item_word, 'prefix', f.prefix,
           'description', f.description, 'active', f.active,
           'stages', core.relay_chain_json(v_uid, f.id),
           'counts', core.relay_counts_json(v_uid, f.id),
           'tools', core.relay_tools_json(v_uid, f.id),
           'can_start', f.active and core.relay_can_act(v_uid, s1.space),
           -- the open items he may see: those his teams hold or have held
           'open', (select count(*) from core.relay_items i where i.flow = f.id and i.status in ('waiting', 'working')
                      and (v_it or i.created_by = v_uid or i.seen && core.relay_my_pos(v_uid, f.id))))
           order by f.name), '[]'::jsonb)
    into v_flows
    from core.relay_flows f
    join core.relay_stages s1 on s1.flow = f.id and s1.pos = 1
   where (f.active or v_it) and core.relay_sees(v_uid, f.id);

  -- At a stage of one of his teams and nobody has it, or he has it.
  select coalesce(pg_catalog.jsonb_agg(core.relay_card_json(v_uid, q.it) order by core.relay_rank(q.it)), '[]'::jsonb)
    into v_inbox
    from (select x as it from core.relay_items x
            join core.relay_stages s on s.flow = x.flow and s.pos = x.path[pg_catalog.cardinality(x.path)]
           where x.status in ('waiting', 'working')
             and (x.picked_by = v_uid or (x.status = 'waiting' and core.relay_named(v_uid, s.space)))
           limit 300) q;

  -- Started by him, still open, not in his inbox.
  select coalesce(pg_catalog.jsonb_agg(core.relay_card_json(v_uid, q.it) order by (q.it).created_at desc), '[]'::jsonb)
    into v_mine
    from (select x as it from core.relay_items x
            join core.relay_stages s on s.flow = x.flow and s.pos = x.path[pg_catalog.cardinality(x.path)]
           where x.created_by = v_uid and x.status in ('waiting', 'working')
             and not (coalesce(x.picked_by = v_uid, false) or (x.status = 'waiting' and core.relay_named(v_uid, s.space)))
           order by x.created_at desc limit 100) q;

  -- Blocked at a stage of a space he is admin of (IT: of every space): someone asked for help.
  select coalesce(pg_catalog.jsonb_agg(core.relay_card_json(v_uid, q.it) order by (q.it).blocked_at), '[]'::jsonb)
    into v_flags
    from (select x as it from core.relay_items x
            join core.relay_stages s on s.flow = x.flow and s.pos = x.path[pg_catalog.cardinality(x.path)]
           where x.status in ('waiting', 'working') and x.blocked_at is not null
             and core.can_admin_space(v_uid, s.space) and coalesce(x.picked_by <> v_uid, true)
           order by x.blocked_at limit 100) q;

  return pg_catalog.jsonb_build_object('is_it', v_it, 'flows', v_flows, 'inbox', v_inbox, 'started', v_mine, 'flags', v_flags,
    'waiting', (select count(*) from pg_catalog.jsonb_array_elements(v_inbox) c where c ->> 'status' = 'waiting'),
    'working', (select count(*) from pg_catalog.jsonb_array_elements(v_inbox) c where (c ->> 'mine')::boolean));
end $$;

-- One flow as a board: its chain, the numbers of the caller's own stages, the
-- items his teams hold or have held, and the latest of those that are finished.
create or replace function public.dame_relay_board(p_flow text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := core.require_user();
  v_flow  core.relay_flows;
  v_all   boolean;
  v_mine  integer[];
  v_stats jsonb;
begin
  select * into v_flow from core.relay_flows f where f.id = p_flow;
  if v_flow.id is null or not core.relay_sees(v_uid, v_flow.id) or not (v_flow.active or core.is_it(v_uid)) then
    perform core.fail('not_allowed', 'This flow was not found, or none of your teams is on it.');
  end if;
  v_all := core.is_it(v_uid);
  v_mine := core.relay_my_pos(v_uid, v_flow.id);

  -- Per stage of his own (IT: every stage): open now, late now, blocked now, the usual
  -- time held (last 90 days), how often it sent an item back. Other teams: no numbers.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'pos', s.pos,
           'open', (select count(*) from core.relay_items i where i.flow = s.flow and i.status in ('waiting', 'working')
                      and i.path[pg_catalog.cardinality(i.path)] = s.pos),
           'late', (select count(*) from core.relay_items i where i.flow = s.flow and i.status in ('waiting', 'working')
                      and i.path[pg_catalog.cardinality(i.path)] = s.pos
                      and pg_catalog.now() > i.stage_since + pg_catalog.make_interval(hours => s.hours)),
           'blocked', (select count(*) from core.relay_items i where i.flow = s.flow and i.status in ('waiting', 'working')
                      and i.path[pg_catalog.cardinality(i.path)] = s.pos and i.blocked_at is not null),
           'avg_hours', (select pg_catalog.round(avg(e.held_hours), 1) from core.relay_events e
                           join core.relay_items i on i.id = e.item
                          where i.flow = s.flow and e.from_pos = s.pos and e.held_hours is not null
                            and e.kind in ('passed', 'answered', 'sent_back', 'closed')
                            and e.at > pg_catalog.now() - interval '90 days'),
           'sent_back', (select count(*) from core.relay_events e join core.relay_items i on i.id = e.item
                          where i.flow = s.flow and e.from_pos = s.pos and e.kind = 'sent_back'
                            and e.at > pg_catalog.now() - interval '90 days')) order by s.pos), '[]'::jsonb)
    into v_stats
    from core.relay_stages s where s.flow = v_flow.id and (v_all or s.pos = any (v_mine));

  return pg_catalog.jsonb_build_object(
    'flow', pg_catalog.jsonb_build_object('id', v_flow.id, 'name', v_flow.name, 'word', v_flow.item_word,
              'prefix', v_flow.prefix, 'description', v_flow.description, 'active', v_flow.active,
              'can_start', v_flow.active and core.relay_can_act(v_uid, (select s.space from core.relay_stages s where s.flow = v_flow.id and s.pos = 1))),
    'stages', core.relay_chain_json(v_uid, v_flow.id),
    'tools', core.relay_tools_json(v_uid, v_flow.id),
    'stats', v_stats,
    'open', (select coalesce(pg_catalog.jsonb_agg(core.relay_card_json(v_uid, q.it) order by core.relay_rank(q.it)), '[]'::jsonb)
               from (select x as it from core.relay_items x where x.flow = v_flow.id and x.status in ('waiting', 'working')
                        and (v_all or x.created_by = v_uid or x.seen && v_mine) limit 500) q),
    'done', (select coalesce(pg_catalog.jsonb_agg(core.relay_card_json(v_uid, q.it) order by (q.it).closed_at desc), '[]'::jsonb)
               from (select x as it from core.relay_items x where x.flow = v_flow.id and x.status in ('closed', 'cancelled')
                        and (v_all or x.created_by = v_uid or x.seen && v_mine)
                      order by x.closed_at desc limit 20) q))
    -- From start to close is the first team's number (and IT's): the others do not see the whole road.
    || case when v_all or 1 = any (v_mine) then pg_catalog.jsonb_build_object(
         'closed_30', (select count(*) from core.relay_items x where x.flow = v_flow.id and x.status = 'closed'
                         and x.closed_at > pg_catalog.now() - interval '30 days'),
         'avg_days', (select pg_catalog.round((avg(extract(epoch from (x.closed_at - x.created_at))) / 86400)::numeric, 1)
                        from core.relay_items x where x.flow = v_flow.id and x.status = 'closed'
                         and x.closed_at > pg_catalog.now() - interval '90 days'))
       else '{}'::jsonb end;
end $$;

-- One item, cut to what the caller may know: the card; the first hand-over if it was
-- to or from his team; his own stage's checklist; the lines of history his team wrote
-- or was written to; and what he may do now. IT sees all, and each look is audited.
create or replace function public.dame_relay_item(p_item bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := core.require_user();
  v        core.relay_items := core.relay_item_get(v_uid, p_item, false);
  v_stage  core.relay_stages := core.relay_stage_of(v);
  v_all    boolean := core.is_it(v_uid);
  v_mine   integer[] := core.relay_my_pos(v_uid, v.flow);
  v_s1     text := (select s.space from core.relay_stages s where s.flow = v.flow and s.pos = 1);
  v_last   integer := (select max(s.pos) from core.relay_stages s where s.flow = v.flow);
  v_open   boolean := v.status in ('waiting', 'working');
  v_act    boolean := v_open and core.relay_can_act(v_uid, v_stage.space);
  v_holds  boolean := v_open and v.status = 'working' and v.picked_by = v_uid and core.relay_can_act(v_uid, v_stage.space);
  v_cur    integer := v.path[pg_catalog.cardinality(v.path)];
  v_here   boolean := v_all or v_cur = any (v_mine);
  v_back   integer := case when pg_catalog.cardinality(v.path) > 1 then v.path[pg_catalog.cardinality(v.path) - 1] end;
  v_pass   jsonb := '[]'::jsonb;
  v_ref    text;
  r        record;
begin
  -- An IT admin looking at an item none of his teams held: written to the audit, once a day per item.
  if v_all and not (v.seen && v_mine) then
    select core.relay_ref(f.prefix, v.ref_no) into v_ref from core.relay_flows f where f.id = v.flow;
    if not exists (select 1 from core.audit a where a.actor = v_uid and a.action = 'relay.looked' and a.target = v_ref
                    and a.at > pg_catalog.now() - interval '1 day') then
      perform core.audit_add(v_uid, 'relay.looked', v_ref, pg_catalog.jsonb_build_object('flow', v.flow, 'item', v.id));
    end if;
  end if;

  -- Where it may be passed: the next stage, and past it while the stages between may be skipped.
  if v_holds then
    for r in select s.pos, s.name, s.optional, coalesce(sp.active, false) as ok, coalesce(sp.name, s.space) as team
               from core.relay_stages s left join core.spaces sp on sp.id = s.space
              where s.flow = v.flow and s.pos > v_cur order by s.pos loop
      v_pass := v_pass || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                  'pos', r.pos, 'name', r.name, 'team', r.team, 'team_ok', r.ok, 'full', core.relay_full(v.flow, r.pos)));
      exit when not r.optional;
    end loop;
  end if;

  return core.relay_card_json(v_uid, v)
    || pg_catalog.jsonb_build_object(
      'stages', core.relay_chain_json(v_uid, v.flow),
      'tools', core.relay_tools_json(v_uid, v.flow),
      'history', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                    'at', e.at, 'kind', e.kind, 'who', coalesce(p.name, 'Unknown'), 'as_it', e.as_it,
                    'from', sf.name, 'to', st.name, 'text', e.text, 'held_hours', e.held_hours) order by e.id), '[]'::jsonb)
                    from core.relay_events e
                    left join core.profiles p on p.id = e.actor
                    left join core.relay_stages sf on sf.flow = v.flow and sf.pos = e.from_pos
                    left join core.relay_stages st on st.flow = v.flow and st.pos = e.to_pos
                   where e.item = v.id
                     -- a hand-over: its two teams. A cancellation: everyone on the item. Anything else: the team that did it.
                     and (v_all
                          or e.kind = 'cancelled'
                          or (e.kind in ('passed', 'answered', 'sent_back') and (e.from_pos = any (v_mine) or e.to_pos = any (v_mine)))
                          or (e.kind not in ('passed', 'answered', 'sent_back') and coalesce(e.from_pos, e.to_pos) = any (v_mine)))),
      'can', pg_catalog.jsonb_build_object(
        'pick', v_act and v.status = 'waiting',
        'take_over', v_act and v.status = 'working' and v.picked_by <> v_uid and core.can_admin_space(v_uid, v_stage.space),
        'release', v_holds,
        'tick', v_holds,
        'pass', v_pass,
        'back', v_holds and v_back is not null,
        'close', v_holds and (v_cur = v_last or (pg_catalog.cardinality(v.path) = 1 and v.last_move = 'answer')),
        'cancel', v_open and (v.created_by = v_uid or v_all or core.can_admin_space(v_uid, v_s1)),
        'block', v_holds and v.blocked_at is null,
        'unblock', v_open and v.blocked_at is not null and (v_holds or (v_act and core.can_admin_space(v_uid, v_stage.space))),
        'note', true))
    || case when core.relay_front(v_uid, v_mine, v_all, v) then pg_catalog.jsonb_build_object('details', v.details) else '{}'::jsonb end
    || case when v_here then pg_catalog.jsonb_build_object(
         'checks', v_stage.checks, 'ticks', v.ticks,
         'back_to', (select pg_catalog.jsonb_build_object('pos', s.pos, 'name', s.name, 'space_name', coalesce(sp.name, s.space),
                       'person', (select p.name from core.profiles p where p.id = core.relay_worker_at(v.id, s.pos)))
                       from core.relay_stages s left join core.spaces sp on sp.id = s.space
                      where s.flow = v.flow and s.pos = v_back))
       else '{}'::jsonb end
    || case when v_all then pg_catalog.jsonb_build_object('path', pg_catalog.to_jsonb(v.path)) else '{}'::jsonb end;
end $$;

-- ---------------------------------------------------------------------------
-- 4. For the team holding an item: start, pick up, tick, pass, answer, send back, close
-- ---------------------------------------------------------------------------

-- Starts an item at the first stage. Only its team (or IT) may; the starter has it at once.
create or replace function public.dame_relay_start(p_flow text, p_title text, p_project text, p_details text,
                                        p_priority text, p_needed_by date) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := core.require_user();
  v_flow   core.relay_flows;
  v_s1     core.relay_stages;
  v_no     integer;
  v        core.relay_items;
begin
  select * into v_flow from core.relay_flows f where f.id = p_flow for update;
  if v_flow.id is null or not core.relay_sees(v_uid, v_flow.id) then
    perform core.fail('not_allowed', 'This flow was not found, or none of your teams is on it.');
  end if;
  if not v_flow.active then
    perform core.fail('not_allowed', 'This flow is switched off: nothing new can start. Ask IT.');
  end if;
  select * into v_s1 from core.relay_stages s where s.flow = v_flow.id and s.pos = 1;
  if not core.relay_can_act(v_uid, v_s1.space) then
    perform core.fail('not_allowed', 'Only the team of the first stage (' || v_s1.name || ') starts a new ' || v_flow.item_word || '.');
  end if;
  if coalesce(p_priority, 'normal') not in ('normal', 'urgent') then
    perform core.fail('bad_request', 'Priority is normal or urgent.', 400);
  end if;
  if p_needed_by is not null and (p_needed_by < current_date or p_needed_by > current_date + 1100) then
    perform core.fail('bad_request', 'The "needed by" date must be today or later, within 3 years.', 400);
  end if;
  if core.relay_full(v_flow.id, 1) then
    perform core.fail('stage_full', '"' || v_s1.name || '" holds as many as it may at once (' || v_s1.max_open || '). Pass one on first.', 400);
  end if;
  if (select count(*) from core.relay_items i where i.flow = v_flow.id and i.status in ('waiting', 'working')) >= 5000 then
    perform core.fail('quota_full', 'This flow has 5,000 open items. Close some first, or ask IT.');
  end if;

  update core.relay_flows set next_no = next_no + 1 where id = v_flow.id returning next_no - 1 into v_no;
  insert into core.relay_items (flow, ref_no, title, project, details, priority, needed_by, path, status, picked_by, created_by)
  values (v_flow.id, v_no,
          core.relay_text(core.clean_line(p_title, 120), 3, 120, 'Give it a title of at least 3 characters.'),
          core.clean_line(p_project, 120), core.clean_text(p_details, 4000),
          coalesce(p_priority, 'normal'), p_needed_by, array[1], 'working', v_uid, v_uid)
  returning * into v;
  perform core.relay_log(v_uid, v, 'started', null, 1, '', v_s1.space);
  return pg_catalog.jsonb_build_object('id', v.id, 'ref', core.relay_ref(v_flow.prefix, v_no));
end $$;

-- Picks up an item that waits at a team of the caller. An admin of that team's
-- space (or IT) may also take over an item someone else has.
create or replace function public.dame_relay_pick(p_item bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := core.require_user();
  v        core.relay_items := core.relay_item_get(v_uid, p_item, true);
  v_stage  core.relay_stages := core.relay_stage_of(v);
  v_before text;
begin
  if v.status not in ('waiting', 'working') then
    perform core.fail('bad_request', 'This item is finished: nothing can be moved any more.', 400);
  end if;
  if not core.relay_can_act(v_uid, v_stage.space) then
    perform core.fail('not_allowed', 'This item is with another team. Only the team holding it can pick it up.');
  end if;
  if v.status = 'working' then
    if v.picked_by = v_uid then
      return pg_catalog.jsonb_build_object('id', v.id);
    end if;
    if not core.can_admin_space(v_uid, v_stage.space) then
      perform core.fail('not_allowed', (select p.name from core.profiles p where p.id = v.picked_by)
        || ' is working on it. Ask him, or an admin of the team, to hand it to you.');
    end if;
    select p.name into v_before from core.profiles p where p.id = v.picked_by;
    update core.relay_items set picked_by = v_uid where id = v.id returning * into v;
    perform core.relay_log(v_uid, v, 'taken_over', v_stage.pos, null, 'From ' || coalesce(v_before, 'someone'), v_stage.space);
  else
    update core.relay_items set status = 'working', picked_by = v_uid where id = v.id returning * into v;
    perform core.relay_log(v_uid, v, 'picked', v_stage.pos, null, '', v_stage.space);
  end if;
  return pg_catalog.jsonb_build_object('id', v.id);
end $$;

-- Puts an item back for the rest of the team.
create or replace function public.dame_relay_release(p_item bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := core.require_user();
  v        core.relay_items := core.relay_item_get(v_uid, p_item, true);
  v_stage  core.relay_stages := core.relay_require_holder(v_uid, v);
begin
  update core.relay_items set status = 'waiting', picked_by = null where id = v.id returning * into v;
  perform core.relay_log(v_uid, v, 'released', v_stage.pos, null, '', v_stage.space);
  return pg_catalog.jsonb_build_object('id', v.id);
end $$;

-- Ticks one line of the stage's checklist, or takes the tick away.
create or replace function public.dame_relay_tick(p_item bigint, p_line integer, p_done boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := core.require_user();
  v        core.relay_items := core.relay_item_get(v_uid, p_item, true);
  v_stage  core.relay_stages := core.relay_require_holder(v_uid, v);
  v_ticks  jsonb;
begin
  if p_line is null or p_line < 1 or p_line > pg_catalog.jsonb_array_length(v_stage.checks) or p_done is null then
    perform core.fail('bad_request', 'This line is not on the checklist. Reload the page.', 400);
  end if;
  select coalesce(pg_catalog.jsonb_agg(x order by x), '[]'::jsonb) into v_ticks
    from (select distinct t::integer as x from pg_catalog.jsonb_array_elements_text(v.ticks) t
           where t::integer <> p_line and t::integer between 1 and pg_catalog.jsonb_array_length(v_stage.checks)
          union select p_line where p_done) d;
  update core.relay_items set ticks = v_ticks where id = v.id;
  return pg_catalog.jsonb_build_object('ticks', v_ticks);
end $$;

-- Passes the item on: to the next stage, or past stages that may be skipped.
-- The checklist of the stage must be done. p_to null = the next stage.
create or replace function public.dame_relay_pass(p_item bigint, p_to integer, p_note text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := core.require_user();
  v        core.relay_items := core.relay_item_get(v_uid, p_item, true);
  v_stage  core.relay_stages := core.relay_require_holder(v_uid, v);
  v_to     core.relay_stages;
  v_need   integer := pg_catalog.jsonb_array_length(v_stage.checks);
  v_done   integer;
  v_note   text := core.clean_text(p_note, 2000);
begin
  select count(distinct t::integer) into v_done from pg_catalog.jsonb_array_elements_text(v.ticks) t
   where t::integer between 1 and v_need;
  if v_done < v_need then
    perform core.fail('not_ready', 'Tick every line of the checklist first: ' || v_done || ' of ' || v_need || ' are done.', 400);
  end if;
  select * into v_to from core.relay_stages s where s.flow = v.flow and s.pos = coalesce(p_to, v_stage.pos + 1);
  if v_to.pos is null then
    perform core.fail('bad_request', 'This is the last stage: close the item instead.', 400);
  end if;
  if v_to.pos <= v_stage.pos then
    perform core.fail('bad_request', 'An item is passed on to a later stage. To go back, answer it or send it back.', 400);
  end if;
  if exists (select 1 from core.relay_stages s where s.flow = v.flow and s.pos > v_stage.pos and s.pos < v_to.pos and not s.optional) then
    perform core.fail('bad_request', 'A stage on the way cannot be skipped. Pass it to the next stage.', 400);
  end if;
  if not exists (select 1 from core.spaces sp where sp.id = v_to.space and sp.active) then
    perform core.fail('not_allowed', 'The team of "' || v_to.name || '" is switched off or deleted. Ask IT to fix the flow.');
  end if;
  -- Pull, not push: a team that holds its limit takes nothing more until it passes one on.
  if core.relay_full(v.flow, v_to.pos) then
    perform core.fail('stage_full', '"' || v_to.name || '" is full: it holds as many as it may at once. It frees a place when it passes one on.', 400);
  end if;
  -- The first team's hand-over is the item's own details. Every later team must write its own:
  -- the next team sees only the title and this message.
  if v_stage.pos > 1 and pg_catalog.length(v_note) < 3 then
    perform core.fail('bad_request', 'Write what the next team needs: they see only the title and your message.', 400);
  end if;
  update core.relay_items
     set path = pg_catalog.array_append(path, v_to.pos), status = 'waiting', picked_by = null, ticks = '[]'::jsonb,
         last_move = 'pass', stage_since = pg_catalog.now(), blocked_at = null, blocked_by = null,
         seen = case when v_to.pos = any (seen) then seen else pg_catalog.array_append(seen, v_to.pos) end
   where id = v.id;
  perform core.relay_log(v_uid, v, 'passed', v_stage.pos, v_to.pos, v_note, v_stage.space);
  return pg_catalog.jsonb_build_object('id', v.id, 'to', v_to.name);
end $$;

-- Goes back to the team that passed it on, and to the person there who did:
-- p_kind 'answer' = here is the answer; 'missing' = something is missing. A note is required.
create or replace function public.dame_relay_back(p_item bigint, p_kind text, p_note text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := core.require_user();
  v        core.relay_items := core.relay_item_get(v_uid, p_item, true);
  v_stage  core.relay_stages := core.relay_require_holder(v_uid, v);
  v_n      integer := pg_catalog.cardinality(v.path);
  v_to     core.relay_stages;
  v_who    uuid;
  v_note   text;
begin
  if p_kind is null or p_kind not in ('answer', 'missing') then
    perform core.fail('bad_request', 'Choose: an answer, or something is missing.', 400);
  end if;
  if v_n < 2 then
    perform core.fail('bad_request', 'This item started here: there is no team before it to go back to.', 400);
  end if;
  v_note := core.relay_text(p_note, 3,  2000, case when p_kind = 'answer' then 'Write the answer.' else 'Write what is missing.' end);
  select * into v_to from core.relay_stages s where s.flow = v.flow and s.pos = v.path[v_n - 1];
  v_who := core.relay_worker_at(v.id, v_to.pos);
  if v_who is not null and not core.relay_can_act(v_who, v_to.space) then
    v_who := null;  -- he left the team: the item waits for the team
  end if;
  update core.relay_items
     set path = v.path[1:v_n - 1], status = case when v_who is null then 'waiting' else 'working' end,
         picked_by = v_who, ticks = '[]'::jsonb, last_move = p_kind, stage_since = pg_catalog.now(),
         blocked_at = null, blocked_by = null,
         sent_back = sent_back + case when p_kind = 'missing' then 1 else 0 end
   where id = v.id;
  perform core.relay_log(v_uid, v, case when p_kind = 'answer' then 'answered' else 'sent_back' end,
                         v_stage.pos, v_to.pos, v_note, v_stage.space);
  return pg_catalog.jsonb_build_object('id', v.id, 'to', v_to.name,
    'person', (select p.name from core.profiles p where p.id = v_who));
end $$;

-- Closes the item: at the last stage, or at the first when the answer has come back to it.
create or replace function public.dame_relay_close(p_item bigint, p_note text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := core.require_user();
  v        core.relay_items := core.relay_item_get(v_uid, p_item, true);
  v_stage  core.relay_stages := core.relay_require_holder(v_uid, v);
begin
  if not (v_stage.pos = (select max(s.pos) from core.relay_stages s where s.flow = v.flow)
          or (pg_catalog.cardinality(v.path) = 1 and v.last_move = 'answer')) then
    perform core.fail('bad_request', 'An item is closed at the last stage, or by the first team once the answer is back. Pass it on instead.', 400);
  end if;
  update core.relay_items
     set status = 'closed', picked_by = null, closed_at = pg_catalog.now(), closed_by = v_uid, blocked_at = null, blocked_by = null
   where id = v.id;
  perform core.relay_log(v_uid, v, 'closed', v_stage.pos, null, core.clean_text(p_note, 2000), v_stage.space);
  return pg_catalog.jsonb_build_object('id', v.id);
end $$;

-- Cancels an open item: who started it, an admin of the first team, or IT. A reason is required.
create or replace function public.dame_relay_cancel(p_item bigint, p_reason text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := core.require_user();
  v        core.relay_items := core.relay_item_get(v_uid, p_item, true);
  v_stage  core.relay_stages := core.relay_stage_of(v);
  v_reason text;
begin
  if v.status not in ('waiting', 'working') then
    perform core.fail('bad_request', 'This item is finished already.', 400);
  end if;
  if not (v.created_by = v_uid or core.is_it(v_uid)
          or core.can_admin_space(v_uid, (select s.space from core.relay_stages s where s.flow = v.flow and s.pos = 1))) then
    perform core.fail('not_allowed', 'Only who started it, an admin of the first team, or IT can cancel it.');
  end if;
  v_reason := core.relay_text(p_reason, 3, 2000, 'Write why it is cancelled.');
  update core.relay_items
     set status = 'cancelled', picked_by = null, closed_at = pg_catalog.now(), closed_by = v_uid, blocked_at = null, blocked_by = null
   where id = v.id;
  perform core.relay_log(v_uid, v, 'cancelled', v_stage.pos, null, v_reason, v_stage.space);
  return pg_catalog.jsonb_build_object('id', v.id);
end $$;

-- Adds a note to the history: anyone who sees the item. A note is for the writer's
-- own team only: it is filed under his team's stage, not under the stage holding the item.
create or replace function public.dame_relay_note(p_item bigint, p_text text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := core.require_user();
  v        core.relay_items := core.relay_item_get(v_uid, p_item, true);
  v_cur    integer := v.path[pg_catalog.cardinality(v.path)];
  v_mine   integer[] := core.relay_my_pos(v_uid, v.flow);
  v_pos    integer;
begin
  if (select count(*) from core.relay_events e where e.item = v.id) >= 1000 then
    perform core.fail('quota_full', 'This item has 1,000 lines of history. Start a new one.');
  end if;
  -- His team's stage: the one holding the item if that is his, else the latest of his that held it.
  v_pos := case when v_cur = any (v_mine) then v_cur
                else coalesce((select max(x) from pg_catalog.unnest(v.seen) x where x = any (v_mine)),
                              case when core.is_it(v_uid) then v_cur else 1 end) end;
  perform core.relay_log(v_uid, v, 'note', v_pos, null,
    core.relay_text(p_text, 1, 2000, 'Write the note first.'),
    (select s.space from core.relay_stages s where s.flow = v.flow and s.pos = v_pos));
  return pg_catalog.jsonb_build_object('id', v.id);
end $$;

-- "I am blocked": the person holding the item asks for help. The flag shows to his team, to
-- the admins of his team's space, and to the team that passed the item to him. It says why.
create or replace function public.dame_relay_block(p_item bigint, p_reason text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := core.require_user();
  v        core.relay_items := core.relay_item_get(v_uid, p_item, true);
  v_stage  core.relay_stages := core.relay_require_holder(v_uid, v);
  v_reason text;
begin
  if v.blocked_at is not null then
    perform core.fail('bad_request', 'The flag is raised already.', 400);
  end if;
  v_reason := core.relay_text(p_reason, 3, 2000, 'Write what blocks you, so that help can come.');
  update core.relay_items set blocked_at = pg_catalog.now(), blocked_by = v_uid where id = v.id;
  perform core.relay_log(v_uid, v, 'blocked', v_stage.pos, null, v_reason, v_stage.space);
  return pg_catalog.jsonb_build_object('id', v.id);
end $$;

-- Clears the flag: the person holding the item, or an admin of his team's space.
create or replace function public.dame_relay_unblock(p_item bigint, p_note text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := core.require_user();
  v        core.relay_items := core.relay_item_get(v_uid, p_item, true);
  v_stage  core.relay_stages := core.relay_stage_of(v);
begin
  if v.status not in ('waiting', 'working') or v.blocked_at is null then
    perform core.fail('bad_request', 'No flag is raised on this item.', 400);
  end if;
  if not (core.relay_can_act(v_uid, v_stage.space)
          and (coalesce(v.picked_by = v_uid, false) or core.can_admin_space(v_uid, v_stage.space))) then
    perform core.fail('not_allowed', 'Only the person holding the item, or an admin of his team, clears the flag.');
  end if;
  update core.relay_items set blocked_at = null, blocked_by = null where id = v.id;
  perform core.relay_log(v_uid, v, 'unblocked', v_stage.pos, null, core.clean_text(p_note, 2000), v_stage.space);
  return pg_catalog.jsonb_build_object('id', v.id);
end $$;

-- ---------------------------------------------------------------------------
-- 5. For IT: set up the flows
-- ---------------------------------------------------------------------------

-- Every flow, also the switched-off ones, with its stages and what is open.
create or replace function public.dame_relay_flows_all() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_it();
begin
  return (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', f.id, 'name', f.name, 'word', f.item_word, 'prefix', f.prefix,
            'description', f.description, 'active', f.active,
            'stages', core.relay_stages_json(f.id),
            'tools', core.relay_tools_json(v_uid, f.id),
            'counts', core.relay_counts_json(v_uid, f.id),
            'open', (select count(*) from core.relay_items i where i.flow = f.id and i.status in ('waiting', 'working')),
            'items', (select count(*) from core.relay_items i where i.flow = f.id),
            'created_at', f.created_at) order by f.name), '[]'::jsonb)
            from core.relay_flows f);
end $$;

-- Makes a flow, or changes one. p_stages: [{ "space": "sales", "name": "Raise the query",
-- "optional": false, "hours": 8, "checks": ["Customer and project named", ...] }, ...], 2 to 12.
-- While items are open, its stages cannot be added, removed, moved or given to another team:
-- names, checklists, hours and "may be skipped" can still change.
create or replace function public.dame_relay_flow_save(p_flow text, p_name text, p_word text, p_prefix text,
                                            p_description text, p_stages jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := core.require_it();
  v_old    core.relay_flows;
  v_name   text := core.clean_line(p_name, 80);
  v_word   text := core.clean_line(p_word, 30);
  v_prefix text := pg_catalog.upper(core.clean_line(p_prefix, 6));
  v_n      integer;
  v_open   integer := 0;
  v_clean  jsonb := '[]'::jsonb;
  v_checks jsonb;
  st       jsonb;
  c        jsonb;
  i        integer := 0;
  v_hours  integer;
  v_sname  text;
  v_space  text;
  v_line   text;
  v_tools  jsonb;
  v_max    integer;
begin
  if not core.id_ok(p_flow) then
    perform core.fail('bad_request', 'The id must be 3 to 30 lower-case letters, digits and single dashes, like mto-query.', 400);
  end if;
  if pg_catalog.length(v_name) < 1 then
    perform core.fail('bad_request', 'Give the flow a name.', 400);
  end if;
  if v_word !~ '^[A-Za-z][A-Za-z -]{1,29}$' then
    perform core.fail('bad_request', 'What one item is called: 2 to 30 letters, for example "MTO query".', 400);
  end if;
  if v_prefix !~ '^[A-Z][A-Z0-9]{1,5}$' then
    perform core.fail('bad_request', 'The number letters: 2 to 6 capital letters or digits, starting with a letter, for example MTO.', 400);
  end if;
  if p_stages is null or pg_catalog.jsonb_typeof(p_stages) <> 'array' then
    perform core.fail('bad_request', 'The stages are missing. Reload the page.', 400);
  end if;
  v_n := pg_catalog.jsonb_array_length(p_stages);
  if v_n < 2 or v_n > 12 then
    perform core.fail('bad_request', 'A flow has 2 to 12 stages.', 400);
  end if;

  -- Each stage, checked and cleaned.
  for st in select x from pg_catalog.jsonb_array_elements(p_stages) x loop
    i := i + 1;
    if pg_catalog.jsonb_typeof(st) <> 'object' then
      perform core.fail('bad_request', 'Stage ' || i || ' cannot be read. Reload the page.', 400);
    end if;
    v_space := st ->> 'space';
    if v_space is null or not exists (select 1 from core.spaces s where s.id = v_space) then
      perform core.fail('bad_request', 'Stage ' || i || ': choose the team (a space) that does it.', 400);
    end if;
    v_sname := core.clean_line(st ->> 'name', 60);
    if pg_catalog.length(v_sname) < 1 then
      perform core.fail('bad_request', 'Stage ' || i || ': give it a name, for example "Technical review".', 400);
    end if;
    begin
      v_hours := coalesce((st ->> 'hours')::integer, 24);
    exception when others then
      v_hours := 0;
    end;
    if v_hours < 1 or v_hours > 2000 then
      perform core.fail('bad_request', 'Stage ' || i || ': the hours must be a whole number from 1 to 2000.', 400);
    end if;
    if coalesce((st ->> 'optional')::boolean, false) and (i = 1 or i = v_n) then
      perform core.fail('bad_request', 'The first and the last stage cannot be skipped.', 400);
    end if;
    v_checks := '[]'::jsonb;
    if st ? 'checks' then
      if pg_catalog.jsonb_typeof(st -> 'checks') <> 'array' then
        perform core.fail('bad_request', 'Stage ' || i || ': the checklist cannot be read. Reload the page.', 400);
      end if;
      for c in select x from pg_catalog.jsonb_array_elements(st -> 'checks') x loop
        v_line := core.clean_line(c #>> '{}', 160);
        if pg_catalog.length(v_line) > 0 then
          v_checks := v_checks || pg_catalog.jsonb_build_array(v_line);
        end if;
      end loop;
    end if;
    if pg_catalog.jsonb_array_length(v_checks) > 10 then
      perform core.fail('bad_request', 'Stage ' || i || ': at most 10 checklist lines.', 400);
    end if;
    -- The most items at once: empty = no limit.
    begin
      v_max := nullif(st ->> 'max_open', '')::integer;
    exception when others then
      v_max := 0;
    end;
    if v_max is not null and (v_max < 1 or v_max > 500) then
      perform core.fail('bad_request', 'Stage ' || i || ': the most items at once is a whole number from 1 to 500, or empty for no limit.', 400);
    end if;
    -- The tools hung on this stage: tools of the stage's own space, each once, at most 6.
    v_tools := '[]'::jsonb;
    if st ? 'tools' then
      if pg_catalog.jsonb_typeof(st -> 'tools') <> 'array' then
        perform core.fail('bad_request', 'Stage ' || i || ': the tools cannot be read. Reload the page.', 400);
      end if;
      select coalesce(pg_catalog.jsonb_agg(d.id order by d.o), '[]'::jsonb) into v_tools
        from (select x.id, min(x.o) as o from pg_catalog.jsonb_array_elements_text(st -> 'tools') with ordinality x (id, o) group by x.id) d;
      if exists (select 1 from pg_catalog.jsonb_array_elements_text(v_tools) x (id)
                  where not exists (select 1 from core.tools t where t.space = v_space and t.id = x.id)) then
        perform core.fail('bad_request', 'Stage ' || i || ': a chosen tool is not a tool of that team''s space. Choose again.', 400);
      end if;
      if pg_catalog.jsonb_array_length(v_tools) > 6 then
        perform core.fail('bad_request', 'Stage ' || i || ': at most 6 tools.', 400);
      end if;
    end if;
    v_clean := v_clean || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'pos', i, 'space', v_space, 'name', v_sname, 'hours', v_hours, 'checks', v_checks, 'tools', v_tools, 'max_open', v_max,
      'optional', coalesce((st ->> 'optional')::boolean, false)));
  end loop;

  select * into v_old from core.relay_flows f where f.id = p_flow for update;
  if exists (select 1 from core.relay_flows f where f.prefix = v_prefix and f.id <> p_flow) then
    perform core.fail('bad_request', 'Another flow uses the letters ' || v_prefix || '. Choose others.', 400);
  end if;

  if v_old.id is null then
    insert into core.relay_flows (id, name, item_word, prefix, description, created_by)
    values (p_flow, v_name, v_word, v_prefix, core.clean_text(p_description, 400), v_uid);
  else
    select count(*) into v_open from core.relay_items x where x.flow = p_flow and x.status in ('waiting', 'working');
    if v_prefix <> v_old.prefix and exists (select 1 from core.relay_items x where x.flow = p_flow) then
      perform core.fail('bad_request', 'The number letters cannot change once items exist: their numbers are in use.', 400);
    end if;
    if v_open > 0 and (
         (select count(*) from core.relay_stages s where s.flow = p_flow) <> v_n
         or exists (select 1 from core.relay_stages s join pg_catalog.jsonb_array_elements(v_clean) n on (n ->> 'pos')::integer = s.pos
                     where s.flow = p_flow and s.space <> n ->> 'space')) then
      perform core.fail('bad_request', v_open || ' items of this flow are still open. While they are, stages cannot be added, removed, moved or given to another team. Names, checklists and hours can change.', 400);
    end if;
    update core.relay_flows set name = v_name, item_word = v_word, prefix = v_prefix,
           description = core.clean_text(p_description, 400), changed_at = pg_catalog.now(), changed_by = v_uid
     where id = p_flow;
    -- A changed checklist starts again for the items at that stage.
    update core.relay_items x set ticks = '[]'::jsonb
      from core.relay_stages s join pg_catalog.jsonb_array_elements(v_clean) n on (n ->> 'pos')::integer = s.pos
     where s.flow = p_flow and x.flow = p_flow and x.status in ('waiting', 'working')
       and x.path[pg_catalog.cardinality(x.path)] = s.pos and s.checks <> n -> 'checks';
    delete from core.relay_stages where flow = p_flow;
  end if;

  insert into core.relay_stages (flow, pos, space, name, optional, hours, checks, tools, max_open)
  select p_flow, (n ->> 'pos')::integer, n ->> 'space', n ->> 'name', (n ->> 'optional')::boolean,
         (n ->> 'hours')::integer, n -> 'checks', n -> 'tools', (n ->> 'max_open')::integer
    from pg_catalog.jsonb_array_elements(v_clean) n;

  perform core.audit_add(v_uid, case when v_old.id is null then 'relay.flow_created' else 'relay.flow_changed' end,
    p_flow, pg_catalog.jsonb_build_object('name', v_name, 'stages', v_n));
  return pg_catalog.jsonb_build_object('id', p_flow);
end $$;

-- Switches a flow off (nothing new starts; open items can still finish) or on again.
create or replace function public.dame_relay_flow_active(p_flow text, p_active boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_it();
begin
  if p_active is null then
    perform core.fail('bad_request', 'On or off?', 400);
  end if;
  update core.relay_flows set active = p_active, changed_at = pg_catalog.now(), changed_by = v_uid where id = p_flow;
  if not found then
    perform core.fail('bad_request', 'This flow was not found. Reload the page.', 400);
  end if;
  perform core.audit_add(v_uid, case when p_active then 'relay.flow_on' else 'relay.flow_off' end, p_flow);
  return pg_catalog.jsonb_build_object('id', p_flow, 'active', p_active);
end $$;

-- Rights: nobody by default, then signed-in people through the site (as db/10_rights.sql does).
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_catalog.pg_proc p
           join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'dame\_%'
  loop
    execute pg_catalog.format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute pg_catalog.format('grant execute on function %s to authenticated', f.sig);
    if f.proname = 'dame_site_info' then
      execute pg_catalog.format('grant execute on function %s to anon', f.sig);
    end if;
  end loop;
end $$;

commit;

-- Must show no rows.
select * from core.security_check();

-- The question of db/check.sql: must say yes.
select case when t.fingerprint = 'cb479aa761d46270e259f413692090db' then 'yes' else 'no' end as final_version,
       t.fingerprint, 'cb479aa761d46270e259f413692090db' as expected, t.parts
  from (select pg_catalog.md5(pg_catalog.string_agg(x, '|' order by x)) as fingerprint, pg_catalog.count(*) as parts
          from (select 'f ' || n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' as x
                  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'core' or (n.nspname = 'public' and p.proname like 'dame\_%')
                union all
                select 'c ' || c.relname || '.' || a.attname || ' ' || pg_catalog.format_type(a.atttypid, a.atttypmod)
                  from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid
                  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'core' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
                union all
                select 's ' || s.key from core.settings s) parts) t;
