-- db/install/install.sql - installs the whole DAME core into an EMPTY database
-- in one transaction: it finishes completely or changes nothing.
-- Serves: the hand-over to IT. The same end state as db/core/001..012 (the
-- files that built the demo database), proved by tests/sql/same-schema.mjs.
-- Must not change: the order of the files; a new file goes before 09_rights.sql.
--
-- Run with psql from the repo root (the \ir lines read the files next to this one):
--   psql "<connection>" -f db/install/install.sql
-- Then, once, after the first IT admin has signed in on the site:
--   select core.make_first_admin('email');
-- In a SQL editor that has no \ir (Supabase): paste 01 to 09 in number order.

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
\ir 09_rights.sql
commit;

-- Must show no rows.
select * from core.security_check();
