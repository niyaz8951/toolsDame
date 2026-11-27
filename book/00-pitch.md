# DAME in five minutes

One site for the working tools of every department. Built by the people who do the work. Controlled by IT.

:::chain
A person describes a tool | In his own words. No code
The site prepares it | Rules and building blocks for the approved AI
The site checks it | And says in plain words what to fix
It runs sealed | No internet, no session, no other team's data
IT stays in control | People, spaces, rules, audit
:::

## The problem today

:::cards
Tools live on laptops | Excel files and loose HTML pages. Nobody knows which copy is right | today
No sign-in, no shared data | A loose page cannot hold data safely for a team | today
AI builds a page in an hour | But nobody can publish it, share it or connect it to a database | new
IT cannot host every small tool | Reviewing each one by hand does not scale | limit
:::

> People are already building tools with AI. The question is where those tools run, and under whose rules.

## The idea: one site, three levels

:::tree
0 Hub | The home page. Run by IT: who gets in, which spaces exist, the rules
1 Space: Finance | One per department. Its admin decides its tools and its people
2 Tool: budget tracker | One page of work, with its own tables
2 Tool: currency converter | A calculator. Saves nothing
1 Space: Factory | Sees nothing of Finance
2 Tool: lead-time planner | Its own tables, its own people
:::

## Who decides what

:::chain
IT admin | Lets people in. Makes spaces. Sets the rules. Reads the audit
Space admin | Makes the tools of one department. Adds its people
Tool manager | Builds one tool and gives it to people, at a level
Member | Uses the tools he was given
:::

> IT admin can open every space, and every time IT opens a department's tool the audit says so. Private rows stay with their owner, even for IT. Every right is one row in the database and one line in the audit.

## From an idea to a live tool

:::chain
Describe | What the tool should do, in plain words
Starter kit | One text for the AI: site rules, building blocks, the description
Check | The site reads the answer and writes the fix request
Preview | Only its managers see it, on empty trial tables
Make live | Two presses. Roll back any time
:::

> No repository, no server, no SQL, no key, no IT ticket. Tables are made by the site from a fixed list of column kinds.

## Why uploaded code cannot do harm

:::walls
The sealed frame | The tool runs here. No network at all, no session, no storage, no way to another tool
The site's shell | Takes a short list of requests from the tool and adds the person's session itself
The database functions | 71 named functions. Each one first checks who asks and what he may do
The data | One schema per tool. No table is reachable from outside
:::

Every upload is treated as hostile. It does not matter who wrote it, a person or an AI.

## Proven, not promised

:::stats
33 | attacks from inside a tool. All blocked
1,260 | attempts by one department against another. All refused
1,193 | database cases: allowed and refused, for every function
7 | departments rehearsed, with 14 tools built through the site
0 | secret keys in the repository
:::

All of it is in the repository and can be run again by IT.

## What IT keeps in its hands

:::cards
Who gets in | Email domains, approval, switch-off at once | ok
Which spaces exist | And who their admins are | ok
The rules and the quotas | The AI setting, the shelf of libraries, how much each space may store | ok
The audit | Append-only. Nobody can change or delete it | ok
The code | Pages and database change only through IT | ok
The data | IT's own servers, inside the company's domains | ok
:::

## Demo today, IT's platform tomorrow

:::compare
Demo | IT's platform
Sign-in | Email and password | Company sign-in with second factor
Pages | A public test address | IT's servers, inside the company's domains
Database | One hosted test project | IT's database, IT's backups
Changes | The owner, by hand | IT's pipeline with review
Tools | Run sealed | The same tools, unchanged
:::

> The demo and the target keep the same seven rules. A tool built on the demo runs on IT's platform as it is.

## What is open, said plainly

:::cards
No second factor yet | Comes with company sign-in | warn
A manager publishes alone | Review by a second person is planned | warn
No export or backup of our own | Quotas are built; export is the last phase; backups are IT's | warn
A delete is final | No bin. "Switch off" is the safe action | warn
:::

Every gap, with what closes it, is in the chapter "Open gaps and hand-over".

## What we ask for

1. **Read** this book and run the tests. "Threats, one by one" and "Open gaps and hand-over" first.
2. **Decide**: adopt the design, change it, or stop.
3. **If adopted**: company sign-in and IT's hosting first. They close the largest gaps.

:::stats
2 | things IT replaces first: sign-in and hosting
7 | rules that stay the same
0 | tools to rewrite
:::
