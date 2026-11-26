# Uploads and versions, in detail

Contract 6: upload, check, preview, make live, roll back. A version never changes.

=> Announce | Send the files | Close | Preview | Live

## What is stored
- Only pages (`.html`). Before upload the browser **packs** each page: style sheets, scripts, pictures and fonts are written into the page itself. A tool of one file stays one file; a tool of many files becomes one file per page.
- Path in the private bucket `tools`: `<space>/<tool>/<version>/<page>.html`.
- `core.tool_versions` holds one row per version: number, state, who, when, a note, and the list of pages with name, size and SHA-256 fingerprint.
- `core.tools` holds two pointers: `live_version` and `preview_version`.

## An upload, step by step
1. **Check, in the browser.** The hidden helper page `pack.html` reads the files, packs them and runs the checks (the builder chapter lists them). The admin page itself never touches the inside of an upload.
2. **Announce.** `dame_version_begin(space, tool, note, files)` (tool manager only). The database checks: 1 to 50 pages, legal page names, an `index.html`, 20 MB a page, 200 MB in all. It creates the version in state `uploading`.
3. **Send.** The browser puts each page into the file store. The store asks the database for every file (see below).
4. **Close.** `dame_version_seal` turns the version to `ready` and makes it the preview. From here nothing in it can change.
5. **Try.** Managers open the preview. People still get the old live version.
6. **Make live.** `dame_version_make_live` moves the live pointer. Two presses on the page.
7. **Roll back** is "make live" of an older version. Every version is kept.

## The file store's rule
The bucket is private. Two policies exist, both a single question to the database, `dame_file_allowed(path, action)`:
- **Read**: the caller manages the tool; or the version is `ready`, is the tool's live version, and the caller has the tool.
- **Write**: the caller manages the tool, the version is still `uploading`, he is the one who began it, and the file name is one that was announced.
- There is **no policy for change or delete**. A stored file can never be replaced or removed from the site.

So a person who knows the exact path of another department's file still gets nothing, and a manager cannot swap a page after the version was closed.

## Why a fingerprint as well
The file store and the database are two systems. The fingerprint recorded at announce time ties them together: the shell runs a page only if its bytes still hash to that value. A file changed by any other route would simply not run.

## The preview
- Only managers and the space's admins can open it.
- It has its own empty copy of every table (`p_<space>__<tool>`), so trying a new version never touches real rows.
- In the preview a manager may do everything, to be able to test every level's buttons.

## Switching off and deleting
- A tool switched off: closed to its people at once, open to its managers and the space admins.
- A space switched off by IT: closed to everyone but its admins.
- Deleting a tool: its id typed in full, checked again in the database. Its rows in the core go, its two schemas with all tables are dropped, its id is retired forever.
- **Limit:** the stored files of a deleted tool stay in the bucket, unreachable (no rule allows reading them). Clearing them is part of the last phase.

## Why this way
- **Immutable versions** make "what exactly did people run on that day" answerable, and make roll back instant and safe.
- **Preview before live** means a mistake is seen by its maker first.
- **Packing in the browser** keeps the store to one kind of file and lets the frame forbid every network call, since a page needs nothing from outside.

## Considered and not done
- **Storing scripts, styles and pictures as separate files**: the sealed frame would then need a way to load them, which means a hole in the policy. Rejected.
- **Letting a version be patched**: rejected; a fix is a new version.
- **A second person approving before go-live**: wanted, planned, not built. Today a manager can publish alone; the frame is what limits the damage.
