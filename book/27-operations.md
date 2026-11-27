# Running it: changes, watching, and when something goes wrong

Who can change the running site, how a change gets there, what is watched, and what to do in each kind of incident. The demo's answers are short because the demo has one operator; each has the target's answer beside it.

## The three ways the running site changes
| What changes | How | Who can | Trace | Undo |
|---|---|---|---|---|
| Platform pages, the kit, help texts and this book | A push to the main branch of the repository; GitHub Pages serves it within minutes | Whoever has write access to the repository: the owner | The repository's history | Revert the commit and push |
| The database's functions and core tables | The owner pastes a numbered file from `db/core/` into the Supabase SQL editor (a new database: `db/install/` in one go) | The owner of the Supabase project | The numbered files themselves: a file that ran is never edited | A new numbered file. Each file runs completely or not at all |
| Tools, tables, people, rights, settings | On the site, by the role that holds the right | See "Who can give what to whom" | The audit | Roll back a version; switch on again; give the right again. A delete has no undo |

There is no staging site: a change is tested locally (below), then it is live. On the target this is IT's pipeline: review, staging, then production.

## Before a change goes out
1. `node tests/phase0.mjs`: page rules, no key in the repository, the shelf's fingerprints.
2. `node tests/sql/run-local.mjs` (and with `--install`): all SQL files in a throw-away PostgreSQL, each refused a second time, every test twice; `node tests/sql/same-schema.mjs`: `db/install` and `db/core` make the same database.
3. The eight browser tests, with the hostile tool and the company rehearsal.
4. After a SQL file on the real project: its result must be an empty table (`core.security_check()`), then its test file, then the provider's Security Advisor with no errors.

## The keys and secrets that exist
| Thing | Where it is | If it leaks |
|---|---|---|
| Project address and publishable key | `kit/v1/config.js`, public | Nothing. They are public by design |
| Secret key, service-role key, database password of the project | With the owner only. In no file, no chat, no screenshot. No part of the site uses them | Rotate at once in the Supabase dashboard; note it in `docs/STATUS.md`. The site keeps working, since it never used them |
| The signing secret of the sign-in service | Inside the Supabase project | Rotate in the dashboard: every session ends, everyone signs in again |
| A person's password | As a hash in the sign-in service | IT resets it; his sessions end at once |
| Sign-in to GitHub and to Supabase | The owner's two accounts | The highest risk on this list: see "Threats, one by one". Second factor on both |

No vault is needed because the demo has no secret in use. The SQL console of the last phase would be the first thing to need one.

## What is watched today
- **By a person, on the site:** the audit (IT admin page), the Approvals tab with its red count, a tool's script errors shown to its manager.
- **By the provider:** the Supabase dashboard has its own logs of API calls, sign-ins and database errors, and the Security Advisor. Refused calls are visible there, not in our audit.
- **Not built:** a health page (per space and for IT), alerts, a count of refused attempts, usage figures, the audit forwarded to IT's log system. The health page is the next thing the owner asked for.

## When something goes wrong
| Event | First action | Then |
|---|---|---|
| A person's password may be known to someone | IT admin, People, Open, Reset password. Sessions end in the same statement | The person gets the temporary password by voice and chooses his own |
| A laptop is lost | The same reset; or the person signs in elsewhere, which ends the older session | - |
| A person must be out now | IT admin, People, Switch off (two presses) | Check the last admins of his spaces |
| A tool misbehaves or misleads | Its manager rolls back to the version before, or the space admin switches the tool off | The audit shows who made which version live. The bad version stays stored, unchanged, as evidence |
| IT must stop a tool and its admins do not answer | IT switches the **space** off (closed to all but its admins), or names itself admin of the space and switches the tool off. Both are audited | - |
| An IT admin's account is taken over | Another IT admin switches it off. The audit shows what it did | With one IT admin only: the owner in the SQL editor |
| The last IT admin is locked out | No page can fix it, by design. The owner runs one line in the SQL editor (in `docs/RUNBOOK.md`) and notes it | - |
| A bad push broke the pages | Revert the commit, push; Pages serves the old pages within minutes | Data was not touched: pages hold none |
| A bad SQL file | It either ran completely or changed nothing. A fix is the next numbered file | - |
| A secret was pasted somewhere | Rotate it at once, note it in `docs/STATUS.md` | - |
| Data was deleted by mistake | Nothing on the site brings it back | The provider's backup if the plan has one. This is the strongest reason for export and IT's backups |
| The project is paused or the provider is down | Nothing answers. Wake the project in the dashboard | No uptime promise in the demo |

## Capacity
- The demo runs on free plans: a small database, a small file store, a project that is paused when unused, a built-in mail sender that sends only a few messages an hour.
- Each space has a quota set by IT: rows in the whole space (10,000 by default), tools in the space (10), tables a tool (10), columns a table (60). A full space still reads, changes and deletes. The quota counts rows, not bytes or stored files.
- A page makes one or two calls to load. Nothing was measured under load; "How it is tested" says so.

## What the provider does, and what we rely on
| Relied on | For |
|---|---|
| The sign-in service | Hashing and checking passwords, issuing and signing tokens, limiting sign-in tries, confirmation emails |
| The data API | Turning a call into a function call with the caller's token; nothing else is exposed |
| PostgreSQL | Everything else: the checks, row security, the audit's triggers |
| The file store | Asking our function before every read and write |
| GitHub Pages | Serving the pages over HTTPS, unchanged |

Two places reach into the provider's own tables: making an account with a username, and resetting a password (files 009 and 010). They are the parts most likely to need care when the provider changes something, and they are not part of the target.

## Third-party code in the running site
| Code | Where | Licence | Kept in step by |
|---|---|---|---|
| ExcelJS 4.4.0 | The shelf, `kit/v1/lib/`; runs only inside the sealed frame | MIT | Its SHA-256 is recorded; a test fails if the file changes. No check against known flaws yet |
| Lucide icons (90 pictures) | Drawn by the site's own code | ISC | Pictures only, no code |
| Nothing else | No framework, no package, no CDN, no outside font in any page | - | - |

The tests use two tools (a PostgreSQL that runs inside Node, and a browser driver). They are installed only to run tests and are no part of the site.

## On the target, the same questions
| Question | Demo | Target |
|---|---|---|
| Who deploys | The owner pushes | IT's pipeline after review |
| Staging | None | A staging copy |
| Database changes | Pasted by the owner | Migrations run by the pipeline |
| Secrets | None in use | IT's vault |
| Logs and alerts | The audit on the site; the provider's dashboard | IT's log system, alerts |
| Backups | The plan's | IT's, with a tested restore |
| Leaver | Switched off by hand | The directory |
