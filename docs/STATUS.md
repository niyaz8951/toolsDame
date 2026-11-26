# Status

## Built
**Phase 0 (2026-11-26): done.** Skeleton, kit, local server, docs.

**Phase 1 (2026-11-26): done, confirmed by the owner on the real project.** Sign-in, request access, approval, hub, IT admin.

**Phase 2 (2026-11-26): done, confirmed by the owner on the real project.** Spaces and tools.

**Phase 3 (2026-11-26): SQL run by the owner; the tool admin page works on the real project. Uploading a version to the real file store is not yet confirmed.**

**Phase 3b (2026-11-26): built and tested locally. No SQL.**
- The guided builder: describe > starter kit for the AI > paste the answer > the site checks and writes the fix request > upload > preview > make live.
- Building blocks in `dame.css` (shown on `blocks.html`), kit functions for files and long work, the library shelf with ExcelJS, the reference tool `examples/parts-extractor/`.
- Tests, all passing locally: phase 0 checks, three SQL files, four browser tests at desktop and 390 px, the hostile-tool test.

**What is most likely to need a fix on the real project:** the first real upload to Supabase Storage. Locally the file store is a stand-in that obeys the database's own file rules. If "Upload as a new version" fails, send the exact message on screen.

A tool cannot save rows yet: tables are phase 4.

## The owner does now, in this order
No SQL this time.
1. Reload the site with Ctrl+F5.
2. Open the tile "Spare Parts Extractor": it shows "is not built yet" and a button **Build this tool**.
3. In step 3 of the builder, under "Or, for a tool made of several files", choose the one file `examples/parts-extractor/index.html` from the repo. The check must pass.
4. Press **Upload as a new version**, then **Open the preview**. Choose one or two parts-list workbooks (.xlsx), press Extract, download the result.
5. Press **Make live** twice in the Versions list. Open the tool from the hub.
6. Try the full path on another tile: write two lines in step 1, press **Copy the starter kit**, give it to the AI, paste the answer in step 3.

If a step fails, send the exact message on screen.

## Still needed from the owner
- `docs/IT-GUIDE.md`.
- MFA on GitHub and Supabase; secret scanning and push protection on for the repo.
- A "go" for phase 4.

## Next
Phase 4: the table builder and the Data page, `dame.json`, the one data service (`dame_rows_*`), the three sharing presets, and the starter kit taught to use them. With it, a "tracker" needs no AI at all: name the columns and the site makes the tool. Test: a tracker saves shared rows; every refused case fails correctly.

Later, noted: a second person approving before Make live; the description of step 1 kept in the database; old `.xls` files.

## Changes tools must know
Additions only: the building blocks of `dame.css`, `Dame.drop`, `Dame.download`, `Dame.progress`, `Dame.pause`, the shelf line for a library.
