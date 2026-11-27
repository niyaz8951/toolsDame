-- db/core/010_accounts.sql - accounts as a company expects them: every person
-- has an account page (work details, his access, his sign-ins, a new password),
-- and an IT admin can open a person's account, correct it and reset a forgotten
-- password with a temporary one.
-- Serves: contract 1 (Identity), 3 (Access) and 7 (Audit). Owner's decision of 2026-11-27.
-- Must not change: once run, never edited; a fix is a new file.
--   * A person changes only his own work details. His name, username and
--     staff number are changed by IT only (they say who he is to others).
--   * Only an IT admin resets a password, never his own, never of an account
--     that is waiting or switched off. A reset ends every session of the person.
--   * A temporary password (new account or reset) is never stored readable,
--     never written to the audit, and is valid for 7 days.
--   * Nothing opens after a reset until the person has chosen his own password
--     AND shown that he knows the temporary one. So a stranger who still holds
--     an old sign-in of that person cannot finish the reset in his place.
-- Like 009, this file writes to Supabase's own sign-in tables (auth.users, and
-- auth.sessions when it exists). That is the demo's stand-in for company
-- sign-in and is NOT part of the target (docs/DEMO-STACK.md).
--
-- How to run: after 009. Paste the whole file into the Supabase SQL editor and
-- press Run. It finishes completely or changes nothing. The last result must
-- be an empty table.

begin;

do $$
begin
  if pg_catalog.to_regprocedure('public.dame_password_done()') is null
     and pg_catalog.to_regprocedure('public.dame_password_done(text)') is null then
    raise exception 'Run db/core/009_new_user.sql first.';
  end if;
  if exists (select 1 from pg_catalog.pg_attribute a
             where a.attrelid = 'core.profiles'::regclass and a.attname = 'job_title' and not a.attisdropped) then
    raise exception '010 was already run. Do not run it twice.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. What an account holds
-- ---------------------------------------------------------------------------

alter table core.profiles add column job_title   text not null default '' check (pg_catalog.length(job_title) <= 80);
alter table core.profiles add column department  text not null default '' check (pg_catalog.length(department) <= 80);
alter table core.profiles add column office      text not null default '' check (pg_catalog.length(office) <= 80);
alter table core.profiles add column phone       text not null default '' check (phone ~ '^[0-9+() ./-]{0,30}$');
alter table core.profiles add column staff_no    text not null default '' check (staff_no ~ '^[A-Za-z0-9._/-]{0,30}$');
alter table core.profiles add column pw_changed_at timestamptz;          -- when the person last chose a password himself
alter table core.profiles add column pw_mark     text;                   -- a fingerprint of the stored password hash, only to see that it changed
alter table core.profiles add column temp_set_at timestamptz;            -- when the temporary password was given
alter table core.profiles add column temp_set_by uuid references core.profiles (id);
alter table core.profiles add column temp_kind   text check (temp_kind is null or temp_kind in ('new', 'reset'));

-- Accounts that exist: remember today's password fingerprint; a temporary password
-- given before this file counts from now.
update core.profiles p set pw_mark = pg_catalog.md5(u.encrypted_password)
  from auth.users u where u.id = p.id and u.encrypted_password is not null;
update core.profiles set temp_set_at = pg_catalog.now(), temp_kind = 'new' where must_change;

create index audit_actor on core.audit (actor, id desc);

