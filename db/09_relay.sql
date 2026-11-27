-- db/09_relay.sql - Relay: work that passes from team to team along the value
-- chain (for example Sales > Application > HQ-AES > Product team > Factory).
-- IT sets up a flow: its stages in order, each stage one space (a team), and
-- per stage the checklist that must be done before the item is passed on.
-- An item starts at the first stage. The team holding it picks it up, works,
-- passes it on, answers it back to the team that asked, or sends it back when
-- something is missing. Every move is history that cannot be changed.
-- Serves: contracts 1 (Identity), 2 (Structure: a stage IS a space; Relay adds
-- no level), 3 (Access: the database decides who holds an item) and 7 (Audit).
-- Must not change: Relay reads spaces and their people and writes only its own
-- tables. It changes no space, tool, table or row of a tool, so every tool
-- works exactly as before. Only the team that holds an item can move it; an
-- item goes back only to the team that passed it on ("each level answers only
-- the level that asked it"); history is append-only.
-- How to run: as part of db/install.sql (psql), or pasted in number
-- order. Only into an empty database; see db/README.md. On the live demo:
-- db/upgrade-relay.sql.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

-- A flow: the road an item takes. Set up by IT. A flow is never deleted, only
-- switched off: its items and their history stay.
create table core.relay_flows (
  id           text primary key check (core.id_ok(id)),
  name         text not null check (pg_catalog.length(name) between 1 and 80),
  -- what one item is called on screen, for example "MTO query"
  item_word    text not null check (item_word ~ '^[A-Za-z][A-Za-z -]{1,29}$'),
  -- the letters in front of an item's number, for example MTO-0007
  prefix       text not null check (prefix ~ '^[A-Z][A-Z0-9]{1,5}$'),
  description  text not null default '' check (pg_catalog.length(description) <= 400),
  active       boolean not null default true,
  next_no      integer not null default 1 check (next_no > 0),
  created_at   timestamptz not null default pg_catalog.now(),
  created_by   uuid not null references core.profiles (id),
  changed_at   timestamptz,
  changed_by   uuid references core.profiles (id)
);
create unique index relay_flows_prefix on core.relay_flows (prefix);

-- The stages of a flow, in order. A stage is one space: its admins and members
-- are the team. No foreign key to the space on purpose: a deleted space leaves
-- the stage without a team (nobody but IT can act there) and the setup page
-- says so; Relay never stops a space from being deleted.
create table core.relay_stages (
  flow      text not null references core.relay_flows (id),
  pos       integer not null check (pos between 1 and 12),
  space     text not null check (core.id_ok(space)),
  name      text not null check (pg_catalog.length(name) between 1 and 60),
  -- may be skipped: the team before it may pass straight to a later stage
  optional  boolean not null default false,
  -- how long the team should hold an item, in hours, before it is late
  hours     integer not null default 24 check (hours between 1 and 2000),
  -- what must be done before the item is passed on: up to 10 lines of text
  checks    jsonb not null default '[]'::jsonb
            check (pg_catalog.jsonb_typeof(checks) = 'array' and pg_catalog.jsonb_array_length(checks) <= 10),
  -- the tools of the stage's space that help do this stage: up to 6 tool ids
  tools     jsonb not null default '[]'::jsonb
            check (pg_catalog.jsonb_typeof(tools) = 'array' and pg_catalog.jsonb_array_length(tools) <= 6),
  primary key (flow, pos)
);

-- One item: a query, a request, an order. path is the stages it went through
-- to get where it is, in order; its last number is the stage holding it now.
-- Passing on adds a stage; answering or sending back takes the last one away.
create table core.relay_items (
  id           bigint generated always as identity primary key,
  flow         text not null references core.relay_flows (id),
  ref_no       integer not null check (ref_no > 0),
  title        text not null check (pg_catalog.length(title) between 3 and 120),
  project      text not null default '' check (pg_catalog.length(project) <= 120),
  details      text not null default '' check (pg_catalog.length(details) <= 4000),
  priority     text not null default 'normal' check (priority in ('normal', 'urgent')),
  needed_by    date,
  path         integer[] not null check (pg_catalog.cardinality(path) between 1 and 500),
  -- waiting: at a team, nobody has picked it up; working: one person has it
  status       text not null default 'waiting' check (status in ('waiting', 'working', 'closed', 'cancelled')),
  picked_by    uuid references core.profiles (id),
  -- the checklist lines done at the stage holding it now, by number (1, 2, ...)
  ticks        jsonb not null default '[]'::jsonb check (pg_catalog.jsonb_typeof(ticks) = 'array'),
  -- how it reached the stage holding it now
  last_move    text not null default 'start' check (last_move in ('start', 'pass', 'answer', 'missing')),
  stage_since  timestamptz not null default pg_catalog.now(),
  sent_back    integer not null default 0 check (sent_back >= 0),
  created_at   timestamptz not null default pg_catalog.now(),
  created_by   uuid not null references core.profiles (id),
  closed_at    timestamptz,
  closed_by    uuid references core.profiles (id),
  unique (flow, ref_no),
  check ((status = 'working') = (picked_by is not null))
);
create index relay_items_open on core.relay_items (flow, status) where status in ('waiting', 'working');
create index relay_items_by on core.relay_items (created_by) where status in ('waiting', 'working');

-- Everything that happened to an item. Rows are only ever added.
create table core.relay_events (
  id          bigint generated always as identity primary key,
  item        bigint not null references core.relay_items (id),
  at          timestamptz not null default pg_catalog.now(),
  actor       uuid not null references core.profiles (id),
  kind        text not null check (kind in ('started', 'picked', 'released', 'taken_over', 'passed',
                                            'answered', 'sent_back', 'closed', 'cancelled', 'note')),
  from_pos    integer,
  to_pos      integer,
  -- how long the item had been at from_pos when it left it, in hours
  held_hours  numeric(10, 2),
  text        text not null default '' check (pg_catalog.length(text) <= 2000),
  -- an IT admin acted at a stage whose team he is not named in
  as_it       boolean not null default false
);
create index relay_events_item on core.relay_events (item, id);

create function core.relay_history_is_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'The history of an item is append-only: rows cannot be changed or deleted.';
end $$;
create trigger relay_events_no_change before update or delete on core.relay_events
  for each row execute function core.relay_history_is_append_only();
create trigger relay_events_no_truncate before truncate on core.relay_events
  for each statement execute function core.relay_history_is_append_only();

-- Row security on and forced, no policies, no rights: as every table of core.
do $$
declare t text;
begin
  foreach t in array array['core.relay_flows', 'core.relay_stages', 'core.relay_items', 'core.relay_events'] loop
    execute pg_catalog.format('alter table %s enable row level security', t);
    execute pg_catalog.format('alter table %s force row level security', t);
    execute pg_catalog.format('revoke all on table %s from public, anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Helpers: who is the team, who sees what
-- ---------------------------------------------------------------------------

-- Named in the team of a space: its admin or its member, and the space is on.
create function core.relay_named(p_uid uuid, p_space text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from core.spaces s where s.id = p_space and s.active)
     and exists (select 1 from core.profiles p where p.id = p_uid and p.status = 'active')
     and (core.is_space_admin(p_uid, p_space)
          or exists (select 1 from core.space_members m where m.space = p_space and m.user_id = p_uid));
$$;

-- May act at a stage of this space: its team, or an IT admin (who acts as admin
-- of every space, owner 2026-11-27; the history marks it).
create function core.relay_can_act(p_uid uuid, p_space text) returns boolean
language sql stable set search_path = '' as $$
  select core.relay_named(p_uid, p_space) or core.is_it(p_uid);
$$;

-- Sees a flow and all its items: everyone named in the team of one of its
-- stages, and IT. The value chain is open to everyone on it.
create function core.relay_sees(p_uid uuid, p_flow text) returns boolean
language sql stable set search_path = '' as $$
  select core.is_it(p_uid)
      or exists (select 1 from core.relay_stages s where s.flow = p_flow and core.relay_named(p_uid, s.space));
$$;

-- The number people use: MTO-0007.
create function core.relay_ref(p_prefix text, p_no integer) returns text
language sql immutable set search_path = '' as $$
  select p_prefix || '-' || pg_catalog.lpad(p_no::text, 4, '0');
$$;

-- An item the caller may see, or a refusal that does not say whether it exists.
-- p_lock: the row is locked until the end of the call (for every change).
create function core.relay_item_get(p_uid uuid, p_item bigint, p_lock boolean) returns core.relay_items
language plpgsql volatile set search_path = '' as $$
declare
  v core.relay_items;
begin
  if p_lock then
    select * into v from core.relay_items i where i.id = p_item for update;
  else
    select * into v from core.relay_items i where i.id = p_item;
  end if;
  if v.id is null or not (core.relay_sees(p_uid, v.flow) or v.created_by = p_uid) then
    perform core.fail('not_allowed', 'This item was not found, or it is not for you. Open Relay again.');
  end if;
  return v;
end $$;

-- The stage holding an item now.
create function core.relay_stage_of(p_item core.relay_items) returns core.relay_stages
language sql stable set search_path = '' as $$
  select s.* from core.relay_stages s
   where s.flow = p_item.flow and s.pos = p_item.path[pg_catalog.cardinality(p_item.path)];
$$;

-- The caller must hold this item: it is open, at a stage he may act at, and he picked it up.
create function core.relay_require_holder(p_uid uuid, p_item core.relay_items) returns core.relay_stages
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
create function core.relay_log(p_uid uuid, p_item core.relay_items, p_kind text, p_from integer, p_to integer,
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

-- The stages of a flow as the pages show them.
create function core.relay_stages_json(p_flow text) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'pos', s.pos, 'name', s.name, 'space', s.space,
           'space_name', coalesce(sp.name, s.space),
           'team_ok', coalesce(sp.active, false),
           'team_gone', sp.id is null,
           'optional', s.optional, 'hours', s.hours, 'checks', s.checks) order by s.pos), '[]'::jsonb)
    from core.relay_stages s left join core.spaces sp on sp.id = s.space
   where s.flow = p_flow;
