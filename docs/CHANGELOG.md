# Changelog

Newest first. One entry per delivery: what changed, what the owner must do.

## 2026-11-27 - Quotas: rows in a space, tables in a tool, columns in a table
New (owner: "IT admin page controlling the quota and space admins can request IT team to increase the quota, this is very important"; "rows 10,000, 60 columns, 10 tables per tool by default"; "same tile kind as we use in spaces")
- **Three limits per space**, enforced by the database: rows in the whole space (all tools, live and preview) 10,000; tables in one tool 10; columns in one table 60. Before: no limit on rows; 30 tables and 60 columns fixed.
- **IT admin > Quotas**, in the look of Spaces: "Change the default" on top, one tile per space (rows used, "Request waiting", "Full", "Own limits"), and a window per space where its limits are set, put back on the default, and its admin's request granted or declined. Spaces that wait come first; the tab shows how many wait.
- **Space admin > Quota:** rows used of allowed with a bar, a warning from 80%, where the rows are (per tool), "Ask IT for more" (three numbers and a reason), the waiting request with "Take the request back", IT's last answers.
- **A full space** still reads, changes and deletes. A new row is refused with a sentence that says whom to tell (code `quota_full`).
- **Nobody raises his own limit:** only IT sets, only a space's admin asks. Every step is in the audit.
- Rows are counted in one number per space, kept in the statement that checks the limit and counted again whenever the admin or IT looks, and when a table or tool is deleted.
- Not in this delivery: a quota in bytes, stored files, tools per space, a notice to IT beyond the number on the tab.
- Tests: `tests/sql/011_quotas_test.sql` (144 cases) and `tests/browser/quotas.mjs` (desktop and 390 px) are new. All eleven SQL test files, the eight browser tests and `tests/phase0.mjs` pass locally. Not yet run on the real Supabase project.

Files: `db/core/011_quotas.sql` (new), `tests/sql/011_quotas_test.sql` (new), `tests/browser/quotas.mjs` (new), `admin/it.html`, `admin/space.html`, `pages/admin-it.js`, `pages/admin-space.js`, `help/admin-it.md`, `help/admin-space.md`, `docs/`, `db/core/README.md`, `tests/README.md`, the site book (`17-data`, `22-questions`, `23-gaps`, `07`, `09`, `10-notes`).
SQL to paste: `db/core/011_quotas.sql`, then `tests/sql/011_quotas_test.sql`. The files before it (004 to 010) must be run first.
Owner: paste the SQL, reload the site (Ctrl+F5), open IT admin > Quotas.

## 2026-11-27 - Day and night: the switch to day runs the same movement backwards
Changed (owner: "for dark mode dark flows downward and in switching to light mode it flows upwards", "it must not change the existing animation")
- To night: nothing changed. The dark page opens as a circle from the button, same speed, same curve.
- To day: before, the day page opened with that same circle, so both directions looked alike. Now the dark page lies on top and the circle closes back into the button (quicker than the way down: 0.34 s against 0.48 s, moving from the first instant; owner: the first version at equal length "feels slow than dark"), so the dark flows down to night and back up to day.
- The plain fade (older browsers, devices that ask for less movement) is as before. Display only: no contract, no SQL, no change for tools; a running tool follows as before.
- Tests: `tests/phase0.mjs` passes. Both directions were run in a real browser and looked at half-way: the theme changes, the choice is kept, no page error. `tests/browser/phase4.mjs` (it holds the check that a running tool follows) stops earlier, at "the tool did not show #fields input", on the build machine with and without this change; the part that passes the theme to a tool was not touched. To be run on the owner's computer.

Files: `kit/v1/shell.js`, `kit/v1/shell.css`, `book/08-every-page.md`.
SQL to paste: none.
Owner: reload the live site once (Ctrl+F5) and press the sun and moon button both ways.

