# Open gaps and hand-over

Everything that is weaker than a production system, in one place, with what closes it.

## Closed during the build
- A forgotten password blocked a username account > IT resets it with a temporary password.
- A leftover sign-in could have finished a password change in the person's place > the temporary password is asked again at the end.
- Anyone could ask for access > email domains set by IT.
- Sign-ins were not audited > they are.
- A tool could start any download > saving goes through the shell with a list of file kinds.
- A tool could flood the database > 300 requests in 10 seconds.
- A tool whose code failed showed a blank page > its manager sees the error in words.
- An empty date from a form was refused > saved as "no value".

## Open: sign-in and accounts
| Gap | Risk | Closed by |
|---|---|---|
| Email or username with password; no company sign-in, no second factor | A guessed or shared password | Company sign-in |
| Password strength is the sign-in service's setting | Weak passwords if left at the default | One setting in Supabase now (12 characters); company sign-in later |
| Accounts made by IT: IT knows the temporary password until first sign-in | Misuse in that window | Forced change is enforced; company directory later |
| `dame_user_create` and `dame_user_password_reset` write into the sign-in service's tables | May break when Supabase changes them | Not part of the target |
| A forgotten password always needs IT; no reset by email | IT must be reachable, and must be sure who is asking | Company sign-in |
| An IT admin can reset anyone's password, another IT admin's too | He could sign in as that person; it is in the audit and the person is told | Company sign-in |
| No second factor, no lock-out of our own after wrong tries | Only the sign-in service's own limits | Company sign-in |
| No end date on an account, a role or an access; no regular review of lists | A contractor or a mover keeps rights until someone removes them | End dates and a review reminder; the directory on the target |
| The rule for a person's own password is checked by the page and the sign-in service, not the database | A person who goes around the page gets only the service's minimum length | One setting in Supabase now (12 characters); company sign-in later |
| "Add by email" and the domain rule trust the address | Only as strong as email confirmation, which must stay on | Company sign-in |

## Open: publishing
| Gap | Risk | Closed by |
|---|---|---|
| A manager publishes alone | A misleading tool (for example a fake form) goes live unseen | Review by a second person before "Make live" (planned) |
| The upload check runs in the browser | A manager can skip it | Accepted: the frame and the database are the wall |
| Files of a deleted tool stay stored | Space only; they are unreachable | Clean-up in the last phase |
| A manager decides his tool's code, and that code acts as each user inside the tool | A version could copy users' private rows into a shared table of the same tool | Review by a second person; versions are kept with who made them live |
| A manager can give his tool to anyone on the site | A department's data shared outside it without its admin | Audited today; a "members only" check if IT wants it |
| Removing a member of a space leaves tools given to him by name | A mover keeps some access | One "remove from everything in this space" action; meanwhile the person window lists it |

## Open: data
| Gap | Risk | Closed by |
|---|---|---|
| No quota on rows, tables per space, or stored files | A runaway tool fills the free plan | Quotas (last phase) |
| Last save wins on the same row | A change is overwritten without warning | A version check on update |
| No export, no site-level backup | Loss depends on the Supabase plan | Export (last phase); IT's backups |
| Row changes are not in the audit | No history of a row | A history table, if IT wants it |
| A delete (row, table, tool, space) is final | A mistake cannot be undone from the site | Export and IT's backups; "switch off" until then |
| Nothing has a retention period: audit, sessions, versions, switched-off accounts stay for good | Growth; data kept longer than needed | A policy set by IT (proposal: restore 35 days, audit 3 years) |
| The request limit of a tool sits in the shell | A signed-in person calling functions directly is slowed only by the provider | A limit in the database or at IT's gateway |
| What a tool saves as a file is not audited | No record of who exported what | An audit line per download, if IT wants it |
| Personal data: names and emails of staff | Needs a data-protection view before real use | IT and the data-protection officer |

## Open: hosting
| Gap | Risk | Closed by |
|---|---|---|
| GitHub Pages cannot send security headers | The policy is a tag in each page; framing is refused by script only | IT's web server |
| A push to the main branch is live at once, with no review and no staging | Whoever holds write access changes the pages every person runs | IT's pipeline with review |
| The demo is a public test site: the repository, its `docs/` folder and this book are files anyone can fetch. The book is only shown to IT admins, not locked | The design and its limits are readable by someone who knows the address | Accepted: nothing in them is a key or data, and the design does not rely on being hidden. On IT's servers, inside the company's domains, the web server closes `book/` to everyone but IT |
| No health page, no alerts, refused attempts not counted on the site | A problem is noticed by a person, late | Health page (next), IT's monitoring |
| One address for the whole account's Pages sites | A script on another site of the account could read a DAME session in the browser | Accepted for sample data; IT's own address |
| One browser wall for tools | Isolation is the sandbox alone | A separate address per tool on the target |
| Free plan: pauses when unused, no uptime promise | The demo may be asleep | IT hosting |
| The audit stays in the same database | Not forwarded | IT's log system |
| The shelf library is not checked against a vulnerability list | A flaw in it; it runs sealed, with no network and no session | A check at each release |

## What is not built at all yet
Pinned notes and ideas with votes; the per-space SQL console; quotas; a health page (per space and for IT); export; groups; end dates on access; charts as a building block; file columns; a space admin tightening site settings for his space.

## Hand-over: what moves to IT's platform unchanged
- **Every tool, as uploaded.** Tools are written against two kit lines and the `Dame` functions. They know no address, no key and no SQL.
- **Table definitions** (`core.tool_tables`) and the rows (ordinary PostgreSQL tables).
- **People, spaces, tools, roles, access** (the core tables).
- **The audit.**
- **The seven rules** and the tests that check them.

## Hand-over: what IT builds or replaces
| Part | From | To |
|---|---|---|
| Sign-in | Supabase Auth | Company sign-in with second factor |
| Pages | GitHub Pages | IT's web server, security headers, own address, an address per tool |
| Functions and data | One Supabase project | IT's database; a database per space in the target design |
| Tool files | Supabase Storage | IT's file store |
| Changes | Owner pastes SQL | Pipeline with staging |
| Secrets | None in the demo | IT's vault |
| Logs | In the database | IT's log system |
| Files written for IT (`book/`, `docs/`) | Files of a public test site, shown to IT admins only | Closed by IT's web server to everyone but IT |

## The order that makes sense
1. IT reads this book and `docs/IT-REVIEW.md`, and runs the tests.
2. IT decides: adopt the design, change it, or stop.
3. If adopted: sign-in and hosting first (they close the largest gaps), then review-before-live, quotas, export.