-- A short line of text: no control characters, single spaces, trimmed, cut to p_max.
create function core.clean_line(p_text text, p_max integer) returns text
language sql immutable set search_path = '' as $$
  select pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(
           pg_catalog.regexp_replace(coalesce(p_text, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), p_max);
$$;

-- How long a temporary password may wait for the person.
create function core.temp_days() returns integer
language sql immutable set search_path = '' as $$ select 7; $$;

-- One person's account as a card. p_full adds what only IT sees.
create function core.account_card(p_user uuid, p_full boolean) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_row   core.profiles;
  v_card  jsonb;
begin
  select * into v_row from core.profiles p where p.id = p_user;
  if v_row.id is null then
    return null;
  end if;
  v_card := pg_catalog.jsonb_build_object(
    'id', v_row.id, 'name', v_row.name, 'username', v_row.username,
    'email', case when v_row.username is null then v_row.email end,
    'job_title', v_row.job_title, 'department', v_row.department, 'office', v_row.office,
    'phone', v_row.phone, 'staff_no', v_row.staff_no,
    'is_it', v_row.is_it, 'status', v_row.status, 'created_at', v_row.created_at,
    'pw_changed_at', v_row.pw_changed_at,
    'spaces', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', s.id, 'name', s.name, 'active', s.active,
               'role', case when core.is_space_admin(p_user, s.id) then 'admin' else 'member' end) order by s.name)
        from core.spaces s
       where core.is_space_admin(p_user, s.id)
          or exists (select 1 from core.space_members m where m.space = s.id and m.user_id = p_user)), '[]'::jsonb),
    'tools', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('space', t.space, 'space_name', s.name, 'tool', t.id, 'name', t.name,
               'level', core.tool_level(p_user, t.space, t.id),
               'manager', exists (select 1 from core.tool_managers m where m.space = t.space and m.tool = t.id and m.user_id = p_user))
             order by s.name, t.name)
        from core.tools t join core.spaces s on s.id = t.space
       where core.tool_level(p_user, t.space, t.id) is not null), '[]'::jsonb),
    'sign_ins', coalesce((
      select pg_catalog.jsonb_agg(x.at order by x.id desc)
        from (select a.id, a.at from core.audit a
               where a.actor = p_user and a.action = 'user.signed_in' order by a.id desc limit 10) x), '[]'::jsonb));
  if p_full then
    v_card := v_card || pg_catalog.jsonb_build_object(
      'decided_at', v_row.decided_at,
      'must_change', v_row.must_change,
      'temp_set_at', v_row.temp_set_at,
      'temp_expired', v_row.must_change and v_row.temp_set_at is not null
                      and v_row.temp_set_at < pg_catalog.now() - pg_catalog.make_interval(days => core.temp_days()));
  end if;
  return v_card;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The person: his own account
-- ---------------------------------------------------------------------------

create function public.dame_account_get() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_user();
begin
  return core.account_card(v_uid, false);
end $$;

