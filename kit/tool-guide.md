# How to make a tool (for space admins and tool managers)

You do not need to program. The site gives you a starter kit for the approved AI, checks what comes back and tells you what to fix. The look, the top bar, sign-in and security are already there.

1. **New tool.** In your space admin page fill "New tool": a name, an icon, a colour, who may open it. The id is suggested and is permanent.
2. **Build and access.** Press it on the new tool. The page "Build this tool" has five steps.
3. **Say what the tool should do**, in your own words: who uses it, what goes in, what comes out. Tick what it needs (for example: read and write Excel files).
4. **Copy the starter kit** and give it to the approved AI. It is one text. Put no real names, prices or customer data into the AI.
5. **Paste the AI's answer** (one file, `index.html`) into the box and press Check the code. Nothing is uploaded yet.
6. **Fix what the site found.** If something is wrong, press "Copy a fix request for the AI", paste it into the same AI chat, and bring the new answer back. Repeat until the check passes.
7. **Upload.** The upload becomes the preview: only admins and managers see it. Try it.
8. **Make live.** Press it twice. Everyone who has the tool gets it. An older version can be brought back at any time.

No AI at hand? Press "Use the starter page as it is": a working page with your tool's name is uploaded in a minute. A tool made of several files can be chosen as files or one zip instead of pasting.

## What a tool can do today
- Calculate and show results.
- Read files the person chooses (for example Excel) and give files back as a download.
- Saving rows that people share arrives in phase 4.

## What every tool has in common
- The site's bar on top: name, the way back, the user. A tool has no header, menu or sign-in of its own.
- One look: the building blocks shown on `blocks.html`. No own fonts, no own colours except one accent.
- Nothing from outside the site. Libraries come from the site's shelf (`kit/v1/lib/`).
- No real data, names, prices or passwords in the file.
