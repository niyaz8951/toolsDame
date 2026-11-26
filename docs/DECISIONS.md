# Decisions

## Owner, for the demo (2026-11-26)
- Demonstration on GitHub Pages + Supabase; IT takes it from there.
- Repo `toolsDame`, from scratch.
- Hub > Space (department) > Tool. Space admin is super user of his space.
- Tile admins create tools, upload HTML and create tables from the site; no repo, no SQL.
- Every page: info icon, notes, ideas, AI prompt by site setting.

## Owner, 2026-11-26 (answers to O1-O4)
| # | Decided | How it is built |
|---|---|---|
| O2 | "Anything is fine for now." | One session per person, 12 hours, enforced in `core` (`core.sessions`, checked by every `core.require_*`). Holds on any Supabase plan. |
| O3 | "Proceed with what works, optimise later." | The exact project address is written in each page's security policy and in `config.js`; `tests/phase0.mjs` fails if they differ. Changing the project means editing those lines; a helper script can come later. |
| O4 | "Keep the default; IT will bring its own." | Supabase's default: a new account must open the link in a confirmation email before it can sign in, then waits for an IT admin. Limit: the built-in sender allows only a few emails an hour. |

## Owner, 2026-11-26 (O1, closed)
- The account's other repos (the earlier DAME hub and others) are separate projects and stay as they are, Pages included.
- Accepted risk for the demo: GitHub serves every Pages site of one account from one address, so a script on any of those sites could read a signed-in DAME session kept in the browser. Condition: sample data only (already the rule in DEMO-STACK).
- IT's platform has its own address, so the risk does not carry over.

## Built in phase 1 (say if any should change)
- A tool is named by its space and its id together: `core.require_tool(space, tool, level)`, `core.has_tool(user, space, tool, level)`. Tool ids are unique inside a space, not across the site.
- An IT admin is not a member of any space by being IT admin (BEDROCK roles table). He sees a space on the hub only if he is its admin or member.
- Nobody changes his own account or role; switching an account off also removes its IT admin role and ends its session at once.
- Refusing a waiting account switches it off (it can be switched on later). Accounts are never deleted.
- The first IT admin is made once by the owner in the SQL editor: `select core.make_first_admin('email');`. It refuses when an IT admin exists.
- Page scripts live in `pages/` (one per page), beside the planned layout.

## Built in phase 2 (say if any should change)
- **An IT admin may name himself admin of a space.** BEDROCK says nobody raises himself; an IT admin can already name anyone, and with one person on the site the demo could not start otherwise. It is written to the audit. Stricter choice for IT: forbid it, so two people are always needed.
- A space id and a tool id together may have 59 characters at most, because the tool's database name (`t_<space>__<tool>`) may have 63.
- "People in this space" (members) is its own list. A member sees the space and gets the tools marked "open to the space", nothing else. A person given one tool by name sees the space too, with that tool only.
- A space switched off by IT stays open to its admins (to repair it) and closed to everyone else. A tool switched off stays open to its managers and the space admins.
- "The last admin cannot be removed" counts only approved accounts: an admin whose account is switched off does not count.
- Deleting needs the id typed in full, on the page and again in the database. Phase 2 deletes the core rows; files and tables are added to the same delete in phases 3 and 4.
- People are looked up by name or email (at least 2 letters, 20 results, approved accounts only) by IT admins, space admins and tool managers. Members cannot look people up.
- Not built yet from the Roles table: a space admin tightening site settings for his space. It belongs with the AI prompt in phase 5.

## Built in phase 3 (say if any should change)
- An upload is three steps: announce the pages (name, size, fingerprint), send the files, close the version. A closed version can never change: the database refuses it and the file store has no rule that allows a change or a delete.
- A new version becomes the preview by itself. Make live and Roll back need two presses. Roll back is "Make live" of an older version; all versions are kept.
- Only pages (`.html`) are stored. The browser packs style sheets, scripts, pictures and fonts into each page before upload.
- The tool gets `{ id, name, level }` from `Dame.ready()` and nothing else about the user.
- A tool moves between its own pages by plain links (`<a href="other.html">`); the kit and the shell do the rest.
- Files are read and packed in a hidden helper page (`pack.html`), so the admin page itself never touches what is inside an upload.
- `Dame.table` and `Dame.files` exist and answer "arrives in phase 4" until then.
- `examples/hello-tool/` is a first tool to upload.

## Owner, 2026-11-26 (phase 3b: one website from many teams)
- A small shelf of approved libraries, provided by the platform. Yes.
- Different teams and very basic users build tools with AI. The site must say exactly what is needed when a tile is made, hand out a starter kit for the AI, and do the hard work itself.
- Security is never weakened for convenience.
- A second person approving before "Make live": later.

