# Status

## Built
**Phase 0 (2026-11-26): done.** Skeleton, kit, local server, docs.

**Phase 1 (2026-11-26): done, confirmed by the owner on the real project.** Sign-in, request access, approval, hub, IT admin. The owner is the first IT admin.

**Phase 2 (2026-11-26): built and tested locally. Not yet run on the real Supabase project.**
- `db/core/002_spaces_tools.sql`: spaces and tools: create, change, on/off, delete with cleanup; admins, members, managers, access; people lookup; audit by space and by tool.
- Pages: Spaces on `admin/it.html`; `space.html`; `admin/space.html`; access and audit on `admin/tool.html`.
- Tests, all passing locally: `tests/sql/002_spaces_tools_test.sql` (131 cases), `tests/sql/001_core_test.sql` (238 cases with the new functions), `tests/browser/phase1.mjs`, `tests/browser/phase2.mjs`, `tests/phase0.mjs`.

A tile of a tool opens `tool.html`, which is still a placeholder: running a tool is phase 3.

## The owner does now, in this order
1. **SQL editor:** paste all of `db/core/002_spaces_tools.sql`, Run. The result must be an empty table.
2. **SQL editor:** paste all of `tests/sql/002_spaces_tools_test.sql`, Run. First row must read "131 passed, 0 failed". It undoes everything it does.
3. **On the site** (reload first; press Ctrl+F5 if the page looks unchanged): IT admin > Spaces > New space. Type a name, press "Choose myself", Create space.
4. Press "Open its admin page". Create a tool. Open the space from the hub: the tool is a tile.
5. Optional, to see the walls: request access with a second email, approve it, add it to the space, sign in as that person in a private window.
6. **Supabase > Advisors > Security:** no errors. Send any warning text.

If a step fails, send the exact message on screen.

## Still needed from the owner
- O1: in each other repo of the account, Settings > Pages > Source "None" (unless it has its own custom domain). Decision recorded in `DECISIONS.md`.
- `docs/IT-GUIDE.md`.
- MFA on GitHub and Supabase; secret scanning and push protection on for the repo.
- A "go" for phase 3 after steps 1-4 pass.

## Next
Phase 3: the shell and the sealed frame, kit v1 (`dame.js`), upload to Storage, versions, preview, Make live, roll back. Test: a hostile tool cannot read a token, reach the network, the shell or another tool.

## Changes tools must know
None.
