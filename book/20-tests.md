# How it is tested, in detail

Rule of the project: every function has an allowed test and refused tests. Nothing is called done until its test passes.

## The layers
| Layer | Files | What it proves |
|---|---|---|
| Page rules | `tests/phase0.mjs` | Every page starts with the security policy, has no inline script, loads nothing from outside, names only the configured database; the repository holds no key but the publishable one; the shelf library's fingerprint |
| Database | `tests/sql/001..009_*_test.sql` | 899 cases over the nine SQL files. For every function: the allowed case, then signed out, pending, switched off, wrong space, wrong tool, level too low, someone else's row |
| Pages in a browser | `tests/browser/phase1..4.mjs` | The real pages driven by a real browser, at desktop width and at 390 px: sign-in, admin pages, building, uploading, data |
| Hostile tool | inside `phase3.mjs` | 33 attacks from inside a tool, all blocked |
| Company rehearsal | `tests/browser/company.mjs` | 7 departments, 15 people, 14 tools built through the builder, 1,260 cross-department attempts, leaver, stranger, joiner, new user, space off, tool deleted: over 120 checks |

## How a database test is built
- One file, pasted into the SQL editor like the SQL files, so the owner can run it on the real project.
- It makes its own people, spaces and tools with ids starting `zz`, runs every case **as that person** (it sets the session the way the data API does), and collects results.
- Then it raises an error on purpose inside a block: **everything it did is undone**. The result list is all that remains. The test checks afterwards that nothing was left behind.
- Each test also ends with `core.security_check()` empty.

## The generic refusals
The first test file loops over **every** `dame_*` function there is and calls it signed out, as a pending person and as a switched-off person. A new function is covered by that loop the day it is added: it cannot be forgotten. (One helper used only by the file store answers yes or no instead of refusing; it has its own cases.)

## How it runs without the real project
- `tests/sql/run-local.mjs` runs the nine SQL files, in order, in a PostgreSQL that runs inside the test (PGlite), checks each refuses to run twice, then runs every test twice.
- `tests/browser/mock-supabase.mjs` is a stand-in for Supabase: it runs the **real** SQL files in that local PostgreSQL and answers the same addresses (sign-in, functions, file store). The file store there honours the same two policies by asking the same database function.
- The pages are served exactly as GitHub Pages serves them, by `tools/serve.mjs`. Only the database address is swapped for the stand-in.

## What the stand-in cannot prove
> The stand-in copies Supabase's behaviour as far as we know it. Three things are only proven when run on the real project: the file store's behaviour on upload (done by the owner: works), the SQL files themselves (pasted by the owner one by one), and `009_new_user.sql`, which writes into the sign-in service's own tables.

## Control runs
A test that cannot fail proves nothing. Twice the wall was loosened on purpose (the sandbox given same-origin rights; the policy given a network address) to see the hostile-tool test fail loudly. It did. The cross-department test has a control too: the same calls by the right person succeed.

## What is not tested
- Load: many people at once.
- Other browsers than Chrome (the pages use nothing unusual, but it was not run).
- Screen readers, beyond labels and keyboard use.
- The real sign-in service's rate limits and emails.
