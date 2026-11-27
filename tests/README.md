# Tests

| File | Proves | Run |
|---|---|---|
| `phase0.mjs` | Every page opens; page rules hold; no key, password or account name in the repo; the sealed-frame policy; building blocks, starter kit and blocks page agree; shelf libraries are the recorded files | `node tests/phase0.mjs` |
| `sql/core_test.sql` | Every sign-in, people and IT admin function: allowed and refused cases (signed out, pending, disabled, no request, level too low, other session), audit append-only, security check | Paste into the SQL editor of a database built from `db/`. Leaves nothing behind. |
| `sql/spaces_tools_test.sql` | An admin acts alone inside his space; every action outside it, and every action above a manager's or member's role, is refused; last admin; ids never reused; delete with cleanup | The same |
| `sql/releases_test.sql` | Who may upload, what an upload may hold, the file rules for every role, preview for managers only, make live, roll back, a closed version never changes | The same |
| `sql/data_test.sql` | Who may make a table, what a table may be, injection tries, the three presets for every level, values that do not fit, filters and sorting, the preview's own rows, adding a column, deleting | The same |
| `sql/access_requests_test.sql` | Who may ask for access by email domain, the setting's rules, sign-ins in the audit | The same |
| `sql/tool_help_test.sql` | Who reads and who writes a tool's usage guide; it is stored as plain text | The same |
| `sql/add_people_test.sql` | Who may add a person; bad addresses; the added person is in at once, everyone else as before | The same |
| `sql/space_look_test.sql` | Who may change a space's icon and colour; what a colour may be | The same |
| `sql/new_user_test.sql` | Who may make an account; usernames and temporary passwords that are refused; everything is refused until the person chose his own password | The same |
| `sql/accounts_test.sql` | A person reads and changes only his own account; IT opens, corrects and resets; a reset ends the sessions and opens nothing without the temporary password, not even for someone who changed the password behind IT's back; 7 days | The same |
| `sql/quotas_test.sql` | The limits at work (row 101 refused, also in the preview and in another tool of the space; a full space still reads, changes and deletes), who sees a quota, only IT sets it, only a space admin asks, nobody grants his own request, the count put right, the audit | The same |
| `sql/tools_quota_test.sql` | Tool 11 refused, only IT sets the tools limit, asking and granting with tools, a limit below what is there deletes nothing, calls that leave the tools number out | The same |
| `sql/run-local.mjs` | Builds the database from `db/install.sql` on a throw-away PostgreSQL, checks it refuses to run twice and that `db/check.sql` says yes, then runs every test file twice | `node tests/sql/run-local.mjs` |
| `browser/parts.mjs` | Helper used by every browser test: before an action it presses the tab and opens the fold the element sits in, as a person does | (not run alone) |
| `browser/phase1.mjs` | Sign in, request access, approval, hub, IT admin in a real browser at desktop and 390 px, against `browser/mock-supabase.mjs` | `node tests/browser/phase1.mjs` |
| `browser/phase2.mjs` | Spaces and tools in a real browser at desktop and 390 px: IT admin, space admin, manager, member, each refused outside his part | `node tests/browser/phase2.mjs` |
| `browser/phase3.mjs` | Upload checks, upload from files, a zip and pasted code, the starter kit, the complete fix request (rules, database rules and the page inside it), a stand-alone page with its own design and storage refused, preview, make live, roll back, a changed stored page is refused, the reference tool reading and writing real Excel files inside the frame, the building blocks page, and **the hostile-tool test** (`browser/fixtures/hostile/`) | `node tests/browser/phase3.mjs` |
| `browser/phase4.mjs` | The test space; a stand-alone tool and a tool that saves rows, both built through "I already have a page" from the example pages in the repo; tables made by one press and by the form; people of every level using the tracker; what a tool's own code cannot do | `node tests/browser/phase4.mjs` |
| `browser/accounts.mjs` | My account at desktop and 390 px: details, changing the password, access, sign-ins; IT's person window; a reset from both sides; a stolen sign-in; a temporary password that is too old; no password kept in the browser | `node tests/browser/accounts.mjs` |
| `browser/quotas.mjs` | Quotas at desktop and 390 px: the space admin's Quota part, a space filling up, asking IT, IT's tiles and windows (grant less than asked, decline, own limits, the default), hostile text in a reason | `node tests/browser/quotas.mjs` |
| `browser/company.mjs` | The rehearsal: seven departments, 14 tools built through the builder, every user and admin against the other six departments, leaver, stranger, joiner, space off, tool deleted; the site book read and presented by IT, and not opened for a user or a department admin | `node tests/browser/company.mjs` |

The two Node tests need, once: `npm install --no-save @electric-sql/pglite playwright-core` (test tools only; the site itself uses no package). The stand-in server copies how Supabase answers; it is not proof that the real project is set up right.

To come: each phase's own SQL and browser tests. The hostile tool only ever gets more attempts. A later phase adds checks; it never removes one.
