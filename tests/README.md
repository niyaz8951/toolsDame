# Tests

| File | Proves | Run |
|---|---|---|
| `phase0.mjs` | Every page opens; page rules hold; no key, password or account name in the repo | `node tests/phase0.mjs` |
| `sql/001_core_test.sql` | Every `dame_*` function: allowed and refused cases (signed out, pending, disabled, no request, level too low, other session), audit append-only, security check | Paste into the Supabase SQL editor. Leaves nothing behind. |
| `sql/run-local.mjs` | The same SQL and tests on a throw-away database, twice | `node tests/sql/run-local.mjs` |
| `browser/phase1.mjs` | Sign in, request access, approval, hub, IT admin in a real browser at desktop and 390 px, against `browser/mock-supabase.mjs` | `node tests/browser/phase1.mjs` |

The two Node tests need, once: `npm install --no-save @electric-sql/pglite playwright-core` (test tools only; the site itself uses no package). The stand-in server copies how Supabase answers; it is not proof that the real project is set up right.

To come: the hostile-tool test (phase 3) and each phase's own SQL and browser tests. A later phase adds checks; it never removes one.
