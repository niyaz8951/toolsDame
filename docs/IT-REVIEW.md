# IT review (demo)

What a company IT reviewer asks before a first demo, what was checked, and what is still open.
Written after the department rehearsal of 2026-11-26. Honest limits are in `SECURITY.md`; how the demo
differs from the target is in `DEMO-STACK.md`.

## The rehearsal
`tests/browser/company.mjs` plays a company in a real browser against the real core SQL (on a stand-in for Supabase):

- 15 people: one IT admin; an admin and a user in each of Marketing, DX, Applied, Product team, Factory, Finance, Spare Parts.
- 14 tools: each department builds one stand-alone tool and one that keeps rows, through the builder page exactly as a person would. All 14 passed the upload check with no note. Sources: `examples/departments/`.
- 7 tables, all named `entries` on purpose, with every column type and all three sharing presets (team, private, reference).
- 1,260 tries by one department against another (every user and every admin against the other six): all refused, nothing changed.
- Then: a user raising himself, an admin doing IT's work, IT reading a department's rows, a leaver, a stranger's email, a new joiner, a space switched off, a tool deleted.

Result: 103 checks, all passed. Together with the other tests: five SQL test files and five more browser tests.
**All of this ran locally. The real Supabase project has confirmed phases 1 to 3 only; see "Not yet proven" below.**

## What IT asks, and the answer

| Question | Answer in the demo | Proof |
|---|---|---|
| Can one department see or change another's tools, rows, files, people? | No. Every function checks the caller's role on that space or tool first; the file store has its own rule. | company test: 1,260 tries |
| Do two tables with the same name mix? | No. Each tool has its own schema. | company test |
| Can a user raise his own rights? An admin act as IT? | No. | company test: 13 and 10 tries |
| Does being IT admin open every department's data? | No. IT manages people, spaces and settings. To see a department's rows IT must add itself as its admin, and that is written in the audit. | company test |
| Private rows (Finance)? | Seen by their owner only, not even by the department's admin. | company test |
| What happens to a leaver? | Switched off by IT: out at the next click, files too. Rows stay, marked as his. | company test |
| Can IT add a person directly? | Yes, by email: the address is approved in advance and the person is in at once when he signs up with it. IT never sets or sees a password, and nothing is written into the sign-in service's own tables. | `007_add_people_test.sql`, company test |
| Who can get an account? | Only addresses from the domains IT lists, and then only after IT approves. A refused address leaves no row. | `005_hardening_test.sql`, company test |
| Can uploaded code steal a session, call the internet, read another tool? | No: sealed frame, no network, no token. 33 attack tries, with control runs that prove the test notices a leak. | hostile-tool test |
| Can a tool drop a program onto a PC? | No. Files are saved by the site, only of 13 named kinds (Excel, CSV, PDF, pictures, text...), 100 MB, 20 a minute. | hostile-tool test |
| Can a tool flood the database? | Slowed to 300 requests in 10 seconds per open tool. | hostile-tool test |
| SQL injection through table or column names? | Names are checked against a pattern, looked up in the site's own list, and written with `format('%I')`. Tile admins never type SQL. | `004_tables_test.sql` |
| Is there an audit trail? | Yes, append-only: sign-ins, approvals, spaces, tools, access, tables, versions, go-lives. Row edits inside a tool are not logged (each row keeps who changed it last). | SQL tests |
| Secrets in the repo? | None. Only the project address and the publishable key, which are public by design. A test fails on anything else. | `tests/phase0.mjs` |
| Third-party code? | One library (ExcelJS 4.4.0, MIT), served from the repo, fingerprint checked. No CDN, no framework. | `tests/phase0.mjs` |

## Found and fixed in this round
1. Anyone on the internet could ask for access. Now: an email-domain list set by IT (`005_hardening.sql`).
2. Sign-ins were not in the audit. Now they are.
3. A tool could start a download of any file kind by itself. Now downloads go through the site with an allow-list; the frame lost its download right.
4. No limit on how fast a tool calls the database. Now limited.
5. A tool whose code fails showed a blank page. Now its manager sees the error in words with "Copy for the AI"; a user is told to tell the manager.
6. A two-letter department name ("DX") produced an id the database refuses. The form now suggests `dx-team`.

