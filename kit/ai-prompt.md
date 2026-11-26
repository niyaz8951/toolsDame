# Starter kit for a DAME tool

You are writing one small web tool for the company site DAME. Follow this kit exactly. Return ONE file named `index.html`, complete, in a single code block. I cannot program: do not leave anything for me to edit, fill in or decide.

## The tool
Name: {{TOOL}}

What it must do:
{{BRIEF}}

## How a DAME tool is built
1. One file, `index.html`. Plain HTML, CSS and JavaScript. All CSS in one `<style>` in the head (keep it short), all JavaScript in one `<script>` at the end of the body. No framework, no build step, no modules, no `import`.
2. The head contains exactly these lines, in this order, before anything of your own:
{{HEAD}}
3. The site already shows a top bar with the tool's name, the way back and the user. So: no `<header>`, `<nav>` or `<footer>`, no sign-in, no password field, no user menu, no logo.
4. Nothing from outside the file: no CDN, web font, outside image, script or style sheet; no `fetch`, `XMLHttpRequest` or `WebSocket`; no web worker; no `<iframe>`. All of these are blocked and the upload is refused.
5. The browser's own storage (`localStorage`, `sessionStorage`, `indexedDB`, cookies) does not work inside a tool. {{DATA}}
6. Look: build the page only from the building blocks below. No own fonts. No own colours: use the theme variables `var(--dame-text)`, `var(--dame-muted)`, `var(--dame-line)`, `var(--dame-surface)`, `var(--dame-bg)`, `var(--dame-ok)`, `var(--dame-warn)`. The only thing a tool may set is `--dame-accent` (one colour).
7. It must work on a phone (390 px wide) and on a desktop. Every control is reachable by keyboard and every input has a label.
8. Plain words on screen, for people who are not technical. Every message says what the person should do next. Show an empty state before there is anything to show. No `alert`, `confirm` or `prompt` boxes.
9. No real names, prices, customer data, keys or passwords in the file. Sample values must be invented.
10. Long work (many files, many rows) is done in small steps with `await Dame.pause();` between them, and a progress bar is shown.
11. Put data on the page with `textContent`, never by building HTML from data.

## What the kit gives you (JavaScript, already loaded)
- `const me = await Dame.ready();` gives `{ id, name, level }`. `level` is `read`, `contribute`, `edit` or `approve`. Call it once at the start.
- `Dame.toast('Done')` shows a short message.
- `Dame.drop(element, { accept: ['.xlsx'], multiple: true }, function (files) { ... })` turns a `dame-drop` element into a place to drop files or press to choose them. `files` is an array of `File`. Use this for every file input.
- `Dame.download('result.csv', textOrBytesOrBlob)` saves a file the tool made to the person's computer.
- `Dame.progress(element, 0.4)` sets a `dame-progress` bar; the number goes from 0 to 1.
- `await Dame.pause()` lets the screen update during long work.
- A link to an outside address (`<a href="https://...">`) asks the person before it opens.

{{LIBS}}## Building blocks (use these classes and no others, except your own small additions for layout)
```html
<main class="dame-page"> ... the whole page ... </main>

<div class="dame-head"><h1>Title</h1><p>One line that says what the tool is for.</p></div>

<section class="dame-card">
  <div class="dame-card-head"><h2>Step title</h2><button class="dame-btn dame-btn-small" type="button">Clear</button></div>
  ...
</section>

<button class="dame-btn dame-btn-primary" type="button">Main action</button>
<button class="dame-btn" type="button">Other action</button>
<button class="dame-btn dame-btn-quiet dame-btn-small" type="button">Remove</button>
<div class="dame-row"> buttons or controls side by side </div>

<label class="dame-field">Label <input class="dame-input" type="text"></label>
<label class="dame-field">Choose <select class="dame-input"><option>One</option></select></label>
<p class="dame-hint">A line of help under a field.</p>
<label class="dame-check"><input type="checkbox"> <span>Tick box text<em>A quieter second line</em></span></label>
<div class="dame-grid"> fields side by side that fold on a phone </div>

<div class="dame-toggle" role="group" aria-label="Choose one">
  <button type="button" aria-pressed="true">First</button><button type="button" aria-pressed="false">Second</button>
</div>

<div class="dame-drop" id="drop"><strong>Choose files or drop them here</strong><span>.xlsx, as many as you like</span></div>
<ul class="dame-list"><li><span>file-name.xlsx</span><button class="dame-btn dame-btn-quiet dame-btn-small" type="button">Remove</button></li></ul>

<div class="dame-progress" id="bar"><span></span></div>

<div class="dame-stats"><div class="dame-stat"><b>128</b><span>rows found</span></div></div>

<p class="dame-note">A plain message.</p>
<p class="dame-note dame-note-ok">Good news.</p>
<p class="dame-note dame-note-warn">Something to fix, and what to do.</p>
<p class="dame-empty">Nothing here yet. Say what to do first.</p>
<span class="dame-badge">label</span> <span class="dame-badge dame-badge-ok">ok</span> <span class="dame-badge dame-badge-warn">check</span>

<div class="dame-scroll"><table class="dame-table">
  <thead><tr><th>Name</th><th class="dame-num">Amount</th></tr></thead>
  <tbody><tr><td>Row</td><td class="dame-num">12</td></tr><tr class="is-warn"><td>Row to check</td><td class="dame-num">0</td></tr></tbody>
</table></div>

<span class="dame-muted">quieter text</span> <span class="dame-mono">CODE-123</span> <span class="dame-sr">text for screen readers only</span>
```
Show or hide a part of the page with the `hidden` attribute.

## Start from this file
```html
{{STARTER}}
```

## Your answer
Return only `index.html`, in one code block, complete from `<!doctype html>` to `</html>`. After the code block write three short lines for the tool's help text: what it is for, how to use it, who to ask.
