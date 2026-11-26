/*
 * pages/admin-tool.js - the tool admin page: files and versions, access, audit.
 * Serves: contract 6 (Releases), 3 (Access), 7 (Audit); Data (5) comes later.
 * Must not change: everything from the database is written with textContent;
 * each change calls one dame_* function and then reloads, so the page shows
 * what the database holds; pasted code and chosen files are only read by
 * kit/v1/pack.js in the helper page, never run here; a version with a problem
 * is not uploaded; the starter kit holds no address, key or user data.
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
    $('title').textContent = (t.icon ? t.icon + ' ' : '') + t.name + ': admin';
    toolName = t.name;
    $('text').textContent = (t.description ? t.description + ' ' : '') + 'In ' + t.space_name + '. ' +
      (t.active ? '' : 'This tool is switched off: only its managers and the space admins can open it. ') +
      (t.space_active ? '' : 'The space is switched off by IT.');
    $('open-text').textContent = t.open_to_space
      ? 'Everyone in the space has this tool at the level "' + t.open_level + '". People named here can have a higher level.'
      : 'Only the people named here can open this tool.';
    $('back').href = api.href(t.is_space_admin ? 'admin/space.html' : 'space.html') + '?space=' + encodeURIComponent(space);
    $('back').textContent = t.is_space_admin ? 'Back to the space admin page' : 'Back to the space';

    var state = got[1];
    $('ver-state').textContent = (state.live === null ? 'Not built yet: people who have this tool see "being prepared".' : 'Live: version ' + state.live + '.') +
      (state.preview === null ? '' : ' Preview: version ' + state.preview + ' (only admins and managers see it).');
    $('open-live').href = toolUrl(false);
    $('open-live').hidden = state.live === null;
    $('open-preview').href = toolUrl(true);
    $('open-preview').hidden = state.preview === null;
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
  var starter = '';        // kit/starter/index.html, without its repo note
  var toolName = '';
  var aiMode = 'prompt';
  var lastProblems = [];
  var tables = [];         // this tool's tables, as the database lists them
  var plan = null;         // what the checked page still needs: { create: [], add: [], clash: [] }
  var SAMPLE = { dame: 1, tables: { bids: { sharing: 'team', columns: { project: 'text', capacity_kw: 'number', due: 'date',
    status: { choice: ['open', 'won', 'lost'] }, lead: 'person', notes: 'longtext' } } } };

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
  function starterKit() {
    var libs = shelf.filter(function (l) { return chosenLibs().indexOf(l.id) >= 0; });
    var head = ['   `<link rel="stylesheet" href="/_dame/v1/dame.css">`', '   `<script src="/_dame/v1/dame.js"></script>`']
      .concat(libs.map(function (l) { return '   `' + l.line + '`'; })).join('\n');
    var libText = libs.map(function (l) {
      return '## Library: ' + l.name + ' ' + l.version + ' (' + l.use + ')\nThe site provides it; load it with the line above and nothing else.\n' +
        l.how.map(function (h) { return '- ' + h; }).join('\n') + '\n\n';
    }).join('');
    var brief = $('brief').value.trim() || '(Describe here what the tool should do: who uses it, what goes in, what comes out.)';
    var page = starterPage();
    if (libs.length) {
      page = page.replace('<script src="/_dame/v1/dame.js"></script>',
        '<script src="/_dame/v1/dame.js"></script>\n' + libs.map(function (l) { return l.line; }).join('\n'));
    }
    // A page the person already has (kept when he chose "Ask the AI to rebuild this page") is handed over.
    var existing = oldPage.trim();
    var convert = (existing && /<[a-z!][\s\S]*>/i.test(existing))
      ? '\n## The page I already have\nRebuild this page as a DAME tool. Keep what it does and its words. Replace its look with the building blocks, ' +
        'remove everything the rules forbid (outside files, own header, own fonts, browser storage), and after the code tell me in one line anything it did that a DAME tool cannot do.\n' +
        '```html\n' + existing.slice(0, 60000) + '\n```\n'
      : '';
    return (template + convert)
      .split('{{TOOL}}').join(toolName)
      .split('{{BRIEF}}').join(brief)
      .split('{{HEAD}}').join(head)
      .split('{{DATARULE}}').join($('need-data').checked ? 'To keep data use the tables of this site, as described below.'
        : 'This tool saves nothing: it works with what the person types or the files he chooses, and gives results on screen or as a download. Do not use `Dame.table`.')
      .split('{{DATA}}').join($('need-data').checked ? dataText() : '')
      .split('{{LIBS}}').join(libText)
      .split('{{STARTER}}').join(page);
  }

  async function copy(textToCopy, button, done) {
    try {
      await navigator.clipboard.writeText(textToCopy);
      var old = button.textContent;
      button.textContent = done;
      setTimeout(function () { button.textContent = old; }, 2500);
    } catch (e) {
      // The browser did not allow copying: show the text so it can be copied by hand.
      $('kit-pre').textContent = textToCopy;
      $('kit-pre').hidden = false;
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

  // What to tell the AI when the site refused its answer.
  function fixRequest() {
    return 'The DAME site checked the index.html you gave me and refused it. Correct exactly these points and give me the complete index.html again, in one code block, still following every rule of the starter kit:\n\n' +
      lastProblems.map(function (p, i) { return (i + 1) + '. ' + p; }).join('\n') + '\n';
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
  var way = null;          // 'ai' | 'own' | 'ready' | null (the three choices are shown)
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
    $('bring-ready').hidden = way !== 'ready';
    $('bring-paste').hidden = way === 'ready';
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
    $('wz-back').textContent = at === 0 ? 'Back to the three choices' : 'Back';
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
    if (packed && packed.manifest) {
      tables = await api.rpc('dame_tables_list', { p_space: space, p_tool: tool }) || [];
      fromManifest(packed.manifest).forEach(function (want) {
        var have = tables.filter(function (t) { return t.name === want.name; })[0];
        if (!have) { plan.create.push(want); return; }
        if (have.sharing !== want.sharing) { plan.clash.push('The table ' + want.name + ' exists as "' + have.sharing + '", the page asks for "' + want.sharing + '".'); }
        want.columns.forEach(function (c) {
          var old = have.columns.filter(function (x) { return x.name === c.name; })[0];
          if (!old) { plan.add.push({ table: want.name, column: c }); }
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
    $('tables-text').textContent = plan.clash.length ? 'The page and the tool\'s tables do not agree:'
      : 'This tool saves data in the database. It needs the following tables. The site makes them for you (one for real use, one empty copy for the preview). Read the list, then press the button:';
    $('up-send').disabled = !packed || pending > 0 || plan.clash.length > 0;
    show();
  }

  async function createTables() {
    $('tables-create').disabled = true;
    ui.say($('msg'), '');
    try {
      for (var i = 0; i < plan.create.length; i += 1) {
        var t = plan.create[i];
        await api.rpc('dame_table_create', { p_space: space, p_tool: tool, p_name: t.name, p_sharing: t.sharing, p_columns: t.columns });
      }
      for (var k = 0; k < plan.add.length; k += 1) {
        await api.rpc('dame_table_add_column', { p_space: space, p_tool: tool, p_table: plan.add[k].table, p_column: plan.add[k].column });
      }
      await planTables();
      await showTables();
      ui.say($('msg'), 'The tables are made in the database. Press "Next: upload".', 'ok');
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
    lastProblems = [];
    $('after-upload').hidden = true;
    $('tables-need').hidden = true;
    $('up-send').disabled = true;
    $('fix-copy').hidden = true;
    $('fix-text').hidden = true;
    $('to-ai').hidden = true;
    uploaded = false;
    report([['Reading.', '']]);
    try {
      // The code is read in the hidden helper page pack.html, not in this page.
      var packer = $('packer').contentWindow.DamePack;
      if (!packer) { throw new Error('The file reader is still loading. Try again in a moment.'); }
      var result = await packer.pack(await getMap(packer), { libs: shelf.map(function (l) { return l.id; }) });
      var lines = [];
      result.problems.forEach(function (p) { lines.push(['Fix this: ' + p, 'hub-warn']); });
      result.notes.forEach(function (n) { lines.push(['Note: ' + n, '']); });
      mark(3, true);
      if (!result.problems.length) {
        packed = result;
        $('to-ai').hidden = way !== 'own' || aiMode === 'off';
        await planTables();
        var waits = plan.create.length + plan.add.length + plan.clash.length > 0;
        lines.unshift(['The check passed: ' + result.pages.map(function (p) { return p.name; }).join(', ') + ' (' + size(result.total) + '). ' + (waits ? 'One thing left before the upload: the database tables below.' : 'Press "Next: upload".'), 'hub-ok']);
      } else {
        lastProblems = result.problems;
        lines.push(['Nothing was uploaded. That is normal on a first try. Copy the fix request, give it to the AI, then press Back and paste the new answer.', '']);
        $('fix-copy').hidden = false;
        $('fix-text').hidden = false;
        $('to-ai').hidden = way !== 'own' || aiMode === 'off';
      }
      report(lines);
    } catch (err) {
      lastProblems = [(err && err.message) || 'The code could not be read.'];
      report([['Fix this: ' + lastProblems[0], 'hub-warn']]);
    }
    if (!way) { way = 'own'; }
    go('step-4');
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
    var own = $('example').querySelector('[value="own"]');
    if (own) { own.hidden = tables.length === 0; }
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
    var loaded = await Promise.all([text('kit/ai-prompt.md'), text('kit/starter/index.html'), text('kit/v1/lib/index.json'), loading]);
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
    $('go-ready').addEventListener('click', function () { begin('ready'); });
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

    // Ready-made pages: served by this site, loaded into the box like a pasted answer.
    $('example').querySelector('[value="own"]').hidden = tables.length === 0;
    if (tables.length) { $('example').value = 'own'; }
    else if (/track|list|log|regist/.test(tool)) { $('example').value = 'tracker'; }
    $('example-load').addEventListener('click', async function () {
      try {
        var which = $('example').value;
        if (which === 'starter') { $('code').value = starterPage(); check(function (packer) { return packer.fromCode($('code').value); }); return; }
        var page = (await text(which === 'converter' ? 'examples/converter/index.html' : 'kit/starter/tracker.html')).replace(/<!--[\s\S]*?-->\s*/, '');
        if (which !== 'converter') {
          page = page.split('{{TOOL}}').join(toolName.replace(/[<>&]/g, ' '))
            .split('{{TABLES}}').join(JSON.stringify(which === 'own' ? toManifest(tables) : SAMPLE, null, 1).replace(/</g, '\\u003c'));
        }
        $('code').value = page;
        check(function (packer) { return packer.fromCode($('code').value); });
      } catch (err) {
        ui.sayError($('msg'), err);
      }
    });
    $('tables-create').addEventListener('click', createTables);
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
    $('fix-copy').addEventListener('click', function () { copy(fixRequest(), $('fix-copy'), 'Copied. Paste it into the AI.'); });
    $('up-send').addEventListener('click', send);
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
  }

  start().catch(function (err) {
    $('main').hidden = false;
    ui.sayError($('msg'), err);
  });
})();
