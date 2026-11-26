# Status

## Built
**Phase 0 (2026-11-26): done.** Skeleton, kit, local server, docs.

**Phase 1 (2026-11-26): done, confirmed by the owner on the real project.** Sign-in, request access, approval, hub, IT admin.

**Phase 2 (2026-11-26): done, confirmed by the owner on the real project.** Spaces and tools.

**Phase 3 and 3b (2026-11-26): SQL run by the owner; pages work on the real project. A real upload to the file store is not yet confirmed.** The sealed frame, versions, the guided builder, building blocks, the shelf.

**Phase 4 (2026-11-26): built and tested locally. Not yet run on the real Supabase project.** Tables from the site, the one data service, the test space.

**Hardening and the department rehearsal (2026-11-26): built and tested locally. Not yet run on the real project.**
- `db/core/005_hardening.sql`: who may ask for access (email domains), sign-ins in the audit.
- Downloads through the site with an allow-list; a request limit per tool; script errors shown to the tool's manager.
- The builder: "I already have a page", plain HTML styled like the site, "Open the preview" and "Make live" right after the upload.
- `tests/browser/company.mjs`: seven departments, 14 tools, 1,176 cross-department tries, all refused. Write-up: `docs/IT-REVIEW.md`.
- The builder is a guide: three choices, then one step at a time; a database question in plain words; every link a button; pages load about twice as fast.
- The look of the DAME hub: palette, mark, movement, a day and night button that tools follow.
- The information button on every page, a usage guide per tool (`006_help.sql`), IT adds a person by email (`007_add_people.sql`).
- Tests, all passing locally: seven SQL test files, six browser tests, the hostile-tool test (33 attempts).

**What is most likely to need a fix on the real project:** the first real upload to Supabase Storage (step 6 below). Locally the file store is a stand-in. If "Upload as a new version" fails, send the exact message on screen.

## The owner does now, in this order
1. **SQL editor:** paste all of `db/core/004_tables.sql`, Run. The result must be an empty table.
2. **SQL editor:** paste all of `tests/sql/004_tables_test.sql`, Run. First row: "... passed, 0 failed".
3. **SQL editor:** the same with `db/core/005_hardening.sql`, then `tests/sql/005_hardening_test.sql`.
   Then the same with `006_help.sql` + `006_help_test.sql`, and `007_add_people.sql` + `007_add_people_test.sql`.
4. **On the site** (Ctrl+F5 first): IT admin > Site settings > **Who may ask for access**: type the work email domain(s), Save. Empty means anyone may ask.
5. IT admin > Spaces > **Make the test space**, then **Open the test space's admin page**.
6. On **Converter**: "Build and access", **Use a ready-made page**, **Use it**, **Next: upload**, **Upload as a new version**, then **Make live** twice. Open it from the hub.
7. On **Tracker**: **Use a ready-made page**, **Use it**, **Create the tables**, **Next: upload**, **Upload as a new version**, **Open the preview**, add a row; back on the admin page **Make live** twice. Open it from the hub and add a real row.
8. Optional, a real department tool: make a space, a tool, and upload any file from `examples/departments/`.
9. **Supabase > Authentication:** set the minimum password length to 12.
10. **Supabase > Advisors > Security:** no errors. Send any warning text.

If a step fails, send the exact message on screen.

## Still needed from the owner
- `docs/IT-GUIDE.md`.
- MFA on GitHub and Supabase; secret scanning and push protection on for the repo.
- A "go" for phase 5.

## Next
Phase 5: on every page the info icon, pinned notes, ideas with votes, and the AI prompt setting; the tool's help text; a space admin tightening the AI setting.

Later, noted (ranked in `docs/IT-REVIEW.md`): a second person approving before Make live; quotas; a version check when two people save the same row; export; charts as a built-in block of the kit (no library); file columns and `Dame.files`; old `.xls` files; renaming or removing a column; two pasted code blocks merged.

## Changes tools must know
Additions only: `Dame.table` now works, `Dame.people()`, the `dame-tables` block that declares a tool's tables. From this delivery: `Dame.download` saves only these kinds of file: xlsx, xlsm, csv, txt, json, pdf, png, jpg, jpeg, docx, pptx, xml, md.
