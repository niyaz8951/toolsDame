-- db/install/02_tables.sql - every table of schema core, in its final form,
-- with its indexes, its triggers and the site's default settings.
-- Serves: contracts 1 (Identity), 2 (Structure), 3 (Access), 5 (Data),
-- 6 (Releases) and 7 (Audit).
-- Must not change: row security is on and forced on every table and there is
-- no policy: nobody reaches a table except through the dame_* functions. The
-- audit is append-only; a ready version never changes. Column order is the
-- same as in the demo database, so its data can be copied over as it is.
-- How to run: as part of db/install/install.sql (psql), or pasted in number
-- order. Only into an empty database; see db/install/README.md.

-- ---------------------------------------------------------------------------
-- 1. People and sessions
-- ---------------------------------------------------------------------------

-- One person = one row. id is the user id given by sign-in.
create table core.profiles (
  id             uuid primary key,
  email          text not null,
  name           text not null,
  status         text not null default 'pending' check (status in ('pending', 'active', 'disabled')),
  is_it          boolean not null default false,
  created_at     timestamptz not null default pg_catalog.now(),
  decided_at     timestamptz,
  decided_by     uuid references core.profiles (id),
  -- an account made by IT: its username (sign-in uses <username>@users.dame.internal)
  username       text constraint profiles_username_form check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,29}$'),
  -- a temporary password is in place: nothing opens until the person chose his own
  must_change    boolean not null default false,
  -- the temporary password as Supabase stores it (a one-way hash), to see that it was replaced
  temp_hash      text,
  -- work details: the person changes them himself, except staff_no (IT only)
  job_title      text not null default '' check (pg_catalog.length(job_title) <= 80),
  department     text not null default '' check (pg_catalog.length(department) <= 80),
  office         text not null default '' check (pg_catalog.length(office) <= 80),
  phone          text not null default '' check (phone ~ '^[0-9+() ./-]{0,30}$'),
  staff_no       text not null default '' check (staff_no ~ '^[A-Za-z0-9._/-]{0,30}$'),
  pw_changed_at  timestamptz,                       -- when the person last chose a password himself
  pw_mark        text,                              -- a fingerprint of the stored password hash, only to see that it changed
  temp_set_at    timestamptz,                       -- when the temporary password was given (valid 7 days)
  temp_set_by    uuid references core.profiles (id),
  temp_kind      text check (temp_kind is null or temp_kind in ('new', 'reset')),
  check (not is_it or status = 'active')
);
create unique index profiles_username on core.profiles (username) where username is not null;

-- Every sign-in seen by the platform. Only the newest one of a user is
-- honoured, for 12 hours. Rows are never deleted, so an old session can never
-- come back as a new one.
create table core.sessions (
  seq         bigint generated always as identity primary key,
  session_id  uuid not null unique,
  user_id     uuid not null,
  first_seen  timestamptz not null default pg_catalog.now(),
  ended_at    timestamptz
);
create index sessions_user on core.sessions (user_id, seq desc);

-- People an IT admin added by email and who have not signed up yet (used_by is null), or have.
create table core.invites (
  email     text primary key check (email = pg_catalog.lower(email) and pg_catalog.char_length(email) <= 254),
  name      text not null,
  added_by  uuid not null references core.profiles (id),
  added_at  timestamptz not null default pg_catalog.now(),
  used_by   uuid references core.profiles (id),
  used_at   timestamptz
);

-- ---------------------------------------------------------------------------
-- 2. Spaces and tools
-- ---------------------------------------------------------------------------

create table core.spaces (
  id          text primary key check (core.id_ok(id)),
  name        text not null check (pg_catalog.length(name) between 1 and 80),
  description text not null default '' check (pg_catalog.length(description) <= 400),
  icon        text not null default '',
  colour      text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default pg_catalog.now(),
  created_by  uuid not null references core.profiles (id)
);

create table core.tools (
  space           text not null references core.spaces (id),
  id              text not null check (core.id_ok(id)),
  name            text not null check (pg_catalog.length(name) between 1 and 80),
  description     text not null default '' check (pg_catalog.length(description) <= 400),
  icon            text not null default '',
  colour          text not null default '',
  active          boolean not null default true,
  open_to_space   boolean not null default false,
  open_level      text not null default 'read' check (core.level_rank(open_level) is not null),
  created_at      timestamptz not null default pg_catalog.now(),
  created_by      uuid not null references core.profiles (id),
  live_version    integer,                          -- the version everybody gets
  preview_version integer,                          -- the version the managers preview
  -- the usage guide behind the information button: plain text, shown as text
  help_text       text not null default '' constraint tools_help_len check (pg_catalog.char_length(help_text) <= 4000),
  help_by         uuid references core.profiles (id),
  help_at         timestamptz,
  primary key (space, id)
);

-- Ids are permanent and never reused: a deleted space or tool leaves its id here.
create table core.retired_ids (
  kind        text not null check (kind in ('space', 'tool')),
  space       text not null,
  id          text not null default '',
  retired_at  timestamptz not null default pg_catalog.now(),
  primary key (kind, space, id)
);

-- ---------------------------------------------------------------------------
-- 3. Roles and access
-- ---------------------------------------------------------------------------

create table core.space_admins (
  space     text not null references core.spaces (id),
  user_id   uuid not null references core.profiles (id),
  added_at  timestamptz not null default pg_catalog.now(),
  added_by  uuid not null references core.profiles (id),
  primary key (space, user_id)
);

create table core.space_members (
  space     text not null references core.spaces (id),
  user_id   uuid not null references core.profiles (id),
  added_at  timestamptz not null default pg_catalog.now(),
  added_by  uuid not null references core.profiles (id),
  primary key (space, user_id)
);

