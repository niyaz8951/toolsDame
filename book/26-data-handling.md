# Where data lives, and what happens to it

Every place the site keeps something, who can reach it, how long it stays, and what a delete really does.

=> Entered in a tool | Shell adds the session | Function checks | Row in the tool's own schema

## Every place something is kept
| Place | What is there | Who can reach it | Leaves when |
|---|---|---|---|
| Sign-in service (`auth` schema of the Supabase project) | Email or inner address, password as a bcrypt hash, sign-in sessions | The service itself; the project's owner | Never by the site. Accounts are switched off, not deleted |
| `core.profiles` | Name, email, username, status, IT admin or not, job title, department, office, work phone, staff number, when the password was last chosen | The person (his own, `dame_account_get`); IT admins (everyone); admins and managers find people by name or email | Never by the site |
| `core.sessions` | One row per sign-in: when first seen, when ended | Functions only | Never. Grows with sign-ins |
| `core.spaces`, `tools`, `space_admins`, `space_members`, `tool_managers`, `tool_access` | The structure and every right | Through functions, each to the people it concerns | When removed on the site, or when the space or tool is deleted |
| `core.tool_versions`, `core.tool_tables`, usage guides | What was uploaded when by whom; the definition of every table | The tool's managers; `dame_tool_open` for its users | With the tool |
| `core.audit` | Who did what, when | IT (all), space admin (his space), manager (his tool) | Never. Cannot be changed or deleted |
| `core.settings`, `core.invites`, `core.retired_ids` | Site settings, addresses approved in advance, ids that may not return | IT; functions | An unused invite when IT takes it back |
| `t_<space>__<tool>` | **The departments' data**: the rows of a tool's tables | People with that tool, by level and sharing rule | Row by row by its users; all at once when the table, the tool or the space is deleted |
| `p_<space>__<tool>` | Trial rows of the preview | The tool's managers | With the table or tool |
| File store, private bucket `tools` | The uploaded pages of every version | Managers; users of the live version | **Not at all for now**: files of a deleted tool stay, unreachable |
| The repository (public in the demo) | What the site is made of: page code, the kit, help texts, this book, SQL files, tests, documents. Never data | Anyone in the demo; on the target IT's own servers and domains | - |
| The person's browser | See below | That browser | See below |

## What the browser keeps
| Key | Holds | Lifetime |
|---|---|---|
| `dame.session` (local storage) | The access token (short-lived) and the refresh token | Until sign-out, or the session ends; the database stops honouring it after 12 hours or a newer sign-in |
| `dame.theme` (local storage) | The day or night choice | Until changed |
| `dame.trail` (session storage) | Addresses of this site's pages visited in this tab, for the Back button | Until the tab closes |
| `dame.brief.<space>.<tool>` (local storage) | A builder's draft: the description a manager typed for the AI and the libraries he ticked | Until the browser's storage is cleared |
| A notice for the start page (session storage) | One sentence, such as "Your session has ended" | Shown once |

No row of any tool is kept in the browser. A tool has no storage at all. No password is ever stored: a temporary password is held in the start page's memory until the new one is saved or the page is left.

## Personal data on the site
- **Staff data only:** name, work email or username, job title, department, office, work phone, staff number; times of sign-ins; which actions a person took (audit); which rows he added or last changed (`owner`, `updated_by`).
- **Whatever departments enter in their tools.** The site cannot know what that is. The demo's rule is: technical and sample data only, nothing personal, no prices, no customer data.
- An account is never deleted, so a person's name stays on his rows and in the audit after he leaves. That is wanted for traceability and needs a data-protection view before real use: how long, and whether a name is replaced by a marker on request.

## In transit and at rest
- **In transit:** every call goes over HTTPS: to GitHub Pages for the pages, to the Supabase project for sign-in, functions and files. Nothing else is contacted; each page's policy names that one database address.
- **At rest:** the provider's own disk encryption, as the provider states it. The site adds no encryption of single fields. Passwords are hashes (bcrypt), never readable.
- **Where:** the region chosen when the Supabase project was made; it is shown in the project's settings. Pages are served from GitHub's network. For real data both become IT's own hosting.