$$;

-- The tools hung on the stages of a flow, for this caller: can_open says whether he may open each.
-- A tool that was deleted since is left out.
create function core.relay_tools_json(p_uid uuid, p_flow text) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'pos', s.pos, 'space', t.space, 'id', t.id, 'name', t.name, 'icon', t.icon, 'colour', t.colour,
           'can_open', core.tool_level(p_uid, t.space, t.id) is not null) order by s.pos, x.o), '[]'::jsonb)
    from core.relay_stages s
    cross join lateral pg_catalog.jsonb_array_elements_text(s.tools) with ordinality x (id, o)
    join core.tools t on t.space = s.space and t.id = x.id
   where s.flow = p_flow;
$$;

-- How many items each stage of a flow holds now, and how many of them are late.
create function core.relay_counts_json(p_flow text) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('pos', s.pos,
           'open', (select count(*) from core.relay_items i where i.flow = s.flow and i.status in ('waiting', 'working')
                      and i.path[pg_catalog.cardinality(i.path)] = s.pos),
           'late', (select count(*) from core.relay_items i where i.flow = s.flow and i.status in ('waiting', 'working')
                      and i.path[pg_catalog.cardinality(i.path)] = s.pos
                      and pg_catalog.now() > i.stage_since + pg_catalog.make_interval(hours => s.hours))) order by s.pos), '[]'::jsonb)
    from core.relay_stages s where s.flow = p_flow;