create table core.tool_managers (
  space     text not null,
  tool      text not null,
  user_id   uuid not null references core.profiles (id),
  added_at  timestamptz not null default pg_catalog.now(),
  added_by  uuid not null references core.profiles (id),
  primary key (space, tool, user_id),
  foreign key (space, tool) references core.tools (space, id)
);

-- A person's level on a tool: read < contribute < edit < approve.
create table core.tool_access (
  space     text not null,
  tool      text not null,
  user_id   uuid not null references core.profiles (id),
  level     text not null check (core.level_rank(level) is not null),
  added_at  timestamptz not null default pg_catalog.now(),
  added_by  uuid not null references core.profiles (id),
  primary key (space, tool, user_id),
  foreign key (space, tool) references core.tools (space, id)
);

-- ---------------------------------------------------------------------------
-- 4. Releases and tables of a tool
-- ---------------------------------------------------------------------------

-- One row per upload. files: [{ "name": "index.html", "size": 1234, "sha256": "..." }]
create table core.tool_versions (
  space        text not null,
  tool         text not null,
  version      integer not null check (version > 0),
  state        text not null default 'uploading' check (state in ('uploading', 'ready', 'discarded')),
  note         text not null default '',
  files        jsonb not null,
  total_bytes  bigint not null,
  created_at   timestamptz not null default pg_catalog.now(),
  created_by   uuid not null references core.profiles (id),
  sealed_at    timestamptz,
  primary key (space, tool, version),
  foreign key (space, tool) references core.tools (space, id)
);
create trigger version_no_change before update on core.tool_versions
  for each row execute function core.version_is_immutable();

-- What the platform knows about a tool's tables. The tables themselves live in
-- schemas t_<space>__<tool> (live) and p_<space>__<tool> (preview), made by 07_data.sql.
-- columns: [{ "name": "status", "type": "choice", "choices": ["open", "won"] }, ...] in order.
create table core.tool_tables (
  space       text not null,
  tool        text not null,
  name        text not null,
  sharing     text not null check (sharing in ('private', 'team', 'reference')),
  columns     jsonb not null,
  created_at  timestamptz not null default pg_catalog.now(),
  created_by  uuid not null references core.profiles (id),
  primary key (space, tool, name),
  foreign key (space, tool) references core.tools (space, id)
);

-- ---------------------------------------------------------------------------
-- 5. Quotas
-- ---------------------------------------------------------------------------

-- One line per space. An empty limit means: the site's default (core.settings quota_*).
-- rows_used is kept by the row service; core.quota_recount() counts it again.
create table core.space_quotas (
  space        text primary key references core.spaces (id) on delete cascade,
  max_rows     bigint  check (max_rows between 100 and 10000000),
  max_tables   integer check (max_tables between 1 and 100),
  max_columns  integer check (max_columns between 1 and 200),
  rows_used    bigint not null default 0 check (rows_used >= 0),
  set_at       timestamptz,
  set_by       uuid references core.profiles (id),
  max_tools    integer check (max_tools between 1 and 200)
);

-- A space admin's request for more. One open request per space.
create table core.quota_requests (
  id            bigint generated always as identity primary key,
  space         text not null references core.spaces (id) on delete cascade,
  asked_by      uuid not null references core.profiles (id),
  asked_at      timestamptz not null default pg_catalog.now(),
  want_rows     bigint not null,
  want_tables   integer not null,
  want_columns  integer not null,
  reason        text not null,
  status        text not null default 'open' check (status in ('open', 'granted', 'declined', 'taken_back')),
  answered_by   uuid references core.profiles (id),
  answered_at   timestamptz,
  answer        text,
  want_tools    integer not null
);
create unique index quota_requests_one_open on core.quota_requests (space) where status = 'open';

-- ---------------------------------------------------------------------------
-- 6. Site settings
-- ---------------------------------------------------------------------------

create table core.settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default pg_catalog.now(),
  updated_by  uuid references core.profiles (id)
);
insert into core.settings (key, value) values
  ('ai_mode', 'prompt'),          -- off / prompt / prompt_all
  ('signup_domains', ''),         -- empty = any email may ask for access; else "company.com, company.ae"
  ('quota_rows', '10000'),        -- the default limits of a space (08_quotas.sql)
  ('quota_tables', '10'),
  ('quota_columns', '60'),
  ('quota_tools', '10');

-- ---------------------------------------------------------------------------
-- 7. The audit: who, when, what. Rows are only ever added.
-- ---------------------------------------------------------------------------

create table core.audit (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default pg_catalog.now(),
  actor   uuid,
  action  text not null,
  space   text,
  tool    text,
  target  text,
  detail  jsonb not null default '{}'::jsonb
);
create index audit_space on core.audit (space, id desc);
create index audit_actor on core.audit (actor, id desc);

create trigger audit_no_change before update or delete on core.audit
  for each row execute function core.audit_is_append_only();
create trigger audit_no_truncate before truncate on core.audit
  for each statement execute function core.audit_is_append_only();

-- ---------------------------------------------------------------------------
-- 8. Row security on and forced on every table; no policies; no rights
-- ---------------------------------------------------------------------------

do $$
declare t record;
begin
  for t in select c.oid::regclass as name from pg_catalog.pg_class c
           join pg_catalog.pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'core' and c.relkind = 'r'
  loop
    execute pg_catalog.format('alter table %s enable row level security', t.name);
    execute pg_catalog.format('alter table %s force row level security', t.name);
    execute pg_catalog.format('revoke all on table %s from public, anon, authenticated', t.name);
  end loop;
end $$;
