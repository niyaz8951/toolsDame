-- db/core/005_hardening.sql - what a review as IT asked for before a first demo:
-- who may ask for access (email domains), sign-ins in the audit, and the
-- site settings readable by IT admins.
-- Serves: contract 1 (Identity), 7 (Audit) and SECURITY "Accounts and keys".
-- Must not change: once run, never edited; a fix is a new file. An account
-- whose email is outside the allowed domains gets no access request at all.
-- A sign-in is written to the audit the first time the platform sees it.
--
-- How to run: after 004. Paste the whole file into the Supabase SQL editor and
-- press Run. It finishes completely or changes nothing. The last result must
-- be an empty table.

begin;

do $$
begin
  if pg_catalog.to_regclass('core.tool_tables') is null then
    raise exception 'Run db/core/004_tables.sql first.';
  end if;
  if exists (select 1 from core.settings s where s.key = 'signup_domains') then
    raise exception '005 was already run. Do not run it twice.';
  end if;
end $$;

-- Empty = any email address may ask for access (the demo's first days).
-- Otherwise a list like "company.com, company.ae": only those may ask.
insert into core.settings (key, value) values ('signup_domains', '');

-- Is this email address allowed to ask for access?
create function core.email_allowed(p_email text) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select s.value from core.settings s where s.key = 'signup_domains'), '') = ''
      or pg_catalog.split_part(p_email, '@', 2) = any (
           pg_catalog.string_to_array(pg_catalog.replace((select s.value from core.settings s where s.key = 'signup_domains'), ' ', ''), ','));
$$;

-- Signed in, with the one valid session. New: the first time a session of a
-- known person is seen, that sign-in is written to the audit.
create or replace function core.require_login() returns uuid
language plpgsql volatile set search_path = '' as $$
declare
  v_claims  jsonb := auth.jwt();
  v_uid     uuid  := auth.uid();
  v_sid     uuid;
  v_row     core.sessions;
  v_newest  uuid;
  v_new     integer;
begin
  if v_uid is null
     or coalesce(v_claims ->> 'role', '') <> 'authenticated'
     or coalesce(v_claims ->> 'is_anonymous', 'false') <> 'false' then
    perform core.fail('signed_out', 'You are not signed in. Sign in and try again.', 401);
  end if;

  begin
    v_sid := (v_claims ->> 'session_id')::uuid;
  exception when others then
    v_sid := null;
  end;
  if v_sid is null then
    perform core.fail('signed_out', 'You are not signed in. Sign in and try again.', 401);
  end if;

  insert into core.sessions (session_id, user_id) values (v_sid, v_uid)
  on conflict (session_id) do nothing;
  get diagnostics v_new = row_count;

  select * into v_row from core.sessions where session_id = v_sid;
  select s.session_id into v_newest from core.sessions s
   where s.user_id = v_uid order by s.seq desc limit 1;

  if v_row.user_id <> v_uid
     or v_row.ended_at is not null
     or v_newest <> v_sid
     or v_row.first_seen < pg_catalog.now() - interval '12 hours' then
    perform core.fail('session_ended', 'Your session has ended. Sign in again.', 401);
  end if;

  if v_new > 0 and exists (select 1 from core.profiles p where p.id = v_uid) then
    perform core.audit_add(v_uid, 'user.signed_in', v_uid::text);
  end if;
  return v_uid;
end $$;

-- Called right after sign-in. New: an email outside the allowed domains gets
-- no access request. People who already have one are not affected.
create or replace function public.dame_request_access() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := core.require_login();
  v_claims  jsonb := auth.jwt();
  v_email   text := pg_catalog.lower(pg_catalog.left(coalesce(v_claims ->> 'email', ''), 254));
  v_added   integer;
  v_row     core.profiles;
begin
  if v_email = '' then
    perform core.fail('bad_request', 'Your sign-in has no email address. Ask an IT admin.', 400);
  end if;

  if not exists (select 1 from core.profiles p where p.id = v_uid) and not core.email_allowed(v_email) then
    perform core.fail('not_allowed', 'This site is for work email addresses only ('
      || (select s.value from core.settings s where s.key = 'signup_domains')
      || '). Sign out and request access with your work email.');
  end if;

  insert into core.profiles (id, email, name)
  values (v_uid, v_email, core.clean_name(v_claims -> 'user_metadata' ->> 'name', v_email))
  on conflict (id) do nothing;
  get diagnostics v_added = row_count;
  if v_added > 0 then
    perform core.audit_add(v_uid, 'user.requested', v_uid::text, pg_catalog.jsonb_build_object('email', v_email));
  end if;

  select * into v_row from core.profiles p where p.id = v_uid;
  if v_row.email <> v_email then
    update core.profiles set email = v_email where id = v_uid;
    perform core.audit_add(v_uid, 'user.email_changed', v_uid::text,
                           pg_catalog.jsonb_build_object('from', v_row.email, 'to', v_email));
  end if;

  return pg_catalog.jsonb_build_object('status', v_row.status);
end $$;

-- IT admin: a site setting. Only known keys and values.
create or replace function public.dame_setting_set(p_key text, p_value text) returns void
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

-- IT admin: all site settings.
create function public.dame_settings_get() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := core.require_it();
begin
  return (select pg_catalog.jsonb_object_agg(s.key, s.value) from core.settings s);
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