$$;

-- An item as a card: what a list or the board shows.
create function core.relay_card_json(p_uid uuid, p_item core.relay_items) returns jsonb
language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'id', p_item.id,
    'ref', core.relay_ref(f.prefix, p_item.ref_no),
    'flow', f.id, 'flow_name', f.name, 'word', f.item_word,
    'title', p_item.title, 'project', p_item.project,
    'priority', p_item.priority, 'needed_by', p_item.needed_by,
    'status', p_item.status,
    'pos', s.pos, 'stage', s.name, 'space', s.space, 'space_name', coalesce(sp.name, s.space),
    'last_stage', (select max(x.pos) from core.relay_stages x where x.flow = f.id),
    'picked_by', pp.name, 'mine', coalesce(p_item.picked_by = p_uid, false),
    'last_move', p_item.last_move, 'since', p_item.stage_since,
    'due', p_item.stage_since + pg_catalog.make_interval(hours => s.hours),
    'late', p_item.status in ('waiting', 'working')
            and pg_catalog.now() > p_item.stage_since + pg_catalog.make_interval(hours => s.hours),
    'sent_back', p_item.sent_back,
    'started_by', pc.name, 'started_at', p_item.created_at, 'closed_at', p_item.closed_at)
  from core.relay_flows f
  join core.relay_stages s on s.flow = f.id and s.pos = p_item.path[pg_catalog.cardinality(p_item.path)]
  left join core.spaces sp on sp.id = s.space
  left join core.profiles pp on pp.id = p_item.picked_by
  left join core.profiles pc on pc.id = p_item.created_by
  where f.id = p_item.flow;
