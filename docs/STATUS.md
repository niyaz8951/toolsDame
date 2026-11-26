# Status

## Built
**Phase 0 (2026-11-26): done, tested locally.**
- Repo skeleton: the eight pages open as placeholders, each with its security policy, hidden from search engines, no inline script.
- `kit/v1/`: theme (`dame.css`), platform bar (`shell.js`, `shell.css`), base path and config check (`api.js`), `config.js` with the demo project's URL and publishable key. `dame.js` is empty until phase 3.
- `kit/dame.schema.json`, `help/*.md` (texts only; shown from phase 5).
- `tools/serve.mjs` local server; `tests/phase0.mjs` (all checks pass).
- Docs: RUNBOOK, CHANGELOG; one row added to DEMO-STACK (no response headers on Pages).

Not yet proven: the site opening on GitHub Pages. Pages must be switched on by the owner (below).

## Next
Phase 1, on the owner's go: `db/core/001_init.sql`, sign in, request access, hub dashboard, IT admin. Before it starts, the owner answers O1-O4 in `DECISIONS.md`.

## The owner provides
1. ~~A new Supabase project; its URL and publishable key.~~ Received 2026-11-26, in `kit/v1/config.js`.
2. GitHub Pages switched on for `toolsDame`: Settings > Pages > Deploy from a branch > `main`, `/ (root)`. Then open the site and check the start page says "Database address is set".
3. `docs/IT-GUIDE.md`: the design document, downloaded as Markdown. Still missing; `README.md` points to it.
4. Answers to O1-O4 in `DECISIONS.md`.
5. On GitHub: MFA on the account; Settings > Code security > secret scanning and push protection on. On Supabase: MFA on the account.
6. A "go" for phase 1.

## Changes tools must know
None.