-- His own work details. Not his name, username or staff number: IT changes those.
create function public.dame_account_set(p_job_title text, p_department text, p_office text, p_phone text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := core.require_user();
  v_old    core.profiles;
  v_title  text := core.clean_line(p_job_title, 80);
  v_dept   text := core.clean_line(p_department, 80);
  v_office text := core.clean_line(p_office, 80);
  v_phone  text := core.clean_line(p_phone, 40);
  v_what   text[] := '{}';
begin
  if v_phone !~ '^[0-9+() ./-]{0,30}$' then
    perform core.fail('bad_request', 'A phone number has up to 30 characters: digits, spaces and + ( ) . / -', 400);
  end if;
  select * into v_old from core.profiles p where p.id = v_uid for update;
  if v_old.job_title <> v_title then v_what := v_what || 'job title'::text; end if;
  if v_old.department <> v_dept then v_what := v_what || 'department'::text; end if;
  if v_old.office <> v_office then v_what := v_what || 'office'::text; end if;
  if v_old.phone <> v_phone then v_what := v_what || 'phone'::text; end if;
  if pg_catalog.cardinality(v_what) = 0 then
    return;
  end if;
  update core.profiles set job_title = v_title, department = v_dept, office = v_office, phone = v_phone where id = v_uid;
  perform core.audit_add(v_uid, 'user.details_changed', v_uid::text,
                         pg_catalog.jsonb_build_object('name', pg_catalog.array_to_string(v_what, ', ')));
end $$;

-- The person changed his password in the sign-in service (account page). The
-- database looks itself whether the stored password really changed, then notes it.
create function public.dame_password_changed() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := core.require_user();
  v_mark  text;
  v_now   text;
begin
  select p.pw_mark into v_mark from core.profiles p where p.id = v_uid for update;
  select pg_catalog.md5(u.encrypted_password) into v_now from auth.users u where u.id = v_uid;
  if v_now is null or v_now = v_mark then
    perform core.fail('bad_request', 'The password was not changed. Try again.', 400);
  end if;
  update core.profiles set pw_mark = v_now, pw_changed_at = pg_catalog.now() where id = v_uid;
  perform core.audit_add(v_uid, 'user.password_changed', v_uid::text);
end $$;

-- After a temporary password (new account or reset): the person chose his own
-- password in the sign-in service. New in 010: he also shows that he knows the
-- temporary one, and a temporary password older than 7 days is refused.
drop function public.dame_password_done();
create function public.dame_password_done(p_temp_password text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := core.require_login();
  v_row  core.profiles;
  v_now  text;
begin
  select * into v_row from core.profiles p where p.id = v_uid for update;
  if v_row.id is null then
    perform core.fail('no_profile', 'No access request was found for you. Open the start page and request access.');
  elsif v_row.status = 'pending' then
    perform core.fail('pending', 'Your account is waiting for approval by an IT admin.');
  elsif v_row.status <> 'active' then
    perform core.fail('disabled', 'Your account is switched off. Ask an IT admin.');
  end if;
  if not v_row.must_change then
    return;
  end if;
  if v_row.temp_set_at is not null
     and v_row.temp_set_at < pg_catalog.now() - pg_catalog.make_interval(days => core.temp_days()) then
    perform core.fail('temp_expired', 'This temporary password is older than ' || core.temp_days() || ' days. Ask an IT admin for a new one.');
  end if;
  select u.encrypted_password into v_now from auth.users u where u.id = v_uid;
  if v_now is null or v_now = v_row.temp_hash then
    perform core.fail('bad_request', 'The temporary password is still in place. Choose a new password first.', 400);
  end if;
  if v_row.temp_hash is not null then
    if coalesce(p_temp_password, '') = '' then
      perform core.fail('temp_needed', 'Type the temporary password you got from IT, then your new password.', 400);
    end if;
    if extensions.crypt(p_temp_password, v_row.temp_hash) <> v_row.temp_hash then
      perform core.fail('temp_wrong', 'The temporary password is not the one IT gave you. Check it; if it keeps failing, ask an IT admin for a new one.', 400);
    end if;
  end if;
  update core.profiles
     set must_change = false, temp_hash = null, temp_set_at = null, temp_set_by = null, temp_kind = null,
         pw_changed_at = pg_catalog.now(), pw_mark = pg_catalog.md5(v_now)
   where id = v_uid;
  perform core.audit_add(v_uid, 'user.password_chosen', v_uid::text);
end $$;

-- Who the bar shows. New: the username, so an account made by IT is not shown by its inner address.
create or replace function public.dame_me() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_user();
begin
  return (select pg_catalog.jsonb_build_object(
            'id', p.id, 'name', p.name, 'email', p.email, 'username', p.username, 'is_it', p.is_it,
            'ai_mode', (select s.value from core.settings s where s.key = 'ai_mode'))
          from core.profiles p where p.id = v_uid);
end $$;

-- The access request, as in 009, with two additions: it says why a password
-- must be chosen (new account or reset, by whom, when, too old), and it notes
-- the password fingerprint of a new sign-up.
create or replace function public.dame_request_access() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := core.require_login();
  v_claims  jsonb := auth.jwt();
  v_email   text := pg_catalog.lower(pg_catalog.left(coalesce(v_claims ->> 'email', ''), 254));
  v_added   integer;
  v_row     core.profiles;
  v_invite  core.invites;
  v_must    boolean;
begin
  if v_email = '' then
    perform core.fail('bad_request', 'Your sign-in has no email address. Ask an IT admin.', 400);
  end if;

  select * into v_invite from core.invites i where i.email = v_email and i.used_by is null;

  if not exists (select 1 from core.profiles p where p.id = v_uid) and v_invite.email is null and not core.email_allowed(v_email) then
    perform core.fail('not_allowed', 'This site is for work email addresses only ('
      || (select s.value from core.settings s where s.key = 'signup_domains')
      || '). Sign out and request access with your work email.');
  end if;

  insert into core.profiles (id, email, name, pw_mark)
  values (v_uid, v_email, core.clean_name(coalesce(v_invite.name, v_claims -> 'user_metadata' ->> 'name'), v_email),
          (select pg_catalog.md5(u.encrypted_password) from auth.users u where u.id = v_uid))
  on conflict (id) do nothing;
  get diagnostics v_added = row_count;
  if v_added > 0 then
    perform core.audit_add(v_uid, 'user.requested', v_uid::text, pg_catalog.jsonb_build_object('email', v_email));
    if v_invite.email is not null then
      update core.profiles set status = 'active', decided_at = pg_catalog.now(), decided_by = v_invite.added_by where id = v_uid;
      update core.invites set used_by = v_uid, used_at = pg_catalog.now() where email = v_email;
      perform core.audit_add(v_invite.added_by, 'user.status_changed', v_uid::text,
                             pg_catalog.jsonb_build_object('from', 'added by IT', 'to', 'active'));
    end if;
  end if;

  select * into v_row from core.profiles p where p.id = v_uid;
  if v_row.email <> v_email then
    update core.profiles set email = v_email where id = v_uid;
    perform core.audit_add(v_uid, 'user.email_changed', v_uid::text,
                           pg_catalog.jsonb_build_object('from', v_row.email, 'to', v_email));
  end if;

  v_must := v_row.status = 'active' and v_row.must_change;
  return pg_catalog.jsonb_build_object('status', v_row.status, 'must_change', v_must)
    || case when v_must then pg_catalog.jsonb_build_object(
         'temp_kind', coalesce(v_row.temp_kind, 'new'),
         'temp_by', (select p.name from core.profiles p where p.id = v_row.temp_set_by),
         'temp_at', v_row.temp_set_at,
         'temp_expired', v_row.temp_set_at is not null
                         and v_row.temp_set_at < pg_catalog.now() - pg_catalog.make_interval(days => core.temp_days()))
       else '{}'::jsonb end;
end $$;

-- ---------------------------------------------------------------------------
-- 3. IT admin: a person's account
-- ---------------------------------------------------------------------------

-- Everyone, as in 001, with what the People list now shows.
create or replace function public.dame_users_list(p_status text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_it();
begin
  if p_status is not null and p_status not in ('pending', 'active', 'disabled') then
    perform core.fail('bad_request', 'Unknown status.', 400);
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', u.id, 'name', u.name, 'email', u.email, 'username', u.username, 'status', u.status,
             'is_it', u.is_it, 'created_at', u.created_at, 'decided_at', u.decided_at,
             'job_title', u.job_title, 'department', u.department, 'must_change', u.must_change,
             'is_me', u.id = v_uid)
           order by (u.status = 'pending') desc, u.created_at desc)
      from (select * from core.profiles p
             where p_status is null or p.status = p_status
             order by (p.status = 'pending') desc, p.created_at desc limit 1000) u
  ), '[]'::jsonb);
