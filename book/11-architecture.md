# The pieces, and one click from start to end

This part of the book is for IT. Every chapter says how a thing is done, why it is done that way, what was considered and left out, and what its limits are. Names in `code style` are the real names in the repository, so anything here can be checked against the source.

=> Browser page | Shell (holds the session) | dame_* function | core check | table

## The five pieces
| Piece | Where it lives | What it holds | What it never holds |
|---|---|---|---|
| Platform pages | Repository, served by GitHub Pages | `index.html`, `hub.html`, `space.html`, `tool.html`, `frame.html`, `book.html`, `account.html`, the three admin pages, the kit in `kit/v1/`, the help texts in `help/` and this book in `book/` | Data, keys other than the publishable one |
| Sign-in service | Supabase Auth | Accounts, passwords (hashed), tokens | Roles, spaces, access: those are ours |
| Core | Schema `core` in the Supabase database | People, sessions, spaces, tools, roles, access, versions, table definitions, settings, audit | Anything a browser can reach directly |
| Tool data | One schema per tool, `t_<space>__<tool>`, and its preview copy `p_<space>__<tool>` | The rows of that tool's tables | Rows of any other tool |
| Tool files | Supabase Storage, private bucket `tools` | The uploaded pages of every version | Anything readable without the database saying yes |

## What a page is
- Plain HTML, CSS and JavaScript. No framework, no build step, no package, no CDN, no outside font. A page is the file you read in the repository.
- The first element of every page is its security policy. It allows scripts and styles from the site only, and network calls to the site and to one named database address.
- Every page loads `kit/v1/config.js` (the database address and the publishable key), `kit/v1/api.js` (sign-in, calls), `kit/v1/shell.js` (the bar, helpers), then its own script in `pages/`.
- Text is always written with `textContent`. No page builds HTML from data.

## One click, start to end: a person adds a row in a tool
:::lanes
The tool | Calls `Dame.table('requests').add({...})`. It runs in a sealed frame and cannot call anything itself
The kit | `dame.js`, inside the frame, sends a message over its private line: action `table.add`, table name, the row
The shell | `pages/tool.js` checks the message: a known action, a well-formed table name, a size limit, at most 300 requests in 10 seconds
The shell | Calls `dame_rows_add(space, tool, table, row, preview)` with **the person's own session**. Space and tool are the ones it opened: the tool cannot name another
The database | `core.rows_gate` runs `core.require_tool(space, tool, 'read')`: signed in, newest session, not older than 12 hours, approved, not switched off, has this tool
The database | Looks the table up in `core.tool_tables`. A table not listed there does not exist for the service
The database | Applies the sharing rule and the person's level, cleans the row against the column list, and sets `owner`, `created_at`, `updated_at`, `updated_by` itself
The shell | Passes the new row back over the line to the tool
:::

## Why it is cut this way
- **The browser is never trusted.** Pages show and hide; the database decides. A person who edits the page in his browser gains nothing.
- **A tool is never trusted.** It has no network and no token, so the worst it can do is ask the shell for things its user may do anyway.
- **One small surface.** 71 functions are the whole API. No table, view or sequence is exposed. Reviewing the API is reading those functions.
- **Everything derives from ids.** A tool's schema name, file path and address come from the space id and tool id. Nothing of that is stored twice, so nothing can drift apart.

## What was considered and not done
- **A framework (React or similar)**: needs a build step and packages from outside. Rejected: every dependency is something IT must trust and keep patched, and non-developers must be able to read a page.
- **The Supabase JavaScript library**: convenient, but large and able to reach tables directly. Rejected: plain `fetch` to named functions is easier to review and cannot do more than the functions allow.
- **Tools as files in the repository**: would need a GitHub token for tile admins. Rejected: no token exists; a tile admin never touches the repository.
- **Letting tools call the database themselves with the user's token**: rejected, because a tool would then hold the token.
