# Core SQL

Files are named `NNN_name.sql` and are pasted by the owner into the Supabase SQL editor in number order, after reading them. A file that has been run is never edited: a fix is a new file with the next number.

After every file: the result shown is an empty table (`core.security_check()` found nothing), and the Security Advisor shows no errors.

| File | What it makes | Test to paste after it |
|---|---|---|
| `001_init.sql` | Schema `core` (people, sessions, spaces, tools, roles, access, settings, audit), the `core.require_*` checks, `core.security_check()`, and the phase 1 `dame_*` functions | `tests/sql/001_core_test.sql` |
| `002_spaces_tools.sql` | Spaces and tools: create, change, on/off, delete with cleanup; admins, members, managers, access; people lookup; audit by space and by tool | `tests/sql/002_spaces_tools_test.sql` |
| `003_versions.sql` | A tool's versions (upload, preview, make live, roll back, never changed once closed), the private file store `tools` and its two rules, opening a tool | `tests/sql/003_versions_test.sql` |
| `004_tables.sql` | The table maker (tables from the site, live and preview copy, locked) and the one data service `dame_rows_*` with the three sharing presets; the people of a tool | `tests/sql/004_tables_test.sql` |
| `005_hardening.sql` | Who may ask for access (email domains), reading the settings, sign-ins in the audit | `tests/sql/005_hardening_test.sql` |

Owner only, in the SQL editor: `select core.make_first_admin('email');` (once) and `select * from core.security_check();` (any time).
