# Security

The site assumes that every uploaded tool might be hostile, by mistake or on purpose. It is built so that this does not matter.

=> Uploaded code | Sealed frame, no network | Asks the site | Database decides

## The sealed frame
- A tool runs in a sealed frame under the site's bar. It has **no network at all**: it can load nothing and call nothing.
- It never sees the person's session. It cannot read the site's storage, the bar, or another tool.
- Its only way out is one private line to the site, with a short list of requests: who am I, my rows, the people of this tool, save a file, open a link (after the person agrees).
- Saving a file goes through the site: only named kinds (Excel, CSV, PDF, pictures, text), never a program.
- A tool that asks too fast is slowed down.

## The database is the wall
- No table is reachable from outside. The site can only call a fixed set of functions, and each one first checks who is asking.
- Row security is on and forced on every table.
- Signed out, pending, switched off, wrong space, wrong tool, level too low, someone else's row: each is refused by the database, with a test for each.

## The audit
- Append-only: nothing in it can be changed or deleted, by anyone.
- Sign-ins, approvals, accounts, spaces, tools, access, tables, uploads, go-lives, usage guides.

## How it was tested
| Test | What it shows |
|---|---|
| The hostile tool | 33 attack attempts from inside a tool: session, storage, network, other frames, file drops, flooding. All blocked. Control runs prove the test notices a leak. |
| The company rehearsal | 7 departments, 14 tools, 1,260 attempts by one department against another. All refused; nothing changed. |
| SQL tests | Ten files, 1,024 cases: for every function the allowed case and the refused ones. |

> All of this was run locally against the real database code. On the live demo, the parts not yet confirmed are listed in "Where we are".

## What no site can prevent
- A tool can **draw** anything, for example a fake form. The bar above it always shows the real tool and space. A second person reviewing before go-live is planned.
- Keys: the repository holds only the project address and the publishable key, which are public by design. A test fails on anything else.
- The people above the rules: whoever can change the page code or owns the database account. In the demo that is the owner; on the target it is IT's pipeline and administration.
- A tool's manager decides what his tool's code does with the rows of the people who use it. Versions are kept and named; a second reviewer is planned.
