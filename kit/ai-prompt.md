# Prompt for an AI that builds a DAME tool

Copy everything below the line, add your description at the end, and give it to the approved AI. Do not paste real data, names or prices into the AI.

---

Build a small web tool for the DAME platform. Return complete files, ready to upload.

Rules:
1. Plain HTML, CSS and JavaScript. No framework, no build step.
2. In every page's head, exactly these two lines, and no other theme:
   `<link rel="stylesheet" href="/_dame/v1/dame.css">`
   `<script src="/_dame/v1/dame.js"></script>`
3. Nothing from outside: no CDN, external font, script, image, analytics or network call. If a library is needed, say which file I must add.
4. No header, sign-in, user menu or footer: the platform adds the top bar. Start with the tool's own content.
5. No real data, names, prices, keys or passwords in the files. No `localStorage` for work data.
6. All data through the `Dame` object:
   - `const me = await Dame.ready();` gives `{ id, name, level }`; level is `read`, `contribute`, `edit` or `approve`. Call it first.
   - `const t = Dame.table('name');`
   - `await t.list({ where: { column: value }, sort: '-column', limit: 100 })`
   - `await t.get(id)`, `await t.add({ ... })`, `await t.update(id, { ... })`, `await t.remove(id)`
   - `await Dame.files.upload(file)` returns `{ id, name }`; `Dame.files.url(id)` gives a link
   - `Dame.toast('text')` for short messages
   Every row also has `id`, `owner`, `created_at`, `updated_at`, `updated_by`; never set them.
7. Declare the tables in a file `dame.json`:
   `{ "dame": 1, "tables": { "<table>": { "sharing": "private|team|reference", "columns": { "<column>": "text|longtext|number|bool|date|person|file|json" or { "choice": ["a","b"] } } } } }`
   Table and column names: lower case letters, digits, underscore.
   Sharing: `private` = each user sees only his rows; `team` = everyone with the tool sees all rows; `reference` = everyone reads, only managers change.
8. Hide buttons the user's level does not allow (add needs contribute, changing others' rows needs edit, delete needs approve). The database refuses anyway; show its message.
9. Works on a phone (390 px wide) and a desktop. Usable by keyboard. Use the classes of `dame.css`: `dame-page`, `dame-card`, `dame-btn`, `dame-btn-primary`, `dame-input`, `dame-table`, `dame-row`, `dame-empty`.
10. Plain words on screen. Every error says what the user should do next. Show a clear empty state.

Return: `index.html`, any other pages, one `app.js` per page, `dame.json`, and three lines for the tool's info text (what it is for, how to use it, who to ask).

My tool:
