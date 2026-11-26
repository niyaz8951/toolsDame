/*
 * pages/hub.js - fills the hub with the caller's spaces.
 * Serves: contract 2 (Structure). Must not change: everything from the
 * database is written with textContent; a space's address is built from its
 * id, never stored; the list is what the database returns for this user.
 */
(function () {
  'use strict';

  var api = window.DameApi;
  var ui = window.DameShell;
  if (!ui) { return; }

  function $(id) { return document.getElementById(id); }

  function tile(space) {
    var a = ui.el('a', 'hub-tile');
    a.href = api.href('space.html') + '?space=' + encodeURIComponent(space.id);
    if (/^#[0-9a-f]{6}$/.test(space.colour || '')) { a.style.setProperty('--dame-accent', space.colour); }
    a.appendChild(ui.el('span', 'hub-tile-icon', space.icon || (space.name.trim().charAt(0) || 'S').toUpperCase()));
    a.appendChild(ui.el('span', 'hub-tile-name', space.name));
    if (space.description) { a.appendChild(ui.el('span', 'hub-tile-text', space.description)); }
    if (space.is_admin) { a.appendChild(ui.el('span', 'hub-pill', 'You are admin')); }
    if (!space.active) { a.appendChild(ui.el('span', 'hub-pill', 'Switched off')); }
    return a;
  }

  async function start() {
    // Asked at the same moment as the sign-in check, so the page waits once, not twice.
    var asked = api.rpc('dame_spaces_list');
    asked.catch(function () {});
    var me = await ui.guard();
    $('hello').textContent = 'Hello, ' + me.name;
    $('it-card').hidden = !me.is_it;
    $('main').hidden = false;

    var spaces = await asked;
    var box = ui.clear($('spaces'));
    (spaces || []).forEach(function (s) { box.appendChild(tile(s)); });
    $('empty').hidden = (spaces || []).length > 0;
  }

  start().catch(function (err) {
    $('main').hidden = false;
    ui.sayError($('msg'), err);
  });
})();
