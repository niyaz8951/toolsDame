/*
 * pages/admin-it.js - the IT admin page: approvals, people, spaces, settings, audit.
 * Serves: contract 1 (Identity), 2 (Structure), 3 (Access), 7 (Audit).
 * Must not change: everything from the database is written with textContent;
 * each button calls one dame_* function and then reloads the lists, so the
 * page always shows what the database holds, not what the page assumes.
 */
(function () {
  'use strict';

  var api = window.DameApi;
  var ui = window.DameShell;
  if (!ui) { return; }

  var me = null;
  var firstAdmin = null;
  var idTouched = false;
  var act = null;
  var loadAudit = null;

  function $(id) { return document.getElementById(id); }

  function status(user, value, done) {
    return function () { return act('dame_user_set_status', { p_user: user.id, p_status: value }, done); };
  }

  function role(user, value, done) {
    return function () { return act('dame_user_set_it', { p_user: user.id, p_is_it: value }, done); };
  }

  function buttons(list) {
    var box = ui.el('div', 'hub-actions');
    list.forEach(function (b) { box.appendChild(b); });
    return box;
  }

  function waitingRow(body, u) {
    var yes = ui.el('button', 'dame-btn dame-btn-primary hub-small', 'Approve');
    yes.type = 'button';
    yes.addEventListener('click', function () { yes.disabled = true; status(u, 'active', u.name + ' is approved.')(); });
    ui.addRow(body, [u.name, u.email, ui.when(u.created_at),
      buttons([yes, ui.confirmButton('Refuse', '', status(u, 'disabled', u.name + ' is refused. The account is switched off.'))])]);
  }

  function personRow(body, u) {
    var state = ui.el('span');
    state.appendChild(ui.el('span', 'hub-pill' + (u.status === 'active' ? ' hub-pill-ok' : ''),
      u.status === 'active' ? 'Active' : 'Switched off'));
    if (u.is_it) { state.appendChild(ui.el('span', 'hub-pill', 'IT admin')); }
    var change;
    if (u.is_me) {
      change = ui.el('span', 'dame-muted', 'Another IT admin changes your account.');
    } else if (u.status === 'active') {
      change = buttons([
        ui.confirmButton('Switch off', '', status(u, 'disabled', u.name + ' is switched off.')),
        u.is_it ? ui.confirmButton('Remove IT admin', '', role(u, false, u.name + ' is no longer an IT admin.'))
          : ui.confirmButton('Make IT admin', '', role(u, true, u.name + ' is now an IT admin.'))]);
    } else {
      change = buttons([ui.confirmButton('Switch on', '', status(u, 'active', u.name + ' is switched on again.'))]);
    }
    ui.addRow(body, [u.name + (u.is_me ? ' (you)' : ''), u.email, state, change]);
  }

  function spaceBlock(s) {
    var box = ui.el('div', 'hub-block');
    box.setAttribute('data-space', s.id);
    var title = ui.el('h3', null, s.name + ' ');
    title.appendChild(ui.el('span', 'hub-pill', s.id));
    title.appendChild(ui.el('span', 'hub-pill' + (s.active ? ' hub-pill-ok' : ''), s.active ? 'On' : 'Switched off'));
    box.appendChild(title);
    box.appendChild(ui.el('p', 'dame-muted', (s.description ? s.description + ' ' : '') +
      s.tools + (s.tools === 1 ? ' tool, ' : ' tools, ') + s.members + (s.members === 1 ? ' member.' : ' members.')));

    box.appendChild(ui.el('p', 'hub-sub', 'Admins'));
    var list = ui.el('ul', 'hub-list');
    ui.people(list, s.admins, 'No admin.', 'Remove', function (person) {
      act('dame_space_admin_remove', { p_space: s.id, p_user: person.id }, person.name + ' is no longer an admin of ' + s.name + '.');
    });
    box.appendChild(list);
    box.appendChild(ui.picker('Find a person to name as admin of ' + s.name, 'Name as admin', function (person) {
      act('dame_space_admin_add', { p_space: s.id, p_user: person.id }, person.name + ' is now an admin of ' + s.name + '.');
    }));

    var row = ui.el('div', 'dame-row hub-delete');
    row.appendChild(s.active
      ? ui.confirmButton('Switch space off', '', function () { act('dame_space_set_active', { p_space: s.id, p_active: false }, s.name + ' is switched off. Only its admins can open it.'); })
      : ui.confirmButton('Switch space on', '', function () { act('dame_space_set_active', { p_space: s.id, p_active: true }, s.name + ' is switched on.'); }));
    if (s.admins.some(function (a) { return a.id === me.id; })) {
      var link = ui.el('a', 'dame-btn hub-small', 'Open its admin page');
      link.href = api.href('admin/space.html') + '?space=' + encodeURIComponent(s.id);
      row.appendChild(link);
    }
    box.appendChild(row);
    box.appendChild(ui.typedDelete(s.id, 'Delete space and its tools', function (typed) {
      act('dame_space_delete', { p_space: s.id, p_confirm: typed }, s.name + ' is deleted. Its id ' + s.id + ' will never be used again.');
    }));
    return box;
  }

  function showFirstAdmin() {
    $('sp-admin').textContent = firstAdmin ? 'First admin: ' + firstAdmin.name + ' (' + firstAdmin.email + ')'
      : 'Nobody chosen yet. Find the person, or choose yourself.';
  }

  async function load() {
    var users = await api.rpc('dame_users_list', { p_status: null }) || [];
    var waiting = ui.clear($('waiting'));
    var people = ui.clear($('people'));
    var nWaiting = 0;
    var nPeople = 0;
    users.forEach(function (u) {
      if (u.status === 'pending') { waitingRow(waiting, u); nWaiting += 1; } else { personRow(people, u); nPeople += 1; }
    });
    $('waiting-empty').hidden = nWaiting > 0;
    $('people-empty').hidden = nPeople > 0;

    var spaces = await api.rpc('dame_spaces_all') || [];
    var box = ui.clear($('spaces'));
    spaces.forEach(function (s) { box.appendChild(spaceBlock(s)); });
    $('spaces-empty').hidden = spaces.length > 0;

    await loadAudit();
  }

  function slug(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
  }

  async function start() {
    me = await ui.guard();
    $('main').hidden = false;
    if (!me.is_it) {
      ui.say($('msg'), 'Only an IT admin can use this page. Go back to the hub.', 'warn');
      return;
    }
    act = ui.runner($('msg'), load);
    loadAudit = ui.audit($('audit'), $('audit-more'), function (limit, before) {
      return api.rpc('dame_audit_list', { p_limit: limit, p_before: before });
    });

    $('ai-mode').value = me.ai_mode;
    $('ai-save').addEventListener('click', function () {
      act('dame_setting_set', { p_key: 'ai_mode', p_value: $('ai-mode').value }, 'Setting saved.');
    });

    $('sp-picker').appendChild(ui.picker('Find the first admin', 'Choose', function (person) {
      firstAdmin = person;
      showFirstAdmin();
    }));
    $('sp-me').addEventListener('click', function () {
      firstAdmin = { id: me.id, name: me.name, email: me.email };
      showFirstAdmin();
    });
    $('sp-id').addEventListener('input', function () { idTouched = true; });
    $('sp-name').addEventListener('input', function () {
      if (!idTouched) { $('sp-id').value = slug($('sp-name').value); }
    });
    $('form-space').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var form = ev.currentTarget;
      if (!firstAdmin) {
        ui.say($('msg'), 'Choose the first admin of the new space.', 'warn');
        $('msg').scrollIntoView({ block: 'nearest' });
        return;
      }
      var name = $('sp-name').value.trim();
      var before = $('spaces').children.length;
      await act('dame_space_create', { p_id: $('sp-id').value.trim(), p_name: name, p_description: $('sp-desc').value, p_admin: firstAdmin.id },
        'Space ' + name + ' is created. Its admin can now add tools and people.');
      if ($('spaces').children.length > before) {
        form.reset();
        firstAdmin = null;
        idTouched = false;
        showFirstAdmin();
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
