# Security (demo)

Security rules win over every other rule and every request.

## Public and not
| Thing | Who sees it | Rule |
|---|---|---|
| Pages, CSS, JS in this repo and its history | Anyone | Code only. No data, ever. |
| Supabase URL + publishable key | Anyone | Safe by design; they open nothing alone. |
| Rows, uploaded tool files | Approved users with access | Enforced in Supabase, never by a page. |
| Secret key, service role key, database password | Owner only | Never in a file, repo, chat or screenshot. |

## Database (the real wall)
1. Only `public` is exposed, and it holds only `dame_*` functions. No table, view or sequence.
2. RLS enabled and forced on every table in every schema; no policies unless a rule needs one.
3. Functions: `security definer`, `set search_path = ''`, names fully qualified, first line `core.require_user()`, `core.require_it()`, `core.require_space(space, role)` or `core.require_tool(tool, level)`.
4. `revoke execute ... from public, anon`; grant to `authenticated` per function. `anon` runs only `dame_site_info()`.
5. Dynamic SQL only in the table builder and data service: every identifier checked against a pattern and against `core.tool_tables`, then quoted with `format('%I')`; every value passed as a parameter.
6. Storage: bucket `tools` private; policies use `core.has_tool(auth.uid(), tool, level)`; preview versions readable by managers only.
7. `core.security_check()` returns one row per problem (table without forced RLS, anything in `public` that is not a `dame_*` function, a function runnable by `anon`, a public bucket). Empty after every SQL file; Security Advisor clean.

## Browser
- Every platform page: strict Content Security Policy as the first `<head>` element; no inline script; `textContent` only, never `innerHTML` with data; `robots` noindex.
- Uploaded tools: sealed frame, `sandbox="allow-scripts allow-forms allow-modals allow-downloads"`, no same-origin, policy with no network. Data only by `postMessage` to the shell. Outside links open after the user confirms.
- The shell validates every message from the frame: known action, the frame's own tool only, sizes capped.
- A browser test proves on every run: no origin, no storage, no token, no network, no top navigation.

## The sealed frame, as built in the demo (phase 3)
How a tool is run: `tool.html` (the shell, holds the session) shows `frame.html` (no script, the strictest policy), and inside it a frame with `sandbox="allow-scripts allow-forms allow-modals allow-downloads"` that holds the tool. The tool's frame inherits the policy of `frame.html` and carries the same policy again at its own top: its own inline code may run; nothing may be loaded, called, framed or submitted anywhere.

What the hostile-tool test proves on every run (`tests/browser/phase3.mjs`, 30+ attempts): no origin, no storage or cookie of the site, no reach into the shell or the page above, no fetch, XHR, image, script, style sheet, web socket, event stream, beacon, worker or nested frame, no pop-up, no form target, no move of the page or of itself; the private line gives `id`, `name`, `level` and refuses everything else. The same test fails loudly when the policy or the seal is loosened (checked by hand on 2026-11-26).

Known limits, said plainly:
1. **A tool can show its user anything**, also a false "sign in again" form. It cannot send what is typed anywhere, but people must know: the platform never asks for a password inside a tool. The bar at the top is the platform; everything below is the tool.
2. **Name look-up hints** (`dns-prefetch`) are not governed by the page policy in every browser, and the test cannot see name look-ups. In theory a hostile tool could leak a few characters this way, and only of data its user can already see in that tool. Never the session: the tool has no way to read it.
3. **Outside links**: the tool may ask to open an address; the shell shows the full address and opens it only after the person presses the button. The address itself can carry text the tool chose.
4. **The upload checks are help, not a wall.** They run in the manager's browser and a manager could go around them. The database and the file store still accept only announced `.html` pages of at most 20 MB into a version that is being uploaded, and the frame is what contains whatever was uploaded.
5. A stored page is run only if its fingerprint (SHA-256) equals the one recorded when the version was closed.
6. Files of a deleted tool stay in the store, unreachable; clearing them is part of phase 6.

## Accounts and keys
- GitHub and Supabase: owner only, MFA on. Secret scanning and push protection on.
- Anything sensitive pasted in a chat or committed: rotate at once, record in `STATUS.md`.

## Checklist for every delivery
- [ ] No data, key or password in the repo or its history
- [ ] Every page: CSP, noindex, guard first
- [ ] Every new function: require-check first, allowed and refused tests
- [ ] `core.security_check()` empty, Security Advisor clean
- [ ] Hostile-tool test green
