/*
 * pages/admin-tool.js - the tool admin page: files and versions, access, audit.
 * Serves: contract 6 (Releases), 3 (Access), 7 (Audit); Data (5) comes later.
 * Must not change: everything from the database is written with textContent;
 * each change calls one dame_* function and then reloads, so the page shows
 * what the database holds; the chosen files are only read by kit/v1/pack.js,
 * never run; a version with a problem is not uploaded.
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
    $('text').textContent = (t.description ? t.description + ' ' : '') + 'In ' + t.space_name + '. ' +
      (t.active ? '' : 'This tool is switched off: only its managers and the space admins can open it. ') +
      (t.space_active ? '' : 'The space is switched off by IT.');
    $('open-text').textContent = t.open_to_space
      ? 'Everyone in the space has this tool at the level "' + t.open_level + '". People named here can have a higher level.'
      : 'Only the people named here can open this tool.';
    $('back').href = api.href(t.is_space_admin ? 'admin/space.html' : 'space.html') + '?space=' + encodeURIComponent(space);
    $('back').textContent = t.is_space_admin ? 'Back to the space admin page' : 'Back to the space';

    var state = await api.rpc('dame_versions_list', { p_space: space, p_tool: tool });
    $('ver-state').textContent = (state.live === null ? 'Nothing is live yet: people with the tool see "not published".' : 'Live: version ' + state.live + '.') +
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

  // ------------------------------------------------------------------ upload

  function report(lines) {
    var list = ui.clear($('up-report'));
    lines.forEach(function (l) { list.appendChild(ui.el('li', l[1], l[0])); });
  }

  async function chosen() {
    packed = null;
    $('up-send').disabled = true;
    var files = $('up-files').files;
    if (!files.length) { report([]); return; }
    report([['Reading the files.', '']]);
    try {
      // The files are read in the hidden helper page pack.html, not in this page.
      var packer = $('packer').contentWindow.DamePack;
      if (!packer) { throw new Error('The file reader is still loading. Choose the files again in a moment.'); }
      var result = await packer.pack(await packer.collect(files));
      var lines = [];
      result.problems.forEach(function (p) { lines.push(['Fix this: ' + p, 'hub-warn']); });
      result.notes.forEach(function (n) { lines.push(['Note: ' + n, '']); });
      if (!result.problems.length) {
        lines.unshift(['Ready to upload: ' + result.pages.map(function (p) { return p.name; }).join(', ') + ' (' + size(result.total) + ' in all).', 'hub-ok']);
        packed = result;
        $('up-send').disabled = false;
      } else {
        lines.push(['Nothing was uploaded. Fix the files, then choose them again.', '']);
      }
      report(lines);
    } catch (err) {
      report([['Fix this: ' + ((err && err.message) || 'The files could not be read.'), 'hub-warn']]);
    }
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
      report([]);
      await load();
      ui.say($('msg'), 'Version ' + version + ' is uploaded and is the preview. Open the preview, try it, then press Make live.', 'ok');
    } catch (err) {
      report([['The upload stopped. Nothing went live. Choose the files again to retry.', 'hub-warn']]);
      $('up-files').value = '';
      packed = null;
      ui.sayError($('msg'), err);
    }
    $('msg').scrollIntoView({ block: 'nearest' });
  }

  async function start() {
    await ui.guard();
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
    $('up-files').addEventListener('change', chosen);
    $('up-send').addEventListener('click', send);
    await load();
    $('body').hidden = false;
  }

  start().catch(function (err) {
    $('main').hidden = false;
    ui.sayError($('msg'), err);
  });
})();
