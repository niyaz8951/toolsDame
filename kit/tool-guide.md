# How to make a tool (for space admins and tool managers)

You do not need to program. The site gives you a starter kit for the approved AI, checks what comes back and tells you what to fix. The look, the top bar, sign-in and security are already there.

1. **Add a tool.** In your space admin page press "Add a tool": a name, an icon (pick a picture, or type one or two letters), a colour, who may open it. The id is suggested and is permanent.
2. **Build and access.** The new tool opens in a window; press "Build and access" there. Later: press the tool's tile, then "Build and access". The page "Build this tool" has five steps.
3. **Say what the tool should do**, in your own words: who uses it, what goes in, what comes out. Tick what it needs (for example: read and write Excel files).
4. **Copy the starter kit** and give it to the approved AI. It is one text. Put no real names, prices or customer data into the AI.
5. **Paste the AI's answer** (one file, `index.html`) into the box and press Check the code. Nothing is uploaded yet.
6. **Fix what the site found.** If something is wrong, press "Copy the full request for the AI" and paste it into the AI, in the same chat or a new one: it holds every rule of the site and your page. Bring the new answer back. Repeat until the check passes.
7. **Upload.** The upload becomes the preview: only admins and managers see it. Try it.
8. **Make live.** Press it twice. Everyone who has the tool gets it. An older version can be brought back at any time.

No AI at hand? Press "Use the starter page as it is": a working page with your tool's name is uploaded in a minute. A tool made of several files can be chosen as files or one zip instead of pasting.

## What a tool can do
- Calculate and show results.
- Read files the person chooses (for example Excel) and give files back as a download.
- Keep rows in tables of this site, shared by the people who have the tool.

## A tool that keeps rows
- When the guide asks "Does the tool need to save data in the database?", answer Yes; the starter kit then teaches the AI how, and the site makes the tables.
- The page says which tables it needs. After the check the site lists them; read the list and press **Create the tables**. Nobody types SQL.
- Or make a table yourself under **Data**: a name, the columns, and who shares the rows. Then load "A list and form for this tool's own tables": a complete tool, no AI needed.
- The preview has its own empty copy of each table. Try anything there.

## What every tool has in common
- The site's bar on top: name, the way back, the user. A tool has no header, menu or sign-in of its own.
- One look: the building blocks shown on `blocks.html`. No own fonts, no own colours except one accent, no pop-up boxes, only a few lines of own styles. A page with a design of its own is refused.
- One place for data: the tables of this site. A page that keeps data in the browser or calls a server is refused.
- Nothing from outside the site. Libraries come from the site's shelf (`kit/v1/lib/`).
- No real data, names, prices or passwords in the file.
