# Demo stack: how GitHub Pages + Supabase stand in for the target

The demo proves the idea and the contracts. It is not the production design: read the last column before putting real data in it.

| Part of the target (`IT-GUIDE.md`) | In the demo | Weaker because |
|---|---|---|
| Company sign-in (Entra ID, MFA) | Supabase Auth, email + password, approval by an IT admin | No SSO, no company MFA, leavers disabled by hand |
| One session, 12 hours, ended at sign-out or switch-off | `core.sessions`: only a person's newest sign-in is honoured, for 12 hours | The sign-in service itself still thinks older sessions are alive; only the `dame_*` functions refuse them |
| Proof of email, password rules | Supabase defaults: confirmation link by email; the page asks for 12 characters | Built-in sender: a few emails an hour; the 12-character rule is only in the page unless set in Supabase |
| The site's own address | Shared with every other Pages site of the same GitHub account | A script on any of them could read a DAME session kept in the browser. Accepted by the owner for the demo; sample data only |
| The tool's own address (`/<space>/<tool>/`) and server-sent policy | `tool.html?space=..&tool=..` runs the tool in a sealed frame inside `frame.html`; the policy is inherited from that page and repeated in the tool's page | No address of its own for a tool; limits listed in SECURITY "The sealed frame" |
| Hub app and API | Static pages on GitHub Pages + `dame_*` functions in Supabase | Page code is public (it holds no data) |
| Security headers sent by the server | GitHub Pages sends none of ours: the policy is a tag at the top of each page; hub pages refuse by script to run inside a frame | A tag cannot forbid framing or report violations; the script check is weaker than the header |
| Core database server | Schema `core` in the one Supabase database | Same server as the spaces |
| A database per space | Schemas `t_<space>__<tool>`; nothing exposed to the API | Separation by schema and function checks, not by server |
| Data API per space (PostgREST, per-tool role) | One generic data service: `dame_rows_*` functions | All access passes one set of functions; they must be right (tested, refused cases) |
| Table builder | `dame_table_*` functions called from the Data page | Same |
| A web address per tool | One address; the tool runs in a sealed frame with no network | Isolation by browser sandbox only, no second wall |
| Tool files store, immutable versions | Supabase Storage, private bucket `tools` | Free-tier size limits |
| SQL console with per-space roles | Edge Function connecting as the space's own role; built last | Until built: no SQL for tile admins |
| Vault | Supabase Vault and function secrets | - |
| Backups, point-in-time restore | Whatever the Supabase plan gives | Free tier: none worth relying on |
| Audit to SIEM | `core.audit`, shown in the admin page | Not forwarded |
| Pipeline, staging | Owner pastes numbered SQL files; no staging project | Nothing is tested before live except locally |

## What stays identical (so tools move unchanged)
The seven contracts in `BEDROCK.md`: ids, roles and levels, the two kit lines, the `Dame` API, `dame.json`, standard columns, presets, the release steps, the audit.

## Rules for the demo
- Technical and sample data only. Nothing personal, no prices or customer data, until IT hosts it.
- Only the Supabase URL and publishable key are in the repo.
- The GitHub account should serve no other Pages site that loads outside code: every Pages site of one account shares one address with DAME.

## Files that IT closes on its own servers
The demo is a public test site, so every file of the repo can be fetched by its address. Two folders are written for IT and are only *shown* to IT admins in the demo: `book/` (the site book) and `docs/`. On IT's servers one web-server rule closes them to everyone but IT. Nothing in them is a key or data.

## Hand-over to IT
Export: `core` tables, each tool's tables (ordinary PostgreSQL), each tool's files (the uploaded versions), the audit. IT builds the target; tools are re-uploaded as they are.
