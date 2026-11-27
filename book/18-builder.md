# The builder and the AI, in detail

The people who build tools are not developers. The builder exists so that they never need to be.

## The two ways
| Way | Steps |
|---|---|
| Build a new page | Describe > database question > starter kit to the AI > paste the answer > what the site found > upload |
| I already have a page | Choose the file (or paste) > what the site found > upload. A refused page gets one complete request for the AI |

One step is on screen at a time. "Next" does not move until the step is done.

## What goes OUT to the AI: the starter kit
One text, made by the site for this tool (`kit/ai-prompt.md` filled in):
- the rules of the site a tool must follow;
- the building blocks of `dame.css` with their class names;
- the functions of the kit (`Dame.ready`, `Dame.table`, `Dame.people`, `Dame.download`, ...);
- the libraries chosen from the shelf;
- if the tool saves data: how to list its tables, the column kinds, the sharing rules;
- a starting page with the tool's name;
- the person's own description;
- if he brought a page: that page, to be rebuilt.

**It holds no address, key, token, email or data.** A test checks that. The page tells the person: no real names, prices or customer data into the AI.

The platform itself calls no AI. The person copies the text into the AI his company approved. Whether the AI prompt is offered at all is a site setting owned by IT (`ai_mode`): `off`, `prompt` (the default: offered to the people who build), or `prompt_all` (offered to all members).

## What comes BACK: untrusted, like any upload
- The pasted answer is only **read** by the checker, in the hidden helper page `pack.html`. It runs nowhere at that point.
- The checker ignores the words an AI writes around the code, keeps the code block, adds the two kit lines if they are missing, and removes a page's own security policy and icons, and any hint that would make the browser look up or open an outside address.
- The code runs for the first time in the sealed frame, after upload, as a preview.

## What the check stops, and what it only notes
| Stops the upload | Why |
|---|---|
| A file, script, style, font or picture loaded from outside | Nothing from outside may run on the site |
| Its own `<header>`, `<nav>`, `<footer>` | The bar belongs to the site |
| A password field | The site never asks for a password inside a tool |
| Own fonts, own colours, a changed theme, pop-up boxes, more than 3000 characters of own styles | One look: a design of its own is refused, however good |
| Frames, background workers | Not allowed in the sealed frame |
| A library that is not on the shelf | Only approved libraries |
| Browser storage, cookies | The frame has none; data belongs in a table |
| A call to a server (`fetch`, XHR, web socket) | The frame has no network; data belongs in a table |
| No `index.html`, bad page names, over 20 MB a page | The database would refuse them |

| Noted, not stopped | |
|---|---|
| An outside address named in the code | Often only a comment; the format names of w3.org are not counted |
| No building block used | Plain HTML without styles still gets the site's look |
| Code saves to a table the page does not list | Saving would fail |

## The fix request: one complete text
Most people arrive with a stand-alone page made elsewhere, by an AI that never saw this site. "Follow the starter kit" means nothing to that AI. So for every refused page the site writes one text (`kit/ai-fix.md`, filled in) that is complete in itself:

| Part | Holds |
|---|---|
| 1. What the site found | Every stop, numbered, and every note |
| 2. How to rebuild | Keep what the tool does. Throw the old design away and map each part to a building block. Move everything kept or fetched into tables: one table per kind of thing, one column per field, the type and the sharing to choose, no own ids, users or roles. Libraries only from the shelf |
| 3. The rules of the site | The whole starter kit, with the database section when the page keeps anything and the shelf library when the page names Excel files |
| 4. The page | The refused page itself; a page over 120,000 characters is attached to the AI as a file instead, and the person is told |
| The answer | `index.html`, the help text, a list of tables to compare with the review window, and "Left out": what the old page did that a tool cannot do |

It works in the same AI chat or a new one. Like the starter kit it holds no address, key or person; but it holds the person's page, so the screen says to take real names, prices and customer data out first.

## The check is help, not the wall
It runs in the manager's browser. A manager who wants to could go around it. That is accepted, because:
- the database accepts only announced `.html` pages into a version being uploaded;
- whatever was uploaded still runs sealed, with no network and no session.

The check exists to save people time and to keep the site looking like one site.

## The shelf of libraries
- `kit/v1/lib/`, listed in `index.json`. One library so far: **ExcelJS 4.4.0** (MIT), the publisher's file byte for byte.
- Its SHA-256 is recorded and a test fails if the file changes.
- A tool names it with one line (`/_dame/v1/lib/exceljs.js`); the shell writes it into the page. It runs inside the sealed frame with the tool's rights: no network, no session.
- Only IT adds a library.
- Not yet done: checking the library against a list of known vulnerabilities at each release.

## Pages kept in the repo as examples
The builder offers none of them (owner, 2026-11-27: IT builds the common tools, departments build their own). They stay as examples and for the tests.
- `kit/starter/index.html`: the empty starting page.
- `kit/starter/tracker.html`: a list and a form that draw themselves from the table list in the page. Add a column in the review window and it shows by itself.
- `examples/`: a converter, the parts extractor (Excel in, Excel out), six department tools.

## Why this way
- **The AI never sees the site.** It gets public rules and a description; it returns a page. No account, no connection, nothing to leak.
- **One file per tool** is the simplest thing a non-developer can carry from an AI chat to the site.
- **The site fixes what it can and explains the rest**, so a first failed check is normal and not a dead end.

## Considered and not done
- **Calling an AI from the site** (an "ask AI" box): would need a key and would send text out from the site. Rejected for the demo; the copy-and-paste is slower but nothing leaves on its own.
- **Editing code on the site**: not built. The person goes back to the AI with the fix request.
