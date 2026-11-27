# Questions IT will ask

Short answers. Each names the chapter with the detail. Where the honest answer is "not yet", it says so.

## Exposure
- **What can someone on the internet do without an account?** Load the pages (code, no data) and call one function, `dame_site_info`. Nothing else answers. *(The database)*
- **What is in the repository?** Pages, the kit, SQL files, tests, documents. No data and no secret. Two values that look like secrets and are not: the project address and the publishable key. *(The pieces)*
- **Why is a key public?** It names the project to the data API, like an address. It grants nothing: every function still wants a signed-in, approved person. The secret keys are in no file and no part of the site uses them. *(Running it)*
- **Could someone list our tables?** No table, view or sequence is exposed. Only 64 named functions. *(The database)*
- **Is the design itself a secret?** No. The code, its documents and this book are files of a public test site. Nothing in them is a key or data, and the design does not rely on being hidden. On IT's servers the book's folder is closed to everyone but IT. *(The decisions)*
- **Why is this book not locked in the database?** The database is for what people enter and what must be checked per person. What the site is made of stays a file, because the whole site moves to IT's servers and domains, where the web server decides who reaches it. *(The decisions)*

## People and sign-in
- **Who decides who is in?** IT: listed email domains plus approval by hand, or accounts IT makes. *(Identity)*
- **What happens the minute someone leaves?** IT switches the account off. His sessions end in the same statement; the next click is refused, files included. His rows stay. *(Identity)*
- **And if nobody tells IT?** Then he stays in. There is no link to HR or a directory in the demo, and no end date on an account. *(Who can give what to whom; Open gaps)*
- **Does IT see passwords?** Only a temporary one it sets itself, which must be replaced before anything opens; the database enforces that. *(Identity)*
- **Could an IT admin sign in as someone else?** By resetting that person's password, yes. It is in the audit with both names and the person is told. Company sign-in removes the path. *(Threats)*
- **Second factor? Lock-out after wrong tries?** Not in the demo. Company sign-in brings both. *(Open gaps)*
- **A laptop left signed in?** One session per person, 12 hours. A sign-in elsewhere ends the older one; a reset by IT ends all. *(Identity)*

## Rights and sharing
- **Who can give access to what?** IT makes spaces and names their admins. A space admin makes tools, adds members, names managers. A manager gives his tool to people by name, at a level. *(Who can give what to whom)*
- **Can Finance's rows be read by Marketing?** Only if a Finance manager gave that person the tool. Otherwise no: 1,260 cross-department attempts were refused in the rehearsal. *(Access; Tests)*
- **Can a manager share his tool with someone outside his department?** Yes, by name, and it is audited. If IT wants "members only", it is one check. *(Who can give what to whom)*
- **Can a department admin see private rows of his own people?** Not by looking. A manager who rewrites the tool's code could copy them; versions are kept with names, and a second reviewer is planned. *(Threats; Tables and rows)*
- **Can IT read a department's rows?** Not as IT admin. Only after naming itself admin of that space, which is in the audit. *(Access)*
- **A person changes department. What must be done?** The old space's admin removes him as member, and the managers of tools he had by name take those away. Both. IT's person window shows what is left. *(Who can give what to whom)*
- **Where do I see who has what?** Per tool on its admin page, per space on the space admin page, per person in IT's person window. Who gave it and when: the audit. *(Who can give what to whom)*
- **Is a removed right gone at once?** Yes. Rights are rows read on every request; nothing waits for a token to expire. *(Access)*
- **Groups? End dates? A regular review?** Not built. *(Open gaps)*

## Uploaded code
- **A team uploads a page that steals sessions. What happens?** It cannot. The page runs with no origin and no network; the session is in the shell and no request returns it. *(The sealed frame)*
- **A page tries to send data to a server.** Every connection is forbidden by the frame's policy. *(The sealed frame)*
- **A page shows a fake login box.** It can draw one. It cannot send what is typed. People are told the site never asks for a password inside a tool; review before go-live is planned. *(The sealed frame)*
- **AI-written code: who checks it?** The site checks it for what would break the rules, and then it runs sealed regardless. Nobody has to trust the AI. *(The builder)*
- **Does our data go to an AI?** The site sends nothing to any AI. A person copies a text of public rules and his own description; with a page of his own, that page. The screen tells him to take real data out first. *(The builder)*
- **Can a tool put a program on a PC?** No. Saving goes through the site: thirteen kinds of document, never a program. *(The sealed frame)*
- **Who can publish?** A tool's manager, alone, after a preview. A second person approving is planned. *(Uploads and versions)*
- **Can a live tool be changed quietly?** No. A version never changes; a fix is a new version, and each go-live is in the audit. A stored page runs only if its fingerprint still matches. *(Uploads and versions)*

