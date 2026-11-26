# Tool admin

1. **Files.** Choose all the tool's files together, or one zip. The site packs each page into one file, checks it and says in plain words what to fix. Up to 20 MB a page, 200 MB a version. A first tool to try is in `examples/hello-tool/`.
2. **Data.** Make a table: a name, its columns, and who shares the rows (private, team, reference). If the upload has a `dame.json`, the site lists its tables; read the list and press Create.
3. **Preview.** Only admins and managers see it. Preview has its own empty tables.
4. **Make live.** The older version is kept. Roll back brings it back.
5. **Access.** Give or take a level per person.
6. **Help text.** Write what the i icon shows: what the tool is for, how to use it, who to ask.

Every table gets five columns by itself: id, owner, created_at, updated_at, updated_by. Nothing is deleted without typing its name to confirm.
