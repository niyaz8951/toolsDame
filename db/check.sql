-- db/check.sql - is this database the final version in db/? One row: yes or no.
-- Serves: the hand-over to IT, and the owner checking the live demo database.
-- Must not change: reads only. The fingerprint covers the names and arguments
-- of every core.* and dame_* function, every column of the core tables with
-- its type, and the keys of the site settings. When a delivery changes any of
-- these, the expected value below changes with it (tests/sql/run-local.mjs
-- fails and prints the new value).
--
-- How to run: paste into the SQL editor (or psql -f db/check.sql) and press Run.

select case when t.fingerprint = '15bd18d1d607024e5b2f2b9ed8657c93' then 'yes' else 'no' end as final_version,
       t.fingerprint, '15bd18d1d607024e5b2f2b9ed8657c93' as expected, t.parts
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
