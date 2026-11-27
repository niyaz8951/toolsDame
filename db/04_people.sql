-- db/04_people.sql - sign-in, access requests, accounts, site settings
-- and the IT admin's People part.
-- Serves: contracts 1 (Identity), 3 (Access) and 7 (Audit).
-- Must not change: an account is pending until an IT admin approves it (or IT
-- added it). A temporary password is never stored readable, never written to
-- the audit, valid 7 days, and nothing opens until the person chose his own.
-- The functions marked SUPABASE stand in for company sign-in in the demo and
-- are what IT replaces (see db/README.md).
-- How to run: as part of db/install.sql (psql), or pasted in number
-- order. Only into an empty database; see db/README.md.

-- ---------------------------------------------------------------------------
-- 1. Signed out, and right after sign-in
-- ---------------------------------------------------------------------------

-- The one function a signed-out visitor may run. Holds no data.
create function public.dame_site_info() returns jsonb
language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object('name', 'DAME', 'demo', true, 'api', 1);
$$;

-- Is this email address allowed to ask for access?
create function core.email_allowed(p_email text) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select s.value from core.settings s where s.key = 'signup_domains'), '') = ''
      or pg_catalog.split_part(p_email, '@', 2) = any (
           pg_catalog.string_to_array(pg_catalog.replace((select s.value from core.settings s where s.key = 'signup_domains'), ' ', ''), ','));
$$;

-- How long a temporary password may wait for the person.
create function core.temp_days() returns integer
language sql immutable set search_path = '' as $$ select 7; $$;

-- Called right after sign-in. The first time, records the access request:
-- only for an allowed email domain (setting signup_domains) or an address IT
-- added, which is then approved at once. Returns only the caller's own status,
-- and when a password must be chosen, why (new account or reset, by whom,
-- when, too old). Notes the password fingerprint of a new sign-up.
-- SUPABASE: reads auth.jwt() and auth.users.
create function public.dame_request_access() returns jsonb
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

-- After a temporary password (new account or reset): the person chose his own
-- password in the sign-in service. He must also type the temporary one, and a
-- temporary password older than 7 days is refused.
-- SUPABASE: reads auth.users; checks the temporary password with extensions.crypt.
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

-- Who the bar shows: id, name, email, username, IT admin or not, and the AI setting. Approved users only.
create function public.dame_me() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_user();
begin
  return (select pg_catalog.jsonb_build_object(
            'id', p.id, 'name', p.name, 'email', p.email, 'username', p.username, 'is_it', p.is_it,
            'ai_mode', (select s.value from core.settings s where s.key = 'ai_mode'))
          from core.profiles p where p.id = v_uid);
end $$;

-- Ends the caller's session at once, whatever the sign-in service still thinks.
create function public.dame_sign_out() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_login();
begin
  update core.sessions set ended_at = pg_catalog.now()
   where user_id = v_uid and ended_at is null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The person: his own account
-- ---------------------------------------------------------------------------

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
               'level', core.named_tool_level(p_user, t.space, t.id),
               'manager', exists (select 1 from core.tool_managers m where m.space = t.space and m.tool = t.id and m.user_id = p_user))
             order by s.name, t.name)
        from core.tools t join core.spaces s on s.id = t.space
       where core.named_tool_level(p_user, t.space, t.id) is not null), '[]'::jsonb),
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

-- The person: his own account (core.account_card without what only IT sees).
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
-- SUPABASE: reads auth.users.
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

-- ---------------------------------------------------------------------------
-- 3. IT admin: people
-- ---------------------------------------------------------------------------

-- IT admin: everyone, waiting accounts first, with what the People list shows.
-- p_status narrows the list.
create function public.dame_users_list(p_status text default null) returns jsonb
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

-- IT admin: one person's account, with what only IT sees.
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

