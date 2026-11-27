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
- **Tile icons** (`kit/v1/icons/tiles/`): 90 pictures from Lucide (lucide-static 1.81.0, ISC licence, text in that folder), files of the site, no outside source. The database keeps the icon as one short text, as before: `i-fan` is the picture "fan", any other text is shown as letters. Only names in the list in `shell.js` become a picture. No SQL.
- **Going back**: a "Back to ..." button names the page the person came from (IT admin, space admin, the tool) and steps back in the browser history instead of opening the page again. For that each browser tab keeps the addresses of the site's pages it visited (`dame.trail` in the tab's session storage: addresses only, gone when the tab closes). The tool admin page never points a manager to the space admin page unless he came from it.
- `examples/parts-extractor/` is the old hub's Parts List Extractor rewritten for this site: same extraction rules, one file, building blocks, shelf library, no worker.

## Built in phase 4 (say if any should change)
- **Nobody runs SQL for a tool's table.** `004_tables.sql`, pasted once by the owner, installs the table maker. From then on a tool's manager makes tables on the tool's Data page, or presses "Create the tables" when a page declares what it needs. The database writes and runs the SQL itself, from checked names and a fixed list of types.
- **A page declares its tables inside itself**, in `<script type="application/json" id="dame-tables">` (same content as `dame.json`, which still works for tools made of several files). One file per tool stays true.
- **Levels on the three presets.** Team: read sees all; contribute adds and changes his own; edit changes anyone's; approve deletes. Private: each person only his own rows, also hidden from managers; adding, changing and deleting his own needs contribute. Reference: everyone reads; every change is for the tool's managers and the space admins only.
- **The preview has its own rows.** Every table exists twice (live and preview copy). In the preview a manager may do everything; nothing there touches real rows.
- **What a table can and cannot do yet.** Columns can be added. A column cannot be renamed, retyped or removed, and a table cannot change its preset: make a new table. A table is deleted only after its name is typed; its rows go with it.
- **Limits:** tables a tool and columns a table by the space's quota since file 011 (before: fixed at 30 and 60), text 1,000 characters, long text 20,000, a list returns at most 1,000 rows, filters match exact values only. Empty values sort last.
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

## Owner, 2026-11-26 (the look)
- The site takes its look from the earlier DAME hub: the blue palette, the mark, the icons, the movement, the day and night button. This changes "nothing is taken from DAME HUB" for the look only. No code, data, table or structure of the hub is used; the hub repo was read, not touched.
- Text on buttons uses a slightly darker blue than the hub (#0078B8) so that white text stays readable; the mark, the hero and the icons keep the hub's bright blue.
- The theme choice is one word in the browser's storage of the site. A tool cannot read it; it is told "day" or "night" by the shell.

## Owner, 2026-11-26 (information button, adding people)
- Every page has an information button. A tool that is not live explains to its manager, in detail, how to build it; a live tool shows its usage guide.
- The IT admin adds people from the IT admin page. Built differently from the earlier hub on purpose: the hub wrote the account and a temporary password straight into the sign-in service's tables. Here the email is approved in advance and the person signs up himself. Reasons: no one ever knows another person's password; nothing depends on the inner tables of Supabase Auth; the same step works with company sign-in on the target.
- A usage guide is plain text, 4000 characters, shown as text.

## Owner, 2026-11-26 (new user as in the DAME hub)
- The owner asked for the hub's way: IT makes an account with a username and a temporary password, no email. Built in `009_new_user.sql`. This replaces the earlier choice "by email only" as the first way; adding by email stays.
- What it costs, said plainly: (1) the IT admin knows the temporary password until the first sign-in; (2) the function writes one row into each of Supabase's own tables `auth.users` and `auth.identities`, which Supabase does not promise to keep stable; (3) such an account has no email, so a forgotten password needs IT.
- What limits it: only IT admins can call it; the password is stored only as a one-way hash and is never in the audit; the database itself refuses the account everywhere until the password was replaced, and checks that by looking at the stored hash; the sign-in service refuses re-using the temporary password.
- Not part of the target: with company sign-in, IT's directory makes accounts.

## Owner, 2026-11-26 (the site book)
- The site explains itself: a site book on the site, to read or to present, so no separate presentation is needed. Notes, logic and decisions are written there as the work goes on.
- Kept up to date with every delivery (chapter touched + "Notes and changes").
- Only signed-in, approved people can open it. It holds no key, address or personal data.

## Owner, 2026-11-26 (the finish)
- The look and feel is judged as a careful phone user would: one-line bar, finger-sized targets, notch-safe, calm movement. These live in `kit/v1/shell.css` only; contract 4 (`dame.css`, `dame.js`) is not touched by look-and-feel work on hub pages.
- Admin pages show one part at a time (tabs), the open part kept in the address; a tool's managers and delete field are folded in the space admin (owner's go, same day). Showing only: contract 3 stands, the database enforces.

