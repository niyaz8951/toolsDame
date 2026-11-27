# Core SQL (history of the demo database)

**For a new database use `db/install/`**: the same database in one clean set of files, every function once in its final version, proved identical to these twelve files by `tests/sql/same-schema.mjs`. The files below are the record of how the live demo database was built, step by step; many functions in them are replaced by a later file.

Files are named `NNN_name.sql` and are pasted by the owner into the Supabase SQL editor in number order, after reading them. A file that has been run is never edited: a fix is a new file with the next number.

After every file: the result shown is an empty table (`core.security_check()` found nothing), and the Security Advisor shows no errors.

| File | What it makes | Test to paste after it |
|---|---|---|
| `001_init.sql` | Schema `core` (people, sessions, spaces, tools, roles, access, settings, audit), the `core.require_*` checks, `core.security_check()`, and the phase 1 `dame_*` functions | `tests/sql/001_core_test.sql` |
| `002_spaces_tools.sql` | Spaces and tools: create, change, on/off, delete with cleanup; admins, members, managers, access; people lookup; audit by space and by tool | `tests/sql/002_spaces_tools_test.sql` |
| `003_versions.sql` | A tool's versions (upload, preview, make live, roll back, never changed once closed), the private file store `tools` and its two rules, opening a tool | `tests/sql/003_versions_test.sql` |
| `004_tables.sql` | The table maker (tables from the site, live and preview copy, locked) and the one data service `dame_rows_*` with the three sharing presets; the people of a tool | `tests/sql/004_tables_test.sql` |
| `005_hardening.sql` | Who may ask for access (email domains), reading the settings, sign-ins in the audit | `tests/sql/005_hardening_test.sql` |
| `006_help.sql` | The usage guide of a tool: who reads it, who writes it | `tests/sql/006_help_test.sql` |
| `007_add_people.sql` | An IT admin adds a person by email; that person is in at once when he signs up | `tests/sql/007_add_people_test.sql` |
| `008_space_look.sql` | Icon and colour of a space, changed by its admins and by IT | `tests/sql/008_space_look_test.sql` |
| `009_new_user.sql` | An IT admin makes an account with a username and a temporary password; nothing opens until the person chose his own | `tests/sql/009_new_user_test.sql` |
| `010_accounts.sql` | Accounts: a person's own account page (work details, access, sign-ins, changing the password); IT opens a person, corrects the account and resets a password with a temporary one; a temporary password counts 7 days and must be shown again before anything opens | `tests/sql/010_accounts_test.sql` |
| `011_quotas.sql` | Quotas: rows in a space, tables in a tool, columns in a table; the site's default and a space's own limits set by IT; a space admin's request for more and IT's answer; the row count kept by the row service | `tests/sql/011_quotas_test.sql` |
| `012_tools_quota.sql` | A fourth quota: tools in a space (default 10), enforced when a tool is made; set, asked for and answered with the other three | `tests/sql/012_tools_quota_test.sql` |

A change from now on: a new file here for the live demo **and** the same change in `db/install/`, in the same delivery; `node tests/sql/same-schema.mjs` fails until both agree.

Owner only, in the SQL editor: `select core.make_first_admin('email');` (once) and `select * from core.security_check();` (any time).
