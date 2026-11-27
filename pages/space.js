/*
 * pages/space.js - one space: the tools the caller may open, as tiles.
 * Serves: contract 2 (Structure) and 3 (Access).
 * Must not change: everything from the database is written with textContent;
 * a tool's address is built from the two ids, never stored; a colour is used
 * only when it has the exact form #rrggbb.
 */
(function () {
  'use strict';

  var api = window.DameApi;
  var ui = window.DameShell;
  if (!ui) { return; }

  var LEVEL = { read: 'You can read', contribute: 'You can add', edit: 'You can edit', approve: 'You can approve' };

  function $(id) { return document.getElementById(id); }

  function tile(space, t) {
    var a = ui.el('a', 'hub-tile' + (t.active ? '' : ' hub-tile-off'));
    a.href = api.href('tool.html') + '?space=' + encodeURIComponent(space) + '&tool=' + encodeURIComponent(t.id);
    if (/^#[0-9a-f]{6}$/.test(t.colour)) { a.style.setProperty('--dame-accent', t.colour); }
    a.appendChild(ui.icon(ui.el('span', 'hub-tile-icon'), t.icon, (t.name.trim().charAt(0) || 'T').toUpperCase()));
    a.appendChild(ui.el('span', 'hub-tile-name', t.name));
    a.appendChild(ui.el('span', 'hub-tile-text', t.description));
    var pills = ui.el('span');
    pills.appendChild(ui.el('span', 'hub-pill', t.is_manager ? 'You manage it' : (LEVEL[t.level] || '')));
    if (!t.active) { pills.appendChild(ui.el('span', 'hub-pill', 'Switched off')); }
    a.appendChild(pills);
    return a;
  }

  async function start() {
    var id = ui.param('space');
    // Asked at the same moment as the sign-in check, so the page waits once, not twice.
    var asked = id ? api.rpc('dame_space_get', { p_space: id }) : null;
    if (asked) { asked.catch(function () {}); }
    await ui.guard();
    $('main').hidden = false;
    if (!id) {
      ui.say($('msg'), 'This address names no space. Go back to the hub and press a tile.', 'warn');
      return;
    }
    var space = await asked;
    document.title = space.name + ' - DAME';
    $('title').textContent = space.name;
    $('text').textContent = space.description;
    if (!space.active) { ui.say($('msg'), 'This space is switched off by IT. Only its admins can open it.', 'warn'); }

    var box = ui.clear($('tools'));
    space.tools.forEach(function (t) { box.appendChild(tile(space.id, t)); });
    $('empty').hidden = space.tools.length > 0;
    $('admin-link').href = api.href('admin/space.html') + '?space=' + encodeURIComponent(space.id);
    $('admin-card').hidden = !space.is_admin;
  }

  start().catch(function (err) {
    $('main').hidden = false;
    ui.sayError($('msg'), err);
  });
})();