## 2026-11-27 - The full fix request; own designs and own data storage are refused
Changed (owner: "site must give a detailed prompt to keep site guidelines and database needs and design needs and it must reject any new designs in html")
- **The fix request is one complete text.** Before: one paragraph ("correct these points, follow the starter kit"). A page brought from outside was made by an AI that never saw the kit, so that could not work. Now `kit/ai-fix.md`: (1) every point the site found, stops and notes; (2) how to rebuild: keep what the tool does, throw the old design away and map each part to a building block, move everything kept or fetched into tables with the right columns, types and sharing; (3) the whole starter kit; (4) the page itself. The AI must answer with the page, the help text, a list of tables and what it left out.
- The request adds the database rules by itself when the page kept or fetched anything, and the shelf's Excel library when the page names Excel files (SheetJS is told to be replaced).
- **Step "What the site found":** one way forward: "Copy the full request for the AI", "Download it as a file", "Show it", three numbered steps, and a line to take real data out of the page first. A page over 120,000 characters is not pasted: the person is told to attach the file.
- **The check now stops** (before: noted): own colours, pop-up boxes, a call to a server. New stops: cookies, a changed theme variable, more than 3000 characters of own styles.
- The SVG format name (`http://www.w3.org/2000/svg`) is no longer reported as an outside address.
- The starter kit says the same limits. All example pages and ready-made pages pass unchanged.
- Tests: 15 new checks in phase 3, new checks in phase 0 (the template's gaps, its blocks exist, one number for the style limit). All browser tests pass.

Files: `kit/ai-fix.md` (new), `kit/ai-prompt.md`, `kit/v1/pack.js`, `kit/v1/lib/index.json`, `pages/admin-tool.js`, `admin/tool.html`, `help/admin-tool.md`, `kit/tool-guide.md`, the tests, `docs/`, the site book (`18-builder`, `10-notes`, `04`, `09`, `21`).
SQL to paste: none.
## 2026-11-27 - A new tool opens its build page; "Use a ready-made page" removed
Changed (owner: "after Create tool it must take me to the admin page; the settings window only for tools created before"; "remove the ready-made page: IT creates common tools, departments create their own")
- **Create tool** now leads straight to the tool's own admin page, on Build, with one line saying what to do next. The settings window opens only from the tile of a tool that exists.
- **The builder has two ways:** "Build a new page" and "I already have a page". The third card and its step are gone. The example pages stay in the repo for IT and for the tests.
- The greeting uses one entry in the tab's session storage (`dame.made`, the tool's id, read once and removed).
- No function, no right, no SQL changed.
- Tests: phase 2 follows the new path (new checks: lands on the build page, greeting once, the window from the tile); phase 4 builds its two tools through "I already have a page" and checks that no third way is offered.

Files: `pages/admin-space.js`, `pages/admin-tool.js`, `admin/tool.html`, help, docs, the site book, the browser tests.
SQL to paste: none.

## 2026-11-27 - Accounts: My account, password change, reset by IT
Added (owner: "user accounts with profiles, basic username, password and a few more things as in a company; IT resets a password with a temporary one; this makes it a fully working site before health")
- **My account** (`account.html`, from the round account button): my name, sign-in, staff number and role (read only), my work details to keep up to date (job title, department, office, work phone), changing my password, everything I can open with my level, and my last ten sign-ins.
- **Changing the password:** the password I have now, then the new one twice (12 characters or more, small letter, capital, digit). The person stays signed in. The database looks itself whether the stored password changed before it writes the date and the audit line.
- **IT admin, People:** one line per person with one button, Open. The window shows last sign-in, password state and access, and holds everything that changes an account: correct name, staff number and work details; **Reset password** (Generate, press twice); switch off or on; IT admin on or off. Nothing on the page itself changes an account any more.
- **Reset:** the person is signed out everywhere at once, signs in with the temporary password, and must choose a new one before anything opens. The start page says who reset it and when.
- **Tighter than before, for new accounts too:** a temporary password counts for 7 days, and finishing needs the temporary password itself (the page remembers it from the sign-in; after a reload it asks again). Someone who still holds an old sign-in of that person, or changes the password behind IT's back, cannot finish in his place.
- The account menu shows an account made by IT by its username, not by its inner address. The start page says what to do about a forgotten password.
- New functions: `dame_account_get`, `dame_account_set`, `dame_password_changed`, `dame_user_get`, `dame_user_details_set`, `dame_user_password_reset`. Changed, additions only in what they answer: `dame_me` (+ username), `dame_users_list`, `dame_request_access`, `dame_user_create`. `dame_password_done` now takes the temporary password.
- Until `010_accounts.sql` is run the site works as before: My account and the two new parts of the person window say that they are not switched on yet.
- Tests: `tests/sql/010_accounts_test.sql` (85 cases), `tests/browser/accounts.mjs` (51 checks at each width). All ten SQL test files, seven browser tests and the hostile-tool test pass locally.

