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

## Open with the owner
| # | Question | Proposed |
|---|---|---|
| O1 | Not about tiles: all tiles are inside this one site, and that is right. The question is the owner's OTHER GitHub Pages sites (other repos of the same account). GitHub serves them all from one address, and a browser lets every page on one address read what the others keep. A signed-in DAME session is kept in the browser, so a script on any other Pages site of the account could read it and act as that user. | Serve the demo from a GitHub account or organisation that has no other Pages site. Or accept that every other Pages site of the account is trusted like DAME itself. Until answered: sample data only (already the rule in DEMO-STACK). |

## Built in phase 1 (say if any should change)
- A tool is named by its space and its id together: `core.require_tool(space, tool, level)`, `core.has_tool(user, space, tool, level)`. Tool ids are unique inside a space, not across the site.
- An IT admin is not a member of any space by being IT admin (BEDROCK roles table). He sees a space on the hub only if he is its admin or member.
- Nobody changes his own account or role; switching an account off also removes its IT admin role and ends its session at once.
- Refusing a waiting account switches it off (it can be switched on later). Accounts are never deleted.
- The first IT admin is made once by the owner in the SQL editor: `select core.make_first_admin('email');`. It refuses when an IT admin exists.
- Page scripts live in `pages/` (one per page), beside the planned layout.

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