-- IT admin: approve (active) or switch off (disabled) another person's account.
create function public.dame_user_set_status(p_user uuid, p_status text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := core.require_it();
  v_old  text;
begin
  if p_status is null or p_status not in ('active', 'disabled') then
    perform core.fail('bad_request', 'Choose Approve or Switch off.', 400);
  end if;
  if p_user = v_uid then
    perform core.fail('not_allowed', 'You cannot change your own account. Ask another IT admin.');
  end if;
  select p.status into v_old from core.profiles p where p.id = p_user for update;
  if v_old is null then
    perform core.fail('bad_request', 'This person was not found. Reload the page.', 400);
  end if;
  if v_old = p_status then
    return;
  end if;

  update core.profiles
     set status = p_status,
         is_it = case when p_status = 'disabled' then false else is_it end,
         decided_at = pg_catalog.now(), decided_by = v_uid
   where id = p_user;
  if p_status = 'disabled' then
    update core.sessions set ended_at = pg_catalog.now() where user_id = p_user and ended_at is null;
  end if;

  perform core.audit_add(v_uid,
    case when p_status = 'active' and v_old = 'pending' then 'user.approved'
         when p_status = 'active' then 'user.switched_on'
         when v_old = 'pending' then 'user.refused'
         else 'user.switched_off' end,
    p_user::text);
end $$;

-- IT admin: make another approved person an IT admin, or take it back.
create function public.dame_user_set_it(p_user uuid, p_is_it boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := core.require_it();
  v_row  core.profiles;
begin
  if p_is_it is null then
    perform core.fail('bad_request', 'Choose yes or no.', 400);
  end if;
  if p_user = v_uid then
    perform core.fail('not_allowed', 'You cannot change your own role. Ask another IT admin.');
  end if;
  select * into v_row from core.profiles p where p.id = p_user for update;
  if v_row.id is null then
    perform core.fail('bad_request', 'This person was not found. Reload the page.', 400);
  end if;
  if v_row.status <> 'active' then
    perform core.fail('bad_request', 'Approve this account first.', 400);
  end if;
  if v_row.is_it = p_is_it then
    return;
  end if;
  update core.profiles set is_it = p_is_it where id = p_user;
  perform core.audit_add(v_uid, case when p_is_it then 'user.it_admin_on' else 'user.it_admin_off' end, p_user::text);
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
-- SUPABASE: writes auth.users and deletes from auth.sessions.
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

-- IT admin: a new account with a username, a display name and a temporary
-- password (valid 7 days). Nothing opens until the person chose his own.
-- SUPABASE: writes one row into auth.users and one into auth.identities. This is
-- the demo's stand-in for company sign-in, NOT part of the target.
create function public.dame_user_create(p_username text, p_name text, p_temp_password text) returns jsonb
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

-- IT admin: add a person by work email. He signs up on the start page with this address and is in at once.
create function public.dame_user_add(p_email text, p_name text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := core.require_it();
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_name  text;
begin
  if v_email !~ '^[a-z0-9._%+-]{1,64}@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' or pg_catalog.char_length(v_email) > 254 then
    perform core.fail('bad_request', 'This is not an email address. Write it like name@company.com.', 400);
  end if;
  if exists (select 1 from core.profiles p where p.email = v_email) then
    perform core.fail('bad_request', 'This person already has an account or a request. Look in the lists above.', 400);
  end if;
  if exists (select 1 from core.invites i where i.email = v_email) then
    perform core.fail('bad_request', 'This address is already added and waiting for the person to sign up.', 400);
  end if;
  v_name := core.clean_name(p_name, v_email);
  insert into core.invites (email, name, added_by) values (v_email, v_name, v_uid);
  perform core.audit_add(v_uid, 'user.added', v_email, pg_catalog.jsonb_build_object('name', v_name));
end $$;

-- IT admin: take an added address back, as long as the person has not signed up.
create function public.dame_user_add_remove(p_email text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := core.require_it();
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_gone  integer;
begin
  delete from core.invites i where i.email = v_email and i.used_by is null;
  get diagnostics v_gone = row_count;
  if v_gone = 0 then
    perform core.fail('bad_request', 'This address is not waiting. If the person has signed up, switch the account off instead.', 400);
  end if;
  perform core.audit_add(v_uid, 'user.add_removed', v_email);
end $$;

-- IT admin: the addresses added and still waiting for their person.
create function public.dame_users_added() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_it();
begin
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'email', i.email, 'name', i.name, 'at', i.added_at,
             'by', (select p.name from core.profiles p where p.id = i.added_by)) order by i.added_at desc)
           from core.invites i where i.used_by is null), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 4. IT admin: site settings and the whole audit
-- ---------------------------------------------------------------------------

-- IT admin: all site settings.
create function public.dame_settings_get() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_it();
begin
  return (select pg_catalog.jsonb_object_agg(s.key, s.value) from core.settings s);
end $$;

-- IT admin: a site setting. Only known keys and values:
--   ai_mode        : off, prompt, prompt_all
--   signup_domains : empty (anyone may ask) or domains like "company.com, company.ae"
create function public.dame_setting_set(p_key text, p_value text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := core.require_it();
  v_old   text;
  v_value text := p_value;
  d       text;
begin
  if p_key = 'ai_mode' then
    if v_value is null or v_value not in ('off', 'prompt', 'prompt_all') then
      perform core.fail('bad_request', 'Unknown setting or value.', 400);
    end if;
  elsif p_key = 'signup_domains' then
    v_value := pg_catalog.lower(pg_catalog.replace(pg_catalog.replace(coalesce(v_value, ''), ' ', ''), '@', ''));
    if pg_catalog.length(v_value) > 600 then
      perform core.fail('bad_request', 'That is too long. List at most 20 domains.', 400);
    end if;
    if v_value <> '' then
      foreach d in array pg_catalog.string_to_array(v_value, ',') loop
        if d !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
          perform core.fail('bad_request', 'Write domains like company.com, with commas between them. This one is not a domain: ' || pg_catalog.left(d, 60), 400);
        end if;
      end loop;
    end if;
  else
    perform core.fail('bad_request', 'Unknown setting or value.', 400);
  end if;

  select s.value into v_old from core.settings s where s.key = p_key for update;
  if v_old = v_value then
    return;
  end if;
  update core.settings set value = v_value, updated_at = pg_catalog.now(), updated_by = v_uid where key = p_key;
  perform core.audit_add(v_uid, 'setting.changed', p_key,
    pg_catalog.jsonb_build_object('from', case when v_old = '' then 'any' else v_old end, 'to', case when v_value = '' then 'any' else v_value end));
end $$;

-- IT admin: the whole audit, newest first. p_before = entries older than this id.
create function public.dame_audit_list(p_limit integer default 100, p_before bigint default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_it();
begin
  return core.audit_json(p_limit, p_before, null, null);
end $$;