$$;

-- The order of a list: urgent first, then late, then the oldest at its stage.
create function core.relay_rank(p_item core.relay_items) returns text
language sql stable set search_path = '' as $$
  select case when p_item.priority = 'urgent' then '0' else '1' end
      || pg_catalog.to_char(p_item.stage_since, 'YYYYMMDDHH24MISSUS');
$$;

-- Who last passed this item on from a stage: the person who will get the answer back.
create function core.relay_worker_at(p_item bigint, p_pos integer) returns uuid
language sql stable set search_path = '' as $$
  select e.actor from core.relay_events e
   where e.item = p_item and e.from_pos = p_pos and e.kind = 'passed'
   order by e.id desc limit 1;
$$;

-- Text typed by a person, required: at least p_min characters after cleaning.
create function core.relay_text(p_text text, p_min integer, p_max integer, p_what text) returns text
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
-- on, and what he started that is still open.
create function public.dame_relay_home() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := core.require_user();
  v_it     boolean := core.is_it(v_uid);
  v_flows  jsonb;
  v_inbox  jsonb;
  v_mine   jsonb;
begin
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id', f.id, 'name', f.name, 'word', f.item_word, 'prefix', f.prefix,
           'description', f.description, 'active', f.active,
           'stages', core.relay_stages_json(f.id),
           'counts', core.relay_counts_json(f.id),
           'tools', core.relay_tools_json(v_uid, f.id),
           'can_start', f.active and core.relay_can_act(v_uid, s1.space),
           'open', (select count(*) from core.relay_items i where i.flow = f.id and i.status in ('waiting', 'working')),
           'late', (select count(*) from core.relay_items i
                      join core.relay_stages s on s.flow = i.flow and s.pos = i.path[pg_catalog.cardinality(i.path)]
                     where i.flow = f.id and i.status in ('waiting', 'working')
                       and pg_catalog.now() > i.stage_since + pg_catalog.make_interval(hours => s.hours)))
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

  return pg_catalog.jsonb_build_object('is_it', v_it, 'flows', v_flows, 'inbox', v_inbox, 'started', v_mine,
    'waiting', (select count(*) from pg_catalog.jsonb_array_elements(v_inbox) c where c ->> 'status' = 'waiting'),
    'working', (select count(*) from pg_catalog.jsonb_array_elements(v_inbox) c where (c ->> 'mine')::boolean));
end $$;

