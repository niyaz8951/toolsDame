# Tables and rows, in detail

Contract 5: each tool has its own tables; every table has five standard columns and one sharing rule; the row rules are written by the platform, not by the tool.

## Who makes a table, and how
Nobody types SQL. The database holds a table maker (`db/07_data.sql`). From then on:
1. A page says what it needs, inside itself: `<script type="application/json" id="dame-tables">` with table names, columns and a sharing rule. (For a tool of several files, a `dame.json` with the same content.)
2. After the check, the review window shows that list. The manager may add columns.
3. He presses "Create in the database and go on". The page calls `dame_table_create(space, tool, name, sharing, columns)` (tool manager only).
4. The database checks every name against `^[a-z][a-z0-9_]{1,40}$`, refuses the five standard names, checks each column kind against a fixed list, and builds the `create table` statement itself with quoted names.
5. It creates the table twice (live schema and preview schema), turns forced row security on, takes every right away from the site's roles, and records the definition in `core.tool_tables`.
6. The audit gets `table.created`.

Adding a column later is `dame_table_add_column`; deleting a table is `dame_table_drop`, with its name typed.

## The fixed list of column kinds
| Kind | Stored as | Checked on every write |
|---|---|---|
| text | text | A string of at most 1,000 characters |
| longtext | text | A string of at most 20,000 characters |
| number | numeric | A number |
| bool | boolean | true or false |
| date | date | `YYYY-MM-DD` and a real date |
| choice | text | One of the listed choices |
| person | uuid | The id of a person |
| json | jsonb | At most 100,000 characters |

A tile admin cannot invent a kind, a default, a trigger or a constraint. That is what makes "tables from the site" safe.

## The five columns of every table
`id`, `owner`, `created_at`, `updated_at`, `updated_by`. The database sets them on every write. A row sent with any of them is cleaned: the tool cannot say who added a row.

## One row service for all tools
Five functions: `dame_rows_list`, `dame_rows_get`, `dame_rows_add`, `dame_rows_update`, `dame_rows_remove`, each taking `(space, tool, table, ..., preview)`.

Each call does this, in order:
1. **Gate** (`core.rows_gate`): for live data, the caller must have the tool at least at "read"; his level is worked out now. For the preview, he must be a manager.
2. **Definition** (`core.table_def`): the table is looked up in `core.tool_tables` for this space and tool. Not there: refused. The schema name is derived from the two ids, never taken from the caller.
3. **Rule**: the table's sharing rule and the caller's level decide (table below).
4. **Clean** (`core.row_clean`): only columns of the definition are accepted, each value checked against its kind. The whole row may have at most 300,000 characters.
5. **Write**: one statement, built with quoted names, values as parameters.

## The three sharing rules, exactly
| Rule | Read | Add | Change | Delete |
|---|---|---|---|---|
| team | Everyone with the tool sees all rows | contribute | Own rows: contribute. Anyone's: edit | approve |
| private | Each person only his own rows. Managers and admins do not see them either | contribute | Own rows only | Own rows only |
| reference | Everyone with the tool | Managers only | Managers only | Managers only |

For a private table, a row that is not yours answers "not found", the same as a row that does not exist. Nobody can test whether someone else has rows.

> What "private" does not promise: the tool's code runs with the rights of whoever has the tool open, and the tool's manager decides that code. A manager could publish a version that copies each person's private rows into a shared table of the same tool. Every version is kept unchanged with the name of who made it live; review by a second person before go-live closes this.

## Why the rules live in one function and not in row policies
- Tables are made on the fly by tile admins. With policies, each new table would need generated policies that must be exactly right; a wrong one is a silent leak.
- Here the rule is the same few lines for every table, read once, tested once (157 cases), and a new table cannot have a different one.
- Forced row security with no policy still sits behind it: without the function there is no way to a row at all.

## Lists
`list` takes exact-match filters, a sort column, a limit and an offset. Limit: 100 by default, 1,000 at most. Filter and sort columns must be columns of the definition (or standard ones). Empty values sort last.

## Limits
- Tables a tool and columns a table: the space's quota, below. By default 10 tables a tool and 60 columns a table.
- A column cannot be renamed, retyped or removed, and a table cannot change its sharing rule: make a new table. (Removing would silently destroy data; it waits for an export.)
- File columns are refused for now ("not built yet").
- **Two people changing the same row: the last save wins.** The row is locked for the instant of the write, so it never gets half of each, but the first change is overwritten without a warning. Planned: a version check.
- Row changes are not written to the audit one by one. Each row carries who changed it last and when.

## Quotas: how much of the database a space may use
Four limits per space, enforced by the database (`db/08_quotas.sql`), shown by the pages.

| Limit | Counts | Default | IT may set |
|---|---|---|---|
| Rows | Every row of the space: all its tools, live and preview together | 10,000 | 100 to 10,000,000 |
| Tools | Tools in the space | 10 | 1 to 200 |
| Tables | Tables in one tool | 10 | 1 to 100 |
| Columns | Own columns in one table | 60 | 1 to 200 |

- **Who sets them.** IT only: the site's default (for every space without limits of its own) and one space's own limits. On the IT admin page, Quotas: "Change the default" on top, one tile per space, and a window per space where its limits are changed.
- **Who asks.** An admin of the space, on his admin page under Quota: the numbers he wants and a sentence why. One request per space at a time; he can take it back. IT grants (with the numbers asked, or others), or declines with a sentence. The admin reads the answer on his page.
- **Nobody raises his own limit.** Asking is the space admin's function, deciding is IT's; neither can call the other's. An IT admin who is also admin of a space can do both, and both lines are in the audit with his name.
- **When the rows are used up.** Reading, changing and deleting work as before. Only a new row is refused, in every tool of the space, with: "the space has reached its limit of N rows... tell the admin of the space". The admin sees a warning from 80% used.
- **How rows are counted.** One number per space, raised by each added row and lowered by each deleted one in the same statement that checks the limit, so two people adding at once cannot both take the last free row. The number is counted again from the tables whenever the admin or IT looks, and when a table or tool is deleted.
- **A limit below what is used** deletes nothing. New rows, tools, tables or columns are refused until there is room.
- **Why tools are limited too.** Tables are limited per tool; without a limit on tools a space could still grow without end. With the defaults a space holds at most 10 tools and 100 tables.
- **In the audit:** `quota.set`, `quota.default_set`, `quota.requested`, `quota.request_taken_back`, `quota.granted`, `quota.declined`.
- **Not counted:** the size of a row (one row can still hold 300,000 characters), and the stored files of a tool's versions.

## Considered and not done
- **A free SQL console for tile admins**: planned for the last phase, as a function that connects with a per-space database role limited to that space's schemas, every statement audited. Until it exists and is tested, there is no free SQL for anyone but the owner.
- **Joins and searches inside the service**: not built. A tool lists rows and combines them itself.
- **Letting a tool create its own tables while running**: rejected. Tables are made by a manager's press, never by tool code.
