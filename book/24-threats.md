# Threats, one by one

Who could try what, what stops him, and what is left over. Ordered by how much the person already holds: a stranger first, the owner of the two accounts behind the site last. Every "stops him" names a mechanism of this book; every "left over" is also in "Open gaps and hand-over".

=> Stranger | Signed-in person | Department admin | Tool builder | IT admin | Account owner

## A stranger on the internet
| He tries | What stops him | Left over |
|---|---|---|
| To read data without an account | The database answers one function to a visitor, `dame_site_info` (name of the site, nothing else). No table is exposed | Nothing |
| To read the page code, the documents and this book | He can, in the demo: they are files of a public test site, and hold no data and no secret | The design is not a secret and does not rely on being one. On IT's servers the site sits inside the company's domains, and `book/` is closed to everyone but IT |
| To use the publishable key from the pages | It only names the project. Every function still wants a signed-in, approved person | Nothing |
| To make himself an account | Only an address of a listed email domain can ask; then an IT admin approves by hand. Until then every function answers `pending` | With no domain listed, anyone can ask (and wait). IT sets the domains once |
| To guess a password | The sign-in service limits tries by itself. The pages ask for 12 characters, mixed | No second factor, no lock-out of our own. Closed by company sign-in |
| To put the site inside a frame of his own page (click-jacking) | Every hub page refuses by script to run inside a frame | A script check, not a server header: GitHub Pages cannot send one |
| To send a person a link that acts for him (request forgery) | The session is not a cookie. It is sent by the page's own code in a header; a foreign page cannot make the browser add it | Nothing |

## A signed-in person with no special role
| He tries | What stops him | Left over |
|---|---|---|
| To open another department's tool by typing its address | `dame_tool_open` checks his level on exactly that tool. The answer is `not_allowed`, the same whether the tool exists or not | Nothing |
| To call the functions directly with his own session, without the pages | He gets the same 64 functions and the same answers. The pages add nothing he could go around | The limit of 300 requests in 10 seconds sits in the tool's shell, not in the database. Called directly, only the provider's own limits slow him |
| To raise his own level | Nobody changes his own account or role; levels are rows he has no function to write | Nothing |
| To read rows of a private table that are not his | The row service answers "not found", as for a row that does not exist | See the tool builder below |
| To fetch a stored tool file of another department by its path | The file store asks `dame_file_allowed` for every file | Nothing |
| To look up colleagues | Only IT admins, space admins and tool managers can search people. A tool gives its user the names of the people of that tool, never an email | Nothing |
| To read the site book | The hub shows it to IT admins only and the book page opens for them only | Show and hide, not a lock: in the demo a chapter is a file with an address. Closed by IT's web server on the target |
| To keep working after he left the company | Switched off by IT: his session is ended in the same statement; the next click is refused, files included | Somebody must switch him off. No link to HR or a directory in the demo |

## A department admin, or a tool's manager
| He tries | What stops him | Left over |
|---|---|---|
| To act in another space | Every admin function names a space and checks that he is admin of that one | Nothing |
| To make himself IT admin, or approve an account | Those functions start with `core.require_it()` | Nothing |
| To delete the audit lines about himself | The audit refuses update, delete and truncate for every role | Nothing |
| To break the database with a strange table | Tables come from eight column kinds and three sharing rules. No SQL, default, trigger or constraint of his own. 30 tables a tool, 60 columns a table | No quota on rows yet |
| To give his tool to the whole company | He can give it to any approved person, by name, at any level. That is his right, and each grant is in the audit | A department's data can be shared outside the department by its own manager. If IT wants a rule ("only members of the space"), it is one check in `dame_tool_access_set` |
| To publish a tool that misleads people | Nothing stops a tool from drawing. The bar above it always shows the real tool and space | A manager publishes alone. Review by a second person is planned |

## The builder of a tool, through the tool's own code
This is the case the site is built around: code written by an AI, pasted by a non-developer, possibly wrong, possibly hostile.

