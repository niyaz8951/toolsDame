/*
 * pages/admin-it.js - the IT admin page: approvals, people, settings, audit.
 * Serves: contract 1 (Identity), 3 (Access), 7 (Audit).
 * Must not change: everything from the database is written with textContent;
 * each button calls one dame_* function and then reloads the lists, so the
 * page always shows what the database holds, not what the page assumes.
 */
(function () {
  'use strict';

  var api = window.DameApi;
  var ui = window.DameShell;
  if (!ui) { return; }

  var PAGE = 50;
  var oldest = null;

  function $(id) { return document.getElementById(id); }

  function cell(row, text, cls) {
    var td = ui.el('td', cls, text);
    row.appendChild(td);
    return td;
  }

  // Adds a row and names each cell after its column, for the narrow-screen layout.
  function addRow(body, tr) {
    var heads = body.parentNode.querySelectorAll('thead th');
    Array.prototype.forEach.call(tr.children, function (td, i) {
      if (heads[i]) { td.setAttribute('data-label', heads[i].textContent); }
    });
    body.appendChild(tr);
  }

  // Runs one action, then shows the fresh lists. A refusal is shown as it is.
  async function act(name, args, done) {
    ui.say($('msg'), '');
    try {
      await api.rpc(name, args);
      await load();
      ui.say($('msg'), done, 'ok');
    } catch (err) {
      await load().catch(function () {});
      ui.sayError($('msg'), err);
    }
    $('msg').scrollIntoView({ block: 'nearest' });
  }

  function status(user, value, done) {
    return function () { return act('dame_user_set_status', { p_user: user.id, p_status: value }, done); };
  }

  function role(user, value, done) {
    return function () { return act('dame_user_set_it', { p_user: user.id, p_is_it: value }, done); };
  }

  function waitingRow(u) {
    var tr = ui.el('tr');
    cell(tr, u.name);
    cell(tr, u.email);
    cell(tr, ui.when(u.created_at));
    var td = cell(tr, null, 'hub-actions');
    var yes = ui.el('button', 'dame-btn dame-btn-primary hub-small', 'Approve');
    yes.type = 'button';
    yes.addEventListener('click', function () { yes.disabled = true; status(u, 'active', u.name + ' is approved.')(); });
    td.appendChild(yes);
    td.appendChild(ui.confirmButton('Refuse', '', status(u, 'disabled', u.name + ' is refused. The account is switched off.')));
    return tr;
  }

  function personRow(u) {
    var tr = ui.el('tr');
    cell(tr, u.name + (u.is_me ? ' (you)' : ''));
    cell(tr, u.email);
    var state = cell(tr, null);
    state.appendChild(ui.el('span', 'hub-pill' + (u.status === 'active' ? ' hub-pill-ok' : ''),
      u.status === 'active' ? 'Active' : 'Switched off'));
    if (u.is_it) { state.appendChild(ui.el('span', 'hub-pill', 'IT admin')); }
    var td = cell(tr, null, 'hub-actions');
    if (u.is_me) {
      td.textContent = 'Another IT admin changes your account.';
      td.className = 'dame-muted';
    } else if (u.status === 'active') {
      td.appendChild(ui.confirmButton('Switch off', '', status(u, 'disabled', u.name + ' is switched off.')));
      td.appendChild(u.is_it
        ? ui.confirmButton('Remove IT admin', '', role(u, false, u.name + ' is no longer an IT admin.'))
        : ui.confirmButton('Make IT admin', '', role(u, true, u.name + ' is now an IT admin.')));
    } else {
      td.appendChild(ui.confirmButton('Switch on', '', status(u, 'active', u.name + ' is switched on again.')));
    }
    return tr;
  }

  var ACTIONS = {
    'user.requested': 'asked for access',
    'user.approved': 'approved',
    'user.refused': 'refused',
    'user.switched_off': 'switched off',
    'user.switched_on': 'switched on',
    'user.it_admin_on': 'made IT admin',
    'user.it_admin_off': 'removed IT admin',
    'user.first_admin': 'made the first IT admin',
    'user.email_changed': 'changed email',
    'setting.changed': 'changed a setting'
  };

  function auditRow(a) {
    var tr = ui.el('tr');
    cell(tr, ui.when(a.at));
    cell(tr, a.actor);
    cell(tr, ACTIONS[a.action] || a.action);
    var about = a.target || '';
    if (a.detail && a.detail.from !== undefined && a.detail.to !== undefined) {
      about += ': ' + a.detail.from + ' > ' + a.detail.to;
    }
    cell(tr, about);
    return tr;
  }

  async function loadAudit(more) {
    var rows = await api.rpc('dame_audit_list', { p_limit: PAGE, p_before: more ? oldest : null }) || [];
    var body = more ? $('audit') : ui.clear($('audit'));
    rows.forEach(function (a) { addRow(body, auditRow(a)); });
    if (rows.length) { oldest = rows[rows.length - 1].id; }
    $('audit-more').hidden = rows.length < PAGE;
  }

  async function load() {
    var users = await api.rpc('dame_users_list', { p_status: null }) || [];
    var waiting = ui.clear($('waiting'));
    var people = ui.clear($('people'));
    var nWaiting = 0;
    var nPeople = 0;
    users.forEach(function (u) {
      if (u.status === 'pending') { addRow(waiting, waitingRow(u)); nWaiting += 1; }
      else { addRow(people, personRow(u)); nPeople += 1; }
    });
    $('waiting-empty').hidden = nWaiting > 0;
    $('people-empty').hidden = nPeople > 0;
    await loadAudit(false);
  }

  async function start() {
    var me = await ui.guard();
    $('main').hidden = false;
    if (!me.is_it) {
      ui.say($('msg'), 'Only an IT admin can use this page. Go back to the hub.', 'warn');
      return;
    }
    $('ai-mode').value = me.ai_mode;
    $('ai-save').addEventListener('click', function () {
      act('dame_setting_set', { p_key: 'ai_mode', p_value: $('ai-mode').value }, 'Setting saved.');
    });
    $('audit-more').addEventListener('click', function () {
      loadAudit(true).catch(function (err) { ui.sayError($('msg'), err); });
    });
    await load();
    $('body').hidden = false;
  }

  start().catch(function (err) {
    $('main').hidden = false;
    ui.sayError($('msg'), err);
  });
})();
