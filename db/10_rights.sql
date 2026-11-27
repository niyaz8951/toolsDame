-- db/10_rights.sql - who may call what, and the checks for the owner.
-- Serves: SECURITY "Database": the API exposes only dame_* functions in public,
-- each security definer with an empty search path; a signed-out visitor runs
-- only dame_site_info; no table is ever reachable.
-- Must not change: rights are given by name to each dame_* function, never by
-- default. core.security_check() must return no rows.
-- How to run: as part of db/install.sql (psql), or pasted in number
-- order. Only into an empty database; see db/README.md.

-- ---------------------------------------------------------------------------
-- 1. For the owner, in the SQL editor only (not reachable from the site)
-- ---------------------------------------------------------------------------

-- Makes the very first IT admin. Works once: refuses when an IT admin exists.
-- The person must have signed in on the site once, so that his request exists.
-- For the owner, in the SQL editor only (not reachable from the site):
--   select core.make_first_admin('your email');
create function core.make_first_admin(p_email text) returns text
language plpgsql volatile set search_path = '' as $$
declare
  v_id uuid;
begin
  if exists (select 1 from core.profiles p where p.is_it) then
    raise exception 'An IT admin already exists. New IT admins are named on the IT admin page.';
  end if;
  select p.id into v_id from core.profiles p where p.email = pg_catalog.lower(pg_catalog.btrim(p_email));
  if v_id is null then
    raise exception 'No access request with this email. Request access and sign in on the site once, then run this again.';
  end if;
  update core.profiles set status = 'active', is_it = true, decided_at = pg_catalog.now() where id = v_id;
  perform core.audit_add(null, 'user.first_admin', v_id::text);
  return 'Done. Sign in on the site: you are the first IT admin.';
end $$;

-- One row per problem. Must return nothing after an install or any change.
create function core.security_check() returns table (problem text, object text)
language plpgsql stable set search_path = '' as $$
begin
  -- a. Every table of ours has row security on and forced.
  return query
    select 'Table without forced row security'::text, c.oid::regclass::text
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p')
       and (n.nspname in ('core', 'public') or n.nspname like 't\_%' or n.nspname like 'p\_%')
       and not (c.relrowsecurity and c.relforcerowsecurity);

  -- b. Nothing in public but dame_* functions.
  return query
    select 'Table, view or sequence in public'::text, c.oid::regclass::text
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f');
  return query
    select 'Function in public that is not dame_*'::text, p.oid::regprocedure::text
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname not like 'dame\_%'
       and not exists (select 1 from pg_catalog.pg_depend d where d.objid = p.oid and d.deptype = 'e');

  -- c. Every dame_* function runs as its owner with an empty search path.
  return query
    select 'dame_* function without security definer and empty search_path'::text, p.oid::regprocedure::text
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'dame\_%'
       and not (p.prosecdef and coalesce('search_path=""' = any (p.proconfig), false));

  -- d. A signed-out visitor runs only dame_site_info.
  return query
    select 'Function a signed-out visitor can run'::text, p.oid::regprocedure::text
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname <> 'dame_site_info'
       and not exists (select 1 from pg_catalog.pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and pg_catalog.has_function_privilege('anon', p.oid, 'execute');

  -- e. The site's roles cannot enter our schemas or touch our tables.
  return query
    select 'Schema open to ' || r.rolname, n.nspname::text
      from pg_catalog.pg_namespace n
      cross join (select rolname from pg_catalog.pg_roles where rolname in ('anon', 'authenticated')) r
     where (n.nspname = 'core' or n.nspname like 't\_%' or n.nspname like 'p\_%')
       and pg_catalog.has_schema_privilege(r.rolname, n.oid, 'usage');
  return query
    select 'Table open to ' || r.rolname, c.oid::regclass::text
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      cross join (select rolname from pg_catalog.pg_roles where rolname in ('anon', 'authenticated')) r
     where c.relkind in ('r', 'p')
       and (n.nspname = 'core' or n.nspname like 't\_%' or n.nspname like 'p\_%')
       and pg_catalog.has_table_privilege(r.rolname, c.oid, 'select, insert, update, delete, truncate');

  -- f. No public storage bucket.
  if pg_catalog.to_regclass('storage.buckets') is not null then
    return query execute
      'select ''Public storage bucket''::text, b.id::text from storage.buckets b where b.public';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Rights: nobody by default, then each dame_* function by name
-- ---------------------------------------------------------------------------

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