| The code tries | What stops it | Left over |
|---|---|---|
| To read the person's session | The session is held by the shell. The tool's frame has no origin and no request that returns a token | Nothing. 33 attempts in the hostile-tool test |
| To send data to a server | The frame's policy forbids every connection, frame, worker and form target | Name look-up hints are not covered by the policy in every browser: a few characters, of data that person can already see, could in theory leak. Never the session |
| To read or change another tool's rows | The shell adds the space and the tool itself; the code can only name a table of its own tool | Nothing |
| To do more than its user may | Each request runs with the level of the person who has the tool open | Nothing |
| **To act as its user inside its own tool** | Nothing: that is what a tool is. Code a manager uploads runs with the rights of whoever opens the tool, on that tool's tables | A manager who wants to can upload a version that copies each user's private rows into a shared table of the same tool. "Private" keeps rows from an admin who only looks; it does not hold against a manager who rewrites the tool. Each version is kept unchanged with who made it live, and review by a second person closes it |
| To drop a program on the PC | Saving goes through the shell: thirteen named kinds of file, 100 MB, 20 a minute | A document of an allowed kind can still hold anything a document can |
| To ask for a password | The check refuses a password field | A box drawn by hand cannot be forbidden. What is typed cannot leave. People are told: the site never asks for a password inside a tool |
| To freeze the page | The frame is one browser tab's work; the bar above it stays usable, the person leaves the tool | Nothing lasting |

## An IT admin who misuses the role
| He tries | What stops him, or shows it | Left over |
|---|---|---|
| To read a department's rows | Being IT admin gives no level on any tool. He must name himself admin of the space: `space.admin_added` in the audit, with his name | One person can do it alone. On the target, IT can require two |
| To read private rows | Not even as space admin | He could reset that person's password and sign in as him. `user.password_reset` is in the audit with both names, the person's own password stops working, and the start page tells him who reset it. Closed by company sign-in, where IT sets no passwords |
| To take over another IT admin | The same path, the same trace | Accepted for the demo |
| To remove the trace | The audit cannot be changed from the site by anyone | Only the owner of the database account can, see below |
| To lock the others out | He can switch another IT admin off or take his role; it is in the audit. Nobody changes his own account, so the site always keeps at least one IT admin | The owner repairs it in the SQL editor |

## Whoever holds the two accounts behind the site
The site is served from one GitHub repository and one Supabase project. Their owners are above every rule in this book.

| Account | What its holder can do | What protects it |
|---|---|---|
| Write access to the repository | Change any page. A page runs in every person's browser and holds his session, so changed page code can do anything that person can. One push to the main branch is live within minutes, with no second pair of eyes | The account's own sign-in with a second factor; push protection and secret scanning. On the target: IT's pipeline with review |
| Owner of the Supabase project | Read and change everything, drop the audit's triggers, read the sign-in service's tables | The account's own sign-in with a second factor. No key of this account is in any file |
| Another Pages site of the same GitHub account | Its scripts share the browser address of the site, so they could read a session kept there | Accepted for a demo with sample data. On the target the site has its own address |

> In the demo both accounts are the owner's. The code is written by an AI assistant working at the owner's instruction and pushed through the owner's session. That is fine for a demonstration and is exactly what IT's pipeline, review and own hosting replace.

## Things that are not attacks but end the same way
| Event | What happens | Left over |
|---|---|---|
| A manager deletes the wrong table, an admin the wrong tool | The name or id must be typed, on the page and again in the database call. Then the tables are dropped at once | No bin and no backup from the site. Irreversible |
| Two people save the same row | The last one wins; the row is never half of each | The first change is lost without a warning |
| The free plan pauses a project that is not used | Nothing answers until the owner wakes it in the dashboard | No uptime promise in the demo |
| A library on the shelf has a flaw | It runs inside the sealed frame like any tool code: no network, no session | No check against a list of known flaws yet |

## Why the order of trust is this one
- The less a person is trusted, the more walls stand between him and data: a stranger meets the database's closed door; a tool's code meets the frame, the shell and the database.
- Rights are only ever handed downwards (IT to space admin to manager to member), and each hand-over is one row and one audit line.
- What stays open sits at the top: people who already hold a role, and the two accounts. Those are answered by review, by a second person and by company sign-in, not by more code in a demo.
