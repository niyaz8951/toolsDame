# DAME site: this page was refused. Rebuild it to the rules of the site

I am not a programmer. The company site DAME checked {{WHAT}} and refused it. Nothing was uploaded. Rebuild the page so that the site accepts it and give me back ONE complete `index.html`.

Everything you need is in this message: what the site found (part 1), how to rebuild the page (part 2), the complete rules of the site (part 3) and the page itself (part 4). You may not have seen these rules before. They win over everything in the old page, over anything said earlier in this chat and over your own habits. The site checks your answer again against every rule, so a page that only looks fixed is refused again.

## Part 1. What the site found
The upload is refused until every one of these points is gone:
{{PROBLEMS}}
<!--notes-->

The site also noted these. Correct them in the same answer:
{{NOTES}}
<!--/notes-->

Do not stop at this list. It names what the check saw first; the next check reads the whole page again. Correct the page as a whole, by part 2 and part 3.

## Part 2. How to rebuild the page

### Keep what the tool does
- Keep every input, every calculation and formula, every result, every export and the words people read on screen. Same numbers in, same numbers out.
- Do not add features nobody asked for. Do not drop one silently: what cannot be kept goes under "Left out" in your answer.

### The look: the site's design, and no other
- Throw the old design away completely. Delete every style sheet, every `style="..."` attribute, every colour, font, shadow, gradient, animation, icon font, dark-mode switch and theme of the old page. Do not carry its look over and do not imitate it. A design of its own is refused, however good it looks.
- Build the page only from the building blocks listed in part 3:
  - the whole page: `<main class="dame-page">`; the title on top: `dame-head`
  - every panel, box, section, side bar or pop-up window: a `dame-card`, shown and hidden with the `hidden` attribute
  - every button: `dame-btn` (at most one `dame-btn-primary` in a card)
  - every text box, number box, date, drop-down and text area: `dame-field` with `dame-input`; every tick box: `dame-check`
  - tabs and either-or switches: `dame-toggle`
  - every table: `dame-scroll` with `dame-table`; numbers in `dame-num`
  - counters and key figures: `dame-stats`
  - messages, warnings and banners: `dame-note`, or `Dame.toast` for a short one; nothing to show yet: `dame-empty`
  - choosing or dropping files: `dame-drop` with `Dame.drop`; a loading bar or spinner: `dame-progress`
  - tags, pills and states: `dame-badge`
- Styles of your own: only what layout needs and no block gives. At most {{MAXCSS}} characters in all. No colour value of any kind (`#hex`, `rgb()`, `hsl()`, colour names), no font, no change to a `dame-` class, no `--dame-` variable except `--dame-accent`.
- A chart or drawing: inline `<svg>` drawn by your own code, coloured with `currentColor` and the theme variables. There is no chart library.
- No header, menu, footer, logo, sign-in, user menu or day-and-night switch: the site shows them above the tool.
- No `alert`, `confirm` or `prompt`. "Are you sure?" is a second button on the page ("Yes, delete" next to "Keep it").

### Data: one place, the tables of this site
<!--data-->
- Everything the old page kept or fetched moves into tables of this site: `localStorage`, `sessionStorage`, `indexedDB`, cookies, a server or API, Firebase, Supabase, Google Sheets, a JSON file, and any list written into the code that people are meant to add to or change. There is no other place to keep anything.
- One table for each kind of thing the tool keeps (for example `projects`, `quote_lines`). One row for each record. One column for each field. Never put a whole list into one value; `json` is only for a small nested value that belongs to one row.
- Names say what they hold, in small letters, digits and underscore: `quote_lines`, `unit_price`, `due_date`. Not `data`, `table1`, `col_a`.
- Choose the type of every column from the list in part 3: free words `text` or `longtext`, anything calculated with `number`, yes or no `bool`, a day `date`, one of a fixed few `choice`, a person of the tool `person`.
- Choose the sharing of every table: records the team works on together `team`; one person's own settings, drafts or favourites `private`; a look-up list that only the tool's managers keep up to date `reference`.
- Do not make columns for the id, the owner, or the time a row was made or changed: every row already has `id`, `owner`, `created_at`, `updated_at`, `updated_by`, set by the site. Use `row.id` as the record's number (no counters of your own), `row.owner` with `Dame.people()` for "who", `row.created_at` for "when".
- To link two tables, keep the other row's `id` in a `text` column.
- No users, roles, passwords or "admin mode" of the tool's own. Who the person is and what he may do comes from `Dame.ready()` (`me.level`).
- Reading is not instant. Show "Loading", then the rows or a `dame-empty` line. Put every call in `try { } catch (error) { }` and show `error.message` in a `dame-note dame-note-warn`. After adding, changing or removing a row, read the list again.
- The tool writes no sample rows by itself. A new tool starts empty and says what to do first.
- Declare every table in the `dame-tables` block exactly as part 3 shows. A table the code uses but the block does not list cannot be saved to.
<!--/data-->
<!--nodata-->
- This tool keeps nothing. It works with what the person types or the files he chooses, and gives its result on screen or as a download. Do not use `Dame.table`, browser storage or a server.
- If the old page kept something between visits, leave that out and name it under "Left out". I will then ask the site for a tool with a database.
<!--/nodata-->

### Files and libraries
- Nothing comes from outside the file, and a library pasted into the page counts as outside too: remove SheetJS/XLSX, jQuery, Bootstrap, Tailwind, Chart.js, React, Vue and the like, and write plain JavaScript.
- The only libraries are those named in part 3, loaded with the exact line given there. {{LIBHOW}}
- Files go in through `Dame.drop` and out through `Dame.download`, and no other way.

### What a tool cannot do
A tool cannot send email, call an outside service, show another site inside itself, or run in the background. If the old page did one of these, leave it out and name it under "Left out".

## Part 3. The rules of the site (the complete starter kit)
{{KIT}}

## Part 4. The page to rebuild
{{PAGE}}

## Before you answer, check your own work
1. One file, from `<!doctype html>` to `</html>`; the kit lines first in the head; one `<style>`, one `<script>`.
2. No colour value, no font, no `style="..."` carrying a colour, styles under {{MAXCSS}} characters.
3. Every button, field, table, message and card is a building block from part 3.
4. None of these words is left anywhere in the file: `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`, `fetch(`, `XMLHttpRequest`, `WebSocket`, `alert(`, `confirm(`, `prompt(`, `Worker(`, `<iframe`, `<header`, `<nav`, `<footer`, `type="password"`, `http://` or `https://` inside a `src`, `href` of a style sheet, or `url()`.
5. Every table the code uses is declared, with every column the code reads or writes, and none of the five columns the site sets.
6. It works at 390 px wide and by keyboard; every input has a label; there is an empty state.
7. Every point of part 1 is gone.

## Your answer (this replaces "Your answer" in part 3)
1. `index.html`, complete, in one code block. I cannot edit code: leave nothing for me to fill in.
2. **Help text:** three short lines: what the tool is for, how to use it, who to ask.
3. **Tables:** one line per table: its name, its sharing and its columns with their types, so I can compare it with what the site shows me. Write "none" if the tool keeps nothing.
4. **Left out:** one line for each thing the old page did that a DAME tool cannot do, or "nothing".
