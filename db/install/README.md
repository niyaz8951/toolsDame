# Database install (final version, for IT)

This folder is **the whole DAME database in one clean set of files**: every table in its final form and every function once, in its latest version, sorted by subject. It is what IT reads, reviews and runs to build a new database.

It makes **exactly the same database** as the twelve numbered files in `db/core/` that built the demo, run one after the other. This is proved by a test (below), not just claimed.

| Folder | What it is | Who uses it |
|---|---|---|
| `db/install/` (this one) | The final version. One definition of everything. | IT, for a new, empty database |
| `db/core/001..012` | The history: the files that built the live demo database, step by step, in the order they were written. Many functions there are replaced by a later file. Kept as the record; never edited. | The owner, for the live demo only |

## The files

| File | What it makes |
|---|---|
| `install.sql` | Runs 01 to 09 in one transaction with psql: it finishes completely or changes nothing |
| `01_base.sql` | Checks that the database is empty; schema `core`; default rights taken away; small helpers (id rule, levels, refusals, text cleaning); the two trigger functions |
| `02_tables.sql` | All 16 tables of `core` in their final form, indexes, triggers, the six default settings; row security on and forced on every table, no policies, no rights |
| `03_access.sql` | The audit and the `core.require_*` checks (who is calling; space and tool roles; a person's level on a tool) |
| `04_people.sql` | Sign-in, access requests, accounts, temporary passwords, the IT admin's People, site settings, the whole audit |
| `05_spaces_tools.sql` | Spaces and tools: create, change, on/off, delete with cleanup; admins, members, managers, access; usage guide; finding people; audit of a space or tool |
| `06_releases.sql` | Versions of a tool (upload, seal, preview, make live, roll back), the private file bucket `tools` and its two policies, opening a tool |
| `07_data.sql` | The table maker and the one data service (`dame_rows_*`) with the three sharing presets |
| `08_quotas.sql` | The four limits per space (rows, tools, tables, columns), requests and answers |
| `09_rights.sql` | `core.make_first_admin`, `core.security_check`, and the rights: each `dame_*` function granted by name |

In numbers: 16 tables, 120 functions (71 `dame_*` functions, the API; 49 `core.*` helpers), 2 storage policies, 6 settings.

## How to run

Into an **empty** database only. `01_base.sql` refuses to run where schema `core` exists, so it can never damage the live demo.

With psql, from the repo root:
```
psql "<connection>" -f db/install/install.sql
```
The last result must be an empty table (`core.security_check()` found nothing).

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

## How the tidy-up was done, and what did not change

Done:
- Each of the 24 functions that a later file replaced (`dame_request_access` had five versions) is written once, in the version the live database runs.
- The columns added later (`alter table ... add column` in 003, 006, 009, 010, 012) are in the `create table` itself, **in the same column order**, with the same constraint names.
- The "Rights" block that ended every file runs once, at the end.
- Comments say what a function does now, not "as in 004" or "new in 010". Function bodies are copied character for character.
- `create function` in place of `create or replace function`: on an empty database nothing may be replaced by accident.

Left out, because an empty database has no rows to fix: the one-time data fixes of 010 (password fingerprints and dates of accounts that existed then), 011 (counting the rows already there) and 012 (requests that waited before the tools limit).

Not changed: any rule, check, message, right or behaviour. The site, the kit and the tools need nothing.

## The proof

```
npm install --no-save @electric-sql/pglite      (once; a test tool only)
node tests/sql/same-schema.mjs                  the two databases are the same
node tests/sql/run-local.mjs --install          the 12 test files pass on db/install
node tests/sql/run-local.mjs                    and still pass on db/core/001..012
```

`same-schema.mjs` builds one throw-away database from `db/core/001..012` and one from `db/install`, then compares them object by object: every column (order, type, default, not null), constraint, index, trigger, policy, function (its whole code, rights and settings), row security, rights on schemas and tables, default rights, settings and the bucket. One difference fails it. It was also run on a real PostgreSQL 16 server with `pg_dump --schema-only` of both: the dumps are identical, and all 12 test files (1,253 cases) pass on both.

## Moving the demo's data

The tables are the same, column for column, so the data copies over as it is:
1. Build the new database with `install.sql`.
2. Copy the rows of the `core` tables (for example `pg_dump --data-only --schema=core` from the demo, restored as a role that bypasses row security). The audit only takes new rows, so copy it into the empty new table.
3. Copy each tool's schemas `t_<space>__<tool>` and `p_<space>__<tool>` whole (structure and rows: `pg_dump --schema='t_*' --schema='p_*'`). They match `core.tool_tables`, which came over in step 2.
4. Copy the files of bucket `tools` (paths `<space>/<tool>/<version>/<page>`). Each version's fingerprints are in `core.tool_versions.files`; `dame_version_seal` checked them once.
5. Run `select * from core.security_check();`: no rows.

## From now on

A change to the database is made twice, in the same delivery:
1. a new numbered file `db/core/013_...sql` for the live demo (files that ran are never edited), and
2. the same change folded into the right file here.

`tests/sql/same-schema.mjs` fails until both say the same thing.
