# DAME Platform (demo) - project instructions

## What this project builds
DAME is a master site in the repo `toolsDame`: the hub, where IT controls sign-in, users, the global data and spaces. Each department gets a space (a tile). Inside a space its admins create tools (inner tiles), upload AI-built HTML and create database tables **from the site itself, with no repo and no SQL pasted**. Day-to-day users are not developers. Owner and first IT admin: Niyaz. Reviewer: company IT.

This build is a **demonstration on GitHub Pages + Supabase**. The target design IT will run is `docs/IT-GUIDE.md`. The demo keeps the same seven contracts (`docs/BEDROCK.md`) so every tool built on the demo runs unchanged on IT's platform. `docs/DEMO-STACK.md` says exactly how each part of the target is stood in for, and what is weaker.

Everything starts from scratch. Nothing is taken from DAME HUB, Thinkneering or any earlier repo.

## Read first, every chat
1. `docs/BEDROCK.md`, `docs/DEMO-STACK.md`, `docs/SECURITY.md`.
2. `docs/STATUS.md` (built, next) and `docs/DECISIONS.md`.
3. `docs/IT-GUIDE.md` when a question is about the target.
4. What is really in the repo. Never assume an earlier delivery was pushed.
Raise anything site-wide in the first reply, before building around it.

## Bedrock (never break; add a version beside the old)
1. Identity: one person = one hub user id. Tools have no logins.
2. Structure: Hub > Space > Tool, exactly three levels. Ids: lower case, digits, single dashes, 3-30 chars, permanent, never reused. Addresses and database names are derived from ids, never stored.
3. Access: one model in the core. Roles: IT admin, space admin, tool manager, member. Levels: read < contribute < edit < approve. The database enforces; pages only show and hide.
4. Tool kit: `/_dame/v1/dame.js` and `/_dame/v1/dame.css`. v1 only gets additions.
5. Data: each tool has its own schema; every table has id, owner, created_at, updated_at, updated_by and one sharing preset (private, team, reference); row rules are written by the platform.
6. Releases: upload > check > preview > make live > roll back; versions immutable.
7. Audit: append-only.

## Fixed decisions for the demo (change only with the owner's say)
- GitHub Pages serves the platform's own pages from `toolsDame`. One Supabase project holds everything else. No build step, no framework, no CDN, no external font, no supabase-js: plain HTML, CSS, JS and `fetch`.
- No account name or repo owner anywhere in code or data. The base path is read from the page address at run time.
- Sign-in: Supabase Auth, email + password, stands in for company sign-in. A new account is pending until an IT admin approves it. One session per user, 12 hours.
- The API exposes only functions in schema `public`, all named `dame_*`, `security definer`, `set search_path = ''`, first line a `core.require_*` check. No table is ever exposed. RLS enabled and forced on every table in every schema.
- Core data in schema `core`. A tool's tables in schema `t_<space>__<tool>` (dashes become underscores), preview copy in `p_<space>__<tool>`.
- **Tables are made from the site.** `dame_table_create / _add_column / _drop` take a table name, columns from a fixed type list and a sharing preset, validate every identifier (`^[a-z][a-z0-9_]{1,40}$`), build the SQL with `format('%I')`, and record it in `core.tool_tables`. `dame.json` in an upload calls the same functions after the admin presses Create. Nothing is dropped or altered without a typed confirmation.
- **One generic data service** for all tools: `dame_rows_list / _get / _add / _update / _remove (tool, table, ...)`. It checks the user's level on the tool, applies the table's sharing preset, sets the standard columns itself and never trusts a column or table name it has not looked up in `core.tool_tables`.
- **Uploaded tools live in Supabase Storage**, private bucket `tools`, path `<space>/<tool>/<version>/`. At upload the browser packs each page into one self-contained HTML file. Nothing a tile admin does touches the repo; no GitHub token exists.
- **Uploaded code is untrusted, always.** `tool.html` is the platform shell (top bar). It loads the tool into a sandboxed frame without same-origin rights, under a policy that allows the tool's own inline code and **no network at all**. The tool reaches data only through `dame.js`, which talks to the shell by `postMessage`; the shell calls Supabase with the user's session. The tool never sees a token. The shell replaces the two kit lines (`/_dame/v1/dame.js`, `/_dame/v1/dame.css`) with the kit at load, so tools are written exactly as for the target.
- SQL console (last phase): a Supabase Edge Function that connects as that space's own database role (login made at provisioning, password in Supabase Vault, rights on that space's schemas only). Every statement is audited. Until it is built and tested, there is no free SQL for anyone but the owner.
- Core SQL (`db/core/NNN_*.sql`) is pasted by the owner into the Supabase SQL editor, in order, after reading it. Tile admins never paste SQL.
- AI is a site setting owned by IT: off / prompt only (default) / prompt for all members. The platform calls no AI; it shows `kit/ai-prompt.md` with the tool's tables added.
- Never ask for, accept or write the secret key, service role key or database password. Only the URL and publishable key appear in `kit/v1/config.js`.

