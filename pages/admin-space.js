/*
 * pages/admin-space.js - the space admin page: tools, people, admins, database quota, audit.
 * Serves: contract 2 (Structure), 3 (Access), 7 (Audit).
 * Must not change: everything from the database is written with textContent;
 * each button calls one dame_* function and then reloads, so the page shows
 * what the database holds; deleting a tool needs its id typed in full.
 * Tools: the page shows "Add a tool" and one tile per tool; a tool is
 * changed or deleted only inside the window its tile opens.
 */
(function () {
  'use strict';

  var api = window.DameApi;
  var ui = window.DameShell;
  if (!ui) { return; }

  var space = '';
  var act = null;
  var hadLook = false;
  var loadAudit = null;
  var idTouched = false;
  var LEVELS = [['read', 'Read: see the rows'], ['contribute', 'Contribute: add rows, change own'],
    ['edit', 'Edit: change anyone\'s rows'], ['approve', 'Approve: also delete']];

  function $(id) { return document.getElementById(id); }

  function field(label, input) {
    var l = ui.el('label', 'hub-field', label);
    l.appendChild(input);
    return l;
  }

  function input(type, value, max) {
    var i = ui.el('input', 'dame-input');
    i.type = type;
    i.value = value;
    if (max) { i.maxLength = max; }
    i.autocomplete = 'off';
    return i;
  }

  function levelSelect(value) {
    var s = ui.el('select', 'dame-input');
    LEVELS.forEach(function (l) {
      var o = ui.el('option', null, l[1]);
      o.value = l[0];
      s.appendChild(o);
    });
    s.value = value;
    return s;
  }

  var tools = [];
  var newIcon = null;     // the icon chooser of "Add a tool"
  var spaceIcon = null;   // the icon chooser of the space's own tile
  var win = null;   // the open tool window, or null

  // A tool is one tile, in its own colour. Pressing it opens its window.
  function toolTile(t) {
    var b = ui.el('button', 'hub-tile' + (t.active ? '' : ' hub-tile-off'));
    b.type = 'button';
    b.setAttribute('data-tool', t.id);
    if (/^#[0-9a-f]{6}$/.test(t.colour || '')) { b.style.setProperty('--dame-accent', t.colour); }
    b.appendChild(ui.icon(ui.el('span', 'hub-tile-icon'), t.icon, (t.name.trim().charAt(0) || 'T').toUpperCase()));
    b.appendChild(ui.el('span', 'hub-tile-name', t.name));
    b.appendChild(ui.el('span', 'hub-tile-text', t.open_to_space ? 'Open to the space' : (t.people + (t.people === 1 ? ' person' : ' people') + ' named')));
    if (!t.active) { b.appendChild(ui.el('span', 'hub-pill', 'Switched off')); }
    b.addEventListener('click', function () { openTool(t.id); });
    return b;
  }

  // The window of one tool. Everything that changes a tool is here and nowhere else on the page.
  // After each action the page is read again and the window is drawn again from the database.
  function closeTool() {
    if (!win) { return; }
    var id = win.id;
    win.back.remove();
    document.removeEventListener('keydown', win.onKey);
    win = null;
    var tile = document.querySelector('#tools [data-tool="' + id + '"]');
    if (tile) { tile.focus(); }
  }

  async function inTool(name, args, done) {
    var w = win;
    ui.say(w.msg, '');
    try {
      await api.rpc(name, args);
      await load();
      if (win === w) { ui.say(w.msg, done, 'ok'); }
    } catch (err) {
      await load().catch(function () {});
      if (win === w) { ui.sayError(w.msg, err); }
    }
    if (win === w) { w.msg.scrollIntoView({ block: 'nearest' }); }
  }

  function drawTool(t) {
    var body = ui.clear(win.body);
    var title = ui.el('h2', null, t.name + ' ');
    title.appendChild(ui.el('span', 'hub-pill', t.id));
    title.appendChild(ui.el('span', 'hub-pill' + (t.active ? ' hub-pill-ok' : ''), t.active ? 'On' : 'Switched off'));
    body.appendChild(title);
    var open = t.open_to_space ? 'Open to everyone in the space (' + t.open_level + ').' : 'Only people named on its access list.';
    body.appendChild(ui.el('p', 'dame-muted', (t.description ? t.description + ' ' : '') + open + ' ' +
      t.people + (t.people === 1 ? ' person' : ' people') + ' named.'));
    body.appendChild(ui.el('p', 'dame-hint', '"Build and access" is where you make the tool\'s page, its tables, and say who may use it.'));

    body.appendChild(ui.el('p', 'hub-sub', 'Name and look'));
    var form = ui.el('form', 'hub-edit');
    form.method = 'post';
    form.noValidate = true;
    var name = input('text', t.name, 80);
    var icon = input('text', '', 8);
    var pick = ui.iconPicker(icon);
    pick.set(t.icon);
    var colour = input('color', /^#[0-9a-f]{6}$/.test(t.colour) ? t.colour : '#0b63ce');
    var desc = input('text', t.description, 400);
    form.appendChild(field('Name', name));
    form.appendChild(field('What it is for', desc));
    form.appendChild(field('Icon on the tile: pick a picture, or type one or two letters', icon));
    form.appendChild(pick.node);
    form.appendChild(field('Colour of the tile', colour));
    var check = ui.el('label', 'hub-check');
    var openBox = ui.el('input');
    openBox.type = 'checkbox';
    openBox.checked = t.open_to_space;
    check.appendChild(openBox);
    check.appendChild(document.createTextNode(' Open to everyone in this space'));
    form.appendChild(check);
    var level = levelSelect(t.open_level);
    var levelField = field('Level for everyone in the space', level);
    levelField.hidden = !openBox.checked;
    openBox.addEventListener('change', function () { levelField.hidden = !openBox.checked; });
    form.appendChild(levelField);
    var save = ui.el('button', 'dame-btn hub-small', 'Save changes');
    save.type = 'submit';
    form.appendChild(save);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      inTool('dame_tool_update', { p_space: space, p_tool: t.id, p_name: name.value, p_description: desc.value,
        p_icon: pick.get(), p_colour: colour.value, p_open_to_space: openBox.checked, p_open_level: level.value },
        t.id + ' is changed.');
    });
    body.appendChild(form);

    body.appendChild(ui.el('p', 'hub-sub', 'Managers'));
    var list = ui.el('ul', 'hub-list');
    ui.people(list, t.managers, 'No manager yet. You look after it yourself.', 'Remove', function (person) {
      inTool('dame_tool_manager_remove', { p_space: space, p_tool: t.id, p_user: person.id }, person.name + ' no longer manages ' + t.name + '.');
    });
    body.appendChild(list);
    body.appendChild(ui.picker('Find a person to manage ' + t.name, 'Name as manager', function (person) {
      inTool('dame_tool_manager_add', { p_space: space, p_tool: t.id, p_user: person.id }, person.name + ' now manages ' + t.name + '.');
    }));

    body.appendChild(ui.el('p', 'hub-sub', t.active ? 'Switch off' : 'Switch on'));
    body.appendChild(ui.el('p', 'dame-hint', t.active ? 'Nothing is deleted. Only you and its managers can open the tool until it is switched on again.'
      : 'The people who have this tool can open it again.'));
    var row = ui.el('div', 'dame-row');
    row.appendChild(t.active
      ? ui.confirmButton('Switch off', '', function () { inTool('dame_tool_set_active', { p_space: space, p_tool: t.id, p_active: false }, t.name + ' is switched off. Only you and its managers can open it.'); })
      : ui.confirmButton('Switch on', '', function () { inTool('dame_tool_set_active', { p_space: space, p_tool: t.id, p_active: true }, t.name + ' is switched on.'); }));
    body.appendChild(row);

    body.appendChild(ui.el('p', 'hub-sub', 'Delete'));
    body.appendChild(ui.el('p', 'dame-hint', 'Deletes the tool, its pages, its tables and their rows for good. The id ' + t.id + ' can never be used again.'));
    body.appendChild(ui.typedDelete(t.id, 'Delete tool', async function (typed) {
      var w = win;
      try {
        await api.rpc('dame_tool_delete', { p_space: space, p_tool: t.id, p_confirm: typed });
        closeTool();
        await load();
        ui.say($('msg'), t.name + ' is deleted. Its id ' + t.id + ' will never be used again.', 'ok');
        $('msg').scrollIntoView({ block: 'nearest' });
      } catch (err) {
        await load().catch(function () {});
        if (win === w) { ui.sayError(w.msg, err); }
      }
    }));

    win.link.href = api.href('admin/tool.html') + '?space=' + encodeURIComponent(space) + '&tool=' + encodeURIComponent(t.id);
  }

  function openTool(id, said) {
    var t = tools.filter(function (x) { return x.id === id; })[0];
    if (!t) { return; }
    var back = ui.el('div', 'hub-focus-back');
    var box = ui.el('section', 'hub-focus hub-focus-small');
    box.id = 'tool-win';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Tool ' + t.name);
    var body = ui.el('div');
    var msg = ui.el('p', 'hub-msg');
    msg.id = 'tool-win-msg';
    msg.hidden = true;
    msg.setAttribute('role', 'alert');
    var foot = ui.el('div', 'dame-row hub-focus-foot');
    var link = ui.el('a', 'dame-btn dame-btn-primary', 'Build and access');
    link.id = 'tool-win-build';
    var close = ui.el('button', 'dame-btn', 'Done');
    close.type = 'button';
    close.id = 'tool-win-close';
    close.addEventListener('click', closeTool);
    back.addEventListener('mousedown', function (ev) { if (ev.target === back) { closeTool(); } });
    foot.appendChild(link);
    foot.appendChild(close);
    box.appendChild(body);
    box.appendChild(msg);
    box.appendChild(foot);
    back.appendChild(box);
    win = { id: id, back: back, body: body, msg: msg, link: link, onKey: function (ev) { if (ev.key === 'Escape') { closeTool(); } } };
    document.addEventListener('keydown', win.onKey);
    drawTool(t);
    document.body.appendChild(back);
    if (said) { ui.say(msg, said, 'ok'); }
    link.focus();
  }

  // The "Add a tool" window.
  function showNewTool(on) {
    $('tool-new').hidden = !on;
    ui.say($('tl-msg'), '');
    if (on) { $('tl-name').focus(); } else { $('tool-add').focus(); }
  }

  function showLevel() {
    $('tl-level-field').hidden = !$('tl-open').checked;
    $('tl-named').hidden = $('tl-open').checked;
  }

  async function load() {
    var audit = loadAudit();
    audit.catch(function () {});
    var s = await api.rpc('dame_space_admin_get', { p_space: space });
    document.title = s.name + ' admin - DAME';
    $('title').textContent = s.name + ': admin';
    if (document.activeElement !== $('sp-name')) { $('sp-name').value = s.name; }
    if (document.activeElement !== $('sp-desc')) { $('sp-desc').value = s.description; }
    // The tile's icon and colour (db/core/008): until that file is run, the two fields are not offered.
    var look = await api.rpc('dame_space_look_get', { p_space: space }).catch(function () { return null; });
    $('sp-look').hidden = look === null;
    if (look) {
      if (document.activeElement !== $('sp-icon') && !$('sp-icons').contains(document.activeElement)) { spaceIcon.set(look.icon || ''); }
      $('sp-colour').value = /^#[0-9a-f]{6}$/.test(look.colour) ? look.colour : '#0078b8';
      hadLook = true;
    }

    tools = s.tools;
    var box = ui.clear($('tools'));
    tools.forEach(function (t) { box.appendChild(toolTile(t)); });
    $('tools-empty').hidden = tools.length > 0;
    // An open window shows what the database holds now; a tool that is gone closes its window.
    if (win) {
      var open = tools.filter(function (x) { return x.id === win.id; })[0];
      if (open) { drawTool(open); } else { closeTool(); }
    }

    ui.people($('members'), s.members, 'Nobody yet. Find a person below.', 'Remove', function (person) {
      act('dame_space_member_remove', { p_space: space, p_user: person.id }, person.name + ' is removed from the space.');
    });
    ui.people($('admins'), s.admins, 'No admin.', 'Remove', function (person) {
      act('dame_space_admin_remove', { p_space: space, p_user: person.id }, person.name + ' is no longer an admin.');
    });
    await loadQuota();
    await audit;
  }

  // ---- the database quota of the space (db/core/011): what is used, the limits, asking IT for more.
  var askFor = '';        // the limits the "ask for more" boxes were filled from
  var askTyped = false;   // the admin changed a number in those boxes

  function num(n) { return Number(n || 0).toLocaleString('en'); }

  function stat(box, value, label) {
    var d = ui.el('div', 'dame-stat');
    d.appendChild(ui.el('b', null, value));
    d.appendChild(ui.el('span', null, label));
    box.appendChild(d);
  }

  function limitsText(o) {
    return num(o.rows) + ' rows in the space, ' + num(o.tables) + ' tables in a tool, ' + num(o.columns) + ' columns in a table';
  }

  // Until 011 is run the card says so and the rest of the page works.
  async function loadQuota() {
    var q = await api.rpc('dame_quota_get', { p_space: space }).catch(function () { return null; });
    $('q-off').hidden = q !== null;
    $('q-body').hidden = q === null;
    if (!q) { return; }
    var used = Number(q.rows_used);
    var max = Number(q.max_rows);
    var share = max > 0 ? used / max : 1;
    var stats = ui.clear($('q-stats'));
    stat(stats, num(used) + ' of ' + num(max), 'rows used in this space');
    stat(stats, num(q.most_tables) + ' of ' + num(q.max_tables), 'tables in the tool that has most');
    stat(stats, num(q.max_columns), 'columns allowed in one table');
    $('q-bar').firstElementChild.style.width = (Math.min(1, share) * 100).toFixed(1) + '%';
    $('q-bar').setAttribute('role', 'progressbar');
    $('q-bar').setAttribute('aria-label', 'Rows used');
    $('q-bar').setAttribute('aria-valuemin', '0');
    $('q-bar').setAttribute('aria-valuemax', '100');
    $('q-bar').setAttribute('aria-valuenow', String(Math.round(Math.min(1, share) * 100)));
    if (used >= max) {
      ui.say($('q-state'), 'The space is full. Nobody can add a row in any of its tools until rows are deleted or IT gives more. Ask IT below.', 'warn');
    } else if (share >= 0.8) {
      ui.say($('q-state'), 'More than four fifths of the rows are used: ' + num(max - used) + ' are left. Ask IT for more now, before the tools stop taking new rows.', 'warn');
    } else {
      ui.say($('q-state'), (q.own ? 'IT gave this space limits of its own. ' : 'This space has the site\'s default limits. ') + num(max - used) + ' rows are left.', 'ok');
    }
    $('q-tools').closest('section').dataset.badge = used >= max ? '!' : '';

    var body = ui.clear($('q-tools'));
    var shown = 0;
    (q.tools || []).forEach(function (t) {
      if (!Number(t.tables)) { return; }
      shown += 1;
      ui.addRow(body, [t.name, num(t.rows), num(t.preview_rows), num(t.tables), num(t.most_columns)]);
    });
    $('q-tools-empty').hidden = shown > 0;
    body.closest('.hub-scroll').hidden = shown === 0;

    var r = q.request;
    $('q-open').hidden = !r;
    $('q-ask').hidden = !!r;
    if (r) {
      $('qr-reason').value = '';
      askTyped = false;
      $('q-open-text').textContent = r.asked_by.name + ' asked on ' + ui.when(r.asked_at) + ' for ' + limitsText(r) + '. Reason: ' + r.reason;
      var box = ui.clear($('q-open-act'));
      box.appendChild(ui.confirmButton('Take the request back', '', function () {
        act('dame_quota_request_cancel', { p_space: space }, 'The request is taken back.');
      }));
    } else {
      // The boxes start at what the space has. Numbers the admin typed stay until the limits change.
      var now = [q.max_rows, q.max_tables, q.max_columns].join('/');
      if (now !== askFor || !askTyped) {
        $('qr-rows').value = q.max_rows;
        $('qr-tables').value = q.max_tables;
        $('qr-columns').value = q.max_columns;
        askTyped = false;
      }
      askFor = now;
    }

    var list = ui.clear($('q-answers'));
    (q.answers || []).forEach(function (a) {
      var li = ui.el('li');
      li.appendChild(ui.el('strong', null, (a.status === 'granted' ? 'Granted' : 'Declined') + ' on ' + ui.when(a.answered_at) +
        (a.answered_by ? ' by ' + a.answered_by.name : '')));
      li.appendChild(ui.el('span', null, 'Asked: ' + limitsText(a) + '. ' + (a.answer ? 'IT wrote: ' + a.answer : 'No note from IT.')));
      list.appendChild(li);
    });
    $('q-answers-block').hidden = !(q.answers && q.answers.length);
  }

  function slug(text) {
    var id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
    // An id needs three characters: a short name like "DX" or "QA" gets a plain ending.
    return id && id.length < 3 ? id + '-tool' : id;
  }

  async function start() {
    await ui.guard();
    space = ui.param('space');
    $('main').hidden = false;
    if (!space) {
      ui.say($('msg'), 'This address names no space. Go back to the hub and press a tile.', 'warn');
      return;
    }
    $('back').href = api.href('space.html') + '?space=' + encodeURIComponent(space);
    // Opened from the IT admin page: the way back is the IT admin page.
    if (ui.cameFrom('admin/it.html')) {
      $('back').href = api.href('admin/it.html') + '#spaces';
      $('back').textContent = 'Back to IT admin';
    }
    newIcon = ui.iconPicker($('tl-icon'));
    $('tl-icons').appendChild(newIcon.node);
    spaceIcon = ui.iconPicker($('sp-icon'));
    $('sp-icons').appendChild(spaceIcon.node);
    act = ui.runner($('msg'), load);
    loadAudit = ui.audit($('audit'), $('audit-more'), function (limit, before) {
      return api.rpc('dame_audit_scope_list', { p_space: space, p_tool: null, p_limit: limit, p_before: before });
    });

    $('member-picker').appendChild(ui.picker('Find a person to add to this space', 'Add to space', function (person) {
      act('dame_space_member_add', { p_space: space, p_user: person.id }, person.name + ' is added to the space.');
    }));
    $('admin-picker').appendChild(ui.picker('Find a person to name as admin', 'Name as admin', function (person) {
      act('dame_space_admin_add', { p_space: space, p_user: person.id }, person.name + ' is now an admin.');
    }));

    ['qr-rows', 'qr-tables', 'qr-columns'].forEach(function (id) {
      $(id).addEventListener('input', function () { askTyped = true; });
    });
    $('form-quota').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var want = { rows: Number($('qr-rows').value), tables: Number($('qr-tables').value), columns: Number($('qr-columns').value) };
      if (![want.rows, want.tables, want.columns].every(function (n) { return Number.isInteger(n) && n > 0; })) {
        ui.say($('msg'), 'Write whole numbers in all three boxes. Leave a number as it is if you do not need more of it.', 'warn');
        return;
      }
      act('dame_quota_request', { p_space: space, p_rows: want.rows, p_tables: want.tables, p_columns: want.columns, p_reason: $('qr-reason').value },
        'The request is sent to IT. The answer shows here.');
    });

    $('form-space').addEventListener('submit', function (ev) {
      ev.preventDefault();
      document.activeElement.blur();
      var name = $('sp-name').value;
      var desc = $('sp-desc').value;
      if (!hadLook) { act('dame_space_update', { p_space: space, p_name: name, p_description: desc }, 'Saved.'); return; }
      // Name and text first, then the tile's icon and colour; the page reloads once, after both.
      api.rpc('dame_space_update', { p_space: space, p_name: name, p_description: desc }).then(function () {
        return act('dame_space_look_set', { p_space: space, p_icon: spaceIcon.get(), p_colour: $('sp-colour').value }, 'Saved. The tile on the hub has the new look.');
      }, function (err) { ui.sayError($('msg'), err); });
    });

    $('tl-id').addEventListener('input', function () { idTouched = true; });
    $('tl-name').addEventListener('input', function () {
      if (!idTouched) { $('tl-id').value = slug($('tl-name').value); }
    });
    $('tl-open').addEventListener('change', showLevel);
    $('tool-add').addEventListener('click', function () { showNewTool(true); });
    $('tl-cancel').addEventListener('click', function () { showNewTool(false); });
    $('tool-new').addEventListener('mousedown', function (ev) { if (ev.target === $('tool-new')) { showNewTool(false); } });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !$('tool-new').hidden) { showNewTool(false); } });
    $('form-tool').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var form = ev.currentTarget;
      var msg = $('tl-msg');
      var name = $('tl-name').value.trim();
      var id = $('tl-id').value.trim();
      $('tl-create').disabled = true;
      ui.say(msg, '');
      try {
        await api.rpc('dame_tool_create', { p_space: space, p_id: id, p_name: name, p_description: $('tl-desc').value,
          p_icon: newIcon.get(), p_colour: $('tl-colour').value, p_open_to_space: $('tl-open').checked, p_open_level: $('tl-level').value });
        form.reset();
        newIcon.set('');
        idTouched = false;
        showLevel();
        showNewTool(false);
        // A new tool goes straight to its own admin page, where it is built. Its window (name, look,
        // managers, switch off, delete) is for a tool that exists: it opens from the tile.
        // The one word left for that page is the tool's id, in this tab only, read once.
        try { sessionStorage.setItem('dame.made', space + '/' + id); } catch (e) { /* the page opens without its greeting */ }
        location.assign(api.href('admin/tool.html') + '?space=' + encodeURIComponent(space) + '&tool=' + encodeURIComponent(id));
        return;
      } catch (err) {
        ui.sayError(msg, err);
        msg.scrollIntoView({ block: 'nearest' });
      }
      $('tl-create').disabled = false;
    });

    await load();
    $('body').hidden = false;
  }

  start().catch(function (err) {
    $('main').hidden = false;
    ui.sayError($('msg'), err);
  });
})();
