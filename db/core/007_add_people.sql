-- db/core/007_add_people.sql - an IT admin adds a person from the IT admin
-- page: the email address is approved in advance, so the person is in at once
-- when he signs up with it, without waiting for an approval.
-- Serves: contract 1 (Identity) and 7 (Audit).
-- Must not change: once run, never edited; a fix is a new file. Nobody sets
-- or sees another person's password: the person chooses his own when he signs
-- up. The platform never writes into Supabase's own sign-in tables.
--
-- How to run: after 006. Paste the whole file into the Supabase SQL editor and
-- press Run. It finishes completely or changes nothing. The last result must
-- be an empty table.

begin;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_attribute a
                 where a.attrelid = 'core.tools'::regclass and a.attname = 'help_text' and not a.attisdropped) then
    raise exception 'Run db/core/006_help.sql first.';
  end if;
  if pg_catalog.to_regclass('core.invites') is not null then
    raise exception '007 was already run. Do not run it twice.';
  end if;
end $$;

-- People an IT admin added by email and who have not signed up yet (used_by is null), or have.
create table core.invites (
  email     text primary key check (email = pg_catalog.lower(email) and pg_catalog.char_length(email) <= 254),
  name      text not null,
  added_by  uuid not null references core.profiles (id),
  added_at  timestamptz not null default pg_catalog.now(),
  used_by   uuid references core.profiles (id),
  used_at   timestamptz
);
alter table core.invites enable row level security;
alter table core.invites force row level security;
revoke all on table core.invites from public, anon, authenticated;

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

-- The access request, as in 005, with one addition: an address an IT admin added is active at once.
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

  return pg_catalog.jsonb_build_object('status', v_row.status);
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
