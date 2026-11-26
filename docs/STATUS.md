# Status

## Built
**Phase 0 (2026-11-26): done.** Skeleton, kit, local server, docs.

**Phase 1 (2026-11-26): done, confirmed by the owner on the real project.** Sign-in, request access, approval, hub, IT admin.

**Phase 2 (2026-11-26): built and tested locally. The owner has not yet confirmed it on the real project.** Spaces and tools: `db/core/002_spaces_tools.sql`.

**Phase 3 (2026-11-26): built and tested locally. Not yet run on the real Supabase project.**
- `db/core/003_versions.sql`: versions, the private file store `tools`, opening a tool.
- `tool.html` runs a tool in the sealed frame; `kit/v1/dame.js` is kit v1; `admin/tool.html` uploads, previews, makes live and rolls back.
- `examples/hello-tool/`: a first tool to upload.
- Tests, all passing locally: three SQL test files, four browser tests at desktop and 390 px, the hostile-tool test (30+ attempts, all blocked; it fails when the wall is loosened).

**What is most likely to need a fix on the real project:** the file store. Locally it is a stand-in that obeys the database's own file rules; the real Supabase Storage has not been touched yet. If uploading a version or opening a tool fails, send the exact message on screen.

A tool cannot save rows yet: tables are phase 4.

## The owner does now, in this order
Phase 2 first, if not done yet:
1. **SQL editor:** paste all of `db/core/002_spaces_tools.sql`, Run. Empty table.
2. **SQL editor:** paste all of `tests/sql/002_spaces_tools_test.sql`, Run. First row: "... passed, 0 failed".

Then phase 3:
3. **SQL editor:** paste all of `db/core/003_versions.sql`, Run. Empty table.
4. **SQL editor:** paste all of `tests/sql/003_versions_test.sql`, Run. First row: "... passed, 0 failed".
5. **Supabase > Storage:** a bucket named `tools` is listed and is not public.
6. **On the site** (Ctrl+F5 first): IT admin > Spaces > New space > "Choose myself" > Create space > "Open its admin page" > create a tool > "Access and files".
7. **Upload:** download the four files of `examples/hello-tool/` from the repo, choose all four together, press Upload version.
8. Press "Open the preview": the tool greets you by name. Go back, press Make live twice, open the tool from the hub.
9. **Supabase > Advisors > Security:** no errors. Send any warning text.

## Still needed from the owner
- `docs/IT-GUIDE.md`.
- MFA on GitHub and Supabase; secret scanning and push protection on for the repo.
- A "go" for phase 4 after steps 1-8 pass.

## Next
Phase 4: the table builder and the Data page, `dame.json`, the one data service (`dame_rows_*`), the three sharing presets. Test: a tracker built with the AI prompt saves shared rows; every refused case fails correctly.

## Changes tools must know
None. Kit v1 is as written in `docs/BEDROCK.md`.