## How data gets in, and the ways it can get out
| Way out | Who | Control |
|---|---|---|
| Reading it on screen | People with the tool | Level and sharing rule |
| `Dame.download` from a tool | The person using the tool, for data he can already see | Through the shell: thirteen kinds of file, 100 MB, 20 a minute. Not written to the audit |
| A link a tool asks to open | The person, after seeing the full address and pressing the button | One at a time; the address itself may carry text |
| Copy and paste | Anyone, of what he can see | None possible |
| The fix request for the AI | A manager; it holds his page, not the site's rows | The screen says: take real names, prices and customer data out first |
| The project owner's dashboard | The owner | The account's sign-in |

There is no export built into the site, no API for other systems, no email sent with data, and no tool can call a server. The site itself sends data nowhere.

## What a delete really does
| Action | By | What goes | Can it be undone |
|---|---|---|---|
| Remove a row | A person with the level for it | That row | No |
| Delete a table (name typed) | Tool manager | The table and all its rows, live and preview | No |
| Delete a tool (id typed) | Space admin | Its two schemas with every table, its versions, access and managers in the core. The id is retired for good | No. Its files stay stored, unreachable |
| Delete a space (id typed) | IT admin | Every tool of the space as above, its members and admins | No |
| Switch a tool or a space off | Space admin; IT admin | Nothing. It is closed to its users until switched on | Yes |
| Switch an account off | IT admin | Nothing. The person is out; his rows and rights stay stored | Yes |
| Take a column away, change its kind, change a table's sharing rule | Nobody | Not possible | - |

> A delete on this site is final. There is no bin, and the site makes no backup of its own. Until export and IT's backups exist, "switch off" is the safe action and "delete" needs a second thought. The typed id is the only brake.

## Backup, restore, export
- **Demo:** whatever the Supabase plan gives. On the free plan that is nothing to rely on. No point-in-time restore.
- **What a full copy consists of:** the `core` schema, every `t_` schema, the bucket `tools`. All ordinary PostgreSQL tables and files; the hand-over to IT is exactly this copy.
- **Not built:** export of a table to a file by its manager, export of a whole space, restore of a deleted tool.

## How long things are kept
| Thing | Kept |
|---|---|
| Rows | Until someone removes them |
| Versions of a tool | All of them, for good: that is what makes roll back possible |
| Audit | For good; no archive, no cut-off |
| Sign-in sessions | For good |
| Switched-off accounts | For good |
| Files of deleted tools | For good, unreachable, until the clean-up is built |

None of this was chosen as a retention policy. It is the absence of one, and is listed as a gap. The target proposal in `docs/DECISIONS.md` is: restore 35 days, audit 3 years.

## Two people, one row
- Each write is one statement and locks the row for that instant. A row is never half of two saves.
- There is no version check: the later save overwrites the earlier one without telling anyone. `updated_by` shows who was last.
- Planned: the row carries a counter, and a save based on an old counter is refused with "someone changed this row, reload".

## Limits that protect the database
| Limit | Value |
|---|---|
| Tables per tool; columns per table | 10; 60 by default, set per space by IT (the quota) |
| One text value; one long text; one structured value | 1,000; 20,000; 100,000 characters |
| One row | 300,000 characters |
| Rows returned by one list | 100 by default, 1,000 at most |
| Pages in a version; one page; a version | 50; 20 MB; 200 MB |
| Requests from one open tool | 300 in 10 seconds (in the shell) |
| Files saved by a tool | 100 MB each, 20 a minute |
| Rows in a whole space | 10,000 by default, set per space by IT (the quota) |
| **Size in bytes, stored files, tools per space** | **No limit yet** |

## Why this way
- **A schema per tool** makes "whose data is this" a question of where it lies, not of a column someone could forget to filter.
- **The standard columns are written by the database**, so who added and who changed a row is a fact, not something a tool reports.
- **Nothing in the browser** means a shared or lost PC holds a session at most, and that session dies by the 12-hour rule or the next sign-in.
- **Delete is final** because a half-delete that keeps data somewhere "just in case" is how data outlives its owner's wish. The cost is the missing safety net, which export and backups must provide before real use.
