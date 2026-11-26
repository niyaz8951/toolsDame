# The audit, in detail

Contract 7: append-only. Who, when, what.

## What a row holds
`core.audit`: a running number, the time, the actor (person id), the action (a short name), the target, a small detail (as data), and the space and tool it belongs to.

## What is written
| Area | Actions |
|---|---|
| People | `user.requested`, `user.added`, `user.add_removed`, `user.created`, `user.password_chosen`, `user.status_changed` (approve, switch off, switch on), `user.email_changed`, `user.signed_in`, `user.first_admin`, IT admin given or taken |
| Site | `setting.changed` |
| Spaces | `space.created`, `space.changed`, `space.deleted`, `space.admin_added`, `space.admin_removed`, `space.member_added`, `space.member_removed`, switched on or off |
| Tools | `tool.created`, `tool.changed`, `tool.deleted`, `tool.manager_added`, `tool.manager_removed`, `tool.access_set`, `tool.access_removed`, `tool.help_set`, switched on or off |
| Versions | uploaded, made the preview, made live (also every roll back) |
| Tables | `table.created`, `table.column_added`, `table.deleted` |

Every one is written **inside the same database function that does the action**, in the same transaction. An action cannot succeed without its audit row, and a refused action leaves none.

## What is not written, on purpose
- **Row changes inside a tool.** A busy tracker would bury everything else. Each row carries `updated_by` and `updated_at` instead. If IT wants a full row history, it is one more table and a few lines in the row service.
- **Reads.** Nobody's reading of rows is logged.
- **Refused attempts.** A refusal changes nothing and is not recorded. (For the target: the server's own log has them.)
- **Secrets.** A temporary password, a usage guide's text, a row's content are never in the audit; only that it happened and how big it was.

## Why it cannot be altered
- The site's roles have no right on the table at all.
- Two triggers refuse every update, delete and truncate on it, for every role including the owner: "The audit is append-only".
- The only way in is `core.audit_add`, called from inside functions.

## Who reads it
| Who | Function | Sees |
|---|---|---|
| IT admin | `dame_audit_list` | Everything |
| Space admin | `dame_audit_scope_list(space)` | His space and its tools |
| Tool manager | `dame_audit_scope_list(space, tool)` | His tool |

Pages show it newest first, with names instead of ids and plain words for each action.

## Limits
- It stays in the same database. The target forwards it to IT's log system.
- It grows without limit; no archive yet.
- A database owner with direct access could drop the triggers. That is the owner account of the Supabase project, protected by its own sign-in; on the target it is IT's database administration.
