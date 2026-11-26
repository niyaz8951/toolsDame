# The sealed frame, in detail

Every uploaded tool is treated as hostile. This chapter says exactly what contains it.

=> tool.html (the shell) | frame.html (no script) | the tool, sandboxed

## Three layers
1. **`tool.html`, the shell.** It is a platform page. It holds the session, draws the bar, and talks to the database.
2. **`frame.html`, the host.** A page with no script at all and the strictest policy. It exists so that the tool's frame inherits that policy from its parent.
3. **The tool's frame.** Created by the shell inside the host, with `sandbox="allow-scripts allow-forms allow-modals"` and the tool's page given as text (`srcdoc`), with the same policy written again at its top.

## What the sandbox flags mean
- `allow-scripts`: the tool's own code may run. Without it a tool could do nothing.
- `allow-forms`, `allow-modals`: forms and simple dialogs work inside the tool.
- **Not given: `allow-same-origin`.** The tool therefore has no origin: it cannot read the site's storage or cookies, cannot reach into the shell or any other frame, and has no storage of its own.
- **Not given:** `allow-top-navigation` (it cannot move the page), `allow-popups` (no new windows), `allow-downloads` (it cannot drop a file by itself).

## The policy inside the frame
`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'`

In words: the tool's own inline code and styles may run; pictures and fonts only if they are inside the page itself; **no connection to anywhere**, no frame inside it, no worker, no plug-in, no form sent anywhere.

`'unsafe-inline'` is safe here because the whole page is the upload: there is no trusted content in that frame to protect from it.

## How a tool is started
1. The shell calls `dame_tool_open(space, tool, preview)`. The database answers only if the person has the tool; it names the version and its pages with their fingerprints.
2. The shell downloads the page from the private file store with the person's token.
3. It computes the SHA-256 of the bytes and compares it with the fingerprint recorded when the version was closed. **A page that differs is not run.**
4. It replaces the two kit lines (`/_dame/v1/dame.css`, `/_dame/v1/dame.js`) with the real kit, written into the page. A shelf library line (`/_dame/v1/lib/<id>.js`) is replaced the same way. So a tool is written exactly as it would be for the company platform.
5. It puts the policy at the top, creates the sandboxed frame, and hands it one end of a private message line (a `MessageChannel` port).

## The private line: everything a tool can ask
| Request | What the shell does |
|---|---|
| `ready` | Answers `{ id, name, level }` of the person. Nothing else about him: no email, no token |
| `table.list / get / add / update / remove` | Calls the matching `dame_rows_*` function for **this** tool with the person's session |
| `people` | The names (id and name, no email) of the people who have this tool |
| `page` | Loads another page of the same tool version |
| `link` | Shows the full address to the person; opens it only after he presses the button. One at a time |
| `download` | Saves a file the tool made: only xlsx, xlsm, csv, txt, json, pdf, png, jpg, jpeg, docx, pptx, xml, md; 100 MB; 20 a minute |
| `error` | The tool's own script error, as text, shown in a strip (details to managers only) |

Anything else is refused. Every message is checked: known action, well-formed names, capped sizes, and at most 300 requests in 10 seconds.

## What the tool can never do, and why
| It cannot | Because |
|---|---|
| Read the session | The token lives in the shell; the frame has no origin and no line that returns it |
| Call any server | `connect-src 'none'`, and no frame, image, script, font or form may go out |
| Touch another tool's rows | The shell adds space and tool itself; the tool only names a table |
| Raise the person's level | Levels are worked out in the database for every call |
| Keep data in the browser | No origin, so no storage |
| Leave a program on the PC | Saving goes through the shell's list of file kinds |

## The hostile-tool test
`tests/browser/fixtures/hostile/index.html` is a tool written to attack: 33 attempts (origin, storage, the page above, fetch, XHR, images, scripts, style sheets, web sockets, event streams, beacons, workers, nested frames, pop-ups, form targets, moving the page, abusing the line, file drops, a flood). The test uploads it, makes it live, opens it as a real person, and checks every attempt was blocked. It was also run once with the seal loosened on purpose, to prove it then fails.

## Known limits
1. **A tool can draw anything**, also a false "sign in again" box. It cannot send what is typed anywhere. People must know: the site never asks for a password inside a tool. Review before go-live is planned.
2. **Name look-up hints** are not governed by the policy in every browser. In theory a hostile tool could leak a few characters of data its user can already see. Never the session.
3. **Links**: the address a tool asks to open can itself carry text. The person sees the whole address before it opens.
4. **One wall in the browser.** The demo has one address for everything; isolation is the sandbox. On the target each tool also gets its own address and the server sends the policy.

## Considered and not done
- **Giving each tool its own address** (the target design): GitHub Pages cannot do that without putting tools in the repository.
- **Allowing background workers** for heavy work: would need loosening `worker-src`. Rejected. Long work is done in steps with `await Dame.pause()`.
- **Letting a tool load an approved library from a CDN**: rejected. Approved libraries are served from the site's own shelf (one so far: ExcelJS 4.4.0, fingerprint tested).
