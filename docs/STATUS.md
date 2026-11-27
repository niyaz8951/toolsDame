# Status

## Built
**Phase 0 (2026-11-26): done.** Skeleton, kit, local server, docs.

**Phase 1 (2026-11-26): done, confirmed by the owner on the real project.** Sign-in, request access, approval, hub, IT admin.

**Phase 2 (2026-11-26): done, confirmed by the owner on the real project.** Spaces and tools.

**Phase 3 and 3b (2026-11-26): SQL run by the owner; pages work on the real project. A real upload to the file store is not yet confirmed.** The sealed frame, versions, the guided builder, building blocks, the shelf.

**Phase 4 (2026-11-26): built and tested locally. Not yet run on the real Supabase project.** Tables from the site, the one data service, the test space.

**Hardening and the department rehearsal (2026-11-26): built and tested locally. Not yet run on the real project.**
- Who may ask for access (email domains), sign-ins in the audit.
- Downloads through the site with an allow-list; a request limit per tool; script errors shown to the tool's manager.
- The builder: "I already have a page", plain HTML styled like the site, "Open the preview" and "Make live" right after the upload.
- `tests/browser/company.mjs`: seven departments, 14 tools, 1,176 cross-department tries, all refused. Write-up: `docs/IT-REVIEW.md`.
- The builder is a guide: two choices ("Use a ready-made page" was removed on 2026-11-27), then one step at a time; a database question in plain words; every link a button; pages load about twice as fast.
- The look of the DAME hub: palette, mark, movement, a day and night button that tools follow.
- The information button on every page, a usage guide per tool, IT adds a person by email.
- A review window for the database tables of an uploaded page (add columns before they are made); colour and icon of a space.
- New user with username and temporary password; the site book (`book.html`).
- The finish: one-line bar with an account button, admin pages as tabs (one part at a time, kept in the address), a tool's managers and delete folded, finger-sized targets, notch-safe pages, plain dates. No SQL.
- IT admin, Spaces: "Add a space" on top, one tile per space, and a window per space where it is changed or deleted. No SQL.
- Space admin, Tools: the same way ("Add a tool", a tile per tool, a window per tool). Icons picked from 90 pictures. Back buttons lead to the page the person came from. No SQL.
- **Accounts (2026-11-27): built and tested locally.** My account (details, password, access, sign-ins); IT's person window (correct, reset password, switch off, role); a temporary password counts 7 days and must be shown again to finish.
- **IT admin reaches every space and tool (2026-11-27): built and tested locally. Needs `db/upgrade.sql` on the live project.** IT acts as admin of every space; opening a tool it is not named in is audited; private rows stay with their owner.
- **Quotas (2026-11-27): built and tested locally.** Per space: 10,000 rows, 10 tools, 10 tables a tool, 60 columns a table by default. IT admin, Quotas: "Change the default", a tile per space, limits and requests in the space's window. Space admin, Quota: what is used, a warning from 80%, "Ask IT for more".
- The fix request for a refused page is one complete text (points, rules, database rules, the page); a design of its own and data outside the tables stop the upload. No SQL.
- **The site book (2026-11-27):** shown to IT admins only (hub card and book page); stays in `book/`. In pictures: a 5-minute chapter of eleven slides, seven kinds of picture drawn from text (`:::kind` blocks), topic nodes, laser, spotlight and pen while presenting. Reread against the repo: 28 chapters in four parts, with a new part "What a reviewer asks" (threats, sharing of rights, data handling, running it). No SQL.
- **One database, final version (2026-11-27): `db/`.** Nine files by subject plus `install.sql` (one transaction) and `check.sql` (is a database this version? yes or no). Every function once, every table in its final form, the ten Supabase stand-ins marked `SUPABASE:`. Proved identical to the twelve step files that built the demo before they were removed (they are in the repository's history). The pages lost the "not switched on yet" branches that only served a half-built database. Read `db/README.md`.
- **The Data page as a sheet (2026-11-27): built and tested locally. Needs `db/upgrade.sql` on the live project.** Each table drawn like a spreadsheet with made-up example rows (saved rows are never shown), "+ Column" at the end, an x on each column to remove it after typing its name (new `dame_table_drop_column`), the five site columns on request, a new table drawn as it is typed, and a request for the AI after each change.
- Tests, all passing locally: thirteen SQL test files by subject (1,306 cases) on the database built from `db/`, eight browser tests, the hostile-tool test (33 attempts).

**What is most likely to need a fix on the real project:** the first real upload to Supabase Storage (step 6 below). Locally the file store is a stand-in. If "Upload as a new version" fails, send the exact message on screen.

## The owner does now, in this order
0. **SQL editor of the live Supabase project:** paste all of `db/upgrade.sql`, Run. The security check must show no rows and the last result must say `yes`. (It gives IT admins every space and tool, and adds removing a column if the last upgrade did not run yet.) Then paste `tests/sql/spaces_tools_test.sql`, Run: first row "... passed, 0 failed". On the site (Ctrl+F5) as IT admin: the hub shows every space.
1. **SQL editor:** paste all of `db/check.sql`, Run.
   - `yes`: the live database is the final version. Go on with step 2.
   - `no`: send the row. The live project missed some of the earlier step files. Either I send one `db/upgrade.sql` for exactly what it misses, or, since the demo holds sample data only, start a fresh Supabase project and run `db/01` to `db/09` there (then `select core.make_first_admin('your email');`).
2. **SQL editor:** paste any test file of `tests/sql/` (for example `accounts_test.sql`), Run. First row: "... passed, 0 failed". The tests undo everything they do.
3. **On the site** (Ctrl+F5 first), three things to try: (a) the round button top right > **My account**: save a job title, then change your password; (b) IT admin > Add a person > **New user**, make a trial account; People > **Open** it > **Generate** > **Reset password** twice; (c) in a private window sign in as the trial account with that temporary password and choose a new one. If (b) or (c) fails, send the exact message: these write into Supabase's own sign-in tables. IT admin > **Quotas**: press a tile, set its rows to 100, **Save these limits**, then **Back to the site's default** twice.
4. **On the site** (Ctrl+F5 first): IT admin > Site settings > **Who may ask for access**: type the work email domain(s), Save. Empty means anyone may ask.
5. IT admin > Spaces > **Make a test space**, press its tile, then **Open its admin page**.
6. Press the **Converter** tile, then "Build and access", **I already have a page**, choose `examples/converter/index.html` from the repo, **Next: upload**, **Upload as a new version**, then **Make live** twice. Open it from the hub.
7. Press the **Tracker** tile, "Build and access", **Build a new page** (or bring a page that declares its tables), **Create the tables**, **Next: upload**, **Upload as a new version**, **Open the preview**, add a row; back on the admin page **Make live** twice. Open it from the hub and add a real row.
8. Optional, a real department tool: make a space, a tool, and upload any file from `examples/departments/`.
9. **Supabase > Authentication:** set the minimum password length to 12.
10. **Supabase > Advisors > Security:** no errors. Send any warning text.

If a step fails, send the exact message on screen.

## With every delivery
A change to the database: change the file of its subject in `db/`, put the new fingerprint in `db/check.sql`, and bring `db/upgrade.sql` (only the change) for the live project; `node tests/sql/run-local.mjs` must pass. The next delivery after it ran removes `db/upgrade.sql`.

Besides this file and the changelog: update the chapter of the site book the change touches (`book/*.md`) and add a line to `book/10-notes.md`.

**Rule for database use (owner, 2026-11-27):** the database is for what people enter and what must be checked per person. What the site is made of (pages, kit, help, the book) stays a file, because IT moves the whole site to its own servers and domains. Do not put site content into tables.

## Still needed from the owner
- `docs/IT-GUIDE.md`.
- MFA on GitHub and Supabase; secret scanning and push protection on for the repo.
- A "go" for health (per space and for IT), which the owner put before phase 5, or for phase 5.

## Next
Phase 5: on every page the info icon, pinned notes, ideas with votes, and the AI prompt setting; the tool's help text; a space admin tightening the AI setting.

Later, noted (ranked in `docs/IT-REVIEW.md`): a second person approving before Make live; a quota by size and for stored files; a version check when two people save the same row; export; charts as a built-in block of the kit (no library); file columns and `Dame.files`; old `.xls` files; renaming or retyping a column; two pasted code blocks merged.

## Changes tools must know
**From the quotas (2026-11-27):** `Dame.table(...).add` can fail with the code `quota_full` when the space has used its rows; the message says what to do, so a tool that shows `error.message` (as the starter kit asks) needs no change. A tool may have 10 tables by default (before: 30); existing tables stay.

**From 2026-11-27 the check refuses** (before: noted) own colours, pop-up boxes (`alert`, `confirm`, `prompt`), a call to a server, cookies, a changed `--dame-` variable other than `--dame-accent`, and more than 3000 characters of own styles. Live versions are not touched; the rule applies at the next upload.

Additions only: `Dame.table` now works, `Dame.people()`, the `dame-tables` block that declares a tool's tables. From this delivery: `Dame.download` saves only these kinds of file: xlsx, xlsm, csv, txt, json, pdf, png, jpg, jpeg, docx, pptx, xml, md.