Files: `db/core/010_accounts.sql`, `account.html`, `pages/account.js`, `help/account.md`, `pages/admin-it.js`, `admin/it.html`, `pages/index.js`, `index.html`, `kit/v1/api.js`, `kit/v1/shell.js`, `kit/v1/shell.css`, the tests, docs, the site book.
SQL to paste: `db/core/010_accounts.sql` (after 009), then `tests/sql/010_accounts_test.sql`.

## 2026-11-27 - Tool page: "Tool admin" at the right edge
Changed (owner: "more natural on the right side")
- On a tool's page the "Tool admin" button now sits at the right end of the strip under the bar; Hub / space / tool stay on the left. Look only.

Files: `kit/v1/shell.css`. SQL to paste: none.

## 2026-11-27 - Space admin as tiles, icons to pick, Back goes where you came from
Changed (owner: "inside the space it doesn't keep the same design language"; "keep open source icons users can select"; "from tool admin it must go back to the tool: a tool's admin may not have space admin rights")
- **Space admin, Tools:** "Add a tool" on top, one tile per tool in its colour, and a window per tool: "Build and access" as the main button, name and look, managers, switch off, delete. A new tool opens its window at once, so the next step is in front of the person. The level for everyone is asked only after "Open to everyone" is ticked.
- **Icons:** 90 pictures (Lucide, ISC licence, files of the site in `kit/v1/icons/tiles/`) to pick for a tool's tile and a space's tile; one or two typed letters still work. Shown on the hub, in the space, on the admin tiles and in the page titles. The test space's two tools get pictures.
- **Back buttons:** the button names the page you came from and returns to it on the tab you left; it steps back in the browser history, so the browser's own Back no longer bounces you forward. Space admin opened from IT admin: "Back to IT admin". Tool admin: "Back to the space admin page" only for a space admin who came from it; otherwise "Back to the tool" (or to the space while the tool is not built). A page the browser shows again from its memory is read again from the database.
- For the Back buttons each browser tab keeps the addresses of the pages it visited (`dame.trail`, session storage, addresses only, gone with the tab). The storage test now allows this entry and checks that it holds nothing but addresses.
- No function, no right, no SQL changed.
- Tests: new checks for the tiles and windows, picking an icon and seeing it as a member, Back from tool admin for a space admin and for a manager, Back to IT admin, both windows on a phone. All browser tests pass.

Files: `admin/space.html`, `admin/tool.html`, `pages/admin-space.js`, `pages/admin-tool.js`, `pages/admin-it.js`, `pages/hub.js`, `pages/space.js`, `pages/tool.js`, `pages/book.js`, `pages/index.js`, `kit/v1/shell.js`, `kit/v1/shell.css`, `kit/v1/icons/tiles/`, help and guide texts, `docs/DECISIONS.md`, the browser tests, the site book.
SQL to paste: none.

## 2026-11-27 - IT admin, Spaces: add on top, a tile per space, changes in its window
Changed (owner: "looks confusing; add space first, then tiles; editing and deleting only after I press the tile")
- **Spaces now shows two things:** the button "Add a space" (and "Make a test space" until one exists), and one tile per space with its name, tools and members.
- **"Add a space" opens a window** with name, id, description and first admin. A refusal (no admin chosen, id used before) is said inside the window.
- **Pressing a tile opens that space's window:** its admins, switch off or on, delete by typing the id, and "Open its admin page" when you are one of its admins. Nothing on the page itself can change or delete a space any more. The window stays open and shows the new state after each action; Done, Escape or a press outside closes it.
- Only how the page is shown changed: the same `dame_space_*` functions, the same press-twice and typed-id confirmations, the same audit. No right, no SQL.
- Tests: phase 2, phase 4 and the rehearsal follow the new way; new checks: no form until asked, a tile holds nothing to change, the window keeps up with the database, both windows fit a phone. All browser tests pass.

