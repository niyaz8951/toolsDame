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
  var byEmailOff = false;
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

  // An account made by IT signs in with a username; its inner address is not shown.
  function shown(email) {
    var d = api.userDomain;
    return email.slice(-d.length) === d ? 'username: ' + email.slice(0, -d.length) : email;
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
    ui.addRow(body, [u.name + (u.is_me ? ' (you)' : ''), shown(u.email), state, change]);
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

  // A temporary password a person can read out: 14 characters without look-alikes (no 0 O 1 l I).
  function generate() {
    var sets = ['abcdefghijkmnpqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789'];
    var all = sets.join('');
    var bytes = new Uint32Array(14);
    crypto.getRandomValues(bytes);
    var out = Array.prototype.map.call(bytes, function (b, i) { var set = i < 3 ? sets[i] : all; return set[b % set.length]; });
    for (var i = out.length - 1; i > 0; i -= 1) { var j = bytes[i] % (i + 1); var t = out[i]; out[i] = out[j]; out[j] = t; }
    return out.join('').replace(/(.{5})(.{5})(.{4})/, '$1-$2-$3');
  }

  // The "New user" window: username, display name, temporary password.
  function newUser() {
    var back = ui.el('div', 'hub-focus-back');
    var box = ui.el('form', 'hub-focus hub-focus-small');
    box.method = 'post';
    box.noValidate = true;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'New user');
    box.appendChild(ui.el('h2', null, 'New user'));
    box.appendChild(ui.el('p', 'dame-muted', 'The person signs in with this username and the temporary password, and must choose a new password at the first sign-in. No email is needed.'));
    function field(label, id, hint) {
      var l = ui.el('label', 'hub-field', label);
      var i = ui.el('input', 'dame-input');
      i.type = 'text';
      i.id = id;
      i.autocomplete = 'off';
      i.spellcheck = false;
      l.appendChild(i);
      box.appendChild(l);
      if (hint) { box.appendChild(ui.el('p', 'dame-hint', hint)); }
      return i;
    }
    var user = field('Username', 'nu-username', '3 to 30 characters: small letters, digits, dot, dash, underscore.');
    user.maxLength = 30;
    var name = field('Display name', 'nu-name', '');
    name.maxLength = 80;
    var pass = field('Temporary password', 'nu-password', 'At least 10 characters with a small letter, a capital letter and a digit. Tell it to the person by voice, not in writing.');
    pass.maxLength = 72;
    var gen = ui.el('button', 'dame-btn hub-small', 'Generate');
    gen.type = 'button';
    gen.addEventListener('click', function () { pass.value = generate(); pass.focus(); pass.select(); });
    box.appendChild(gen);
    var msg = ui.el('p', 'hub-msg');
    msg.hidden = true;
    msg.setAttribute('role', 'alert');
    box.appendChild(msg);
    var foot = ui.el('div', 'dame-row hub-focus-foot');
    var create = ui.el('button', 'dame-btn dame-btn-primary', 'Create');
    create.type = 'submit';
    create.id = 'nu-create';
    var cancel = ui.el('button', 'dame-btn', 'Cancel');
    cancel.type = 'button';
    function close() { back.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(ev) { if (ev.key === 'Escape') { close(); } }
    cancel.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    foot.appendChild(create);
    foot.appendChild(cancel);
    box.appendChild(foot);
    box.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      create.disabled = true;
      ui.say(msg, '');
      try {
        var made = await api.rpc('dame_user_create', { p_username: user.value, p_name: name.value, p_temp_password: pass.value });
        close();
        await load();
        ui.say($('msg'), 'The account ' + made.username + ' (' + made.name + ') is made. Tell the person the username and the temporary password by voice. At the first sign-in the site asks for a new password.', 'ok');
        $('msg').scrollIntoView({ block: 'nearest' });
      } catch (err) {
        if (err && err.code === 'server') { ui.say(msg, 'This part is not switched on yet: the owner pastes db/core/009_new_user.sql into the database first.', 'warn'); }
        else { ui.sayError(msg, err); }
        create.disabled = false;
      }
    });
    back.appendChild(box);
    document.body.appendChild(back);
    user.focus();
  }

  function showFirstAdmin() {
    $('sp-admin').textContent = firstAdmin ? 'First admin: ' + firstAdmin.name + ' (' + firstAdmin.email + ')'
      : 'Nobody chosen yet. Find the person, or choose yourself.';
  }

  async function load() {
    // All four questions go out together; the page waits for the slowest, not for the sum.
    // "Add a person" needs db/core/007: until it is run, that card says so and the rest of the page works.
    var asked = [api.rpc('dame_users_list', { p_status: null }), api.rpc('dame_spaces_all'), api.rpc('dame_settings_get'),
      api.rpc('dame_users_added').catch(function () { return null; })];
    var audit = loadAudit();
    audit.catch(function () {});
    var got = await Promise.all(asked);
    var users = got[0] || [];
    var waiting = ui.clear($('waiting'));
    var people = ui.clear($('people'));
    var nWaiting = 0;
    var nPeople = 0;
    users.forEach(function (u) {
      if (u.status === 'pending') { waitingRow(waiting, u); nWaiting += 1; } else { personRow(people, u); nPeople += 1; }
    });
    $('waiting-empty').hidden = nWaiting > 0;
    // The count on the Approvals tab.
    $('waiting').closest('section').dataset.badge = String(nWaiting);
    $('people-empty').hidden = nPeople > 0;

    var spaces = got[1] || [];
    var box = ui.clear($('spaces'));
    spaces.forEach(function (s) { box.appendChild(spaceBlock(s)); });
    $('spaces-empty').hidden = spaces.length > 0;
    var hasTest = spaces.some(function (x) { return x.id === 'test-space'; });
    $('test-make').hidden = hasTest;
    $('test-open').hidden = !hasTest;
    $('test-open').href = api.href('admin/space.html') + '?space=test-space';

    var settings = got[2] || {};
    if (document.activeElement !== $('domains')) { $('domains').value = String(settings.signup_domains || '').split(',').join(', '); }
    $('domains-warn').hidden = !!settings.signup_domains;

    var added = ui.clear($('added'));
    byEmailOff = got[3] === null;
    if (byEmailOff) { $('form-add').hidden = true; }
    $('added-title').hidden = !(got[3] && got[3].length);
    if (got[3] === null) {
      added.appendChild(ui.el('li', null, 'This part is not switched on yet: the owner pastes db/core/007_add_people.sql into the database first.'));
    }
    (got[3] || []).forEach(function (p) {
      var li = ui.el('li', 'hub-person');
      var text = ui.el('div', 'hub-grow');
      text.appendChild(ui.el('strong', null, p.name));
      text.appendChild(ui.el('span', null, p.email + ', added ' + ui.when(p.at) + ' by ' + p.by));
      li.appendChild(text);
      li.appendChild(ui.confirmButton('Take back', '', function () {
        act('dame_user_add_remove', { p_email: p.email }, p.email + ' is taken back. If he signs up now, he waits for approval like anyone.');
      }));
      added.appendChild(li);
    });

    await audit;
  }

  function slug(text) {
    var id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
    // An id needs three characters: a short name like "DX" or "QA" gets a plain ending.
    return id && id.length < 3 ? id + '-team' : id;
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
    $('domains-save').addEventListener('click', function () {
      act('dame_setting_set', { p_key: 'signup_domains', p_value: $('domains').value }, 'Saved. ' +
        ($('domains').value.trim() ? 'Only these email domains may ask for access now.' : 'Any email address may ask for access.'));
    });
    $('by-email').addEventListener('click', function () {
      $('by-email-text').hidden = !$('by-email-text').hidden;
      $('form-add').hidden = byEmailOff || $('by-email-text').hidden;
    });
    $('new-user').addEventListener('click', newUser);
    $('form-add').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var email = $('add-email').value.trim();
      var before = $('added').children.length;
      await act('dame_user_add', { p_email: email, p_name: $('add-name').value }, email + ' is added. Tell this person to open the site, press "No account? Request access" and sign up with exactly this email.');
      if ($('added').children.length > before) { ev.target.reset(); }
    });
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

    // The test space: the same three calls a person makes by hand, in one press.
    $('test-make').addEventListener('click', async function () {
      $('test-make').disabled = true;
      ui.say($('msg'), '');
      try {
        await api.rpc('dame_space_create', { p_id: 'test-space', p_name: 'Test space', p_description: 'Two example tools to try the site.', p_admin: me.id });
        await api.rpc('dame_tool_create', { p_space: 'test-space', p_id: 'converter', p_name: 'Converter', p_description: 'Stand-alone example: it calculates and saves nothing.',
          p_icon: 'C', p_colour: '#0a7d6c', p_open_to_space: true, p_open_level: 'read' });
        await api.rpc('dame_tool_create', { p_space: 'test-space', p_id: 'tracker', p_name: 'Tracker', p_description: 'Example that saves rows in a table.',
          p_icon: 'T', p_colour: '#b45309', p_open_to_space: true, p_open_level: 'contribute' });
        await load();
        ui.say($('msg'), 'The test space is made, with two empty tools. Open its admin page and press "Build and access" on each tool.', 'ok');
      } catch (err) {
        await load().catch(function () {});
        ui.say($('msg'), (err && err.code === 'bad_request')
          ? 'The test space exists already, or was deleted before (an id is never used twice). Open it below, or make a space by hand under "New space".'
          : ((err && err.message) || 'That did not work. Try again.'), 'warn');
      }
      $('test-make').disabled = false;
      $('msg').scrollIntoView({ block: 'nearest' });
    });

    await load();
    $('body').hidden = false;
  }

  start().catch(function (err) {
    $('main').hidden = false;
    ui.sayError($('msg'), err);
  });
})();
