/*
 * pages/admin-tool.js - the tool admin page. Phase 2: access and audit.
 * Serves: contract 3 (Access), 7 (Audit); Files (6) and Data (5) come later.
 * Must not change: everything from the database is written with textContent;
 * each change calls one dame_* function and then reloads, so the page shows
 * what the database holds.
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
  var LEVELS = [['read', 'Read'], ['contribute', 'Contribute'], ['edit', 'Edit'], ['approve', 'Approve']];

  function $(id) { return document.getElementById(id); }

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

    ui.people($('access'), t.access, 'Nobody is named yet.', 'Take away', function (person) {
      act('dame_tool_access_set', { p_space: space, p_tool: tool, p_user: person.id, p_level: null },
        person.name + ' no longer has access by name.');
    }, levelSelect);
    ui.people($('managers'), t.managers, 'No manager. The space admins look after this tool.', '', null);
    await loadAudit();
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
    await load();
    $('body').hidden = false;
  }

  start().catch(function (err) {
    $('main').hidden = false;
    ui.sayError($('msg'), err);
  });
})();
