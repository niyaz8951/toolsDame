# Tests

| File | Proves | Run |
|---|---|---|
| `phase0.mjs` | Every page opens; page rules hold; no key, password or account name in the repo; the sealed-frame policy; building blocks, starter kit and blocks page agree; shelf libraries are the recorded files | `node tests/phase0.mjs` |
| `sql/001_core_test.sql` | Every `dame_*` function: allowed and refused cases (signed out, pending, disabled, no request, level too low, other session), audit append-only, security check | Paste into the Supabase SQL editor. Leaves nothing behind. |
| `sql/002_spaces_tools_test.sql` | Phase 2: an admin acts alone inside his space; every action outside it, and every action above a manager's or member's role, is refused; last admin; ids never reused; delete with cleanup | Paste into the Supabase SQL editor. Leaves nothing behind. |
| `sql/003_versions_test.sql` | Phase 3: who may upload, what an upload may hold, the file rules for every role, preview for managers only, make live, roll back, a closed version never changes | Paste into the Supabase SQL editor. Leaves nothing behind. |
| `sql/004_tables_test.sql` | Phase 4: who may make a table, what a table may be, injection tries, the three presets for every level, values that do not fit, filters and sorting, the preview's own rows, adding a column, deleting | Paste into the Supabase SQL editor. Leaves nothing behind. |
| `sql/005_hardening_test.sql` | Who may ask for access by email domain, the setting's rules, sign-ins in the audit | Paste into the Supabase SQL editor. Leaves nothing behind. |
| `sql/006_help_test.sql` | Who reads and who writes a tool's usage guide; it is stored as plain text | Paste into the Supabase SQL editor. Leaves nothing behind. |
| `sql/007_add_people_test.sql` | Who may add a person; bad addresses; the added person is in at once, everyone else as before | Paste into the Supabase SQL editor. Leaves nothing behind. |
| `sql/008_space_look_test.sql` | Who may change a space's icon and colour; what a colour may be | Paste into the Supabase SQL editor. Leaves nothing behind. |
| `sql/run-local.mjs` | The same SQL and tests on a throw-away database, twice | `node tests/sql/run-local.mjs` |
| `browser/phase1.mjs` | Sign in, request access, approval, hub, IT admin in a real browser at desktop and 390 px, against `browser/mock-supabase.mjs` | `node tests/browser/phase1.mjs` |
| `browser/phase2.mjs` | Spaces and tools in a real browser at desktop and 390 px: IT admin, space admin, manager, member, each refused outside his part | `node tests/browser/phase2.mjs` |
| `browser/phase3.mjs` | Upload checks, upload from files, a zip and pasted code, the starter kit and fix request, preview, make live, roll back, a changed stored page is refused, the reference tool reading and writing real Excel files inside the frame, the building blocks page, and **the hostile-tool test** (`browser/fixtures/hostile/`) | `node tests/browser/phase3.mjs` |
| `browser/phase4.mjs` | The test space; a stand-alone tool and a tool that saves rows, both built from ready-made pages; tables made by one press and by the form; people of every level using the tracker; what a tool's own code cannot do | `node tests/browser/phase4.mjs` |
| `browser/company.mjs` | The rehearsal: seven departments, 14 tools built through the builder, every user and admin against the other six departments, leaver, stranger, joiner, space off, tool deleted | `node tests/browser/company.mjs` |

The two Node tests need, once: `npm install --no-save @electric-sql/pglite playwright-core` (test tools only; the site itself uses no package). The stand-in server copies how Supabase answers; it is not proof that the real project is set up right.

To come: each phase's own SQL and browser tests. The hostile tool only ever gets more attempts. A later phase adds checks; it never removes one.