## Open, accepted for the first demo (sample data only)
| Gap | Why it can wait | Closed by |
|---|---|---|
| Accounts made by IT with a temporary password: IT knows it until the first sign-in; the function writes into Supabase Auth's own tables; no email means no self-service reset (IT resets with a temporary password, file 010) | Owner's decision for the demo; forced change is enforced by the database | Company sign-in on the target |
| Adding a person and the domain rule trust the email address: they are only as strong as the confirmation email | Supabase confirms email by default; the owner keeps it on | IT's sign-in on the target |
| Email + password, no company sign-in, no MFA | Stand-in by design | IT's sign-in on the target |
| Password strength is whatever the Supabase project is set to | One dashboard setting (owner step) | Owner now; IT's sign-in later |
| A manager can publish alone, no second person | Wanted later by the owner | Phase 5/6: review before live |
| A tool can draw a fake form (e.g. ask for a password) | No frame can stop drawing; the site's bar always shows the real tool name | Review before live; user guidance |
| The quota counts rows, tables and columns (file 011), not bytes or stored files | Row and text sizes are capped; no real load in a demo | Phase 6 |
| Two people saving the same row: the last one wins | Rare at demo size | Phase 6 (version check on update) |
| No export or backup from the site | Supabase keeps its own backups | Phase 6 |
| Row edits are not in the audit | Rows carry `updated_by` and `updated_at` | Target, if IT wants it |
| Files of a deleted tool stay stored (unreachable) | No leak, only space | Phase 6 |
| Pages cannot send security headers; the frame guard is a script | Limit of GitHub Pages | IT's web server |
| `github.io` is shared by all repos of the account | Owner accepted for sample data | IT's own address |
| The library on the shelf is not checked against a vulnerability list | It runs sealed, with no network and no session | Phase 6: check at each release |
| Free plan: the project pauses when unused; no uptime promise | Demo | IT hosting |
| Personal data: names and emails of staff are stored | Sample accounts for the demo | IT / data protection before real use |

## Not yet proven on the real project
- A real upload to Supabase Storage (the stand-in copies its rules; the real thing may answer differently).
- `004_tables.sql`, `005_hardening.sql`, `006_help.sql`, `007_add_people.sql`, `008_space_look.sql` and `009_new_user.sql` have not been run there. 009 is the one most tied to Supabase itself: it must be tried there before it is relied on.
- The Supabase Security Advisor after 004 and 005.
Until these three are done, "works" means "works locally".

## Added 2026-11-27: limits found while rereading the site book
The site book (`book/`, shown to IT admins only) has a new part "What a reviewer asks": threats by actor, the sharing of rights, data handling, operations. Limits recorded there for the first time, all accepted for a demo with sample data:

| Gap | Closed by |
|---|---|
| A tool's manager decides the code that acts as each user inside the tool; "private" rows do not hold against him | Review by a second person before go-live; versions are kept with who made them live |
| A manager may give his tool to any approved person, also outside his department | Audited today; a "members only" check if IT wants it |
| Removing a member of a space leaves tools given to him by name | One action that clears both; the person window lists what is left |
| A delete (row, table, tool, space) is final: no bin, no backup of the site's own | Export, IT's backups |
| Nothing has a retention period | A policy set by IT |
| A push to the repository is live with no review or staging | IT's pipeline |
| A tool's request limit sits in the shell, not in the database | A limit in the database or at IT's gateway |
| An IT admin who resets a password could sign in as that person (audited; the person is told) | Company sign-in |
| No end date on an account or an access; no regular review | End dates, a review reminder, the directory |
| The book and `docs/` are files of a public test site: shown to IT only, not locked | IT's web server, inside the company's domains |
