/*
 * pages/admin-space.js - the space admin page: tools, people, admins, audit.
 * Serves: contract 2 (Structure), 3 (Access), 7 (Audit).
 * Must not change: everything from the database is written with textContent;
 * each button calls one dame_* function and then reloads, so the page shows
 * what the database holds; deleting a tool needs its id typed in full.
 */
(function () {
  'use strict';

  var api = window.DameApi;
  var ui = window.DameShell;
  if (!ui) { return; }

  var space = '';
  var act = null;
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

  function toolBlock(t) {
    var box = ui.el('div', 'hub-block');
    box.setAttribute('data-tool', t.id);
    var title = ui.el('h3', null, (t.icon ? t.icon + ' ' : '') + t.name + ' ');
    title.appendChild(ui.el('span', 'hub-pill', t.id));
    title.appendChild(ui.el('span', 'hub-pill' + (t.active ? ' hub-pill-ok' : ''), t.active ? 'On' : 'Switched off'));
    box.appendChild(title);
    var open = t.open_to_space ? 'Open to everyone in the space (' + t.open_level + ').' : 'Only people named on its access list.';
    box.appendChild(ui.el('p', 'dame-muted', (t.description ? t.description + ' ' : '') + open + ' ' +
      t.people + (t.people === 1 ? ' person' : ' people') + ' named.'));

    var row = ui.el('div', 'dame-row');
    var access = ui.el('a', 'dame-btn dame-btn-primary hub-small', 'Access and files');
    access.href = api.href('admin/tool.html') + '?space=' + encodeURIComponent(space) + '&tool=' + encodeURIComponent(t.id);
    row.appendChild(access);
    var edit = ui.el('button', 'dame-btn hub-small', 'Change');
    edit.type = 'button';
    row.appendChild(edit);
    row.appendChild(t.active
      ? ui.confirmButton('Switch off', '', function () { act('dame_tool_set_active', { p_space: space, p_tool: t.id, p_active: false }, t.name + ' is switched off. Only you and its managers can open it.'); })
      : ui.confirmButton('Switch on', '', function () { act('dame_tool_set_active', { p_space: space, p_tool: t.id, p_active: true }, t.name + ' is switched on.'); }));
    box.appendChild(row);

    // The change form, shown on demand.
    var form = ui.el('form', 'hub-edit');
    form.method = 'post';
    form.noValidate = true;
    form.hidden = true;
    var name = input('text', t.name, 80);
    var icon = input('text', t.icon, 8);
    var colour = input('color', /^#[0-9a-f]{6}$/.test(t.colour) ? t.colour : '#0b63ce');
    var desc = input('text', t.description, 400);
    var two = ui.el('div', 'hub-two');
    two.appendChild(field('Name', name));
    two.appendChild(field('Icon', icon));
    two.appendChild(field('Colour', colour));
    form.appendChild(two);
    form.appendChild(field('What it is for', desc));
    var check = ui.el('label', 'hub-check');
    var openBox = ui.el('input');
    openBox.type = 'checkbox';
    openBox.checked = t.open_to_space;
    check.appendChild(openBox);
    check.appendChild(document.createTextNode(' Open to everyone in this space'));
    form.appendChild(check);
    var level = levelSelect(t.open_level);
    form.appendChild(field('Level for everyone in the space', level));
    var save = ui.el('button', 'dame-btn', 'Save changes');
    save.type = 'submit';
    form.appendChild(save);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      act('dame_tool_update', { p_space: space, p_tool: t.id, p_name: name.value, p_description: desc.value,
        p_icon: icon.value, p_colour: colour.value, p_open_to_space: openBox.checked, p_open_level: level.value },
        t.id + ' is changed.');
    });
    edit.addEventListener('click', function () { form.hidden = !form.hidden; });
    box.appendChild(form);

    box.appendChild(ui.el('p', 'hub-sub', 'Managers'));
    var list = ui.el('ul', 'hub-list');
    ui.people(list, t.managers, 'No manager yet. You look after it yourself.', 'Remove', function (person) {
      act('dame_tool_manager_remove', { p_space: space, p_tool: t.id, p_user: person.id }, person.name + ' no longer manages ' + t.name + '.');
    });
    box.appendChild(list);
    box.appendChild(ui.picker('Find a person to manage ' + t.name, 'Name as manager', function (person) {
      act('dame_tool_manager_add', { p_space: space, p_tool: t.id, p_user: person.id }, person.name + ' now manages ' + t.name + '.');
    }));
    box.appendChild(ui.typedDelete(t.id, 'Delete tool', function (typed) {
      act('dame_tool_delete', { p_space: space, p_tool: t.id, p_confirm: typed }, t.name + ' is deleted. Its id ' + t.id + ' will never be used again.');
    }));
    return box;
  }

  async function load() {
    var s = await api.rpc('dame_space_admin_get', { p_space: space });
    document.title = s.name + ' admin - DAME';
    $('title').textContent = s.name + ': admin';
    if (document.activeElement !== $('sp-name')) { $('sp-name').value = s.name; }
    if (document.activeElement !== $('sp-desc')) { $('sp-desc').value = s.description; }

    var box = ui.clear($('tools'));
    s.tools.forEach(function (t) { box.appendChild(toolBlock(t)); });
    $('tools-empty').hidden = s.tools.length > 0;

    ui.people($('members'), s.members, 'Nobody yet. Find a person below.', 'Remove', function (person) {
      act('dame_space_member_remove', { p_space: space, p_user: person.id }, person.name + ' is removed from the space.');
    });
    ui.people($('admins'), s.admins, 'No admin.', 'Remove', function (person) {
      act('dame_space_admin_remove', { p_space: space, p_user: person.id }, person.name + ' is no longer an admin.');
    });
    await loadAudit();
  }

  function slug(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
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

    $('form-space').addEventListener('submit', function (ev) {
      ev.preventDefault();
      document.activeElement.blur();
      act('dame_space_update', { p_space: space, p_name: $('sp-name').value, p_description: $('sp-desc').value }, 'Saved.');
    });

    $('tl-id').addEventListener('input', function () { idTouched = true; });
    $('tl-name').addEventListener('input', function () {
      if (!idTouched) { $('tl-id').value = slug($('tl-name').value); }
    });
    $('form-tool').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var form = ev.currentTarget;
      var name = $('tl-name').value.trim();
      var before = $('tools').children.length;
      await act('dame_tool_create', { p_space: space, p_id: $('tl-id').value.trim(), p_name: name, p_description: $('tl-desc').value,
        p_icon: $('tl-icon').value, p_colour: $('tl-colour').value, p_open_to_space: $('tl-open').checked, p_open_level: $('tl-level').value },
        'Tool ' + name + ' is created. Next: Access and files.');
      if ($('tools').children.length > before) {
        form.reset();
        idTouched = false;
      }
    });

    await load();
    $('body').hidden = false;
  }

  start().catch(function (err) {
    $('main').hidden = false;
    ui.sayError($('msg'), err);
  });
})();
