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

## Accounts and keys
- GitHub and Supabase: owner only, MFA on. Secret scanning and push protection on.
- Anything sensitive pasted in a chat or committed: rotate at once, record in `STATUS.md`.

## Checklist for every delivery
- [ ] No data, key or password in the repo or its history
- [ ] Every page: CSP, noindex, guard first
- [ ] Every new function: require-check first, allowed and refused tests
- [ ] `core.security_check()` empty, Security Advisor clean
- [ ] Hostile-tool test green
