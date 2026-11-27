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

## All checks before a delivery
```
npm install --no-save @electric-sql/pglite playwright-core     (once; test tools only)
node tests/phase0.mjs
node tests/sql/run-local.mjs
node tests/sql/run-local.mjs --install
node tests/sql/same-schema.mjs
node tests/browser/phase1.mjs
node tests/browser/phase2.mjs
node tests/browser/phase3.mjs     (includes the hostile-tool test)
node tests/browser/phase4.mjs
node tests/browser/accounts.mjs
node tests/browser/quotas.mjs
node tests/browser/company.mjs    (the rehearsal)
```

## Switch on GitHub Pages (once)
1. Repo > Settings > Pages.
2. Source: Deploy from a branch. Branch: `main`, folder `/ (root)`. Save.
3. Wait a minute or two, then open the address Pages shows.
4. The start page must show the DAME bar and "Database address is set".

## The Supabase project
- Only the project URL and the publishable key are written down, in `kit/v1/config.js`.
- The secret key, service role key and database password stay with the owner. Never in a file, a chat or a screenshot. If one leaks: rotate it at once in Supabase and note it in `STATUS.md`.

## Supabase settings (once)
- Authentication > URL Configuration > Site URL: the Pages address of this site.
- Data API settings > Exposed schemas: only `public`.
- Optional, stronger: Authentication > password settings > minimum length 12 (the page already asks for 12).

## Core SQL
Files `db/core/NNN_*.sql` are pasted by the owner into the Supabase SQL editor, in number order, after reading them. Each file ends by showing `core.security_check()`: it must be an empty table. Then paste the matching `tests/sql/NNN_*_test.sql`: first row "N passed, 0 failed". The test undoes everything it does. Then Advisors > Security: no errors.

A new database (IT, or a fresh Supabase project): not the numbered files but `db/install/`, in one go: `psql "<connection>" -f db/install/install.sql`, or paste `01` to `09` in order. It refuses to run where schema `core` exists. Read `db/install/README.md` first.

A change to the database is written twice in the same delivery: a new `db/core/NNN_*.sql` for the live demo and the same change in `db/install/`. `node tests/sql/same-schema.mjs` must pass.

## First IT admin (once)
Request access and sign in on the site, then in the SQL editor: `select core.make_first_admin('your email');`. Later IT admins are named on the IT admin page.

## People
- A leaver: IT admin > People > Switch off (press twice). He is out at his next click.
- Locked-out last IT admin: no page can fix it by design. The owner runs in the SQL editor: `update core.profiles set status = 'active', is_it = true where email = '...';` and notes it in `STATUS.md`.
- Forgotten password: Supabase dashboard > Authentication > Users > send password recovery (no page for it in the demo yet).

## Every delivery
The checklist at the end of `SECURITY.md`, then update `STATUS.md` and `CHANGELOG.md`.