end $$;

create function public.dame_user_get(p_user uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := core.require_it();
  v_card  jsonb := core.account_card(p_user, true);
begin
  if v_card is null then
    perform core.fail('bad_request', 'This person was not found. Reload the page.', 400);
  end if;
  return v_card || pg_catalog.jsonb_build_object('is_me', p_user = v_uid);
end $$;

-- IT corrects a person's account: name, work details, staff number.
create function public.dame_user_details_set(p_user uuid, p_name text, p_job_title text, p_department text,
                                             p_office text, p_phone text, p_staff_no text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := core.require_it();
  v_old    core.profiles;
  v_name   text;
  v_title  text := core.clean_line(p_job_title, 80);
  v_dept   text := core.clean_line(p_department, 80);
  v_office text := core.clean_line(p_office, 80);
  v_phone  text := core.clean_line(p_phone, 40);
  v_staff  text := core.clean_line(p_staff_no, 40);
  v_what   text[] := '{}';
begin
  select * into v_old from core.profiles p where p.id = p_user for update;
  if v_old.id is null then
    perform core.fail('bad_request', 'This person was not found. Reload the page.', 400);
  end if;
  if core.clean_line(p_name, 80) = '' then
    perform core.fail('bad_request', 'Type the person''s name.', 400);
  end if;
  v_name := core.clean_name(p_name, v_old.name);
  if v_phone !~ '^[0-9+() ./-]{0,30}$' then
    perform core.fail('bad_request', 'A phone number has up to 30 characters: digits, spaces and + ( ) . / -', 400);
  end if;
  if v_staff !~ '^[A-Za-z0-9._/-]{0,30}$' then
    perform core.fail('bad_request', 'A staff number has up to 30 characters: letters, digits and . _ / -', 400);
  end if;
  if v_old.name <> v_name then v_what := v_what || 'name'::text; end if;
  if v_old.job_title <> v_title then v_what := v_what || 'job title'::text; end if;
  if v_old.department <> v_dept then v_what := v_what || 'department'::text; end if;
  if v_old.office <> v_office then v_what := v_what || 'office'::text; end if;
  if v_old.phone <> v_phone then v_what := v_what || 'phone'::text; end if;
  if v_old.staff_no <> v_staff then v_what := v_what || 'staff number'::text; end if;
  if pg_catalog.cardinality(v_what) = 0 then
    return;
  end if;
  update core.profiles set name = v_name, job_title = v_title, department = v_dept, office = v_office,
                           phone = v_phone, staff_no = v_staff where id = p_user;
  perform core.audit_add(v_uid, 'user.details_set', p_user::text,
    case when v_old.name <> v_name
         then pg_catalog.jsonb_build_object('from', v_old.name, 'to', v_name, 'changed', pg_catalog.array_to_string(v_what, ', '))
         else pg_catalog.jsonb_build_object('name', pg_catalog.array_to_string(v_what, ', ')) end);
end $$;

-- IT resets a forgotten password: a temporary one, told to the person by voice.
-- Every session of the person ends. He signs in with the temporary password and
-- must choose his own before anything opens.
create function public.dame_user_password_reset(p_user uuid, p_temp_password text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := core.require_it();
  v_row   core.profiles;
  v_hash  text;
  v_done  integer;
begin
  if p_user = v_uid then
    perform core.fail('not_allowed', 'You cannot reset your own password here. Change it on "My account", or ask another IT admin.');
  end if;
  select * into v_row from core.profiles p where p.id = p_user for update;
  if v_row.id is null then
    perform core.fail('bad_request', 'This person was not found. Reload the page.', 400);
  end if;
  if v_row.status <> 'active' then
    perform core.fail('bad_request', 'This account is waiting or switched off. Approve it or switch it on first.', 400);
  end if;
  if coalesce(p_temp_password, '') !~ '^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{10,72}$' then
    perform core.fail('bad_request', 'The temporary password needs at least 10 characters with a small letter, a capital letter and a digit.', 400);
  end if;
  v_hash := extensions.crypt(p_temp_password, extensions.gen_salt('bf'));

  update auth.users set encrypted_password = v_hash, updated_at = pg_catalog.now(), recovery_token = '' where id = p_user;
  get diagnostics v_done = row_count;
  if v_done = 0 then
    perform core.fail('bad_request', 'This account has no sign-in. Ask the owner of the site.', 400);
  end if;

  update core.profiles set must_change = true, temp_hash = v_hash, temp_set_at = pg_catalog.now(),
                           temp_set_by = v_uid, temp_kind = 'reset' where id = p_user;
  update core.sessions set ended_at = pg_catalog.now() where user_id = p_user and ended_at is null;
  -- The sign-in service's own sessions too, where it keeps them. If this is not
  -- permitted, the wall still stands: nothing opens without the temporary password.
  begin
    if pg_catalog.to_regclass('auth.sessions') is not null then
      execute 'delete from auth.sessions where user_id = $1' using p_user;
    end if;
  exception when insufficient_privilege then
    null;
  end;
  perform core.audit_add(v_uid, 'user.password_reset', p_user::text, pg_catalog.jsonb_build_object('name', v_row.name));
end $$;

-- A new account, as in 009; the temporary password now carries its date and who gave it.
create or replace function public.dame_user_create(p_username text, p_name text, p_temp_password text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := core.require_it();
  v_user  text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_username, '')));
  v_name  text;
  v_email text;
  v_id    uuid := pg_catalog.gen_random_uuid();
  v_hash  text;
begin
  if v_user !~ '^[a-z0-9][a-z0-9._-]{2,29}$' then
    perform core.fail('bad_request', 'A username has 3 to 30 characters: small letters, digits, dot, dash, underscore, and starts with a letter or digit.', 400);
  end if;
  if coalesce(p_temp_password, '') !~ '^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{10,72}$' then
    perform core.fail('bad_request', 'The temporary password needs at least 10 characters with a small letter, a capital letter and a digit.', 400);
  end if;
  v_email := v_user || '@users.dame.internal';
  if exists (select 1 from core.profiles p where p.username = v_user or p.email = v_email)
     or exists (select 1 from auth.users u where u.email = v_email) then
    perform core.fail('bad_request', 'This username is taken. Choose another one.', 400);
  end if;
  v_name := core.clean_name(p_name, v_user);
  v_hash := extensions.crypt(p_temp_password, extensions.gen_salt('bf'));

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    v_email, v_hash, pg_catalog.now(),
    '{"provider":"email","providers":["email"]}', pg_catalog.jsonb_build_object('name', v_name),
    pg_catalog.now(), pg_catalog.now(), '', '', '', '', '', '', '', '');
  insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values (pg_catalog.gen_random_uuid(), v_id,
    pg_catalog.jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
    'email', v_id::text, pg_catalog.now(), pg_catalog.now(), pg_catalog.now());

  insert into core.profiles (id, email, name, status, decided_at, decided_by, username, must_change, temp_hash,
                             temp_set_at, temp_set_by, temp_kind)
  values (v_id, v_email, v_name, 'active', pg_catalog.now(), v_uid, v_user, true, v_hash, pg_catalog.now(), v_uid, 'new');
  perform core.audit_add(v_uid, 'user.created', v_id::text, pg_catalog.jsonb_build_object('name', v_name, 'username', v_user));
  return pg_catalog.jsonb_build_object('id', v_id, 'username', v_user, 'name', v_name);
end $$;

-- Rights: nobody by default, then each function by name.
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
