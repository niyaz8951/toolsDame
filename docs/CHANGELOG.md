# Changelog

Newest first. One entry per delivery: what changed, what the owner must do.

## 2026-11-26 - Phase 1: sign-in, approval, hub, IT admin
Added
- `db/core/001_init.sql`: schema `core`, require-checks, security check, ten `dame_*` functions.
- `index.html` + `pages/index.js`: sign in, request access, waiting and switched-off screens.
- `hub.html` + `pages/hub.js`: the caller's spaces as tiles (none until phase 2), IT admin card.
- `admin/it.html` + `pages/admin-it.js`: approve, refuse, switch off and on, IT admin role, AI setting, audit.
- `kit/v1/api.js`: sign-in, session (kept in the browser, renewed, 12 hours), `DameApi.rpc`. `kit/v1/shell.js`: user and Sign out in the bar, page guard.
- Tests: `tests/sql/001_core_test.sql`, `tests/sql/run-local.mjs`, `tests/browser/phase1.mjs` with `mock-supabase.mjs`.

Changed
- Every page's security policy now names the one database address. `tests/phase0.mjs` checks it equals `config.js`.
- `kit/v1/dame.css`: one addition, `[hidden]` always hides (contract 4: additions only).
- `tools/serve.mjs`: optional rewrite hook, used by tests only.
- DECISIONS: O2-O4 decided, O1 restated, phase 1 choices listed. DEMO-STACK: two rows (session, email proof).

SQL to paste, in order: `db/core/001_init.sql`, then `tests/sql/001_core_test.sql`.
Owner: the ten steps in `STATUS.md`.

## 2026-11-26 - Phase 0: skeleton
Added
- Pages (placeholders): `index.html`, `hub.html`, `space.html`, `tool.html`, `frame.html`, `admin/it.html`, `admin/space.html`, `admin/tool.html`.
- `kit/v1/`: `dame.css`, `dame.js` (empty), `shell.js`, `shell.css`, `api.js`, `config.js`, `icon.svg`, `README.md`.
- `kit/dame.schema.json`; `help/` texts for the seven hub pages.
- `tools/serve.mjs`; `tests/phase0.mjs`.
- `docs/RUNBOOK.md`, this file. `.nojekyll` so GitHub Pages serves every file as it is.
- Seed docs as supplied: BEDROCK, DEMO-STACK, SECURITY, DECISIONS, STATUS, kit texts, README, PROJECT-INSTRUCTIONS.

Decided in this delivery
- `kit/v1/shell.css` is a new file beside the planned layout: hub-only classes (`hub-*`) stay out of `dame.css`, so they never become part of the promise to tools.
- The base path comes from the address of `api.js` at run time. No page, script or doc holds the account name; the test refuses it.
- Hub pages refuse to run inside a frame by script, because Pages cannot send the header for it (row added to DEMO-STACK).
- `api.js` refuses a secret or service key if one is ever put in `config.js` and says so on the start page.

SQL to paste: none.
Owner: switch on Pages; answer O1-O4 in `DECISIONS.md`; supply `docs/IT-GUIDE.md`.
