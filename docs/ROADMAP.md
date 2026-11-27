# Roadmap

What the site is for, in one sentence: **every piece of work that crosses teams is one item, exactly one team holds it at a time, and each team sees only what was handed to it; each team builds its own tools for its own step.**

Two tiers on one core (sign-in, access, audit, one look):

| | Department tools | Process tools (Relay flows) |
|---|---|---|
| Who builds | Any team, with AI, from the site | IT, with the business owner of the process |
| Scope | One space | Across spaces, along the value chain |
| Trust | Untrusted, sealed frame | Part of the platform |

The test for every feature: does it help someone answer faster **what do I do next, who has it, where does the chain lose time?** If not, it waits. Daikin's way: reliable and simple first; one way to do each thing.

## Is it worth building? (checked 2026-11-27)
- Low-code suites (Microsoft Power Platform, ServiceNow App Engine, Kissflow and others) each cover department apps and cross-department workflows. None is ruled out; IT may well choose one.
- Cost at this size is real: Power Apps Premium is listed at 20 USD a user a month, 12 USD from 2,000 seats (Microsoft's price page, November 2026). 5,000 people at 12 USD is about 720,000 USD a year at list price, before data capacity.
- What this site does that a suite does not give in one simple place: tools any team builds with AI as plain HTML, run sealed so they cannot harm; the chain as everyone's home page; tools hung on the step they serve; no licence per person; all of it readable code and SQL that IT owns.
- The honest risk: IT may prefer to rebuild the idea on a platform it already runs. Then this site is the working specification, and the seven contracts, the Relay rules and the tests carry over. Either way the work is not lost.

## Done
1. The master site: spaces, tools built from the site, tables from the site, sealed frame, releases, quotas, accounts, audit.
2. Relay: flows, checklists, pick up, pass on, answer back, send back, close, history.
3. The hub as home: My work, the chain, shortcuts, spaces. Tools on the chain.
4. Need to know: each team sees only its own hand-overs. Pull limits per team. The "I am blocked" flag.

## Next, in this order
Relay is built on lean methods the company already knows; each step adds one.
5. **Flows as standard BPMN files** (export), so IT can run them on an open-source engine (Flowable, Operaton) if it wishes.
6. **Circulated approval (ringi)**: one item to several teams at once; it moves on when all have answered.
7. **Ideas on each hand-over (kaizen)**: the two teams of a hand-over post and vote; an accepted idea becomes a checklist line.
8. **Share what was solved (yokoten)**: before escalating, a team sees similar closed items it was part of.
9. **A process owner per flow** (a person of the business, who sees the whole flow), and **flow versions**: draft, test, live.
10. **Fields per stage**, each marked "stays with us" or "handed over".
11. **One project list** across flows; a won query starts the order flow.
12. **Cover**: a deputy per stage, and late items raised to the space admin.
13. **Health**: per space and for IT.

## Later, on IT's platform (the demo has no server of its own)
- **Company sign-in** in place of email and password.
- **Outlook and Teams**: a message when an item arrives or is late, with a link to it; an item started from an email.
- **Salesforce**: a "Start Relay query" button on a quote, carrying the project; the item keeps the link.
- **SharePoint**: documents stay there; the item holds the link.
- **Power BI**: the chain's numbers (time per stage, send-backs) as a data source.
- **AI on a tile**: the site setting already decides whether AI is off or prompt-only. On IT's platform the approved AI can be called from the server: suggest similar closed items before an escalation, draft a checklist from send-back reasons, help build a tool. Never from inside a tool's sealed frame.
- Every integration goes through the same `dame_*` functions as the pages, so it obeys the same rules.

## What goes where (for the move to IT)
- **Repository (files):** pages, kit, help, the site book, SQL files, tests. No data.
- **Database:** what people enter and what must be checked per person: accounts, rights, rows, flows, items, history, shortcuts, settings.
- Supabase-specific places are marked `SUPABASE:` in `db/`; nothing else depends on it.