## The database
- **SQL injection?** Values are parameters. The only names put into SQL are checked against a pattern, looked up in the site's own list, and quoted. Tested with hostile names. *(The database; Tables and rows)*
- **Who can run SQL?** The owner, in the project's own editor. Nobody else, until the audited per-space console is built. *(Tables and rows)*
- **Can a tile admin break the database by making tables?** He picks from eight column kinds and three sharing rules; 30 tables a tool, 60 columns a table. No defaults, triggers or constraints of his own. *(Tables and rows)*
- **Can one tool fill the database?** Today, yes: there is no quota on rows or size. *(Where data lives; Open gaps)*
- **How do we know a new function was not left open?** Every SQL file ends by setting the rights of all functions again, `core.security_check()` must come back empty, and one test calls every function there is signed out, pending and switched off. *(The database; Tests)*
- **How is the database changed, and by whom?** Numbered files the owner reads and pastes. A file that ran is never edited. *(The database; Running it)*
- **Two people edit the same row?** The later save wins, without a warning. A version check is planned. *(Where data lives)*

## Data handling
- **Where is the data, physically?** In one Supabase project, in the region chosen when it was made, and in the browser nothing but the session. *(Where data lives)*
- **Is it encrypted?** In transit always (HTTPS). At rest by the provider's disk encryption. No field-level encryption. Passwords are bcrypt hashes. *(Where data lives)*
- **What personal data does the site hold?** Staff name, work email or username, job title, department, office, phone, staff number, sign-in times, and what each person did. Plus whatever departments enter, which the demo's rule limits to sample data. *(Where data lives)*
- **Backups? Restore?** Whatever the plan gives; on the free plan nothing to rely on. *(Where data lives)*
- **Someone deletes a tool by mistake.** It is gone, tables and all. The id must be typed first; there is no bin. Export and IT's backups are the answer, and are not built. *(Where data lives)*
- **Can data be exported?** A tool can save a file of what its user sees. There is no export of a table or a space by its admin yet, and downloads are not audited. *(Where data lives)*
- **How long is data kept?** Until someone removes it. Audit, sessions, versions and switched-off accounts stay for good: no retention policy is set. *(Where data lives)*
- **Can a person be erased on request?** Not from the site: accounts are switched off, never deleted, so that rows and audit lines keep their author. This needs a data-protection decision before real use. *(Where data lives)*

## Audit and watching
- **What is the audit worth?** It is written in the same transaction as the action, and updates, deletes and truncates are refused by triggers for every role. *(The audit)*
- **What is not in it?** Row changes inside a tool, reads, refused attempts, file downloads. *(The audit)*
- **Who could still alter it?** The owner of the database account, by dropping the triggers. *(The audit; Threats)*
- **Is anything watched automatically?** No. A health page is next; alerts and log forwarding are the target's. *(Running it)*

## Running it
- **Who can change the site everyone uses?** Whoever can push to the repository (pages) and whoever owns the Supabase project (database). In the demo, the owner. A push is live in minutes with no review. *(Running it; Threats)*
- **What third-party code runs?** One library, ExcelJS 4.4.0, fingerprinted, only inside the sealed frame; and 90 icons. No framework, no CDN. *(Running it)*
- **What do you do when a tool turns out to be bad?** Roll back or switch it off; IT can switch the whole space off. The bad version stays stored as evidence. *(Running it)*
- **What if the provider changes something?** Two functions reach into the sign-in service's own tables (new user, reset). They are the fragile part and are not in the target. *(Running it)*

## Proof
- **How do we know it holds?** 1,024 database cases over ten files, seven browser tests, a hostile tool with 33 attacks, a rehearsal of seven departments with 145 checks, and control runs showing the tests fail when the wall is loosened. All in the repository, all re-runnable. *(Tests)*
- **Was it tested on the real project?** Sign-in, spaces, tools, a real upload and a tool that saves rows: yes, by the owner. The newest SQL files: as they are pasted. *(Where we are)*
- **What was not tested?** Load, browsers other than Chrome, screen readers, the sign-in service's own limits and emails. *(Tests)*

## The future
- **Can this go to production as it is?** No. It is a demonstration with sample data. *(Open gaps)*
- **What carries over to IT's platform?** The seven rules, every tool as uploaded, the table definitions, the rows, the audit. *(Open gaps and hand-over)*
- **What would IT replace?** Sign-in, hosting with security headers, the database server, the file store, the pipeline, backups, log forwarding. *(Open gaps and hand-over)*
- **What should be built first if it is adopted?** Company sign-in and own hosting, then review before go-live, quotas, export and backups. *(Open gaps and hand-over)*