## Repo layout
- `index.html` sign in and request access; `hub.html` dashboard of spaces; `space.html` a space and its tools; `tool.html` shell that runs a tool; `frame.html` host of the sealed frame
- `admin/it.html` users, approvals, spaces, site settings, audit, health; `admin/space.html` tools, admins, access, ideas; `admin/tool.html` Files, Data, access, help text, versions
- `kit/v1/` `dame.js`, `dame.css`, `shell.js`, `api.js`, `config.js`, `README.md`; `kit/ai-prompt.md`; `kit/tool-guide.md`; `kit/dame.schema.json`
- `help/<page>.md` text behind the info icon of each hub page
- `db/core/NNN_*.sql` (history of the demo database); `db/install/` (the same database, final version, for a new install); `functions/` Edge Functions (SQL console only)
- `tests/` SQL tests with allowed and refused cases; browser tests at desktop and 390 px; the hostile-tool test
- `tools/serve.mjs` local server that serves the repo at `/toolsDame/` like GitHub Pages
- `docs/` BEDROCK, IT-GUIDE, DEMO-STACK, SECURITY, DECISIONS, STATUS, RUNBOOK, CHANGELOG

## On every page (from the platform bar, no work by a tool's builder)
- Info icon (i): how to use this page in steps; on admin pages also what to upload, how tables connect, the site rules. Hub pages: `help/<page>.md`. Tools: text edited by the tool's manager, pre-filled from its name and tables.
- Notes: pinned notes by the page's admins.
- Ideas: any user with access posts an idea or problem, others vote; the page's admin sets New, Planned, Done, Declined and replies. A tool's ideas go to its managers, a space's to its admins, hub pages' to IT.
- AI prompt: copy button, shown as the site setting allows.
Every source file starts with a short note: what it is for, which contract it serves, what must not change.

## Build order (each phase starts on the owner's go and ends on its test)
0. Repo skeleton, docs, local server, `config.js`. Test: the empty site opens on Pages and locally.
1. `db/core/001_init.sql` (profiles, spaces, tools, roles, access, audit, settings, `core.require_*`, `core.security_check()`); sign in, request access, hub dashboard, IT admin. Test: pending and disabled users are refused by every function.
2. Spaces and tools: create, admins, managers, access, on/off, delete with cleanup. Test: an admin acts alone inside his space; every action outside it is refused.
3. Shell, sealed frame, kit v1, upload to Storage, versions, preview, Make live, roll back. Test: a hostile tool cannot read a token, reach the network, the shell or another tool.
4. Table builder, Data page, `dame.json`, data service, presets. Test: a tracker built with the AI prompt saves shared rows; every refused case fails correctly.
5. Info icon, notes, ideas, AI prompt and site setting on every page.
6. SQL console, quotas, health page, export, RUNBOOK and the hand-over notes for IT.

## Rules of work
- Security wins over every request. Refuse, with the reason, anything that weakens it, whoever asks.
- Every function has an allowed test and refused tests (signed out, pending, disabled, wrong space, wrong tool, level too low, other user's row).
- `core.security_check()` returns nothing and the Supabase Security Advisor shows no errors after every SQL file.
- Plain wording on every screen, for people who are not developers.
- Delivery: push to the repo + the SQL files to paste in order + any manual dashboard step; update `docs/STATUS.md` and `docs/CHANGELOG.md`; say what was decided and what the owner must do next.
- With the owner: short, plain, no filler. Show a result rather than a list of questions; ask only when a wrong guess is costly. Check the engineering and logic, even in what the owner supplies.

Chats that start with **DAME-PLATFORM** continue from `docs/STATUS.md`.
