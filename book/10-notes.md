# Notes and changes

The running log of the site. Newest first. Every change to the site adds a line here and updates the chapter it touches.

## 2026-11-27
- **The book in pictures.** Owner: the people who decide have little time; the book read badly and presented badly. New first chapter "DAME in five minutes": the whole case on eleven slides, almost all pictures, with its own button. Seven kinds of picture (numbers, cards, chain, tree, walls, steps with who acts, compare) are drawn by the site from a few lines of text; they are in the key chapters too.
- **Presenting:** topic nodes on the left (hover shows the chapter, a press jumps to it), marks under the slide for the slides of the open chapter, a laser pointer, a spotlight and a pen, a progress line, and a red Close. Code and tables on a dark title slide are readable now.
- **The site book is shown to IT admins only**: the hub shows its card to them, and the book page opens for them only. It stays a set of files in the repository. Reason (owner): the whole site is built on the assumption that IT moves it to its own servers, inside the company's domains, where the web server decides who reaches a file. For one morning the text was moved into the database to lock it in the demo too; that was withdrawn, and the rule written down: the database is for what people enter and what must be checked per person; what the site is made of stays a file.
- **The book was reread against the repository** and now has four parts. New part "What a reviewer asks": threats one by one; who can give what to whom; where data lives and what happens to it; running it. Numbers corrected (64 functions, 1,024 database cases, ten SQL files).
- **Limits written down for the first time:** a manager decides his tool's code, so "private" does not hold against him; a manager may share his tool outside his department; removing a member leaves named access; a delete is final; nothing has a retention period; a push to the repository is live without review; the request limit sits in the shell.
- The fix request is now one complete text: the points, how to rebuild, every rule, the database rules, the page. Reason: people bring stand-alone pages made by an AI that never saw the site; the short request ("follow the starter kit") could not work there.
- A design of its own now stops the upload (colours, pop-up boxes, a changed theme, over 3000 characters of styles), and so does data kept outside the tables (browser storage, cookies, a call to a server). Before, some of these were only noted. Plain HTML without styles still passes and gets the site's look.
- The format name of SVG (a w3.org address inside the code) is no longer reported as an outside address.
- Tool page: "Tool admin" moved to the right end of the strip; the way back (Hub / space / tool) stays on the left.
- Space admin follows the same rule as IT admin: "Add a tool", tiles, and a window per tool. A new tool opens its window at once with "Build and access" in front.
- Icons are picked from 90 pictures kept in the site (Lucide, ISC); the database still keeps one short text (`i-fan`), so nothing changed there.
- Back buttons go to the page the person came from. A tool's manager is never pointed to the space admin page. The tab keeps a trail of page addresses for this, nothing else.
- IT admin, Spaces: the page was one long list with every field of every space open at once. Now: "Add a space" on top, a tile per space, and everything that changes or deletes a space inside the window its tile opens. Rule kept for later pages: a list shows, a window changes.

## 2026-11-26
- **Site book, part for IT**: thirteen chapters with how each thing is done, why, what was considered and left out, and its limits; a register of decisions; the questions IT will ask; every open gap.
- **Site book** added: this book, to read or to present.
- **New user** as in the earlier hub: username and temporary password, own password at the first sign-in.
- **Review window** for a page's database tables: see the columns read from the page, add more, then create. It opens after every check.
- An empty form field is saved as "no value" instead of being refused.
- **Colour and icon of a space** can be changed after it is made.
- **Information button** on every page; **usage guide** per tool; a tool that is not live explains how to build it.
- **Add by work email**: an address approved in advance is in at once.
- The **look** of the earlier hub: palette, mark, movement, day and night.
- The builder became a **guide**: three ways, one step at a time; the database question in plain words.
- Pages load about **twice as fast**.
- **Hardening** after playing seven departments: email domains, sign-ins in the audit, file saves through the site, a request limit.
- Phases 0 to 4 built: skeleton, sign-in, spaces and tools, sealed frame and versions, tables and data.

## Decisions worth remembering
- Uploaded code is never trusted. The frame and the database are the wall; the upload check is help.
- Tile admins never paste SQL and never touch the repository.
- IT admin does not see department data by being IT admin.
- The look follows the earlier DAME hub; no code or data was taken from it.
- Accounts made by IT with a temporary password are a demo stand-in, by the owner's decision; company sign-in replaces them.
- Charts will be a building block of the kit, not a second library.

- The finish (2026-11-26): the whole site was walked through on a phone and a desktop, day and night. One-line bar with an account button, a strip of parts on long admin pages, finger-sized targets, notch-safe, plain dates. No SQL, no change for tools.

- Admin pages as tabs (2026-11-26): one part on screen at a time on IT admin, space admin and tool admin; a tool's managers and delete field folded under one button. Only the showing changed, no right and no SQL.

- Accounts (2026-11-27): My account for every person (details, password, access, sign-ins); on the IT page a person is one line and a window, where IT corrects the account and resets a password with a temporary one. A temporary password counts 7 days and is asked again before anything opens. SQL file 010.

- Builder (2026-11-27): "Create tool" now leads straight to the tool's own admin page, where it is built; the settings window opens from the tile of a tool that exists. "Use a ready-made page" is removed: two ways remain. No SQL.

## Ideas noted, not decided
- Tell the people of a space when a new tool goes live.
- Show the table list in the review window in even plainer words.
- A button in each tool to report a problem to its manager.
