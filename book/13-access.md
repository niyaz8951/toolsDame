# The access model, in detail

Contract 3: one model for the whole site, kept in the core, enforced by the database. Pages only show and hide.

## The tables that hold it
| Table | One row means |
|---|---|
| `core.profiles` | A person, with `status` and `is_it` |
| `core.spaces` | A space, with `active` |
| `core.space_admins` | This person is admin of this space |
| `core.space_members` | This person belongs to this space |
| `core.tools` | A tool in a space, with `active`, `open_to_space`, `open_level` |
| `core.tool_managers` | This person manages this tool |
| `core.tool_access` | This person has this tool at this level |
| `core.retired_ids` | An id that was used once and may never be used again |

## How a person's level on a tool is worked out
This is `core.tool_level(person, space, tool)`, in this order:
1. The person is not approved, or the tool does not exist: **no level**.
2. He is admin of the space, or manager of the tool: **approve**. This holds even when the space or the tool is switched off, so they can repair it.
3. The space or the tool is switched off: **no level** for everyone else.
4. Otherwise the highest of: his own entry in `core.tool_access`, and, if the tool is "open to the space" and he is a member, the tool's open level.

`core.has_tool(person, space, tool, level)` answers yes when that result is at least the level asked.

## The checks at the top of every function
| Check | Lets through |
|---|---|
| `core.require_login()` | A valid, newest, unexpired session. Used only by the start-page functions |
| `core.require_user()` | Also: approved, not switched off, own password chosen |
| `core.require_it()` | Also: IT admin |
| `core.require_space(space, 'admin')` | Also: admin of that space |
| `core.require_space_or_it(space)` | Admin of that space, or IT admin |
| `core.require_tool(space, tool, level)` | Has that tool at that level or higher |
| `core.require_tool_manager(space, tool)` | Manager of that tool, or admin of its space |
| `core.require_tool_of_space(space, tool)` | Admin of the tool's space |

A function that names a space or tool the caller has no right to gets the same answer whether the thing exists or not (`not_allowed`). Nobody can probe which ids exist.

## Which function needs what
| Who | Functions |
|---|---|
| IT admin | `dame_users_list`, `dame_user_set_status`, `dame_user_set_it`, `dame_user_create`, `dame_user_add`, `dame_user_add_remove`, `dame_users_added`, `dame_space_create`, `dame_space_set_active`, `dame_space_delete`, `dame_spaces_all`, `dame_setting_set`, `dame_settings_get`, `dame_audit_list` |
| Space admin (or IT where noted) | `dame_space_admin_get`, `dame_space_member_add/remove`, `dame_tool_create`, `dame_tool_update`, `dame_tool_set_active`, `dame_tool_delete`, `dame_tool_manager_add/remove`, `dame_audit_scope_list`; with IT: `dame_space_admin_add/remove`, `dame_space_update`, `dame_space_look_get/set` |
| Tool manager | `dame_tool_admin_get`, `dame_tool_access_set`, `dame_version_begin/seal/preview/make_live`, `dame_versions_list`, `dame_table_create/add_column/drop`, `dame_tables_list`, `dame_tool_help_set` |
| Has the tool | `dame_tool_open`, `dame_rows_list/get/add/update/remove`, `dame_tool_people`, `dame_tool_help_get` |
| Any approved person | `dame_me`, `dame_spaces_list`, `dame_space_get` (only his spaces), `dame_people_find` (admins and managers only) |
| Signed in, not yet approved | `dame_request_access`, `dame_password_done`, `dame_sign_out` |
| Nobody signed in | `dame_site_info` only |

## Rules that protect the model itself
- Nobody changes his own account or his own role.
- A space always has one approved admin: the last one cannot be removed.
- Switching an account off also removes its IT admin role and ends its session.
- An IT admin may name himself admin of a space. It is written to the audit. (With one person on the site, the demo could not start otherwise. IT can forbid it on the target so that two people are always needed.)
- Deleting a space or a tool needs its id typed, on the page **and again in the database call**.
- An id is checked against `core.retired_ids` when something is created: a deleted tool's id never comes back, so an old link or an old table name can never point at something new.

## Why this way
- **Roles are rows, not flags in a token.** A change takes effect at the next click, with no waiting for a token to expire.
- **Being IT admin is not a master key to data.** Running the site and reading a department's rows are different rights. Taking the second leaves a trace.
- **A space member gets nothing by being a member** except tools marked open to the space. Sensitive tools are given by name.

## Considered and not done
- **Roles inside the token** (custom claims): fast, but a removed right would live until the token expires, and editing claims needs the admin key. Rejected.
- **Database row policies per person** instead of function checks: with tables created on the fly, policies would have to be generated and kept right for every table. One checked service is smaller to review. See the data chapter.
- **Groups**: not built. A space's member list plus "open to the space" covers the demo.
