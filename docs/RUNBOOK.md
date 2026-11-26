# Runbook (demo)

How to run, check and deliver. Grows with each phase; the hand-over notes for IT come in phase 6.

## Open the site on your computer
Needs Node.js 18 or newer. Nothing to install.
```
node tools/serve.mjs
```
Open `http://127.0.0.1:8080/toolsDame/`. Stop with Ctrl+C.

## Run the checks
```
node tests/phase0.mjs
```
"All checks passed" and nothing marked FAIL.

## Switch on GitHub Pages (once)
1. Repo > Settings > Pages.
2. Source: Deploy from a branch. Branch: `main`, folder `/ (root)`. Save.
3. Wait a minute or two, then open the address Pages shows.
4. The start page must show the DAME bar and "Database address is set".

## The Supabase project
- Only the project URL and the publishable key are written down, in `kit/v1/config.js`.
- The secret key, service role key and database password stay with the owner. Never in a file, a chat or a screenshot. If one leaks: rotate it at once in Supabase and note it in `STATUS.md`.

## Core SQL (from phase 1)
Files `db/core/NNN_*.sql` are pasted by the owner into the Supabase SQL editor, in number order, after reading them. After each file: `select * from core.security_check();` returns no rows, and the Security Advisor shows no errors.

## Every delivery
The checklist at the end of `SECURITY.md`, then update `STATUS.md` and `CHANGELOG.md`.
