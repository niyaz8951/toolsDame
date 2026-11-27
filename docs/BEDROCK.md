# Bedrock: the seven contracts that never change

Every tool is built against these and nothing else. The demo (GitHub Pages + Supabase) and IT's platform both keep them, so a tool moves from one to the other unchanged. A change that would break one is not made; a new version is added beside the old.

| # | Contract | What is fixed |
|---|---|---|
| 1 | Identity | One person = one hub user id. Tools never have logins, passwords or user lists. |
| 2 | Structure | Hub > Space > Tool, three levels. Ids permanent, never reused. Every address and database name is derived from ids. |
| 3 | Access | Roles: IT admin, space admin, tool manager, member. Levels: read < contribute < edit < approve. Held in the core, enforced by the database. |
| 4 | Tool kit | `/_dame/v1/dame.js` and `/_dame/v1/dame.css`. v1 only gets additions. |
| 5 | Data | A tool's own schema. Five standard columns on every table. Three sharing presets. Row rules written by the platform. |
| 6 | Releases | Upload > check > preview > make live > roll back. Versions immutable. |
| 7 | Audit | Append-only: who, when, what. |

## Roles
| Action | IT admin | Space admin | Tool manager | Member |
|---|---|---|---|---|
| Approve users, disable a user | yes | - | - | - |
| Create, switch off, delete a space; name its first admin | yes | - | - | - |
| Name or remove admins of his space | yes | yes | - | - |
| Create, switch off, delete a tool in his space; name its managers | every space | yes | - | - |
| Give and take access to a tool | every tool | yes | his tool | - |
| Upload, preview, make live, roll back | every tool | yes | his tool | - |
| Create and change tables | every tool | yes | his tool | - |
| Read the audit | all | his space | his tool | - |
| Site settings (AI, quotas) | yes | may tighten for his space | - | - |

- A space always has at least one admin; the last one cannot be removed.
- Nobody can raise himself or act outside his space.
- A disabled account loses everything at the next request.
- Access to a space does not open its tools; each tool is granted on its own or marked "open to the space".
- A space admin has the top level on every tool of his space. An IT admin acts as admin of every space (owner, 2026-11-27); opening a tool he is not named in is audited. Private rows stay with their owner for everyone.

## Tool kit v1
```html
<link rel="stylesheet" href="/_dame/v1/dame.css">
<script src="/_dame/v1/dame.js"></script>
```
```js
const me = await Dame.ready();            // { id, name, level }
const t = Dame.table('bids');
await t.list({ where: { status: 'open' }, sort: '-due', limit: 100 });
await t.get(id); await t.add(row); await t.update(id, patch); await t.remove(id);
await Dame.files.upload(file); Dame.files.url(fileId);
Dame.toast('Saved');
```
No address, key, password or SQL in a tool.

## Tables
Standard columns, set by the database: `id`, `owner`, `created_at`, `updated_at`, `updated_by`.
Column types: `text`, `longtext`, `number`, `bool`, `date`, `choice`, `person`, `file`, `json`.

| Preset | Reads | Writes |
|---|---|---|
| private | each user, own rows | each user, own rows |
| team | everyone with the tool | contribute: add, change own; edit: change any; approve: delete |
| reference | everyone with the tool | tool managers only |

`dame.json` (optional, in the upload):
```json
{ "dame": 1, "tables": { "bids": { "sharing": "team", "columns": {
  "project": "text", "capacity_kw": "number", "due": "date",
  "status": { "choice": ["open", "won", "lost"] } } } } }
```

## Site rules every tool follows
1. Use `dame.css`; a tool sets only its accent colour.
2. No header, sign-in or user menu of its own: the platform bar has them.
3. Nothing from outside: no CDN, font, script, tracker or outside call.
4. No real data, names, prices, keys or passwords in the files.
5. Data only through `dame.js`.
6. Works at 390 px and desktop; keyboard usable.
7. Plain words; every error says what to do next.
8. 20 MB a file, 200 MB a version.
