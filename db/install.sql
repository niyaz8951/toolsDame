-- db/install.sql - installs the whole DAME core into an EMPTY database
-- in one transaction: it finishes completely or changes nothing.
-- Serves: the hand-over to IT; all seven contracts of docs/BEDROCK.md.
-- Must not change: the order of the files; a new file goes before 10_rights.sql.
-- db/check.sql afterwards says whether a database is this final version.
--
-- Run with psql from the repo root (the \ir lines read the files next to this one):
--   psql "<connection>" -f db/install.sql
-- Then, once, after the first IT admin has signed in on the site:
--   select core.make_first_admin('email');
-- In a SQL editor that has no \ir (Supabase): paste 01 to 10 in number order,
-- then run select * from core.security_check();

\set ON_ERROR_STOP on
begin;
\ir 01_base.sql
\ir 02_tables.sql
\ir 03_access.sql
\ir 04_people.sql
\ir 05_spaces_tools.sql
\ir 06_releases.sql
\ir 07_data.sql
\ir 08_quotas.sql
\ir 09_relay.sql
\ir 10_rights.sql
commit;

-- Must show no rows.
select * from core.security_check();