-- One flow as a board: its stages with how they are doing, its open items, the latest finished ones.
create function public.dame_relay_board(p_flow text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := core.require_user();
  v_flow  core.relay_flows;
  v_stats jsonb;
begin
  select * into v_flow from core.relay_flows f where f.id = p_flow;
  if v_flow.id is null or not core.relay_sees(v_uid, v_flow.id) or not (v_flow.active or core.is_it(v_uid)) then
    perform core.fail('not_allowed', 'This flow was not found, or none of your teams is on it.');
  end if;

  -- Per stage: open now, late now, the usual time held (last 90 days), how often it sent an item back.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'pos', s.pos,
           'open', (select count(*) from core.relay_items i where i.flow = s.flow and i.status in ('waiting', 'working')
                      and i.path[pg_catalog.cardinality(i.path)] = s.pos),
           'late', (select count(*) from core.relay_items i where i.flow = s.flow and i.status in ('waiting', 'working')
                      and i.path[pg_catalog.cardinality(i.path)] = s.pos
                      and pg_catalog.now() > i.stage_since + pg_catalog.make_interval(hours => s.hours)),
           'avg_hours', (select pg_catalog.round(avg(e.held_hours), 1) from core.relay_events e
                           join core.relay_items i on i.id = e.item
                          where i.flow = s.flow and e.from_pos = s.pos and e.held_hours is not null
                            and e.kind in ('passed', 'answered', 'sent_back', 'closed')
                            and e.at > pg_catalog.now() - interval '90 days'),
           'sent_back', (select count(*) from core.relay_events e join core.relay_items i on i.id = e.item
                          where i.flow = s.flow and e.from_pos = s.pos and e.kind = 'sent_back'
                            and e.at > pg_catalog.now() - interval '90 days')) order by s.pos), '[]'::jsonb)
    into v_stats
    from core.relay_stages s where s.flow = v_flow.id;

  return pg_catalog.jsonb_build_object(
    'flow', pg_catalog.jsonb_build_object('id', v_flow.id, 'name', v_flow.name, 'word', v_flow.item_word,
              'prefix', v_flow.prefix, 'description', v_flow.description, 'active', v_flow.active,
              'can_start', v_flow.active and core.relay_can_act(v_uid, (select s.space from core.relay_stages s where s.flow = v_flow.id and s.pos = 1))),
    'stages', core.relay_stages_json(v_flow.id),
    'tools', core.relay_tools_json(v_uid, v_flow.id),
    'stats', v_stats,
    'open', (select coalesce(pg_catalog.jsonb_agg(core.relay_card_json(v_uid, q.it) order by core.relay_rank(q.it)), '[]'::jsonb)
               from (select x as it from core.relay_items x where x.flow = v_flow.id and x.status in ('waiting', 'working') limit 500) q),
    'done', (select coalesce(pg_catalog.jsonb_agg(core.relay_card_json(v_uid, q.it) order by (q.it).closed_at desc), '[]'::jsonb)
               from (select x as it from core.relay_items x where x.flow = v_flow.id and x.status in ('closed', 'cancelled')
                      order by x.closed_at desc limit 20) q),
    'closed_30', (select count(*) from core.relay_items x where x.flow = v_flow.id and x.status = 'closed'
                    and x.closed_at > pg_catalog.now() - interval '30 days'),
    'avg_days', (select pg_catalog.round((avg(extract(epoch from (x.closed_at - x.created_at))) / 86400)::numeric, 1)
                   from core.relay_items x where x.flow = v_flow.id and x.status = 'closed'
                    and x.closed_at > pg_catalog.now() - interval '90 days'));
end $$;

