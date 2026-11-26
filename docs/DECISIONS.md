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