## Owner, 2026-11-27 (builder)
- **After "Create tool" the person lands on the tool's own admin page**, on Build. The settings window (name, look, managers, switch off, delete) is for a tool that exists and opens from its tile.
- **"Use a ready-made page" is removed.** IT builds the common tools; a department's admins build their own. The builder has two ways: build a new page, or bring a page. The example pages stay in the repo (`examples/`, `kit/starter/`) for IT and for the tests; this replaces the two lines above about offering them ready-made.
- The test space keeps its two empty tools; they are built like any other tool.

## Owner, 2026-11-27 (accounts)
- Every person has an account page; IT can reset a password with a temporary one. Health comes after this.
- **Who changes what.** The person: job title, department, office, work phone, and his password. IT only: name, username (never changed), staff number. Reason: name and staff number say who someone is to the admins who give access; a person renaming himself "IT admin" must not be possible.
- **Reset is IT's, by voice.** No "forgot password" email: accounts with a username have no email, the owner keeps the sign-in emails at their default, and company sign-in replaces all of it. IT must be sure who is asking (call back).
- **Nobody resets his own password** (he changes it on My account) and nobody resets a waiting or switched-off account.
- **An IT admin can reset another IT admin.** Accepted for the demo: it is in the audit with both names, and the person is told at his next sign-in who did it. The target has no such path (company sign-in).
- **A temporary password counts 7 days** and must be typed again to finish (the page keeps it in memory from the sign-in, never in storage). Reason: after a reset because "someone may know my password", that someone may still hold a sign-in for up to an hour; without this he could set a password himself and get in.
- **The person's own password rule** (12 characters, mixed) is checked by the page and by the sign-in service's own minimum length; the database never sees a password. The password he has now is checked by a real sign-in that is closed at once.
- **People on the IT page follow the same design language as spaces and tools:** one line, one button, changes only in the window.
- Not done: a person changing his own name; password history; forced change every N days (current guidance is against it without a sign of leakage); lock-out after wrong tries (the sign-in service limits tries by itself).
## Owner, 2026-11-27 (one look, one place for data; the full fix request)
- Owner: "it must reject any new designs in html"; "almost all users will come up with stand-alone htmls and some database logics which we need to streamline"; "a detailed prompt will help us keep everything aligned".
- **A design of its own stops the upload.** Own colours, pop-up boxes, a changed theme variable and more than 3000 characters of own styles are now stops (colours and pop-ups were notes). Own fonts, header, menu and footer already were. Plain HTML with no styles still passes and takes the site's look: that is no design of its own.
- **Data outside the site's tables stops the upload.** Browser storage (already), cookies and a call to a server (was a note). The starter kit always said such a page is refused; the check now does it.
- **The fix request is complete in itself** (`kit/ai-fix.md`): the points found, how to rebuild the look and the data, the whole starter kit, the page. It replaces the one-paragraph request, which assumed the AI had seen the kit.
- What this does not do: the check reads the page as text. Code that builds its look or its storage calls in a hidden way is not seen. That stays accepted: the check keeps the site aligned and saves time; the sealed frame and the database protect (see "The check is help, not the wall").
- 3000 characters is a first number (the largest example page has 328). Say if it should move.

## Owner, 2026-11-27 (quotas)
- Owner: "this to be implemented with min quota with IT admin page controlling the quota and space admins can request IT team to increase the quota, this is very important"; "make rows 10,000 as default and 60 columns as default and 10 tables per tool by default"; "quotas design language must be the same tile kind as we use in spaces".
- **Three limits per space:** rows in the whole space (10,000), tables in one tool (10), columns in one table (60). The owner first thought of tables and columns only; rows were kept because rows are the only thing that fills a database (an empty table is a few kilobytes), and he set the row default himself.
- **Read as:** the row limit holds for the space as a whole, not per tool. Per tool it would not bound a space, because a space may have any number of tools. Say if it should be per tool.
- **Fixed limits became quota.** 30 tables a tool is now 10 by default (IT can give up to 100); 60 columns a table stays the default (IT can give up to 200). A tool that already has more than its limit keeps its tables; it can make no new one.
- **IT sets, the space admin asks.** Two functions with two different checks. A full space still reads, changes and deletes.
- **The count is one number per space**, kept in the same statement that checks it and counted again whenever someone looks. It is not a count per add over every table: that would slow every save as tables grow.
- **Not in this delivery:** a quota by size in bytes, a quota on stored files, a limit on tools per space, a message to IT when a request arrives (IT sees a number on the Quotas tab).

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
