# Who can give what to whom

How rights are handed on, taken back and looked at. Every line here is a database function; the pages only offer the buttons.

=> IT admin | Space admin | Tool manager | Member

## The chain, in one table
| Right | Who gives it | Who takes it back | To whom it can go | In the audit |
|---|---|---|---|---|
| An account (approve, add, new user) | IT admin | IT admin (switch off) | Anyone; "request access" only from a listed email domain | `user.approved`, `user.added`, `user.created`, `user.switched_off` |
| IT admin | Another IT admin. The very first: the owner, once, in the SQL editor | Another IT admin | An approved person | `user.it_admin_on`, `user.it_admin_off`, `user.first_admin` |
| Space admin | An IT admin, or an admin of that space | The same; never the last one | Any approved person | `space.admin_added`, `space.admin_removed` |
| Member of a space | An admin of that space | An admin of that space | Any approved person | `space.member_added`, `space.member_removed` |
| "Open to everyone in the space", and at which level | An admin of that space, on the tool | The same | All members of the space | `tool.changed` |
| Manager of a tool | An admin of the tool's space | The same | Any approved person | `tool.manager_added`, `tool.manager_removed` |
| A tool, by name, at a level | A manager of the tool, or an admin of its space | The same | Any approved person | `tool.access_set` with the old and the new level, `tool.access_removed` |

Nobody gives a right to himself except an IT admin naming himself admin of a space, which leaves the same audit line as for anyone else.

## What each right opens, and what it does not
| Right | Opens | Does not open |
|---|---|---|
| IT admin | People, approvals, spaces, site settings, the whole audit, the site book | Any tool, any row. No level on anything |
| Space admin | Everything in that space: all its tools at the top level, their admin pages, the space's audit | Other spaces. Rows of a "private" table that are not his |
| Tool manager | That tool at the top level: its page, versions, tables, access list, usage guide, audit | The other tools of the space; the space's member list |
| Member of a space | The tools marked "open to the space", at the level set on each | Tools not marked so. Being a member alone opens nothing |
| A tool by name | That tool at that level | Anything else in the space |

## How the level is decided, once more in words
For every single request the database takes the highest of: manager or space admin (top level), the person's own entry on the tool, and the tool's "open to the space" level if he is a member. If the space or the tool is switched off, only its managers and admins get in. There is no cache: a change holds from the next click.

## The four levels against the three kinds of table
| Level | Team table | Private table | Reference table |
|---|---|---|---|
| Read | Sees all rows | Sees his own rows | Sees all rows |
| Contribute | Adds rows, changes his own | Adds, changes and deletes his own | Sees all rows |
| Edit | Changes anyone's rows | As contribute | Sees all rows |
| Approve | Also deletes rows | As contribute | Sees all rows |
| Manager | Everything | His own rows only | Adds, changes, deletes |

## Cases a reviewer asks about
**A new joiner in Finance.** IT approves or makes the account. The Finance admin adds him as a member: he gets every Finance tool marked open to the space, at each tool's level. Sensitive tools are not marked open: their manager adds him by name.

**One person from Marketing needs one Finance tool.** The tool's manager adds him by name at "read". He sees the Finance tile on his hub with that one tool in it. He is not a member of Finance and gets nothing else. Finance's admin did not have to agree; it is in Finance's audit.

**A person moves from Finance to Marketing.** Two steps, both needed: Finance's admin removes him as member (the "open to the space" tools go at once), **and** the managers of tools he was given by name take those away. Removing a member does not remove named access. IT's person window lists everything he can still open.

**A person leaves the company.** IT switches the account off: one press. Every session ends in the same statement. His memberships and named access stay stored but are dead, because every check first asks whether the account is active. His rows stay, marked as his. If he was the last admin of a space, IT names a new one.

**A contractor for three months.** The same account as anyone. There is no end date on an account or on access: somebody must switch it off. *(Not built: access that ends by itself.)*

**The manager of a tool leaves.** The space admin has the tool at the top level anyway and names another manager. A tool cannot be left without someone who can manage it, because its space always has an admin.

**A department wants a second admin.** An existing admin of the space, or IT, adds one. The last active admin cannot be removed.

**IT must look into a department's tool for a problem.** IT names itself admin of the space (audited), looks, and removes itself again (audited). Private tables stay closed to it.

**Someone should see the rows but never change them.** "Read" on the tool. If only some rows may be changed by few people, that table is "reference": everyone reads, managers change.

**Each person should see only his own entries.** A "private" table. Also the admin does not see them. The limit of that promise is in "Threats, one by one": the tool's manager controls the tool's code.

**A whole department gets read, three people get edit.** Tool open to the space at "read"; the three added by name at "edit". The higher one counts.

## Looking at who has what
| Question | Where |
|---|---|
| Who can open this tool, and at which level? | Tool admin page, access: managers, people by name, and whether it is open to the space |
| Who is in this space, who are its admins? | Space admin page |
| What can this one person open? | IT admin, People, Open: his spaces and tools with his level. The person sees the same on My account |
| Who gave it, and when? | The audit: IT sees all; a space admin his space; a manager his tool |

## Not built, said plainly
- **No groups.** A space's member list plus "open to the space" is the only group. A second group inside a department needs tools given by name.
- **No end date** on an account, a role or an access.
- **No regular review**: nothing asks an admin every quarter to confirm his list.
- **Removing a member leaves his named access**, as said above.
- **A manager may share outside his department** without the space admin. Every grant is audited; a rule that forbids it is one check.
- **No request button**: a person who lacks a tool asks its manager outside the site. *(Ideas with votes are planned for the next phase.)*

## Why this way
- **Rights are rows.** A row is easy to list, to audit and to remove, and it works at the next click.
- **Three hands, each with its own reach.** IT decides who exists and which spaces exist. A department decides its tools and its people. A manager decides one tool. None needs the other for the daily work, and none can do the other's.
- **Membership is weak on purpose.** If being in a space opened everything in it, one wrong member would see everything. A tool is open to the space only when its admin says so.
