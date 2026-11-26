# Building and looking after a tool

A tool is one page that lives under the site's bar. The site gives it the look, the sign-in, the people and the database. You bring only what the tool does.

## Before the tool is live
Nobody but you (its managers and the space admins) can open it. People who have the tool see "being prepared". Take your time: nothing is public until you press Make live.

## How to build it
1. Under **Build this tool** choose one of the three ways. The site then shows one step at a time.
2. **Build a new page**: say in your own words what the tool should do. Answer whether it must save data in the database. Copy the starter kit, paste it into the approved AI, and bring its answer back.
3. **I already have a page**: choose your HTML file. If the site refuses it, one button hands it to the AI to be rebuilt.
4. **Use a ready-made page**: no AI. A converter, a tracker, or a list and form for this tool's tables.
5. Read **What the site found**. If something is wrong, "Copy a fix request for the AI" writes the message for you.
6. **Upload**, press **Open the preview** and try it. Then press **Make live** twice.

## What to upload
- One file, `index.html`, is the normal case. Any file name is accepted.
- Several files (pages, pictures, style sheets, scripts) can be chosen together or as one zip; the site packs them.
- No real names, prices or customer data go into the AI.

## What a tool may not do (the site refuses these)
- Load anything from the internet or call a server.
- Have its own header, sign-in, fonts or colours.
- Use the browser's storage or background workers.
- Ask for a password.

## If the tool saves data
- The data goes into this site's database. Nobody writes SQL.
- The page lists the tables and columns it needs. After the check a window shows you that list. You can add more columns there. Nothing is made until you press **Create in the database and go on**.
- A column you add is shown by itself in a page made from the ready-made tracker. A page written by the AI must be told; the site writes that message for you.
- Every table has a sharing rule: **team** (everyone with the tool sees all rows), **private** (each person sees only his own), **reference** (everyone reads, only managers change).
- The preview has its own empty copy of each table, so trying things never touches real rows.
- Under **Data** you see the tables, add a column, or delete a table after typing its name.

## After it is live
- **Usage guide**: write the steps people get behind the information button in the tool.
- **Access**: give or take a level per person: read, contribute (add rows), edit (change anyone's rows), approve (also delete).
- **Versions**: every upload is kept. Roll back brings an older one back at once.
- **Audit**: who did what on this tool.
