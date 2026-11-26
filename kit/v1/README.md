# Kit v1

What is in this folder, and who uses it. Contract 4: v1 only gets additions.

| File | Used by | State |
|---|---|---|
| `dame.css` | hub pages and every tool (`/_dame/v1/dame.css`) | theme and the building blocks (shown on `blocks.html`, listed in `kit/ai-prompt.md`) |
| `dame.js` | every tool (`/_dame/v1/dame.js`) | `Dame.ready`, `Dame.table`, `Dame.people`, `Dame.toast`, `Dame.drop`, `Dame.download`, `Dame.progress`, `Dame.pause`, page links, outside links; `Dame.files` is not built yet |
| `lib/` | tools, through the line `/_dame/v1/lib/<id>.js` | the shelf of approved libraries; see `lib/README.md` |
| `pack.js` | `pack.html`, the hidden helper of the tool admin page | reads the chosen files or zip, packs each page into one file, checks it |
| `config.js` | hub pages | Supabase URL and publishable key only |
| `api.js` | hub pages | base path, config check, sign-in, session, `DameApi.rpc('dame_...')` |
| `shell.js`, `shell.css` | hub pages | the platform bar, the page guard, small helpers; `hub-*` classes are not for tools |
| `icon.svg` | hub pages | tab icon |

## What a tool may rely on (never renamed or removed)
- The two lines in the page head, written exactly as in `docs/BEDROCK.md`.
- Every `dame-*` class in `dame.css` (the building blocks; see `blocks.html`).
- Variable a tool may set: `--dame-accent`. Variables a tool may read: `--dame-bg`, `--dame-surface`, `--dame-text`, `--dame-muted`, `--dame-line`, `--dame-ok`, `--dame-warn`, `--dame-radius`, `--dame-gap`.
- The `Dame` object as written in `docs/BEDROCK.md`.
- A link to another page of the same tool: `<a href="other.html">`. A link to an outside address asks the person first.

## What a tool may not rely on
Anything named `hub-*`, `shell.js`, `api.js`, `config.js`, `pack.js`. They belong to the platform and change freely.
