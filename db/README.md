# The database

This folder is **the whole DAME database, once**: every table in its final form and every function once, sorted by subject. It is what IT reads, reviews and runs to build a database. There is no other copy and no history of steps to replay.

## The files

| File | What it makes |
|---|---|
| `install.sql` | Runs 01 to 09 in one transaction with psql: it finishes completely or changes nothing |
| `check.sql` | Asks a database whether it is this final version: one row, yes or no (reads only) |
| `01_base.sql` | Checks that the database is empty; schema `core`; default rights taken away; small helpers (id rule, levels, refusals, text cleaning); the two trigger functions |
| `02_tables.sql` | All 16 tables of `core` in their final form, indexes, triggers, the six default settings; row security on and forced on every table, no policies, no rights |
| `03_access.sql` | The audit and the `core.require_*` checks (who is calling; space and tool roles; a person's level on a tool). `core.can_admin_space` is the one place that says an IT admin acts as admin of every space |
| `04_people.sql` | Sign-in, access requests, accounts, temporary passwords, the IT admin's People, site settings, the whole audit |
| `05_spaces_tools.sql` | Spaces and tools: create, change, on/off, delete with cleanup; admins, members, managers, access; usage guide; finding people; audit of a space or tool |
| `06_releases.sql` | Versions of a tool (upload, seal, preview, make live, roll back), the private file bucket `tools` and its two policies, opening a tool |
| `07_data.sql` | The table maker and the one data service (`dame_rows_*`) with the three sharing presets |
| `08_quotas.sql` | The four limits per space (rows, tools, tables, columns), requests and answers |
| `09_rights.sql` | `core.make_first_admin`, `core.security_check`, and the rights: each `dame_*` function granted by name |

In numbers: 16 tables, 123 functions (72 `dame_*` functions, the API; 51 `core.*` helpers), 2 storage policies, 6 settings.

## How to run

Into an **empty** database only. `01_base.sql` refuses to run where schema `core` exists, so it can never damage a database in use.

With psql, from the repo root:
```
psql "<connection>" -f db/install.sql
```
The last result must be an empty table (`core.security_check()` found nothing). Then `db/check.sql` must say `yes`.

In a SQL editor without `\ir` (for example a fresh Supabase project): paste `01` to `09` in number order, then run `select * from core.security_check();`. Do not open the site before `09` has run.

Then, once, after the first IT admin has signed in on the site:
```
select core.make_first_admin('email');
```

### What the database must have first

Supabase has all of this. On a plain PostgreSQL (tested on 16 and 17), IT provides it first; `tests/sql/local-shim.sql` shows the smallest stand-in, used by the tests.

| Needed | Used by | In the target (company sign-in) |
|---|---|---|
| Roles `anon` (signed out) and `authenticated` (signed in) | rights in `09_rights.sql` | The API's two roles |
| `auth.jwt()` and `auth.uid()`: the claims of the signed-in person (`sub`, `role`, `session_id`, `email`) | `core.require_login`, `core.peek_user`, `dame_request_access` | Read the company token instead |
| `auth.users`, `auth.identities`, `auth.sessions` | the functions marked SUPABASE below | Not needed: company sign-in owns passwords |
| `extensions.crypt`, `extensions.gen_salt` (pgcrypto in schema `extensions`) | temporary passwords | Not needed |
| `storage.buckets`, `storage.objects` with row security | `06_releases.sql` | The company file store; same rule as `dame_file_allowed` |

## What IT replaces (the demo's stand-ins)

Every function that touches Supabase itself says so in its comment, on a line starting `SUPABASE:`. These are the only places to change for company sign-in and a company file store; nothing else reads `auth.*` or `storage.*`.

| Function | File | Touches |
|---|---|---|
| `core.require_login` | 03 | `auth.jwt()`, `auth.uid()` |
| `core.peek_user` | 03 | `auth.jwt()`, `auth.uid()` |
| `dame_request_access` | 04 | `auth.jwt()`, `auth.users` |
| `dame_password_done` | 04 | `auth.users`, `extensions.crypt` |
| `dame_password_changed` | 04 | `auth.users` |
| `dame_user_create` | 04 | writes `auth.users`, `auth.identities` |
| `dame_user_password_reset` | 04 | writes `auth.users`, deletes from `auth.sessions` |
| `dame_version_seal` | 06 | `storage.objects` |
| bucket `tools`, policies `dame_tools_read`, `dame_tools_write` | 06 | `storage.buckets`, `storage.objects` |
| `core.security_check` (part f) | 09 | `storage.buckets` (skipped when absent) |

With company sign-in, `dame_user_create`, `dame_user_password_reset`, `dame_password_done` and `dame_password_changed` are not needed at all (DEMO-STACK.md).

## Is a database the final version?

Paste `db/check.sql` into the SQL editor (or `psql -f db/check.sql`). It takes a fingerprint of every `core.*` and `dame_*` function (name and arguments), every column of the core tables with its type, and the keys of the site settings, and compares it with the fingerprint of this folder. One row: `yes` or `no`. It reads only.

Use it on the live demo before the hand-over: `yes` means the live database is exactly what these files make, so its data can move as it is (below).

## How these files were made, and the proof

On 2026-11-27 the twelve numbered files that had built the demo step by step (`001_init.sql` to `012_tools_quota.sql`) were folded into these nine: each of the 24 functions that a later file had replaced written once, in the version the live database runs; the columns added later put into their `create table` in the same order with the same constraint names; the rights given once; comments rewritten to say what each function does now. Function bodies were copied character for character.

The two ways were then built and compared object by object (every column, constraint, index, trigger, policy, function with its whole code, right, row security, setting and the bucket): identical, also as `pg_dump --schema-only` on a real PostgreSQL 16 server, and every SQL test passed on both. The twelve files were then removed; they are in the repository's history (commit `eaada5f`) for anyone who needs them.

Today's proof, at every delivery:
```
npm install --no-save @electric-sql/pglite      (once; a test tool only)
node tests/sql/run-local.mjs
```
It builds the database from `install.sql`, checks it refuses to run twice, checks `check.sql` says `yes`, and runs every test file in `tests/sql/` twice (1,253 cases).

## Moving the demo's data

The tables are the same, column for column, so the data copies over as it is:
1. On the live demo, `db/check.sql` says `yes`. Build the new database with `db/install.sql`.
2. Copy the rows of the `core` tables (for example `pg_dump --data-only --schema=core` from the demo, restored as a role that bypasses row security). The audit only takes new rows, so copy it into the empty new table.
3. Copy each tool's schemas `t_<space>__<tool>` and `p_<space>__<tool>` whole (structure and rows: `pg_dump --schema='t_*' --schema='p_*'`). They match `core.tool_tables`, which came over in step 2.
4. Copy the files of bucket `tools` (paths `<space>/<tool>/<version>/<page>`). Each version's fingerprints are in `core.tool_versions.files`; `dame_version_seal` checked them once.
5. Run `select * from core.security_check();`: no rows.

## A change from now on

1. Change the file of the subject in this folder, so that it stays the final version.
2. Put the new fingerprint into `check.sql` (`run-local.mjs` fails and prints it).
3. For a database that already runs (the live demo), the delivery brings one more file, `db/upgrade.sql`: only the change, refusing to run twice, ending with `check.sql`'s question. Before it ships it is tested on a database built from the version before. Once it has run on the live project, the next delivery removes it. So `db/` never holds the database twice.
