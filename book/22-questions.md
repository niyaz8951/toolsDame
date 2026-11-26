# Questions IT will ask

Short answers. Each points to the chapter with the detail.

## About exposure
- **What can someone on the internet do without an account?** Load the pages (code only, no data) and call one function, `dame_site_info`. Nothing else answers. *(The database)*
- **What is in the repository?** Pages, the kit, SQL files, tests, documents. No data. Two values that look like secrets and are not: the project address and the publishable key. *(The pieces)*
- **Why is a key public?** It identifies the project to the data API, like an address. It grants nothing: every function still needs a signed-in, approved person and checks his rights. The secret keys of the project are in no file and were never asked for.
- **Could someone list our tables?** No table, view or sequence is exposed. Only 58 named functions. *(The database)*

## About people
- **Who decides who is in?** IT: listed email domains plus approval, or accounts IT makes. *(Identity)*
- **What happens the minute someone leaves?** IT switches the account off. His session ends at once; the next click is refused, files included. His rows stay. *(Identity)*
- **Does IT see passwords?** Only a temporary one it sets itself, which must be replaced at the first sign-in; the database enforces that. *(Identity)*
- **Second factor?** Not in the demo. Company sign-in brings it. *(Open gaps)*

## About departments
- **Can Finance's rows be read by Marketing?** No. Every call names a space and a tool, and the database checks the caller's level on exactly that tool. 1,260 cross-department attempts were refused in the rehearsal. *(Access; Tests)*
- **Can a department admin see private rows of his own people?** Not in a "private" table. *(Tables and rows)*
- **Can IT read a department's rows?** Not as IT admin. Only after naming itself admin of that space, which is in the audit. *(Access)*

## About uploaded code
- **A team uploads a page that steals sessions. What happens?** It cannot. The page runs with no origin and no network; the session is in the shell and no request returns it. *(The sealed frame)*
- **A page tries to send data to a server.** Every connection is forbidden by the frame's policy. *(The sealed frame)*
- **A page shows a fake login box.** It can draw one. It cannot send what is typed. People are told the site never asks for a password inside a tool; review before go-live is planned. *(The sealed frame, limits)*
- **AI-written code: who checks it?** The site checks it for the things that would break the rules, and then it runs sealed regardless. Nobody has to trust the AI. *(The builder)*
- **Does our data go to an AI?** No. The site sends nothing to any AI. A person copies a text of public rules and his own description. *(The builder)*

## About the database
- **SQL injection?** Values are parameters. The only names put into SQL are checked against a pattern, looked up in the site's own list, and quoted. Tested with hostile names. *(The database; Tables and rows)*
- **Who can run SQL?** The owner, in the project's own editor. Nobody else, until the audited per-space console is built. *(Tables and rows)*
- **Can a tile admin break the database by making tables?** He chooses from eight column kinds and three sharing rules; limits are 30 tables and 60 columns per tool. No defaults, triggers or constraints of his own. *(Tables and rows)*
- **Backups?** Whatever the Supabase plan gives; not something to rely on in the demo. *(Open gaps)*

## About proof
- **How do we know it holds?** 899 database cases, five browser test files, a hostile tool with 33 attacks, a rehearsal of seven departments, and control runs showing the tests fail when the wall is loosened. All in the repository, all re-runnable. *(Tests)*
- **Was it tested on the real project?** Sign-in, spaces, tools, a real upload and a tool that saves rows: yes, by the owner. The newest SQL files: as they are pasted. *(Where we are)*
- **What is the audit worth?** It is written in the same transaction as the action, and updates, deletes and truncates are refused by triggers. *(The audit)*

## About the future
- **Can this go to production as it is?** No. It is a demonstration with sample data. *(Open gaps)*
- **What carries over to IT's platform?** The seven rules, every tool as uploaded, the table definitions, the rows, the audit. *(Open gaps and hand-over)*
- **What would IT replace?** Sign-in, hosting with security headers, the database server, the file store, the pipeline, backups, log forwarding. *(Open gaps and hand-over)*
