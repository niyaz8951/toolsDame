# Building and looking after a tool

A tool is one page that lives under the site's bar. The site gives it the look, the sign-in, the people and the database. You bring only what the tool does.

## Before the tool is live
Nobody but you (its managers and the space admins) can open it. People who have the tool see "being prepared". Take your time: nothing is public until you press Make live.

## How to build it
1. Under **Build this tool** choose one of the two ways. The site then shows one step at a time.
2. **Build a new page**: say in your own words what the tool should do. Answer whether it must save data in the database. Copy the starter kit, paste it into the approved AI, and bring its answer back.
3. **I already have a page**: choose your HTML file. A page made outside this site is almost always refused the first time: it has its own design and keeps its data in its own way. The site then writes one complete request for the AI, which rebuilds the page with this site's look and this site's database.
4. Read **What the site found**. If something is wrong, press **Copy the full request for the AI**. It holds the points the site found, every rule of the site, how data must be kept, and your page. Paste it into the approved AI (the same chat or a new one), then press Back and paste the answer.
5. **Upload**, press **Open the preview** and try it. Then press **Make live** twice.

## What to upload
- One file, `index.html`, is the normal case. Any file name is accepted.
- Several files (pages, pictures, style sheets, scripts) can be chosen together or as one zip; the site packs them.
- No real names, prices or customer data go into the AI.

## What a tool may not do (the site refuses these)
- Load anything from the internet or call a server.
- Have a design of its own: its own header, sign-in, fonts, colours, pop-up boxes, or more than a few lines of styles (3000 characters). The look belongs to the site.
- Keep data anywhere but in this site's tables: no browser storage, no call to a server.
- Use background workers.
- Ask for a password.

## If the tool saves data
- The data goes into this site's database. Nobody writes SQL.
- The page lists the tables and columns it needs. After the check a window shows you that list. You can add more columns there. Nothing is made until you press **Create in the database and go on**.
- A column you add is shown by itself in a page that draws its form from its list of tables. Any other page must be told; the site writes that message for you.
- Every table has a sharing rule: **team** (everyone with the tool sees all rows), **private** (each person sees only his own), **reference** (everyone reads, only managers change).
- The preview has its own empty copy of each table, so trying things never touches real rows.
- Under **Data** each table is drawn like a sheet: one column per thing that is saved, its kind under its name, and two made-up rows in grey. Saved rows are never shown there.
- **+ Column** at the end of a table adds a column. The **x** next to a column's name removes it after you type its name; what was saved in that column is gone for good, the rows stay.
- After adding or removing, press **Copy the request for the AI** and bring back the new page: a page that still uses a removed column cannot save until it is updated.

## After it is live
- **Usage guide**: write the steps people get behind the information button in the tool.
- **Access**: give or take a level per person: read, contribute (add rows), edit (change anyone's rows), approve (also delete).
- **Versions**: every upload is kept. Roll back brings an older one back at once.
- **Audit**: who did what on this tool.
