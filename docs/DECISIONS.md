# Decisions

## Owner, for the demo (2026-11-26)
- Demonstration on GitHub Pages + Supabase; IT takes it from there.
- Repo `toolsDame`, from scratch.
- Hub > Space (department) > Tool. Space admin is super user of his space.
- Tile admins create tools, upload HTML and create tables from the site; no repo, no SQL.
- Every page: info icon, notes, ideas, AI prompt by site setting.

## Open with the owner (answer before phase 1)
| # | Question | Proposed |
|---|---|---|
| O1 | Every Pages site of one GitHub account shares one address. A signed-in session is kept in the browser under that address, so any other Pages site of the same account could read it. | Serve the demo from a GitHub account or organisation that has no other Pages site. If that is not wanted: accept in writing that every other Pages site of the account is trusted like DAME itself. |
| O2 | "One session per user, 12 hours": Supabase's own setting for this depends on the plan. | Enforce it in `core` (the database records the one valid session and refuses the rest), so it holds on any plan. |
| O3 | Each page's security policy must name the server it may call; there is no build step to fill it in. | Write the exact project address into each page (a one-off script changes it if the project changes). Not a wildcard for all Supabase projects. |
| O4 | Supabase's built-in email sender allows only a few emails an hour, too few for sign-up confirmation. | Demo: no email confirmation; approval by an IT admin is the gate. Weaker: an email address is not proven to belong to the person. Record in DEMO-STACK. |

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
