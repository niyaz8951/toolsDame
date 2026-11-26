# Status

## Built
**Phase 0 (2026-11-26): done.** Skeleton, kit, local server, docs.

**Phase 1 (2026-11-26): built and tested locally. Not yet run on the real Supabase project.**
- `db/core/001_init.sql`: schema `core`, the `core.require_*` checks, `core.security_check()`, and the functions `dame_site_info`, `dame_request_access`, `dame_me`, `dame_sign_out`, `dame_spaces_list`, `dame_users_list`, `dame_user_set_status`, `dame_user_set_it`, `dame_setting_set`, `dame_audit_list`.
- Pages: `index.html` (sign in, request access, waiting), `hub.html` (spaces as tiles; empty until phase 2), `admin/it.html` (approvals, people, AI setting, audit).
- Tests, all passing locally: `tests/sql/001_core_test.sql` (133 cases), `tests/browser/phase1.mjs` (desktop and 390 px), `tests/phase0.mjs`.

What local tests cannot prove: that the real project answers like the stand-in. The owner's first sign-in is that proof (steps below). If a step fails, send the exact message on screen.

## The owner does now, in this order
1. ~~GitHub Pages on.~~ Done 2026-11-26.
2. **Supabase > Authentication > URL Configuration > Site URL:** the address Pages shows for this site (it ends in `/toolsDame/`). Without it the confirmation email links to the wrong place.
3. **Supabase > Project Settings > Data API > Exposed schemas:** only `public`. Remove `graphql_public` if listed.
4. **SQL editor:** paste all of `db/core/001_init.sql`, Run. The result must be an empty table.
5. **SQL editor:** paste all of `tests/sql/001_core_test.sql`, Run. First row must read "133 passed, 0 failed".
6. **On the site:** Request access with your work email, open the link in the email, sign in. You see "Waiting for approval".
7. **SQL editor:** `select core.make_first_admin('your email');`
8. **On the site:** press Check again. You land on the hub; open IT admin.
9. **Supabase > Advisors > Security:** no errors. Send any warning text.
10. MFA on GitHub and Supabase; secret scanning and push protection on for the repo.

## Still needed from the owner
- O1: in each other repo of the account, Settings > Pages > Source "None" (unless it has its own custom domain). Decision recorded in `DECISIONS.md`.
- `docs/IT-GUIDE.md`.
- A "go" for phase 2 after steps 1-9 pass.

## Next
Phase 2: spaces and tools: create, admins, managers, access, on/off, delete with cleanup (`db/core/002_*.sql`, `space.html`, `admin/space.html`, the Spaces part of `admin/it.html`).

## Changes tools must know
None.