Files: `admin/it.html`, `pages/admin-it.js`, `kit/v1/shell.css`, `help/admin-it.md`, the browser tests, `book/02-structure.md`, `book/10-notes.md`.
SQL to paste: none.

## 2026-11-26 - Admin pages: one part at a time, and folded tool details
Changed (owner's go on the two ideas noted at the finish)
- **The admin pages are tabs.** IT admin, space admin and tool admin show one part on screen at a time; the strip under the bar is the row of tabs. On a phone each page is now about one screen instead of 3,500 to 5,000 px.
- The open part is kept in the address (`#spaces`, `#audit`): a reload, the back button or a shared link opens the same part. Left and right arrows move along the tabs.
- **The Approvals tab shows a red count** when people are waiting.
- **Space admin, Tools:** a tool's managers and its delete field are folded under one button, "Managers (n) and delete". A tool is three lines until you ask for more; an opened fold stays open while you work in it.
- Only how the page is shown changed: no function, no right, no SQL. A part that is not on screen is still in the page; the database decides what a person may do, as everywhere.
- Tests: `tests/browser/parts.mjs` makes every test press the tab and open the fold before it uses what is inside, as a person does. New checks: one part at a time, the address keeps it, a reload opens it, the fold is closed on a fresh page. All SQL, browser and hostile-tool tests pass.

Files: `kit/v1/shell.js`, `kit/v1/shell.css`, `pages/admin-space.js`, `pages/admin-it.js`, the browser tests.
SQL to paste: none.

## 2026-11-26 - The site book, part for IT
Added (owner: "extremely detailed, with the logic and the decisions")
- Thirteen chapters "In detail, for IT" (`book/11..23-*.md`): the pieces and one request end to end; identity and sessions; the access model with every check and every function; the database; the sealed frame; uploads and versions; tables and rows; the builder and the AI; the audit; how it is tested; the decisions one by one; the questions IT will ask; open gaps and hand-over. Each says how it is done, why, what was considered and not done, and its limits, with the real names from the source.
- The book is grouped in three parts (overview, detail for IT, log). Presentation: the overview, the detail for IT, or one chapter.
- The text format learned `code` and bold with code inside.
- Corrected in passing: a call to a server in a page is a note at the check, not a stop (the frame blocks it at run time).

SQL to paste: none.
## 2026-11-26 - Finish: the site used as a careful phone user would
Changed (owner asked for a review of the whole site and a streamlined result)
- **The bar is one line at any width.** The name and "Sign out" moved into one round account button (the person's initials); a press opens name, email and Sign out. On a phone the name was cut and "Sign out" wrapped onto two lines.
- **Long admin pages have a strip of their parts** under the bar (IT admin, space admin, tool admin). A press goes to the part; the strip lights the part on screen. On a phone these pages are 3,500 to 5,000 px long.
- **Fingers:** every button, field and chip is at least 44 px on a touch screen; nothing stays "hovered" after a tap; a pressed button gives a little.
- **Phones with a notch:** the bar and page keep clear of the notch and the home line; the phone's browser frame takes the colour of day or night.
- **Fields:** one quiet arrow on every list, a colour is a swatch (not a full-width bar), a soft ring on the field in use.
- **Windows:** the page behind an open panel no longer scrolls; the panel from below has a handle; Tab stays inside the information panel.
- **Dates read as people say them:** "Today, 8:15 PM", "Yesterday, 4:02 PM", then the date, the year only when it is not this year.
- **Same order on every page:** the back button above the title. On the front door and the book card of a phone, one button per line.
- Type: tighter headings that break evenly, numbers in tables line up.
- Tests: the bar is one line and the account button works (`phase1`), the strip goes to a part (`phase2`). All SQL, browser and hostile-tool tests pass.

Files: `kit/v1/shell.css`, `kit/v1/shell.js`, `kit/v1/icons/chevron.svg`, the hub pages (viewport line, `data-sections`, `data-nav`), `admin/it.html`.
SQL to paste: none. The tool kit (`dame.css`, `dame.js`) is untouched: nothing changes for a tool.

## 2026-11-26 - The site book
Added (owner's decision)
- `book.html`, `pages/book.js`, `book/index.json`, `book/01..10-*.md`: the whole site explained in ten chapters, to read (chapters on the left) or to present (one part per slide; Next/Back, arrow keys, full screen, Esc).
- The hub has a "Site book" card with the chapters as shortcuts.
- The small text format of the help panel learned steps in a row (`=> a | b`), notes (`> text`) and tables.
- Rule from now on: every delivery that changes the site updates the chapter it touches and adds a line to `book/10-notes.md`.

SQL to paste: none.

## 2026-11-26 - New user: username and temporary password, as in the DAME hub
Added (owner's decision, see DECISIONS)
- `db/core/009_new_user.sql`: `dame_user_create(username, name, temporary password)`, `dame_password_done()`. `core.require_user` refuses an account everywhere until its temporary password is replaced; `dame_request_access` tells the start page.
- IT admin page: "New user" window (username, display name, temporary password, Generate). "Add by work email" stays as the second way.
- Start page: sign in with "work email or username"; "Choose your own password" at the first sign-in.
- Tests: `tests/sql/009_new_user_test.sql`; the rehearsal plays the whole path. The stand-in for Supabase Auth learned accounts made by the database and changing a password.

SQL to paste: `009_new_user.sql`, its test (after 008).

## 2026-11-26 - The review window opens every time; empty form fields
Fixed (found by the owner with a pasted tracker page)
- The window with a page's tables and columns opened only when something had to be made. Now it opens after every check of a page that lists tables, also when they already exist, so the columns can be seen and more can be added.
- A form field left empty (sent as "") for a date, number, choice or person column was refused. The shell now passes it as "no value". The starter kit tells the AI the same.

SQL to paste: none new.

## 2026-11-26 - Review window for a page's database tables; colour of a space
Added
- After the check of a page that saves data, a window opens with the tables and columns the site read from the page (its `dame-tables` block). More columns can be added there (name, kind, choices) before anything is made; "Create in the database and go on" makes the tables, live and preview copy.
- Added columns are written into the page's own list when the page is one file, so a page that draws its form from that list (the ready-made tracker) shows them by itself. For a page written by the AI the site offers "Copy a request for the AI to use the new columns".
- A note when a page's code saves to a table that neither the page lists nor the tool has.
- `db/core/008_space_look.sql`: `dame_space_look_get`, `dame_space_look_set`. Space admin page: icon and colour of the space; the hub tile uses them. The tool's edit button now reads "Change name, icon or colour".

SQL to paste: `008_space_look.sql`, its test (after 007). Until then the two fields are not shown.

## 2026-11-26 - Information button, usage guide, adding people, buttons in one hand
Added
- The information button (i) in the bar of every page. Hub pages show `help/<page>.md`; a tool shows its usage guide; a tool that is not live yet shows, with a red dot until pressed, the detailed guide to building a tool (`help/admin-tool.md`: before live, how to build, what to upload, the rules, the database).
- `db/core/006_help.sql`: `dame_tool_help_get`, `dame_tool_help_set`. Tool admin page: "Usage guide" (write, start from the site's text, see it as users will). With no guide written, the site writes one from the tool's name, description, tables and the reader's level.
- `db/core/007_add_people.sql`: `dame_user_add`, `dame_user_add_remove`, `dame_users_added`; `dame_request_access` lets an added address in at once. IT admin page: "Add a person".
- Choosing a file is a drop area instead of the browser's grey button.
Changed
- Quiet buttons are tinted pills, back buttons carry an arrow, the trail is pills: one hand with the theme.
- Until 006 and 007 are run on the real project, those two parts say so on the page and everything else works.

Decided: IT adds a person by email, never with a password (see DECISIONS).

SQL to paste, in order: `006_help.sql`, its test, `007_add_people.sql`, its test (after 004 and 005).
Owner: Ctrl+F5.

## 2026-11-26 - The look of the DAME hub: palette, mark, movement, day and night
Changed (owner's decision, see DECISIONS)
- `kit/v1/dame.css`: the hub's blue palette for day and night, soft shadows, rounder corners, gradient primary button, focus rings, a small rise when cards arrive. No class or variable renamed or removed; new variables added (`--dame-accent-2`, `--dame-on-accent`, `--dame-soft`, `--dame-surface-2`, shadows, easing).
- `kit/v1/shell.css`: glass bar with the mark, hero band on the hub and on a space, tiles with an icon in their colour that lift on hover, the mark above the sign-in card.
- Day and night button in the bar (sun and moon). The choice is kept in the browser (`dame.theme`), applied before the page is drawn by `kit/v1/theme.js`, and opens as a circle from the button where the browser can. Without a choice the device decides.
- A running tool follows the button: the shell tells it over its private line; what the person typed stays. Tools need no change.
- `kit/v1/icons/` (mark, sun, moon, arrow) and the tab icon. Motion is switched off for people who ask their device for less motion.

SQL to paste: none. Owner: Ctrl+F5.

## 2026-11-26 - The builder as a guide, buttons, speed
Changed
- `admin/tool.html`: the builder starts with three choices (Build a new page / I already have a page / Use a ready-made page) and then shows one step at a time. The next step appears only when this one is done. "Start again" and "Back" on every step.
- A step of its own asks "Does the tool need to save data in the database?" and says plainly that the data goes into the site's database and that the site makes the tables.
- "I already have a page": after the check, one button hands the page to the AI to be rebuilt for the site.
- Everything a person clicks is a button: back links, the trail in the tool bar, the DAME mark.
- Speed: every page sends its questions to the database together instead of one after another, and opens the connection to the database while its scripts load. Measured with 300 ms per database call: hub 0.69 s > 0.36 s, space 0.69 > 0.35, IT admin 1.65 > 0.69, tool admin 1.63 > 0.68, opening a tool 1.09 > 0.74.
- `tests/phase0.mjs`: a page may name the database of `config.js` in one early-connection hint, nothing else from outside.

SQL to paste: none new. Owner: Ctrl+F5.

## 2026-11-26 - Hardening, the builder's rough edges, the department rehearsal
Added
- `db/core/005_hardening.sql`: setting `signup_domains` (who may ask for access), `dame_settings_get`, sign-ins written to the audit. Replaces `core.require_login`, `dame_request_access`, `dame_setting_set`.
- Shell: `Dame.download` is now carried out by the site (allow-list of 13 file kinds, 100 MB, 20 a minute); 300 requests per 10 seconds per open tool; a tool's script errors shown in a strip (manager: the error and "Copy for the AI"; user: "tell its manager").
- Builder: with a page pasted in step 3 the starter kit asks the AI to rebuild that page; files chosen without their folders are matched by name; a note when a page uses no building block; "Open the preview" and "Make live" appear right after the upload.
- `kit/v1/dame.css`: plain HTML (headings, fields, buttons, tables) inside a tool looks like the site by itself. Additions only.
- IT admin page: "Who may ask for access". A two-letter name now gets a valid id suggestion.
- `examples/departments/`: six stand-alone tools. `tests/browser/company.mjs`: the rehearsal. `docs/IT-REVIEW.md`.
Changed
- The tool's frame lost `allow-downloads` (`sandbox="allow-scripts allow-forms allow-modals"`).
- Hostile tool: 33 attempts (new: five file saves, a direct download, a flood).

Decided: charts wait; when built they will be a block of the kit, not a library. See DECISIONS.

SQL to paste, in order: `004_tables.sql`, its test, `005_hardening.sql`, its test.
Owner: the ten steps in `STATUS.md`.

## 2026-11-26 - Phase 4: tables from the site, the data service, the test space
Added
- `db/core/004_tables.sql`: `dame_table_create`, `dame_table_add_column`, `dame_table_drop`, `dame_tables_list`; `dame_rows_list / _get / _add / _update / _remove`; `dame_tool_people`. Deleting a tool now deletes its tables.
- The shell answers `Dame.table(...)` calls through the data service, always for its own tool. Kit: `Dame.people()`.
- `admin/tool.html`: the Data section (tables, new table form, add a column, delete), "Create the tables" in the builder, the "saves rows" option of the starter kit, ready-made pages.
- `kit/starter/tracker.html`: a list and form for any table, no AI. `examples/converter/index.html`: a stand-alone example.
- `admin/it.html`: "Make the test space".
- Tests: `tests/sql/004_tables_test.sql`, `tests/browser/phase4.mjs`.

Changed
- Upload check: one page is accepted whatever its file is called; browser storage is a stop, not a note; tables are read from the page's `dame-tables` block or from `dame.json`.
- The starter kit is not copied without a description.
- `kit/ai-prompt.md`: new gaps `{{DATARULE}}` and `{{DATA}}`.

SQL to paste, in order: `db/core/004_tables.sql`, then `tests/sql/004_tables_test.sql`.
Owner: the steps in `STATUS.md`.

## 2026-11-26 - Phase 3b: one website from many teams (guided builder, building blocks, shelf)
Added
- **Guided builder** on `admin/tool.html`: describe, copy the starter kit, paste the answer, see what the site found (with a ready fix request for the AI), upload. "Use the starter page as it is" gives a working tool in a minute.
- **Starter kit**: `kit/ai-prompt.md` (template) + `kit/starter/index.html`, filled per tool by the site.
- **Building blocks**: about 30 new classes in `kit/v1/dame.css`; `blocks.html` + `pages/blocks.js` show each with its code.
- **Kit**: `Dame.drop`, `Dame.download`, `Dame.progress`, `Dame.pause`.
- **Shelf**: `kit/v1/lib/` with ExcelJS 4.4.0; the shell puts a shelf library in place of its line.
- **Reference tool**: `examples/parts-extractor/index.html`.
- Trail "Hub / Space / Tool" on the tool page; a friendly "not built yet" screen.

Changed
- Upload check: adds the kit lines itself; accepts pasted code; new stops (own header, password field, own font, worker, unknown library) and notes (own colours, pop-up boxes).
- Kit bug fixed: a download made by a tool was blocked by the kit's own link handling.
- `kit/tool-guide.md`, `help/admin-tool.md` rewritten for the guided flow.
- Tests: `tests/browser/phase3.mjs` and `tests/phase0.mjs` extended; the hostile tool is now uploaded around the checks, as an attacker would.

SQL to paste: none. Reload the site (Ctrl+F5).
Owner: the steps in `STATUS.md`.

## 2026-11-26 - Phase 3: running a tool, uploads and versions
Added
- `db/core/003_versions.sql`: versions (announce, send, close; preview; make live; roll back), the private file store `tools` with its two rules, `dame_tool_open`.
- `tool.html` + `pages/tool.js`: the shell. `frame.html`: the host of the sealed frame.
- `kit/v1/dame.js`: kit v1 (`Dame.ready`, `Dame.toast`, links; tables and files answer from phase 4). `kit/v1/dame.css`: `dame-toast` added.
- `kit/v1/pack.js` + `pack.html`: files or a zip are read, packed into one file per page and checked, in a hidden helper page.
- `admin/tool.html`: Files and versions (upload, preview, Make live, Roll back).
- `examples/hello-tool/`: a first tool to upload.
- Tests: `tests/sql/003_versions_test.sql`, `tests/browser/phase3.mjs` with the hostile tool in `tests/browser/fixtures/hostile/`.

Changed
- `tool.html` and `admin/tool.html` may show this site's own frames (`frame-src 'self'`): the sealed frame's host and the file reader.
- `tests/phase0.mjs` checks that `frame.html` carries exactly the sealed-frame policy of `pages/tool.js`.
- `tests/sql/001_core_test.sql`: the file check `dame_file_allowed` answers "no" instead of refusing, so it is tested in 003.
- SECURITY: "The sealed frame, as built" with its known limits. DECISIONS: O1 closed (accepted for the demo), phase 3 choices.

SQL to paste, in order: `db/core/003_versions.sql`, then `tests/sql/003_versions_test.sql`.
Owner: the steps in `STATUS.md`.

## 2026-11-26 - Phase 2: spaces and tools
Added
- `db/core/002_spaces_tools.sql`: 21 functions for spaces, tools, admins, members, managers, access, people lookup, audit by space and tool. `dame_audit_list` replaced (same rights) so it names people and places for the new actions.
- `admin/it.html`: Spaces section (create with first admin, admins, switch off and on, delete by typing the id).
- `space.html` + `pages/space.js`: the caller's tools as tiles with his level.
- `admin/space.html` + `pages/admin-space.js`: tools (create, change, on/off, delete, managers), people, admins, name, audit.
- `admin/tool.html` + `pages/admin-tool.js`: access list and audit of one tool; Files and Data still to come.
- `kit/v1/shell.js`: person picker, people lists, typed delete, shared audit table, action runner.
- Tests: `tests/sql/002_spaces_tools_test.sql` (131 cases), `tests/browser/phase2.mjs`.

Changed
- Audit tables have a "Where" column (space / tool).
- `tests/sql/run-local.mjs` runs every core file and proves each refuses a second run.

SQL to paste, in order: `db/core/002_spaces_tools.sql`, then `tests/sql/002_spaces_tools_test.sql`. `tests/sql/001_core_test.sql` may be run again: it now also covers the new functions (238 cases).
Owner: the steps in `STATUS.md`.

## 2026-11-26 - Phase 1: sign-in, approval, hub, IT admin
Added
- `db/core/001_init.sql`: schema `core`, require-checks, security check, ten `dame_*` functions.
- `index.html` + `pages/index.js`: sign in, request access, waiting and switched-off screens.
- `hub.html` + `pages/hub.js`: the caller's spaces as tiles (none until phase 2), IT admin card.
- `admin/it.html` + `pages/admin-it.js`: approve, refuse, switch off and on, IT admin role, AI setting, audit.
- `kit/v1/api.js`: sign-in, session (kept in the browser, renewed, 12 hours), `DameApi.rpc`. `kit/v1/shell.js`: user and Sign out in the bar, page guard.
- Tests: `tests/sql/001_core_test.sql`, `tests/sql/run-local.mjs`, `tests/browser/phase1.mjs` with `mock-supabase.mjs`.

Changed
- Every page's security policy now names the one database address. `tests/phase0.mjs` checks it equals `config.js`.
- `kit/v1/dame.css`: one addition, `[hidden]` always hides (contract 4: additions only).
- `tools/serve.mjs`: optional rewrite hook, used by tests only.
- DECISIONS: O2-O4 decided, O1 restated, phase 1 choices listed. DEMO-STACK: two rows (session, email proof).

SQL to paste, in order: `db/core/001_init.sql`, then `tests/sql/001_core_test.sql`.
Owner: the ten steps in `STATUS.md`.

## 2026-11-26 - Phase 0: skeleton
Added
- Pages (placeholders): `index.html`, `hub.html`, `space.html`, `tool.html`, `frame.html`, `admin/it.html`, `admin/space.html`, `admin/tool.html`.
- `kit/v1/`: `dame.css`, `dame.js` (empty), `shell.js`, `shell.css`, `api.js`, `config.js`, `icon.svg`, `README.md`.
- `kit/dame.schema.json`; `help/` texts for the seven hub pages.
- `tools/serve.mjs`; `tests/phase0.mjs`.
- `docs/RUNBOOK.md`, this file. `.nojekyll` so GitHub Pages serves every file as it is.
- Seed docs as supplied: BEDROCK, DEMO-STACK, SECURITY, DECISIONS, STATUS, kit texts, README, PROJECT-INSTRUCTIONS.

Decided in this delivery
- `kit/v1/shell.css` is a new file beside the planned layout: hub-only classes (`hub-*`) stay out of `dame.css`, so they never become part of the promise to tools.
- The base path comes from the address of `api.js` at run time. No page, script or doc holds the account name; the test refuses it.
- Hub pages refuse to run inside a frame by script, because Pages cannot send the header for it (row added to DEMO-STACK).
- `api.js` refuses a secret or service key if one is ever put in `config.js` and says so on the start page.

SQL to paste: none.
Owner: switch on Pages; answer O1-O4 in `DECISIONS.md`; supply `docs/IT-GUIDE.md`.