-- One item in full: the card, its details, its checklist, its history, and what the caller may do now.
create function public.dame_relay_item(p_item bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := core.require_user();
  v        core.relay_items := core.relay_item_get(v_uid, p_item, false);
  v_stage  core.relay_stages := core.relay_stage_of(v);
  v_s1     text := (select s.space from core.relay_stages s where s.flow = v.flow and s.pos = 1);
  v_last   integer := (select max(s.pos) from core.relay_stages s where s.flow = v.flow);
  v_open   boolean := v.status in ('waiting', 'working');
  v_act    boolean := v_open and core.relay_can_act(v_uid, v_stage.space);
  v_holds  boolean := v_open and v.status = 'working' and v.picked_by = v_uid and core.relay_can_act(v_uid, v_stage.space);
  v_cur    integer := v.path[pg_catalog.cardinality(v.path)];
  v_back   integer := case when pg_catalog.cardinality(v.path) > 1 then v.path[pg_catalog.cardinality(v.path) - 1] end;
  v_pass   jsonb := '[]'::jsonb;
  r        record;
begin
  -- Where it may be passed: the next stage, and past it while the stages between may be skipped.
  if v_holds then
    for r in select s.pos, s.name, s.optional, coalesce(sp.active, false) as ok, coalesce(sp.name, s.space) as team
               from core.relay_stages s left join core.spaces sp on sp.id = s.space
              where s.flow = v.flow and s.pos > v_cur order by s.pos loop
      v_pass := v_pass || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                  'pos', r.pos, 'name', r.name, 'team', r.team, 'team_ok', r.ok));
      exit when not r.optional;
    end loop;
  end if;

  return core.relay_card_json(v_uid, v) || pg_catalog.jsonb_build_object(
    'details', v.details,
    'path', pg_catalog.to_jsonb(v.path),
    'stages', core.relay_stages_json(v.flow),
    'tools', core.relay_tools_json(v_uid, v.flow),
    'checks', v_stage.checks,
    'ticks', v.ticks,
    'back_to', (select pg_catalog.jsonb_build_object('pos', s.pos, 'name', s.name, 'space_name', coalesce(sp.name, s.space),
                  'person', (select p.name from core.profiles p where p.id = core.relay_worker_at(v.id, s.pos)))
                  from core.relay_stages s left join core.spaces sp on sp.id = s.space
                 where s.flow = v.flow and s.pos = v_back),
    'history', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                  'at', e.at, 'kind', e.kind, 'who', coalesce(p.name, 'Unknown'), 'as_it', e.as_it,
                  'from', sf.name, 'to', st.name, 'text', e.text, 'held_hours', e.held_hours) order by e.id), '[]'::jsonb)
                  from core.relay_events e
                  left join core.profiles p on p.id = e.actor
                  left join core.relay_stages sf on sf.flow = v.flow and sf.pos = e.from_pos
                  left join core.relay_stages st on st.flow = v.flow and st.pos = e.to_pos
                 where e.item = v.id),
    'can', pg_catalog.jsonb_build_object(
      'pick', v_act and v.status = 'waiting',
      'take_over', v_act and v.status = 'working' and v.picked_by <> v_uid and core.can_admin_space(v_uid, v_stage.space),
      'release', v_holds,
      'tick', v_holds,
      'pass', v_pass,
      'back', v_holds and v_back is not null,
      'close', v_holds and (v_cur = v_last or (pg_catalog.cardinality(v.path) = 1 and v.last_move = 'answer')),
      'cancel', v_open and (v.created_by = v_uid or core.is_it(v_uid) or core.can_admin_space(v_uid, v_s1)),
      'note', true));
end $$;

-- ---------------------------------------------------------------------------
-- 4. For the team holding an item: start, pick up, tick, pass, answer, send back, close
-- ---------------------------------------------------------------------------

