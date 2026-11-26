# Core SQL

Files are named `NNN_name.sql` and are pasted by the owner into the Supabase SQL editor in number order, after reading them. A file that has been run is never edited: a fix is a new file with the next number.

After every file: the result shown is an empty table (`core.security_check()` found nothing), and the Security Advisor shows no errors.

| File | What it makes | Test to paste after it |
|---|---|---|
| `001_init.sql` | Schema `core` (people, sessions, spaces, tools, roles, access, settings, audit), the `core.require_*` checks, `core.security_check()`, and the phase 1 `dame_*` functions | `tests/sql/001_core_test.sql` |

Owner only, in the SQL editor: `select core.make_first_admin('email');` (once) and `select * from core.security_check();` (any time).
