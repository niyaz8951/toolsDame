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

## The database
Everything is in `db/`, once: read `db/README.md`.
- A new, empty database: `psql "<connection>" -f db/install.sql`, or paste `db/01` to `db/09` into the SQL editor in number order. It refuses to run where schema `core` exists. The last result must be an empty table (`core.security_check()`), and `db/check.sql` must say `yes`.
- Is a database the final version: paste `db/check.sql`. One row, `yes` or `no`.
- Tests: any file of `tests/sql/`, pasted into the SQL editor: first row "N passed, 0 failed". Each test undoes everything it does. Then Advisors > Security: no errors.
- A change: the file of its subject in `db/` is changed, `db/check.sql` gets the new fingerprint, and the live project gets `db/upgrade.sql` (only the change), removed again by the next delivery.

## First IT admin (once)
Request access and sign in on the site, then in the SQL editor: `select core.make_first_admin('your email');`. Later IT admins are named on the IT admin page.

## People
- A leaver: IT admin > People > Switch off (press twice). He is out at his next click.
- Locked-out last IT admin: no page can fix it by design. The owner runs in the SQL editor: `update core.profiles set status = 'active', is_it = true where email = '...';` and notes it in `STATUS.md`.
- Forgotten password: Supabase dashboard > Authentication > Users > send password recovery (no page for it in the demo yet).

## Every delivery
The checklist at the end of `SECURITY.md`, then update `STATUS.md` and `CHANGELOG.md`.