-- Starts an item at the first stage. Only its team (or IT) may; the starter has it at once.
create function public.dame_relay_start(p_flow text, p_title text, p_project text, p_details text,
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
create function public.dame_relay_pick(p_item bigint) returns jsonb
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
create function public.dame_relay_release(p_item bigint) returns jsonb
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
create function public.dame_relay_tick(p_item bigint, p_line integer, p_done boolean) returns jsonb
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
create function public.dame_relay_pass(p_item bigint, p_to integer, p_note text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := core.require_user();
  v        core.relay_items := core.relay_item_get(v_uid, p_item, true);
  v_stage  core.relay_stages := core.relay_require_holder(v_uid, v);
  v_to     core.relay_stages;
  v_need   integer := pg_catalog.jsonb_array_length(v_stage.checks);
  v_done   integer;
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
  update core.relay_items
     set path = pg_catalog.array_append(path, v_to.pos), status = 'waiting', picked_by = null, ticks = '[]'::jsonb,
         last_move = 'pass', stage_since = pg_catalog.now()
   where id = v.id;
  perform core.relay_log(v_uid, v, 'passed', v_stage.pos, v_to.pos, core.clean_text(p_note, 2000), v_stage.space);
  return pg_catalog.jsonb_build_object('id', v.id, 'to', v_to.name);
end $$;

-- Goes back to the team that passed it on, and to the person there who did:
-- p_kind 'answer' = here is the answer; 'missing' = something is missing. A note is required.
create function public.dame_relay_back(p_item bigint, p_kind text, p_note text) returns jsonb
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
         sent_back = sent_back + case when p_kind = 'missing' then 1 else 0 end
   where id = v.id;
  perform core.relay_log(v_uid, v, case when p_kind = 'answer' then 'answered' else 'sent_back' end,
                         v_stage.pos, v_to.pos, v_note, v_stage.space);
  return pg_catalog.jsonb_build_object('id', v.id, 'to', v_to.name,
    'person', (select p.name from core.profiles p where p.id = v_who));
end $$;

-- Closes the item: at the last stage, or at the first when the answer has come back to it.
create function public.dame_relay_close(p_item bigint, p_note text) returns jsonb
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
     set status = 'closed', picked_by = null, closed_at = pg_catalog.now(), closed_by = v_uid
   where id = v.id;
  perform core.relay_log(v_uid, v, 'closed', v_stage.pos, null, core.clean_text(p_note, 2000), v_stage.space);
  return pg_catalog.jsonb_build_object('id', v.id);
end $$;

-- Cancels an open item: who started it, an admin of the first team, or IT. A reason is required.
create function public.dame_relay_cancel(p_item bigint, p_reason text) returns jsonb
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
     set status = 'cancelled', picked_by = null, closed_at = pg_catalog.now(), closed_by = v_uid
   where id = v.id;
  perform core.relay_log(v_uid, v, 'cancelled', v_stage.pos, null, v_reason, v_stage.space);
  return pg_catalog.jsonb_build_object('id', v.id);
end $$;

-- Adds a note to the history: anyone who sees the item.
create function public.dame_relay_note(p_item bigint, p_text text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := core.require_user();
  v        core.relay_items := core.relay_item_get(v_uid, p_item, true);
  v_stage  core.relay_stages := core.relay_stage_of(v);
begin
  if (select count(*) from core.relay_events e where e.item = v.id) >= 1000 then
    perform core.fail('quota_full', 'This item has 1,000 lines of history. Start a new one.');
  end if;
  perform core.relay_log(v_uid, v, 'note', v_stage.pos, null,
    core.relay_text(p_text, 1, 2000, 'Write the note first.'), v_stage.space);
  return pg_catalog.jsonb_build_object('id', v.id);
end $$;

-- ---------------------------------------------------------------------------
-- 5. For IT: set up the flows
-- ---------------------------------------------------------------------------

-- Every flow, also the switched-off ones, with its stages and what is open.
create function public.dame_relay_flows_all() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_it();
begin
  return (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', f.id, 'name', f.name, 'word', f.item_word, 'prefix', f.prefix,
            'description', f.description, 'active', f.active,
            'stages', core.relay_stages_json(f.id),
            'tools', core.relay_tools_json(v_uid, f.id),
            'open', (select count(*) from core.relay_items i where i.flow = f.id and i.status in ('waiting', 'working')),
            'items', (select count(*) from core.relay_items i where i.flow = f.id),
            'created_at', f.created_at) order by f.name), '[]'::jsonb)
            from core.relay_flows f);
end $$;

-- Makes a flow, or changes one. p_stages: [{ "space": "sales", "name": "Raise the query",
-- "optional": false, "hours": 8, "checks": ["Customer and project named", ...] }, ...], 2 to 12.
-- While items are open, its stages cannot be added, removed, moved or given to another team:
-- names, checklists, hours and "may be skipped" can still change.
create function public.dame_relay_flow_save(p_flow text, p_name text, p_word text, p_prefix text,
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
      'pos', i, 'space', v_space, 'name', v_sname, 'hours', v_hours, 'checks', v_checks, 'tools', v_tools,
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

  insert into core.relay_stages (flow, pos, space, name, optional, hours, checks, tools)
  select p_flow, (n ->> 'pos')::integer, n ->> 'space', n ->> 'name', (n ->> 'optional')::boolean,
         (n ->> 'hours')::integer, n -> 'checks', n -> 'tools'
    from pg_catalog.jsonb_array_elements(v_clean) n;

  perform core.audit_add(v_uid, case when v_old.id is null then 'relay.flow_created' else 'relay.flow_changed' end,
    p_flow, pg_catalog.jsonb_build_object('name', v_name, 'stages', v_n));
  return pg_catalog.jsonb_build_object('id', p_flow);
end $$;

-- Switches a flow off (nothing new starts; open items can still finish) or on again.
create function public.dame_relay_flow_active(p_flow text, p_active boolean) returns jsonb
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