## Built in phase 3b (say if any should change)
- **One file per tool.** A tool is one `index.html`. The person pastes the AI's answer into a box; the site makes the file. Several files or a zip remain possible for people who build that way.
- **The starter kit** is one text made by the site for each tool: the rules, the building blocks, the kit's functions, the chosen libraries, a starting page with the tool's name, and the person's description. It holds no address, key, token or person. It is copied or downloaded and given to the approved AI.
- **The site fixes what it can and explains the rest.** It adds the two kit lines itself, removes a page's own security policy and icons, and ignores the words an AI writes around the code. What it cannot fix it lists in plain words, and it writes the fix request for the AI.
- **The checks hold the look:** a tool's own `<header>`, `<nav>`, `<footer>`, a password field, own fonts, outside files, frames, workers and unknown libraries stop the upload. Own colours and pop-up boxes are noted, not stopped.
- **No background workers.** Not allowing them keeps the wall as it was. Long work is done in steps with `await Dame.pause()` and a progress bar. The reference tool was rewritten that way.
- **The shelf** (`kit/v1/lib/`): first library ExcelJS 4.4.0 (MIT), the publisher's file byte for byte, fingerprint recorded and tested. It reads and writes `.xlsx`, not the old `.xls`. SheetJS was not used: its current version is not published where this build can fetch it, and the version that is has known flaws.
- **Building blocks**: `dame.css` grew from 9 to about 40 classes (additions only). `blocks.html` shows each with its code. A test fails if a block is missing from the starter kit or from that page.
- **Kit additions**: `Dame.drop`, `Dame.download`, `Dame.progress`, `Dame.pause`.
- The description typed in step 1 is kept in the person's browser only (so a reload does not lose it). Keeping it in the database comes with the help text in phase 5.
- A tile that is not built yet shows "being prepared" to people and "Build this tool" to its manager, not an error.
- `examples/parts-extractor/` is the old hub's Parts List Extractor rewritten for this site: same extraction rules, one file, building blocks, shelf library, no worker.

## Built in phase 4 (say if any should change)
- **Nobody runs SQL for a tool's table.** `004_tables.sql`, pasted once by the owner, installs the table maker. From then on a tool's manager makes tables on the tool's Data page, or presses "Create the tables" when a page declares what it needs. The database writes and runs the SQL itself, from checked names and a fixed list of types.
- **A page declares its tables inside itself**, in `<script type="application/json" id="dame-tables">` (same content as `dame.json`, which still works for tools made of several files). One file per tool stays true.
- **Levels on the three presets.** Team: read sees all; contribute adds and changes his own; edit changes anyone's; approve deletes. Private: each person only his own rows, also hidden from managers; adding, changing and deleting his own needs contribute. Reference: everyone reads; every change is for the tool's managers and the space admins only.
- **The preview has its own rows.** Every table exists twice (live and preview copy). In the preview a manager may do everything; nothing there touches real rows.
- **What a table can and cannot do yet.** Columns can be added. A column cannot be renamed, retyped or removed, and a table cannot change its preset: make a new table. A table is deleted only after its name is typed; its rows go with it.
- **Limits:** 30 tables a tool, 60 columns a table, text 1,000 characters, long text 20,000, a list returns at most 1,000 rows, filters match exact values only. Empty values sort last.
- **File columns are refused for now** ("not built yet"), also from a declared list. `Dame.files` still answers "not built".
- **Rows are not written to the audit one by one.** Each row carries who added it, who changed it last and when. Making, extending and deleting tables is in the audit.
- **A tool learns the names of the people who have it** (`Dame.people()`: id and name, no email), to show who added a row and to choose a person.
- **A list and form without AI:** `kit/starter/tracker.html` builds itself from a table's definition. The builder offers it ready-made, and for a tool's own tables once it has some.
- **The test space** (IT admin page, one press): the space "Test space" with two empty tools, Converter and Tracker, to be built by hand with the ready-made pages.
- From the walk as a basic user, fixed here: one page is accepted whatever its file is called; a page that uses the browser's storage is stopped at the check; the starter kit is not copied without a description; ready-made pages are on the site, not only in the repo.

## Built in the hardening round (say if any should change)
- Who may ask for access is a site setting (`signup_domains`), empty by default so the demo keeps working; IT is warned on the page while it is empty.
- A sign-in is audited once per session, when the site first sees it.
- Downloads from a tool are saved by the shell, never by the frame. Allowed kinds: xlsx, xlsm, csv, txt, json, pdf, png, jpg, jpeg, docx, pptx, xml, md. No html, no programs, no scripts, no archives.
- Limits per open tool: 300 requests in 10 seconds, 20 saved files a minute, 100 MB a file.
- A tool's script error is shown in words to its managers only; other users are told to tell the manager.
- Charts: not now. Later as a small building block in the kit (bars and lines from a table), so no second library has to be trusted.
- Review before live, quotas, export: later, as ranked in `IT-REVIEW.md`.

## Owner, 2026-11-26 (the builder)
- The builder shows one step at a time; a step shows only when the one before is done. It starts with a clear "Build a new page" choice.
- Where a tool saves data, the page says "database" in plain words.
- Anything clicked with the mouse looks like a button.
- Pages must open fast: a page asks the database everything it needs at once.

## Open with IT (target; the demo uses the stand-in in `DEMO-STACK.md`)
| # | Decision | Proposed |
|---|---|---|
| D1 | Where it runs | Company cloud subscription or on-premises containers |
| D2 | Sign-in | Company SSO (OpenID Connect) with MFA |
| D3 | Web addresses | `hub.<domain>` + wildcard `*.apps.<domain>` |
| D4 | Databases | PostgreSQL: one server for core, one for spaces, a database per space |
| D5 | Code source | Upload from the site; company Git optional |
| D6 | Network reach | Internal + VPN, or internet behind Conditional Access |
| D7 | Data class allowed | Internal technical and work data |
| D8 | Server-side code in tools | Not in version 1 |
| D9 | Quotas per space | 5 GB data, 200 MB a version, 50 tools, 10 versions |
| D10 | Retention | Restore 35 days; audit 3 years |
