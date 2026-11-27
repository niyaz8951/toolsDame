/*
 * pages/admin-tool.js - the tool admin page: files and versions, access, audit.
 * Serves: contract 6 (Releases), 3 (Access), 7 (Audit); Data (5) comes later.
 * Must not change: everything from the database is written with textContent;
 * each change calls one dame_* function and then reloads, so the page shows
 * what the database holds; pasted code and chosen files are only read by
 * kit/v1/pack.js in the helper page, never run here; a version with a problem
 * is not uploaded; the starter kit holds no address, key or user data; the
 * fix request is complete in itself (the points, all the rules, the data
 * rules, the page), because the AI that gets it may never have seen the kit.
 */
(function () {
  'use strict';

  var api = window.DameApi;
  var ui = window.DameShell;
  if (!ui) { return; }

  var space = '';
  var tool = '';
  var act = null;
  var loadAudit = null;
  var packed = null;
  var LEVELS = [['read', 'Read'], ['contribute', 'Contribute'], ['edit', 'Edit'], ['approve', 'Approve']];

  function $(id) { return document.getElementById(id); }

  function toolUrl(preview) {
    return api.href('tool.html') + '?space=' + encodeURIComponent(space) + '&tool=' + encodeURIComponent(tool) + (preview ? '&preview=1' : '');
  }

  function levelSelect(person) {
    var s = ui.el('select', 'dame-input');
    s.setAttribute('aria-label', 'Level of ' + person.name);
    LEVELS.forEach(function (l) {
      var o = ui.el('option', null, l[1]);
      o.value = l[0];
      s.appendChild(o);
    });
    s.value = person.level;
    s.addEventListener('change', function () {
      act('dame_tool_access_set', { p_space: space, p_tool: tool, p_user: person.id, p_level: s.value },
        person.name + ' now has the level ' + s.value + '.');
    });
    return s;
  }

  function size(bytes) {
    return bytes < 1024 * 1024 ? Math.max(1, Math.round(bytes / 1024)) + ' KB' : (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function versionRow(body, v, state) {
    var pills = ui.el('span');
    if (v.version === state.live) { pills.appendChild(ui.el('span', 'hub-pill hub-pill-ok', 'Live')); }
    if (v.version === state.preview) { pills.appendChild(ui.el('span', 'hub-pill', 'Preview')); }
    var does = ui.el('div', 'hub-actions');
    if (v.version !== state.preview && v.version !== state.live) {
      var pre = ui.el('button', 'dame-btn hub-small', 'Preview this');
      pre.type = 'button';
      pre.addEventListener('click', function () {
        pre.disabled = true;
        act('dame_version_preview', { p_space: space, p_tool: tool, p_version: v.version }, 'Version ' + v.version + ' is now the preview. Press Open the preview.');
      });
      does.appendChild(pre);
    }
    if (v.version !== state.live) {
      var back = state.live !== null && v.version < state.live;
      does.appendChild(ui.confirmButton(back ? 'Roll back to this' : 'Make live', '', function () {
        act('dame_version_make_live', { p_space: space, p_tool: tool, p_version: v.version },
          back ? 'Rolled back: version ' + v.version + ' is live again.' : 'Version ' + v.version + ' is live. Everyone with the tool gets it now.');
      }));
    }
    ui.addRow(body, [v.version + (v.note ? ': ' + v.note : ''), ui.when(v.at), v.by, v.pages + ' (' + size(v.bytes) + ')', pills, does]);
  }

  async function load() {
    // The four questions go out together; the page waits for the slowest, not for the sum.
    var asked = [api.rpc('dame_tool_admin_get', { p_space: space, p_tool: tool }), api.rpc('dame_versions_list', { p_space: space, p_tool: tool }), showTables()];
    var audit = loadAudit();
    audit.catch(function () {});
    var got = await Promise.all(asked);
    var t = got[0];
    document.title = t.name + ' admin - DAME';
    ui.titled($('title'), t.icon, t.name + ': admin');
    toolName = t.name;
    toolText = t.description || '';
    $('text').textContent = (t.description ? t.description.replace(/[.!?]?\s*$/, '. ') : '') + 'In ' + t.space_name + '. ' +
      (t.active ? '' : 'This tool is switched off: only its managers and the space admins can open it. ') +
      (t.space_active ? '' : 'The space is switched off by IT.');
    $('open-text').textContent = t.open_to_space
      ? 'Everyone in the space has this tool at the level "' + t.open_level + '". People named here can have a higher level.'
      : 'Only the people named here can open this tool.';
    var state = got[1];
    // The way back is the page the person came from. A tool's manager need not be a space admin, so the
    // space admin page is offered only to a person who came from it. Otherwise: the tool itself, or,
    // while it is not built yet, the space it sits in.
    var q = '?space=' + encodeURIComponent(space);
    if (t.is_space_admin && ui.cameFrom('admin/space.html')) {
      $('back').href = api.href('admin/space.html') + q;
      $('back').textContent = 'Back to the space admin page';
    } else if (state.live !== null || ui.cameFrom('tool.html')) {
      $('back').href = toolUrl(false);
      $('back').textContent = 'Back to the tool';
    } else {
      $('back').href = api.href('space.html') + q;
      $('back').textContent = 'Back to the space';
    }

    $('ver-state').textContent = (state.live === null ? 'Not built yet: people who have this tool see "being prepared".' : 'Live: version ' + state.live + '.') +
      (state.preview === null ? '' : ' Preview: version ' + state.preview + ' (only admins and managers see it).');
    $('open-live').href = toolUrl(false);
    $('open-live').hidden = state.live === null;
    $('open-preview').href = toolUrl(true);
    $('open-preview').hidden = state.preview === null;
    // Until the tool is live, the information button asks to be pressed: it explains everything about building a tool.
    ui.info(null, state.live === null);
    isLive = state.live !== null;
    var body = ui.clear($('versions'));
    state.versions.forEach(function (v) { versionRow(body, v, state); });
    $('versions-empty').hidden = state.versions.length > 0;

    ui.people($('access'), t.access, 'Nobody is named yet.', 'Take away', function (person) {
      act('dame_tool_access_set', { p_space: space, p_tool: tool, p_user: person.id, p_level: null },
        person.name + ' no longer has access by name.');
    }, levelSelect);
    ui.people($('managers'), t.managers, 'No manager. The space admins look after this tool.', '', null);
    await audit;
  }

  // ------------------------------------------------------------------ the builder
  // Step 1 and 2: the person's description and the starter kit made from it.

  var shelf = [];          // libraries on the shelf, from kit/v1/lib/index.json
  var template = '';       // kit/ai-prompt.md
  var fixTemplate = '';    // kit/ai-fix.md
  var lastNotes = [];
  var lastKeeps = false;   // the checked page keeps or fetches data somewhere
  var MAX_OWN_CSS = 3000;  // the same number as in kit/v1/pack.js
  var MAX_PASTE = 120000;  // a longer page is attached to the AI as a file instead of pasted into the request
  var starter = '';        // kit/starter/index.html, without its repo note
  var toolName = '';
  var isLive = false;
  var toolText = '';
  var aiMode = 'prompt';
  var lastProblems = [];
  var tables = [];         // this tool's tables, as the database lists them
  var plan = null;         // what the checked page still needs: { create: [], add: [], clash: [] }
  var wanted = [];         // the tables of the checked page, with the columns the person added
  var undeclared = [];     // tables the page's code names but neither the page lists nor the tool has
  var extras = {};         // columns added in the review window: { table: [ { name, type, choices } ] }
  var sourceText = '';     // the page as text, when the check was of one page: added columns are written into it
  var focus = null;        // the review window, while it is open
  var newColumns = [];     // columns added in the review window that the page has no field for yet

  function draftKey() { return 'dame.brief.' + space + '.' + tool; }

  // The description is kept in this browser only, so a reload does not lose it.
  function saveDraft() {
    try {
      localStorage.setItem(draftKey(), JSON.stringify({ brief: $('brief').value, needs: chosenLibs(),
        data: $('need-data').checked ? 'yes' : ($('save-no').checked ? 'no' : '') }));
    } catch (e) { /* not kept; nothing depends on it */ }
  }

  function loadDraft() {
    try {
      var d = JSON.parse(localStorage.getItem(draftKey()) || '{}');
      $('brief').value = String(d.brief || '').slice(0, 4000);
      $('need-data').checked = d.data === 'yes';
      $('save-no').checked = d.data === 'no';
      (d.needs || []).forEach(function (id) {
        var box = document.querySelector('#needs input[value="' + String(id).replace(/[^a-z0-9-]/g, '') + '"]');
        if (box) { box.checked = true; }
      });
    } catch (e) { /* no draft */ }
  }

  function chosenLibs() {
    return Array.prototype.map.call(document.querySelectorAll('#needs input[type=checkbox]:checked'), function (b) { return b.value; });
  }

  // "bids (team): project text, status choice (open, won, lost)"
  function describe(t) {
    return t.name + ' (' + t.sharing + '): ' + t.columns.map(function (c) {
      return c.name + ' ' + c.type + (c.choices ? ' (' + c.choices.join(', ') + ')' : '');
    }).join(', ');
  }

  // The tables as a page declares them -> as the database takes them.
  function fromManifest(manifest) {
    return Object.keys(manifest.tables).map(function (name) {
      var t = manifest.tables[name] || {};
      var cols = (t.columns && typeof t.columns === 'object') ? t.columns : {};
      return { name: name, sharing: t.sharing, columns: Object.keys(cols).map(function (c) {
        var type = cols[c];
        return (type && typeof type === 'object') ? { name: c, type: 'choice', choices: type.choice } : { name: c, type: type };
      }) };
    });
  }

  // ...and back: this tool's own tables as a page declares them.
  function toManifest(list) {
    var out = { dame: 1, tables: {} };
    list.forEach(function (t) {
      var cols = {};
      t.columns.forEach(function (c) { cols[c.name] = c.type === 'choice' ? { choice: c.choices } : c.type; });
      out.tables[t.name] = { sharing: t.sharing, columns: cols };
    });
    return out;
  }

  // What the site tells the AI about keeping data.
  function dataText() {
    return '## Keeping data: tables of this site\n' +
      'The tool keeps its rows in tables that the site makes. Declare every table the tool needs in the head, right after the kit lines, in exactly this block (the site reads it and makes the tables):\n' +
      '```html\n<script type="application/json" id="dame-tables">\n' +
      '{ "dame": 1, "tables": { "bids": { "sharing": "team", "columns": { "project": "text", "capacity_kw": "number", "due": "date", "status": { "choice": ["open", "won", "lost"] } } } } }\n' +
      '</script>\n```\n' +
      '- Table and column names: a small letter, then small letters, digits or underscore.\n' +
      '- Column types: `text` (up to 1000 characters), `longtext`, `number`, `bool`, `date` (written `2026-12-31`), `{ "choice": ["a", "b"] }`, `person` (the id of a person from `Dame.people()`), `json`.\n' +
      '- Sharing: `team` = everyone with the tool sees all rows; `private` = each person sees only his own rows; `reference` = everyone reads, only the tool\'s managers change.\n' +
      '- Every row also has `id`, `owner`, `created_at`, `updated_at`, `updated_by`. The site sets them; never send them.\n' +
      '- A field the person left empty: leave the column out or send `null`, for every type.\n' +
      '- Use: `const t = Dame.table(\'bids\');` then `await t.list({ where: { status: \'open\' }, sort: \'-due\', limit: 100 })` (an array, at most 1000 rows; `where` matches exact values only), `await t.get(id)`, `await t.add({ project: \'A\' })`, `await t.update(id, { status: \'won\' })`, `await t.remove(id)`.\n' +
      '- `await Dame.people()` gives `[{ id, name }]`, the people who have this tool: use it to show who added a row (`row.owner`) and to fill a person picker.\n' +
      '- Levels (`me.level`): `read` sees rows; `contribute` adds rows and changes his own; `edit` changes anyone\'s; `approve` also deletes. Hide what the level does not allow. The site refuses anyway: every call can fail, so catch it and show `error.message` on the page.\n' +
      (tables.length ? '- This tool already has these tables; use them as they are and declare them unchanged: ' + tables.map(describe).join('; ') + '.\n' : '') + '\n';
  }


  async function text(path) {
    var res = await fetch(api.href(path), { cache: 'no-cache', credentials: 'omit' });
    if (!res.ok) { throw new Error('The site could not load ' + path + '. Reload the page.'); }
    return res.text();
  }

  // The starter page with this tool's name in it. Angle brackets in a name stay text.
  function starterPage() {
    var safe = toolName.replace(/[<>&]/g, ' ');
    return starter.split('{{TOOL}}').join(safe);
  }

  // The starter kit: the prompt template with this tool, the description and the chosen libraries filled in.
  // o (all optional): { brief, data, libs, plain } - the fix request fills these from the checked page.
  function starterKit(o) {
    o = o || {};
    var withData = o.data === undefined ? $('need-data').checked : o.data;
    var libs = o.libs || shelf.filter(function (l) { return chosenLibs().indexOf(l.id) >= 0; });
    var head = ['   `<link rel="stylesheet" href="/_dame/v1/dame.css">`', '   `<script src="/_dame/v1/dame.js"></script>`']
      .concat(libs.map(function (l) { return '   `' + l.line + '`'; })).join('\n');
    var libText = libs.map(function (l) {
      return '## Library: ' + l.name + ' ' + l.version + ' (' + l.use + ')\nThe site provides it; load it with the line above and nothing else.\n' +
        l.how.map(function (h) { return '- ' + h; }).join('\n') + '\n\n';
    }).join('');
    var brief = o.brief || $('brief').value.trim() || '(Describe here what the tool should do: who uses it, what goes in, what comes out.)';
    var page = starterPage();
    if (libs.length) {
      page = page.replace('<script src="/_dame/v1/dame.js"></script>',
        '<script src="/_dame/v1/dame.js"></script>\n' + libs.map(function (l) { return l.line; }).join('\n'));
    }
    // A page the person already has (kept when he chose "Ask the AI to rebuild this page") is handed over.
    var existing = o.plain ? '' : oldPage.trim();
    var convert = (existing && /<[a-z!][\s\S]*>/i.test(existing))
      ? '\n## The page I already have\nRebuild this page as a DAME tool. Keep what it does and its words. Replace its look with the building blocks, ' +
        'remove everything the rules forbid (outside files, own header, own fonts, browser storage), and after the code tell me in one line anything it did that a DAME tool cannot do.\n' +
        '```html\n' + existing.slice(0, 60000) + '\n```\n'
      : '';
    return (template + convert)
      .split('{{TOOL}}').join(toolName)
      .split('{{BRIEF}}').join(brief)
      .split('{{HEAD}}').join(head)
      .split('{{DATARULE}}').join(withData ? 'To keep data use the tables of this site, as described below.'
        : 'This tool saves nothing: it works with what the person types or the files he chooses, and gives results on screen or as a download. Do not use `Dame.table`.')
      .split('{{DATA}}').join(withData ? dataText() : '')
      .split('{{LIBS}}').join(libText)
      .split('{{STARTER}}').join(page);
  }

  async function copy(textToCopy, button, done, pre) {
    try {
      await navigator.clipboard.writeText(textToCopy);
      var old = button.textContent;
      button.textContent = done;
      setTimeout(function () { button.textContent = old; }, 2500);
    } catch (e) {
      // The browser did not allow copying: show the text so it can be copied by hand.
      pre = pre || $('kit-pre');
      pre.textContent = textToCopy;
      pre.hidden = false;
      ui.say($('msg'), 'The browser did not allow copying. The text is shown below: select all of it and copy it.', 'warn');
    }
  }

  function saveFile(name, content) {
    var url = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }));
    var a = ui.el('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  // What to tell the AI when the site refused a page. Complete in itself: the points
  // the site found, how to rebuild (look, data, files), the whole starter kit and the
  // page. Most pages people bring were made outside the site, by an AI that never saw
  // the rules, so "follow the starter kit" alone means nothing to it.
  function pick(textIn, name, keep) {
    var block = new RegExp('<!--' + name + '-->\\r?\\n?([\\s\\S]*?)<!--/' + name + '-->\\r?\\n?', 'g');
    return textIn.replace(block, keep ? '$1' : '');
  }

  function pageFits() { return !!sourceText && sourceText.length <= MAX_PASTE; }

  function fixRequest() {
    var seen = sourceText.toLowerCase();
    // Libraries: those ticked in step 1, and those the page plainly needs (it names Excel files, say).
    var libs = shelf.filter(function (l) {
      return chosenLibs().indexOf(l.id) >= 0 || (l.hints || []).some(function (h) { return seen.indexOf(h) >= 0; });
    });
    var withData = lastKeeps || $('need-data').checked || tables.length > 0;
    var brief = way === 'ai' ? $('brief').value.trim() : '';   // a description left from another try says nothing about a page brought from outside
    var kit = starterKit({
      brief: (brief ? brief + '\n\n' : '') + 'Do exactly what the page in part 4 does today, rebuilt to these rules.',
      data: withData, libs: libs, plain: true
    });
    var page = pageFits()
      ? 'This is the page the site refused. Read all of it before you write anything.\n```html\n' + sourceText.trim() + '\n```'
      : 'The page is too long to paste here, or it has several files. I attach it to this message as a file. If you see no attached file, ask me for it and write nothing else.';
    var out = pick(pick(pick(fixTemplate, 'notes', lastNotes.length > 0), 'data', withData), 'nodata', !withData);
    return out
      .split('{{WHAT}}').join(way === 'ai' ? 'the index.html you gave me' : 'a page I already have')
      .split('{{PROBLEMS}}').join(lastProblems.map(function (p, i) { return (i + 1) + '. ' + p; }).join('\n'))
      .split('{{NOTES}}').join(lastNotes.map(function (n) { return '- ' + n; }).join('\n'))
      .split('{{MAXCSS}}').join(String(MAX_OWN_CSS))
      .split('{{LIBHOW}}').join(libs.map(function (l) { return l.instead || ''; }).filter(Boolean).join(' '))
      .split('{{KIT}}').join(kit.replace(/^(#{1,2}) /gm, '##$1 '))
      .split('{{PAGE}}').join(page);
  }

  function offerFix(yes) {
    $('fix-box').hidden = !yes;
    $('fix-pre').hidden = true;
    $('fix-attach').hidden = !yes || pageFits();
  }

  // ------------------------------------------------------------------ check and upload

  function report(lines) {
    var list = ui.clear($('up-report'));
    lines.forEach(function (l) { list.appendChild(ui.el('li', l[1], l[0])); });
    $('report-empty').hidden = lines.length > 0;
  }

  function mark() { /* the guide shows one step at a time; nothing to tick */ }

  // ------------------------------------------------------------------ the guide: one step on screen at a time
  var STEPS = ['step-1', 'step-data', 'step-2', 'step-3', 'step-4', 'step-5'];
  var way = null;          // 'ai' | 'own' | null (the two choices are shown)
  var at = 0;
  var kitDone = false;
  var oldPage = '';        // a page the person already has, to be rebuilt by the AI
  var uploaded = false;

  function steps() {
    if (way === 'ai') { return aiMode === 'off' ? ['step-2', 'step-3', 'step-4', 'step-5'] : STEPS; }
    return ['step-3', 'step-4', 'step-5'];
  }

  function show() {
    $('wz-start').hidden = !!way;
    $('wz').hidden = !way;
    if (!way) { return; }
    var list = steps();
    var now = list[at];
    STEPS.forEach(function (id) { $(id).hidden = id !== now; });
    $('wz-where').textContent = 'Step ' + (at + 1) + ' of ' + list.length;
    $('wz-bar').setAttribute('data-at', String(Math.round((at + 1) / list.length * 6)));
    $('bring-file').hidden = way !== 'own';
    $('bring-paste').hidden = false;
    $('code-starter').hidden = way !== 'ai';
    $('paste-title').hidden = way !== 'ai';
    $('paste-label').textContent = way === 'ai' ? 'The AI answers with one file, index.html. Copy all of its code and paste it here' : 'The code of your page';
    $('data-note').hidden = !$('need-data').checked;
    $('kit-convert').hidden = !oldPage;
    $('kit-skip').hidden = kitDone || aiMode === 'off';
    $('up-form').hidden = uploaded;
    var ready = !!packed && !!plan && plan.create.length + plan.add.length + plan.clash.length === 0;
    var next = $('wz-next');
    next.hidden = now === 'step-3' || now === 'step-5' || (now === 'step-2' && !kitDone && aiMode !== 'off') || (now === 'step-4' && !ready);
    next.textContent = now === 'step-2' ? 'I have the AI\'s answer. Next' : now === 'step-4' ? 'Next: upload' : 'Next';
    $('wz-back').textContent = at === 0 ? 'Back to the two choices' : 'Back';
    $('wz-back').hidden = uploaded;
  }

  function go(id) {
    var i = steps().indexOf(id);
    if (i >= 0) { at = i; show(); $('wz').scrollIntoView({ block: 'nearest' }); }
  }

  function begin(which) {
    way = which;
    at = 0;
    uploaded = false;
    ui.say($('msg'), '');
    show();
  }

  function restart() {
    way = null;
    oldPage = '';
    kitDone = false;
    uploaded = false;
    packed = null;
    plan = null;
    $('code').value = '';
    $('up-files').value = '';
    $('after-upload').hidden = true;
    report([]);
    show();
  }

  // The AI can only build what was described: no description, no next step.
  function described() {
    if ($('brief').value.trim().length >= 20) { return true; }
    ui.say($('msg'), 'First say what the tool should do, in a sentence or two. The AI gets exactly those words.', 'warn');
    if (way === 'ai') { go('step-1'); }
    $('brief').focus();
    return false;
  }

  function next() {
    var now = steps()[at];
    ui.say($('msg'), '');
    if (now === 'step-1' && !described()) { return; }
    if (now === 'step-data' && !$('need-data').checked && !$('save-no').checked) {
      ui.say($('msg'), 'Choose one of the two answers: does the tool save data in the database, or not?', 'warn');
      return;
    }
    at += 1;
    show();
    $('wz').scrollIntoView({ block: 'nearest' });
  }

  function back() {
    ui.say($('msg'), '');
    if (at === 0) { restart(); return; }
    at -= 1;
    show();
  }

  // "I already have a page" that the site refused: hand it to the AI to be rebuilt.
  async function toAi() {
    var code = $('code').value.trim();
    if (!code) {
      var file = Array.prototype.filter.call($('up-files').files, function (f) { return /\.html?$/i.test(f.name); })[0];
      if (file) { code = await file.text(); }
    }
    oldPage = code;
    $('code').value = '';
    $('up-files').value = '';
    packed = null;
    report([]);
    begin('ai');
  }

  // Compares the tables the checked page needs with the tables the tool has.
  async function planTables() {
    plan = { create: [], add: [], clash: [] };
    wanted = [];
    if (packed && (packed.manifest || (packed.uses && packed.uses.length))) {
      tables = await api.rpc('dame_tables_list', { p_space: space, p_tool: tool }) || [];
    }
    // The code saves rows in a table the page does not describe and the tool does not have: said as a note after the check.
    undeclared = (packed && packed.uses || []).filter(function (name) {
      return !(packed.manifest && packed.manifest.tables[name]) && !tables.some(function (t) { return t.name === name; });
    });
    if (packed && packed.manifest) {
      wanted = fromManifest(packed.manifest);
      wanted.forEach(function (want) {
        // Columns the person added in the review window count like columns of the page.
        (extras[want.name] || []).forEach(function (c) {
          if (!want.columns.some(function (x) { return x.name === c.name; })) { want.columns.push({ name: c.name, type: c.type, choices: c.choices, mine: true }); }
        });
      });
      wanted.forEach(function (want) {
        var have = tables.filter(function (t) { return t.name === want.name; })[0];
        if (!have) { plan.create.push({ name: want.name, sharing: want.sharing, columns: want.columns.map(function (c) { return { name: c.name, type: c.type, choices: c.choices }; }) }); return; }
        if (have.sharing !== want.sharing) { plan.clash.push('The table ' + want.name + ' exists as "' + have.sharing + '", the page asks for "' + want.sharing + '".'); }
        want.columns.forEach(function (c) {
          var old = have.columns.filter(function (x) { return x.name === c.name; })[0];
          if (!old) { plan.add.push({ table: want.name, column: { name: c.name, type: c.type, choices: c.choices } }); }
          else if (old.type !== c.type) { plan.clash.push('The column ' + want.name + '.' + c.name + ' exists as ' + old.type + ', the page asks for ' + c.type + '.'); }
        });
      });
    }
    var list = ui.clear($('tables-list'));
    plan.create.forEach(function (t) { list.appendChild(ui.el('li', '', 'New table ' + describe(t))); });
    plan.add.forEach(function (a) { list.appendChild(ui.el('li', '', 'New column in ' + a.table + ': ' + a.column.name + ' ' + a.column.type)); });
    plan.clash.forEach(function (c) { list.appendChild(ui.el('li', 'hub-warn', 'Fix this: ' + c + ' A table cannot be changed that way. Use another name in the page, or delete the table under Data (its rows go with it).')); });
    var pending = plan.create.length + plan.add.length;
    $('tables-need').hidden = pending + plan.clash.length === 0;
    $('tables-create').hidden = pending === 0 || plan.clash.length > 0;
    $('tables-review').hidden = !wanted.length || plan.clash.length > 0;
    $('tables-text').textContent = plan.clash.length ? 'The page and the tool\'s tables do not agree:'
      : 'This tool saves data in the database. It needs the following tables. The site makes them for you (one for real use, one empty copy for the preview). Read the list, then press the button:';
    $('up-send').disabled = !packed || pending > 0 || plan.clash.length > 0;
    show();
  }

  // The page's own list of tables with the added columns in it, so that a page that draws
  // its form from that list (as `kit/starter/tracker.html` does) shows the new columns by itself.
  function withExtras(text) {
    var manifest = toManifest(wanted);
    var json = JSON.stringify(manifest, null, 1).replace(/</g, '\\u003c');
    var block = /(<script\b[^>]*\bid=["']dame-tables["'][^>]*>)[\s\S]*?(<\/script>)/i;
    return block.test(text) ? text.replace(block, function (all, a, b) { return a + '\n' + json + '\n' + b; }) : null;
  }

  // ------------------------------------------------------------------ the review window ("focus mode")
  // After the check of a page that saves data: its tables and columns, as read from the page,
  // and a place to add more columns before anything is made in the database.
  var TYPE_WORDS = { text: 'Text (short)', longtext: 'Text (long)', number: 'Number', date: 'Date', bool: 'Yes or no', choice: 'One of a list', person: 'A person', json: 'Structured data' };
  var SHARE_WORDS = { team: 'Team: everyone with the tool sees all rows', 'private': 'Private: each person sees only his own rows', reference: 'Reference: everyone reads, only managers change' };

  function closeFocus() {
    if (focus) { focus.remove(); focus = null; }
  }

  function openFocus() {
    closeFocus();
    if (!wanted.length) { return; }
    focus = ui.el('div', 'hub-focus-back');
    var box = ui.el('section', 'hub-focus');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'The database tables of this tool');
    box.appendChild(ui.el('h2', null, 'The database tables of this tool'));
    box.appendChild(ui.el('p', 'dame-muted', 'Your page saves data in this site\'s database. These are the tables and columns the site read from your page. Add more columns if you need them. Nothing is made in the database until you press the button at the bottom.'));
    var warn = ui.el('p', 'hub-msg hub-warn');
    warn.hidden = true;
    warn.setAttribute('role', 'alert');

    wanted.forEach(function (want) {
      var have = tables.filter(function (t) { return t.name === want.name; })[0];
      var card = ui.el('div', 'hub-focus-table');
      card.setAttribute('data-want', want.name);
      var title = ui.el('h3', null, want.name + ' ');
      title.appendChild(ui.el('span', 'hub-pill' + (have ? ' hub-pill-ok' : ''), have ? 'Already in the database' : 'New table'));
      card.appendChild(title);
      card.appendChild(ui.el('p', 'dame-muted', (SHARE_WORDS[want.sharing] || want.sharing) + '.'));
      var list = ui.el('ul', 'hub-list hub-cols');
      want.columns.forEach(function (c) {
        var old = have && have.columns.some(function (x) { return x.name === c.name; });
        var li = ui.el('li', 'hub-person');
        var text = ui.el('div', 'hub-grow');
        text.appendChild(ui.el('strong', null, c.name));
        text.appendChild(ui.el('span', null, (TYPE_WORDS[c.type] || c.type) + (c.choices ? ': ' + c.choices.join(', ') : '')));
        li.appendChild(text);
        li.appendChild(ui.el('span', 'hub-pill' + (old ? ' hub-pill-ok' : ''), c.mine ? 'Added by you' : (old ? 'In the database' : 'From your page')));
        if (c.mine) {
          var drop = ui.el('button', 'dame-btn hub-small', 'Remove');
          drop.type = 'button';
          drop.addEventListener('click', function () {
            extras[want.name] = (extras[want.name] || []).filter(function (x) { return x.name !== c.name; });
            planTables().then(openFocus);
          });
          li.appendChild(drop);
        }
        list.appendChild(li);
      });
      card.appendChild(list);

      // One more column: a name, what it holds, and the choices when it is "one of a list".
      var row = ui.el('div', 'hub-colline hub-focus-add');
      var name = ui.el('input', 'dame-input');
      name.type = 'text';
      name.maxLength = 41;
      name.placeholder = 'new column, for example remarks';
      name.setAttribute('aria-label', 'Name of a new column in ' + want.name);
      var type = ui.el('select', 'dame-input');
      type.setAttribute('aria-label', 'What the new column holds');
      Object.keys(TYPE_WORDS).forEach(function (t) { var o = ui.el('option', null, TYPE_WORDS[t]); o.value = t; type.appendChild(o); });
      var choices = ui.el('input', 'dame-input');
      choices.type = 'text';
      choices.placeholder = 'the choices, with commas: low, medium, high';
      choices.setAttribute('aria-label', 'The choices');
      choices.hidden = true;
      type.addEventListener('change', function () { choices.hidden = type.value !== 'choice'; });
      var add = ui.el('button', 'dame-btn', 'Add column');
      add.type = 'button';
      add.addEventListener('click', function () {
        // "Unit Price" becomes unit_price: small letters, digits, underscore.
        var id = name.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        var list2 = type.value === 'choice' ? choices.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean) : null;
        var problem = !/^[a-z][a-z0-9_]{1,40}$/.test(id) ? 'A column name starts with a letter and has 2 to 41 small letters, digits or underscores, for example unit_price.'
          : ['id', 'owner', 'created_at', 'updated_at', 'updated_by'].indexOf(id) >= 0 ? 'Every table already has ' + id + ' by itself. Choose another name.'
          : want.columns.some(function (x) { return x.name === id; }) ? 'This table already has a column named ' + id + '.'
          : (type.value === 'choice' && (!list2 || list2.length < 2)) ? 'Write at least two choices, with commas between them.' : '';
        warn.hidden = !problem;
        warn.textContent = problem;
        if (problem) { name.focus(); return; }
        (extras[want.name] = extras[want.name] || []).push(list2 ? { name: id, type: 'choice', choices: list2 } : { name: id, type: type.value });
        planTables().then(openFocus);
      });
      row.appendChild(name);
      row.appendChild(type);
      row.appendChild(choices);
      row.appendChild(add);
      card.appendChild(row);
      box.appendChild(card);
    });

    box.appendChild(ui.el('p', 'dame-muted', 'Every table also keeps by itself who added a row and when. A column you add here is made in the database; a page that draws its form from its list of tables shows it by itself, any other page must be told (the site writes that message for you).'));
    box.appendChild(warn);
    var pending = plan.create.length + plan.add.length;
    var foot = ui.el('div', 'dame-row hub-focus-foot');
    var go = ui.el('button', 'dame-btn dame-btn-primary', pending ? 'Create in the database and go on' : 'Nothing new to create. Go on');
    go.type = 'button';
    go.id = 'tables-go';
    go.addEventListener('click', function () {
      if (plan.create.length + plan.add.length === 0) { closeFocus(); return; }
      go.disabled = true;
      createTables();
    });
    var later = ui.el('button', 'dame-btn', 'Not now');
    later.type = 'button';
    later.id = 'tables-later';
    later.addEventListener('click', closeFocus);
    foot.appendChild(go);
    foot.appendChild(later);
    box.appendChild(foot);
    focus.appendChild(box);
    document.body.appendChild(focus);
    go.focus();
  }

  async function createTables() {
    $('tables-create').disabled = true;
    ui.say($('msg'), '');
    var added = Object.keys(extras).reduce(function (n, t) { return n + extras[t].length; }, 0);
    var names = Object.keys(extras).reduce(function (all, t) { return all.concat(extras[t].map(function (c) { return t + '.' + c.name + ' (' + c.type + ')'; })); }, []);
    try {
      if (added && sourceText) {
        var changed = withExtras(sourceText);
        if (changed) {
          // Check the page again with the longer list; the plan stays the same.
          var packer = $('packer').contentWindow.DamePack;
          var again = await packer.pack(packer.fromCode(changed), { libs: shelf.map(function (l) { return l.id; }) });
          if (!again.problems.length) { packed = again; sourceText = changed; if ($('code').value.trim()) { $('code').value = changed; } }
        }
      }
      for (var i = 0; i < plan.create.length; i += 1) {
        var t = plan.create[i];
        await api.rpc('dame_table_create', { p_space: space, p_tool: tool, p_name: t.name, p_sharing: t.sharing, p_columns: t.columns });
      }
      for (var k = 0; k < plan.add.length; k += 1) {
        await api.rpc('dame_table_add_column', { p_space: space, p_tool: tool, p_table: plan.add[k].table, p_column: plan.add[k].column });
      }
      extras = {};
      await planTables();
      await showTables();
      closeFocus();
      // A page that does not draw itself from the list has no field for an added column yet.
      var selfDrawn = (sourceText.match(/dame-tables/g) || []).length >= 2;
      newColumns = added && !selfDrawn ? names : [];
      $('cols-copy').hidden = !newColumns.length;
      $('cols-text').hidden = !newColumns.length;
      ui.say($('msg'), 'The tables are made in the database. Press "Next: upload".' + (added ? (selfDrawn ? ' Your page draws its form from the list, so it shows the added columns by itself.' : ' The columns you added exist in the database now; your page has no field for them yet (see below).') : ''), 'ok');
    } catch (err) {
      await planTables().catch(function () {});
      ui.sayError($('msg'), err);
      $('msg').scrollIntoView({ block: 'nearest' });
    }
    $('tables-create').disabled = false;
  }

  // Checks what was pasted or chosen. Nothing is sent anywhere by this.
  async function check(getMap) {
    packed = null;
    plan = null;
    extras = {};
    sourceText = '';
    newColumns = [];
    $('cols-copy').hidden = true;
    $('cols-text').hidden = true;
    closeFocus();
    lastProblems = [];
    lastNotes = [];
    lastKeeps = false;
    $('after-upload').hidden = true;
    $('tables-need').hidden = true;
    $('up-send').disabled = true;
    offerFix(false);
    $('to-ai').hidden = true;
    uploaded = false;
    report([['Reading.', '']]);
    try {
      // The code is read in the hidden helper page pack.html, not in this page.
      var packer = $('packer').contentWindow.DamePack;
      if (!packer) { throw new Error('The file reader is still loading. Try again in a moment.'); }
      var map = await getMap(packer);
      var htmls = Object.keys(map).filter(function (n) { return /\.html?$/i.test(n); });
      if (htmls.length === 1 && !map['dame.json']) { sourceText = new TextDecoder().decode(map[htmls[0]]); }
      var result = await packer.pack(map, { libs: shelf.map(function (l) { return l.id; }) });
      var lines = [];
      result.problems.forEach(function (p) { lines.push(['Fix this: ' + p, 'hub-warn']); });
      result.notes.forEach(function (n) { lines.push(['Note: ' + n, '']); });
      mark(3, true);
      if (!result.problems.length) {
        packed = result;
        $('to-ai').hidden = way !== 'own' || aiMode === 'off';
        await planTables();
        var waits = plan.create.length + plan.add.length + plan.clash.length > 0;
        undeclared.forEach(function (name) {
          lines.push(['Note: the page saves rows in a table named "' + name + '", but does not list that table and its columns, and this tool has no such table. Saving there will not work. If it should, ask the AI to add the list of tables (the block with id="dame-tables") and give the complete index.html again.', '']);
        });
        lines.unshift(['The check passed: ' + result.pages.map(function (p) { return p.name; }).join(', ') + ' (' + size(result.total) + '). ' + (waits ? 'One thing left before the upload: the database tables below.' : 'Press "Next: upload".'), 'hub-ok']);
      } else {
        lastProblems = result.problems;
        lastNotes = result.notes;
        lastKeeps = !!result.keeps;
        lines.push(['Nothing was uploaded. That is normal for a page made outside this site. ' + (aiMode === 'off'
          ? 'Correct the points above in your page, then press Back and bring it again.'
          : 'Press "Copy the full request for the AI" below, give it to the AI, then press Back and paste the new answer.'), '']);
        offerFix(aiMode !== 'off');
      }
      report(lines);
    } catch (err) {
      report([['Fix this: ' + ((err && err.message) || 'The code could not be read.'), 'hub-warn']]);
    }
    if (!way) { way = 'own'; }
    go('step-4');
    // A page that saves data: show its tables and columns before anything is made.
    // It opens every time, also when the tables already exist, so the columns can be seen and more can be added.
    if (packed && plan && plan.clash.length === 0 && wanted.length) { openFocus(); }
  }

  async function send() {
    if (!packed) { return; }
    var pages = packed.pages;
    $('up-send').disabled = true;
    ui.say($('msg'), '');
    try {
      var version = await api.rpc('dame_version_begin', {
        p_space: space, p_tool: tool, p_note: $('up-note').value,
        p_files: pages.map(function (p) { return { name: p.name, size: p.size, sha256: p.sha256 }; })
      });
      for (var i = 0; i < pages.length; i += 1) {
        report([['Uploading page ' + (i + 1) + ' of ' + pages.length + ': ' + pages[i].name, '']]);
        await api.fileSend(space + '/' + tool + '/' + version + '/' + pages[i].name, new Blob([pages[i].bytes], { type: 'text/html' }));
      }
      await api.rpc('dame_version_seal', { p_space: space, p_tool: tool, p_version: version });
      packed = null;
      $('tables-need').hidden = true;
      $('up-files').value = '';
      $('up-note').value = '';
      $('code').value = '';
      report([]);
      uploaded = true;
      show();
      await load();
      ui.say($('msg'), 'Version ' + version + ' is uploaded and is the preview. Open the preview, try it, then press Make live.', 'ok');
      // The next two things to do, right where the person is.
      $('after-text').textContent = 'Version ' + version + ' is uploaded. Only admins and managers see it until you make it live.';
      $('after-preview').href = toolUrl(true);
      ui.clear($('after-live')).appendChild(ui.confirmButton('Make live', '', function () {
        restart();
        act('dame_version_make_live', { p_space: space, p_tool: tool, p_version: version }, 'Version ' + version + ' is live. Everyone with the tool gets it now.');
      }));
      $('after-upload').hidden = false;
    } catch (err) {
      report([['The upload stopped. Nothing went live. Press Back and check the page again to retry.', 'hub-warn']]);
      go('step-4');
      $('up-files').value = '';
      packed = null;
      ui.sayError($('msg'), err);
    }
    $('msg').scrollIntoView({ block: 'nearest' });
  }

  // ------------------------------------------------------------------ data: the tool's tables

  var TYPES = [['text', 'Text (short)'], ['longtext', 'Text (long)'], ['number', 'Number'], ['date', 'Date'],
    ['bool', 'Yes or no'], ['choice', 'One of a list'], ['person', 'A person'], ['json', 'Structured data (json)']];

  // One line of the column form: name, type and, for "one of a list", the choices.
  function columnLine() {
    var line = ui.el('div', 'hub-two hub-colline');
    var name = ui.el('input', 'dame-input');
    name.type = 'text';
    name.maxLength = 41;
    name.autocomplete = 'off';
    name.placeholder = 'column name, for example status';
    name.setAttribute('aria-label', 'Column name');
    var type = ui.el('select', 'dame-input');
    type.setAttribute('aria-label', 'Column type');
    TYPES.forEach(function (t) { var o = ui.el('option', null, t[1]); o.value = t[0]; type.appendChild(o); });
    var choices = ui.el('input', 'dame-input');
    choices.type = 'text';
    choices.placeholder = 'the choices, with commas: open, won, lost';
    choices.setAttribute('aria-label', 'Choices');
    choices.hidden = true;
    type.addEventListener('change', function () { choices.hidden = type.value !== 'choice'; });
    line.appendChild(name);
    line.appendChild(type);
    line.appendChild(choices);
    line.read = function () {
      if (!name.value.trim()) { return null; }
      var col = { name: name.value.trim(), type: type.value };
      if (type.value === 'choice') { col.choices = choices.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
      return col;
    };
    return line;
  }

  function tableBlock(t) {
    var box = ui.el('div', 'hub-block');
    box.setAttribute('data-table', t.name);
    var title = ui.el('h3', null, t.name + ' ');
    title.appendChild(ui.el('span', 'hub-pill', t.sharing));
    title.appendChild(ui.el('span', 'hub-pill', t.rows + (t.rows === 1 ? ' row' : ' rows')));
    title.appendChild(ui.el('span', 'hub-pill', t.preview_rows + ' in the preview'));
    box.appendChild(title);
    box.appendChild(ui.el('p', 'dame-muted', 'Columns: ' + t.columns.map(function (c) {
      return c.name + ' (' + c.type + (c.choices ? ': ' + c.choices.join(', ') : '') + ')';
    }).join(', ') + '.'));
    var line = columnLine();
    var add = ui.el('button', 'dame-btn hub-small', 'Add this column');
    add.type = 'button';
    add.addEventListener('click', function () {
      var col = line.read();
      if (!col) { ui.say($('msg'), 'Type the name of the new column first.', 'warn'); return; }
      act('dame_table_add_column', { p_space: space, p_tool: tool, p_table: t.name, p_column: col }, 'The column ' + col.name + ' is added to ' + t.name + '.');
    });
    box.appendChild(ui.el('p', 'hub-sub', 'Add a column'));
    box.appendChild(line);
    box.appendChild(add);
    box.appendChild(ui.typedDelete(t.name, 'Delete table and its ' + t.rows + (t.rows === 1 ? ' row' : ' rows'), function (typed) {
      act('dame_table_drop', { p_space: space, p_tool: tool, p_table: t.name, p_confirm: typed }, 'The table ' + t.name + ' and its rows are deleted.');
    }));
    return box;
  }

  async function showTables() {
    tables = await api.rpc('dame_tables_list', { p_space: space, p_tool: tool }) || [];
    var box = ui.clear($('data-tables'));
    tables.forEach(function (t) { box.appendChild(tableBlock(t)); });
    $('data-empty').hidden = tables.length > 0;
  }

  function dataForm() {
    $('tb-columns').appendChild(columnLine());
    $('tb-columns').appendChild(columnLine());
    $('tb-more').addEventListener('click', function () { $('tb-columns').appendChild(columnLine()); });
    $('form-table').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var cols = Array.prototype.map.call($('tb-columns').children, function (l) { return l.read(); }).filter(Boolean);
      var name = $('tb-name').value.trim();
      var before = tables.length;
      await act('dame_table_create', { p_space: space, p_tool: tool, p_name: name, p_sharing: $('tb-sharing').value, p_columns: cols },
        'The table ' + name + ' is made. A tool reaches it with Dame.table(\'' + name + '\').');
      if (tables.length > before) {
        $('tb-name').value = '';
        ui.clear($('tb-columns'));
        $('tb-columns').appendChild(columnLine());
        $('tb-columns').appendChild(columnLine());
      }
    });
  }

  // 'loading' is the page's own data, already on its way: the kit files are fetched at the same time.
  async function builder(me, loading) {
    aiMode = me.ai_mode;
    var loaded = await Promise.all([text('kit/ai-prompt.md'), text('kit/starter/index.html'), text('kit/v1/lib/index.json'), loading, text('kit/ai-fix.md')]);
    fixTemplate = loaded[4];
    template = loaded[0];
    starter = loaded[1].replace(/<!--[\s\S]*?-->\s*/, '');
    shelf = JSON.parse(loaded[2]).libraries;

    shelf.forEach(function (l) {
      var label = ui.el('label', 'hub-check');
      var box = ui.el('input');
      box.type = 'checkbox';
      box.value = l.id;
      box.addEventListener('change', saveDraft);
      label.appendChild(box);
      label.appendChild(document.createTextNode(' It must ' + l.use));
      $('needs').appendChild(label);
    });
    loadDraft();
    $('brief').addEventListener('input', saveDraft);
    $('go-ai').addEventListener('click', function () { begin('ai'); });
    $('go-own').addEventListener('click', function () { begin('own'); });
    $('wz-next').addEventListener('click', next);
    $('wz-back').addEventListener('click', back);
    $('wz-restart').addEventListener('click', restart);
    $('kit-skip').addEventListener('click', function () { if (described()) { kitDone = true; next(); } });
    $('to-ai').addEventListener('click', function () { toAi().catch(function (err) { ui.sayError($('msg'), err); }); });
    $('save-no').addEventListener('change', function () { saveDraft(); show(); });
    $('need-data').addEventListener('change', function () { saveDraft(); show(); });

    if (aiMode === 'off') {
      $('kit-text').textContent = 'IT has switched the AI prompt off on this site. Press Next and start from the starter page, then change it by hand, or ask a colleague who builds tools.';
      $('kit-how').hidden = true;
      $('kit-copy').hidden = true;
      $('kit-save').hidden = true;
      $('kit-show').hidden = true;
    }
    $('kit-copy').addEventListener('click', function () { if (described()) { kitDone = true; show(); copy(starterKit(), $('kit-copy'), 'Copied. Paste it into the AI.'); } });
    $('kit-save').addEventListener('click', function () { if (described()) { kitDone = true; show(); saveFile('dame-starter-kit-' + tool + '.md', starterKit()); } });

    $('tables-create').addEventListener('click', openFocus);
    $('tables-review').addEventListener('click', openFocus);
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { closeFocus(); } });
    $('cols-copy').addEventListener('click', function () {
      copy('I added these columns to the tool\'s tables on the DAME site: ' + newColumns.join(', ') + '. Add them to the list of tables in the page (the block with id="dame-tables"), give each a field in the form and a column in the list, and give me the complete index.html again, in one code block, still following every rule of the starter kit.',
        $('cols-copy'), 'Copied. Paste it into the AI.');
    });
    dataForm();
    $('kit-show').addEventListener('click', function () {
      if (!described()) { return; }
      $('kit-pre').textContent = starterKit();
      $('kit-pre').hidden = !$('kit-pre').hidden;
      kitDone = true;
      show();
    });

    $('code-check').addEventListener('click', function () {
      if (!$('code').value.trim()) {
        ui.say($('msg'), 'Nothing is pasted yet. Paste the code into the box first.', 'warn');
        return;
      }
      check(function (packer) { return packer.fromCode($('code').value); });
    });
    $('code-starter').addEventListener('click', function () {
      $('code').value = starterPage();
      check(function (packer) { return packer.fromCode($('code').value); });
    });
    $('up-files').addEventListener('change', function () {
      var files = $('up-files').files;
      if (files.length) { check(function (packer) { return packer.collect(files); }); }
    });
    $('fix-copy').addEventListener('click', function () { copy(fixRequest(), $('fix-copy'), 'Copied. Paste it into the AI.', $('fix-pre')); });
    $('fix-save').addEventListener('click', function () { saveFile('dame-fix-request-' + tool + '.md', fixRequest()); });
    $('fix-show').addEventListener('click', function () {
      $('fix-pre').textContent = fixRequest();
      $('fix-pre').hidden = !$('fix-pre').hidden;
    });
    $('up-send').addEventListener('click', send);

    // Choosing a file: the name is shown, and a file can be dropped on the area.
    var pick = $('pick');
    $('up-files').addEventListener('change', function () {
      var files = $('up-files').files;
      $('picked').textContent = files.length === 1 ? 'Chosen: ' + files[0].name : files.length + ' files chosen';
      $('picked').hidden = files.length === 0;
    });
    ['dragenter', 'dragover'].forEach(function (n) { pick.addEventListener(n, function (ev) { ev.preventDefault(); pick.classList.add('is-over'); }); });
    ['dragleave', 'drop'].forEach(function (n) { pick.addEventListener(n, function (ev) { ev.preventDefault(); pick.classList.remove('is-over'); }); });
    pick.addEventListener('drop', function (ev) {
      var files = ev.dataTransfer && ev.dataTransfer.files;
      if (!files || !files.length) { return; }
      $('picked').textContent = files.length === 1 ? 'Chosen: ' + files[0].name : files.length + ' files chosen';
      $('picked').hidden = false;
      check(function (packer) { return packer.collect(files); });
    });

    // The usage guide behind the information button of the tool.
    async function guide() {
      try { return await api.rpc('dame_tool_help_get', { p_space: space, p_tool: tool }); }
      catch (e) { return null; }
    }
    var first = await guide();
    if (first === null) {
      $('help-by').textContent = 'The usage guide is not switched on yet: the owner pastes db/core/006_help.sql into the database first.';
      $('help-save').disabled = true;
    } else {
      $('help-text').value = first.text;
      $('help-by').textContent = first.text ? 'Last written by ' + (first.by || 'a manager') + ', ' + ui.when(first.at) + '.' : 'No guide written yet: people get the site\'s own short text.';
    }
    $('help-fill').addEventListener('click', async function () {
      var h = await guide() || { name: toolName, description: toolText, tables: tables, level: '' };
      h.level = '';
      $('help-text').value = ui.toolGuide(h).replace(/\*\*/g, '');
      $('help-text').focus();
    });
    $('help-save').addEventListener('click', function () {
      act('dame_tool_help_set', { p_space: space, p_tool: tool, p_text: $('help-text').value },
        $('help-text').value.trim() ? 'The guide is saved. People see it behind the information button of the tool.' : 'The guide is empty: people get the site\'s own short text.');
    });
    $('help-see').addEventListener('click', function () {
      ui.info(function () {
        var text = $('help-text').value.trim();
        ui.info(null, !isLive);
        return Promise.resolve({ title: 'How to use ' + toolName, text: text || ui.toolGuide({ description: toolText, tables: tables, level: 'contribute' }), note: 'This is how people will see it.' });
      }, !isLive);
      ui.openInfo();
    });
    show();
  }

  async function start() {
    var me = await ui.guard();
    space = ui.param('space');
    tool = ui.param('tool');
    $('main').hidden = false;
    if (!space || !tool) {
      ui.say($('msg'), 'This address names no tool. Go back to the hub and open the tool from its space.', 'warn');
      return;
    }
    act = ui.runner($('msg'), load);
    loadAudit = ui.audit($('audit'), $('audit-more'), function (limit, before) {
      return api.rpc('dame_audit_scope_list', { p_space: space, p_tool: tool, p_limit: limit, p_before: before });
    });
    $('access-picker').appendChild(ui.picker('Find a person to give access', 'Give access', function (person) {
      act('dame_tool_access_set', { p_space: space, p_tool: tool, p_user: person.id, p_level: $('new-level').value },
        person.name + ' now has the level ' + $('new-level').value + '.');
    }));
    await builder(me, load());
    $('body').hidden = false;
    // Arrived straight from "Create tool" on the space admin page: say so once.
    try {
      if (sessionStorage.getItem('dame.made') === space + '/' + tool) {
        ui.say($('msg'), 'The tool is created. Now build it: choose below how you want to make its page. The site guides you one step at a time; the information button (i) explains everything. Its name, look and managers are on the space admin page, on its tile.', 'ok');
      }
      sessionStorage.removeItem('dame.made');
    } catch (e) { /* no greeting */ }
  }

  start().catch(function (err) {
    $('main').hidden = false;
    ui.sayError($('msg'), err);
  });
})();
