# The database, in detail

The database is the wall. Everything else on the site is convenience.

## What can be reached from outside
- The data API exposes one schema, `public`, and `public` holds **only functions named `dame_*`**: 58 of them. No table, no view, no sequence.
- All real data is in other schemas (`core`, and one per tool). The site's database roles (`anon`, `authenticated`) have no right to enter those schemas or touch their tables.
- A visitor who is not signed in can run exactly one function, `dame_site_info`.

So the complete list of things the internet can ask this database to do is a list of 58 named functions. That list is in the access chapter.

## The rules every function follows
1. `security definer`: it runs with the rights of its owner, not of the caller. That is the only way anything reaches a table.
2. `set search_path = ''`: every name inside is written in full (`core.profiles`, `pg_catalog.now()`), so nobody can slip a look-alike table or function in front of the real one.
3. The first thing it does is a `core.require_*` check. Before that line, nothing has been read.
4. `revoke ... from public, anon`; then `grant execute ... to authenticated`, function by function. Each SQL file ends by setting these rights again for **all** `dame_*` functions, so a new function can never be left open by forgetting.
5. Values from the caller are passed as parameters, never glued into SQL text.

## Row security
- Row level security is **enabled and forced** on every table: the core tables and every table a tool makes.
- There are no policies on them (the file store is the one exception, below). Forced row security with no policy means: nobody reads or writes a row except through a function that runs as the owner.
- This is a second lock behind the first: even if a right on a table were granted by mistake, the rows would stay closed.

## Schemas and names
| Schema | Holds |
|---|---|
| `public` | The `dame_*` functions and nothing else |
| `core` | The site's own tables and its helper functions (`core.require_*`, `core.tool_level`, `core.audit_add`, ...) |
| `t_<space>__<tool>` | The live tables of one tool. Dashes in ids become underscores |
| `p_<space>__<tool>` | The same tables, empty copy for the preview |

A space id and a tool id together may have 59 characters, because a schema name may have 63.

## How refusals travel
- `core.fail(code, sentence, http)` raises an error whose detail is a short code (`signed_out`, `session_ended`, `pending`, `disabled`, `must_change`, `no_profile`, `not_allowed`, `bad_request`, `not_live`) and whose message is a plain sentence.
- The data API turns it into the HTTP status the function asked for (401, 403, 400).
- The page reads the code to decide what to do (for example: back to the start page) and shows the sentence to the person as written. No technical text reaches a person.

## How the database is changed
- Core SQL lives in numbered files, `db/core/001_init.sql` to `009_new_user.sql`. The owner reads a file, pastes it into the Supabase SQL editor and runs it. Nobody else pastes SQL, ever.
- Each file is one transaction: it finishes completely or changes nothing.
- Each file first checks that the file before it was run and that it was **not** already run itself, and stops with a sentence if not.
- A file that was run is never edited. A correction is a new file. So the files in the repository are the exact history of the database.
- Each file ends with `select * from core.security_check();` which must show no rows.

## core.security_check()
It returns one row for each of these problems:
- a table of ours without forced row security;
- anything in `public` that is not a `dame_*` function;
- a `dame_*` function that does not run as its owner with an empty search path;
- a function that a signed-out visitor can run, other than `dame_site_info`;
- a site role that can enter our schemas or touch our tables;
- a public file bucket.

The local tests run it after every file and after every test. Empty every time.

## Where SQL is built at run time
Only in two places: the table maker and the row service. Both follow the same three steps: the name is checked against a pattern (`^[a-z][a-z0-9_]{1,40}$`), looked up in the site's own list (`core.tool_tables`), and written into the statement with `format('%I')`, which quotes it as a name. A table or column the site did not record cannot be named at all.

## Why this way
- **Functions only** makes the API small enough to read in an afternoon, and makes "what can a signed-in person do" a finite list.
- **Empty search path** closes a classic way to hijack owner-rights functions.
- **Numbered, never-edited files** give IT an exact, replayable history, and make "what is running" answerable from the repository.

## Considered and not done
- **Exposing tables with row policies** (the usual Supabase way): quicker to build, but every table, column and policy becomes API surface, and tables made by tile admins would each need generated policies. Rejected.
- **Migrations run by a pipeline**: needs a secret in a pipeline. For a demo, the owner pasting a file he has read is safer. The target has a pipeline.
- **One database per space**: the target design. In the demo, separation is by schema and by the function checks.
