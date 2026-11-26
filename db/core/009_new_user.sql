-- db/core/009_new_user.sql - an IT admin makes an account directly: a username,
-- a display name and a temporary password. No email is needed. The person signs
-- in with them and must choose his own password before he can open anything.
-- Serves: contract 1 (Identity) and 7 (Audit). Owner's decision of 2026-11-26.
-- Must not change: once run, never edited; a fix is a new file. Only an IT
-- admin can make an account. The temporary password is never stored readable
-- and never written to the audit. Until the person has chosen his own password
-- every function of the site refuses him (the database decides, not the page).
-- This file writes one row into each of Supabase's own tables auth.users and
-- auth.identities: that is the demo's stand-in for company sign-in and is NOT
-- part of the target (docs/DEMO-STACK.md).
--
-- How to run: after 008. Paste the whole file into the Supabase SQL editor and
-- press Run. It finishes completely or changes nothing. The last result must
-- be an empty table.

begin;

do $$
begin
  if pg_catalog.to_regprocedure('public.dame_space_look_set(text, text, text)') is null then
    raise exception 'Run db/core/008_space_look.sql first.';
  end if;
  if exists (select 1 from pg_catalog.pg_attribute a
             where a.attrelid = 'core.profiles'::regclass and a.attname = 'must_change' and not a.attisdropped) then
    raise exception '009 was already run. Do not run it twice.';
  end if;
end $$;

alter table core.profiles add column username text
  constraint profiles_username_form check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,29}$');
create unique index profiles_username on core.profiles (username) where username is not null;
alter table core.profiles add column must_change boolean not null default false;
alter table core.profiles add column temp_hash text;   -- the temporary password as Supabase stores it (a one-way hash), to see that it was replaced

-- Approved, and with a password of his own. New: an account made by IT is
-- refused everywhere until its temporary password has been replaced.
create or replace function core.require_user() returns uuid
language plpgsql volatile set search_path = '' as $$
declare
  v_uid   uuid := core.require_login();
  v_row   core.profiles;
begin
  select * into v_row from core.profiles p where p.id = v_uid;
  if v_row.id is null then
    perform core.fail('no_profile', 'No access request was found for you. Open the start page and request access.');
  elsif v_row.status = 'pending' then
    perform core.fail('pending', 'Your account is waiting for approval by an IT admin.');
  elsif v_row.status <> 'active' then
    perform core.fail('disabled', 'Your account is switched off. Ask an IT admin.');
  elsif v_row.must_change then
    perform core.fail('must_change', 'Choose your own password first. Open the start page.');
  end if;
  return v_uid;
end $$;

-- IT admin: a new account. The person signs in with the username and the temporary password.
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

  insert into core.profiles (id, email, name, status, decided_at, decided_by, username, must_change, temp_hash)
  values (v_id, v_email, v_name, 'active', pg_catalog.now(), v_uid, v_user, true, v_hash);
  perform core.audit_add(v_uid, 'user.created', v_id::text, pg_catalog.jsonb_build_object('name', v_name, 'username', v_user));
  return pg_catalog.jsonb_build_object('id', v_id, 'username', v_user, 'name', v_name);
end $$;

-- The person, after choosing his own password in the sign-in service: the
-- database looks itself whether the temporary one is gone, then lets him in.
create function public.dame_password_done() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := core.require_login();
  v_row  core.profiles;
  v_now  text;
begin
  select * into v_row from core.profiles p where p.id = v_uid;
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
  select u.encrypted_password into v_now from auth.users u where u.id = v_uid;
  if v_now is null or v_now = v_row.temp_hash then
    perform core.fail('bad_request', 'The temporary password is still in place. Choose a new password first.', 400);
  end if;
  update core.profiles set must_change = false, temp_hash = null where id = v_uid;
  perform core.audit_add(v_uid, 'user.password_chosen', v_uid::text);
end $$;

-- The access request, as in 007, with one addition: it says when the person must choose a password first.
create or replace function public.dame_request_access() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := core.require_login();
  v_claims  jsonb := auth.jwt();
  v_email   text := pg_catalog.lower(pg_catalog.left(coalesce(v_claims ->> 'email', ''), 254));
  v_added   integer;
  v_row     core.profiles;
  v_invite  core.invites;
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

  insert into core.profiles (id, email, name)
  values (v_uid, v_email, core.clean_name(coalesce(v_invite.name, v_claims -> 'user_metadata' ->> 'name'), v_email))
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

  return pg_catalog.jsonb_build_object('status', v_row.status, 'must_change', v_row.status = 'active' and v_row.must_change);
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
