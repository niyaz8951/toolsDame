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
    var t = await api.rpc('dame_tool_admin_get', { p_space: space, p_tool: tool });
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

    var state = await api.rpc('dame_versions_list', { p_space: space, p_tool: tool });
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
    await loadAudit();
  }

  // ------------------------------------------------------------------ the builder
  // Step 1 and 2: the person's description and the starter kit made from it.

  var shelf = [];          // libraries on the shelf, from kit/v1/lib/index.json
  var template = '';       // kit/ai-prompt.md
  var starter = '';        // kit/starter/index.html, without its repo note
  var toolName = '';
  var aiMode = 'prompt';
  var lastProblems = [];

  function draftKey() { return 'dame.brief.' + space + '.' + tool; }

  // The description is kept in this browser only, so a reload does not lose it.
  function saveDraft() {
    try {
      localStorage.setItem(draftKey(), JSON.stringify({ brief: $('brief').value, needs: chosenLibs() }));
    } catch (e) { /* not kept; nothing depends on it */ }
  }

  function loadDraft() {
    try {
      var d = JSON.parse(localStorage.getItem(draftKey()) || '{}');
      $('brief').value = String(d.brief || '').slice(0, 4000);
      (d.needs || []).forEach(function (id) {
        var box = document.querySelector('#needs input[value="' + String(id).replace(/[^a-z0-9-]/g, '') + '"]');
        if (box) { box.checked = true; }
      });
    } catch (e) { /* no draft */ }
  }

  function chosenLibs() {
    return Array.prototype.map.call(document.querySelectorAll('#needs input:checked'), function (b) { return b.value; });
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
    return template
      .split('{{TOOL}}').join(toolName)
      .split('{{BRIEF}}').join(brief)
      .split('{{HEAD}}').join(head)
      .split('{{DATA}}').join('This tool cannot save anything yet: it works with what the person types or the files he chooses, and gives results on screen or as a download. Do not use `Dame.table` or `Dame.files`.')
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

  function mark(step, done) { $('step-' + step).classList.toggle('hub-done', !!done); }

  // Checks what was pasted or chosen. Nothing is sent anywhere by this.
  async function check(getMap) {
    packed = null;
    lastProblems = [];
    $('up-send').disabled = true;
    $('fix-copy').hidden = true;
    $('fix-text').hidden = true;
    mark(3, false);
    mark(4, false);
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
        lines.unshift(['The check passed: ' + result.pages.map(function (p) { return p.name; }).join(', ') + ' (' + size(result.total) + '). Go to step 5.', 'hub-ok']);
        packed = result;
        $('up-send').disabled = false;
        mark(4, true);
      } else {
        lastProblems = result.problems;
        lines.push(['Nothing was uploaded. Copy the fix request, give it to the AI, and paste the new answer in step 3.', '']);
        $('fix-copy').hidden = false;
        $('fix-text').hidden = false;
      }
      report(lines);
    } catch (err) {
      lastProblems = [(err && err.message) || 'The code could not be read.'];
      report([['Fix this: ' + lastProblems[0], 'hub-warn']]);
    }
    $('step-4').scrollIntoView({ block: 'nearest' });
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
      $('up-files').value = '';
      $('up-note').value = '';
      $('code').value = '';
      report([]);
      mark(3, false);
      mark(4, false);
      await load();
      ui.say($('msg'), 'Version ' + version + ' is uploaded and is the preview. Open the preview, try it, then press Make live.', 'ok');
    } catch (err) {
      report([['The upload stopped. Nothing went live. Press Check the code again to retry.', 'hub-warn']]);
      $('up-files').value = '';
      packed = null;
      ui.sayError($('msg'), err);
    }
    $('msg').scrollIntoView({ block: 'nearest' });
  }

  async function builder(me) {
    aiMode = me.ai_mode;
    var loaded = await Promise.all([text('kit/ai-prompt.md'), text('kit/starter/index.html'), text('kit/v1/lib/index.json')]);
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
    mark(1, $('brief').value.trim().length > 0);
    $('brief').addEventListener('input', function () { saveDraft(); mark(1, $('brief').value.trim().length > 0); });

    if (aiMode === 'off') {
      $('kit-text').textContent = 'IT has switched the AI prompt off on this site. Start from the starter page in step 3 and change it by hand, or ask a colleague who builds tools. The building blocks are shown on their own page.';
      $('kit-copy').hidden = true;
      $('kit-save').hidden = true;
      $('kit-show').hidden = true;
    }
    $('kit-copy').addEventListener('click', function () { mark(2, true); copy(starterKit(), $('kit-copy'), 'Copied. Paste it into the AI.'); });
    $('kit-save').addEventListener('click', function () { mark(2, true); saveFile('dame-starter-kit-' + tool + '.md', starterKit()); });
    $('kit-show').addEventListener('click', function () {
      $('kit-pre').textContent = starterKit();
      $('kit-pre').hidden = !$('kit-pre').hidden;
    });

    $('code-check').addEventListener('click', function () {
      if (!$('code').value.trim()) {
        report([['Fix this: nothing was pasted. Paste the code of index.html in step 3, or press "Use the starter page as it is".', 'hub-warn']]);
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
    await load();
    await builder(me);
    $('body').hidden = false;
  }

  start().catch(function (err) {
    $('main').hidden = false;
    ui.sayError($('msg'), err);
  });
})();
