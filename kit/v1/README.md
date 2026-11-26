# Kit v1

What is in this folder, and who uses it. Contract 4: v1 only gets additions.

| File | Used by | State |
|---|---|---|
| `dame.css` | hub pages and every tool (`/_dame/v1/dame.css`) | theme and the eight classes named in `kit/ai-prompt.md` |
| `dame.js` | every tool (`/_dame/v1/dame.js`) | empty until phase 3 |
| `config.js` | hub pages | Supabase URL and publishable key only |
| `api.js` | hub pages | base path, config check, sign-in, session, `DameApi.rpc('dame_...')` |
| `shell.js`, `shell.css` | hub pages | the platform bar, the page guard, small helpers; `hub-*` classes are not for tools |
| `icon.svg` | hub pages | tab icon |

## What a tool may rely on (never renamed or removed)
- The two lines in the page head, written exactly as in `docs/BEDROCK.md`.
- Classes: `dame-page`, `dame-card`, `dame-btn`, `dame-btn-primary`, `dame-input`, `dame-table`, `dame-row`, `dame-empty`, `dame-muted`.
- Variable a tool may set: `--dame-accent`. Variables a tool may read: `--dame-bg`, `--dame-surface`, `--dame-text`, `--dame-muted`, `--dame-line`, `--dame-ok`, `--dame-warn`, `--dame-radius`, `--dame-gap`.
- The `Dame` object as written in `docs/BEDROCK.md` (from phase 3).

## What a tool may not rely on
Anything named `hub-*`, `shell.js`, `api.js`, `config.js`. They belong to the platform and change freely.
