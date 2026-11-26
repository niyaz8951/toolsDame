# Status

## Built
**Phase 0 (2026-11-26): done.** Skeleton, kit, local server, docs.

**Phase 1 (2026-11-26): done, confirmed by the owner on the real project.** Sign-in, request access, approval, hub, IT admin.

**Phase 2 (2026-11-26): done, confirmed by the owner on the real project.** Spaces and tools.

**Phase 3 and 3b (2026-11-26): SQL run by the owner; pages work on the real project. A real upload to the file store is not yet confirmed.** The sealed frame, versions, the guided builder, building blocks, the shelf.

**Phase 4 (2026-11-26): built and tested locally. Not yet run on the real Supabase project.**
- `db/core/004_tables.sql`: tables made from the site and the one data service.
- The Data section and "Create the tables" on the tool admin page; a list-and-form tool without AI; the test space.
- Tests, all passing locally: four SQL test files, five browser tests at desktop and 390 px, the hostile-tool test.

**What is most likely to need a fix on the real project:** the first real upload to Supabase Storage (step 4 below). Locally the file store is a stand-in. If "Upload as a new version" fails, send the exact message on screen.

## The owner does now, in this order
1. **SQL editor:** paste all of `db/core/004_tables.sql`, Run. The result must be an empty table.
2. **SQL editor:** paste all of `tests/sql/004_tables_test.sql`, Run. First row: "... passed, 0 failed".
3. **On the site** (Ctrl+F5 first): IT admin > Spaces > **Make the test space**, then **Open the test space's admin page**.

Stand-alone sub tile:
4. On **Converter** press "Build and access". In step 3 press **Load it** (the converter is chosen). The check passes. Press **Upload as a new version**, then **Make live** twice in the Versions list. Open it from the hub.

Sub tile with a database table:
5. On **Tracker** press "Build and access". In step 3 press **Load it** (the tracker is chosen).
6. Step 4 lists the table the page needs. Press **Create the tables**. Scroll to **Data**: the table `bids` is there.
7. Press **Upload as a new version**, **Open the preview**, add a row. Back on the admin page, Data shows "1 in the preview" and "0 rows".
8. Press **Make live** twice. Open the Tracker from the hub and add a real row.
9. To see the levels: approve a second account, give it the Tracker at "read" (Access on the tool admin page), sign in as it in a private window: it sees the rows and has no form.

10. **Supabase > Advisors > Security:** no errors. Send any warning text.

If a step fails, send the exact message on screen.

## Still needed from the owner
- `docs/IT-GUIDE.md`.
- MFA on GitHub and Supabase; secret scanning and push protection on for the repo.
- A "go" for phase 5.

## Next
Phase 5: on every page the info icon, pinned notes, ideas with votes, and the AI prompt setting; the tool's help text; a space admin tightening the AI setting.

Still open from the walk as a basic user (not built yet):
- "I already have a page": a conversion kit that includes the person's page.
- Script errors inside a tool shown to its manager in the preview, with "copy for the AI".
- Plain HTML styled like the site by default; a note when a page uses no building block.
- After upload, "Open the preview" and "Make live" right where the person is.
- Files chosen without their folders matched by name; two pasted code blocks merged.
- Charts: a built-in chart block or a library on the shelf (owner to choose).

Later, noted: a second person approving before Make live; file columns and `Dame.files`; old `.xls` files; renaming or removing a column; quotas (phase 6).

## Changes tools must know
Additions only: `Dame.table` now works, `Dame.people()`, the `dame-tables` block that declares a tool's tables.
