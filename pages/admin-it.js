/*
 * pages/admin-it.js - the IT admin page: approvals, people, spaces, settings, database quotas, audit.
 * Serves: contract 1 (Identity), 2 (Structure), 3 (Access), 7 (Audit).
 * Must not change: everything from the database is written with textContent;
 * each button calls one dame_* function and then reloads the lists, so the
 * page always shows what the database holds, not what the page assumes.
 * Spaces: the page shows "Add a space" and one tile per space; a space is
 * changed or deleted only inside the window its tile opens. Quotas: the same,
 * one tile per space and a window for its limits and its request. People: one line
 * per person; an account is changed only inside the window "Open" shows. A
 * temporary password lives in that window's memory until it closes, nowhere else.
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
  var spaces = [];
  var win = null;   // the open space window, or null
  var pwin = null;  // the open person window, or null
  var users = [];

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

  // A person is one line: name, sign-in, state, and "Open". Everything that changes an account
  // is in the window that "Open" shows, and nowhere else on the page.
  function pills(box, u) {
    box.appendChild(ui.el('span', 'hub-pill' + (u.status === 'active' ? ' hub-pill-ok' : ''),
      u.status === 'active' ? 'Active' : u.status === 'pending' ? 'Waiting' : 'Switched off'));
    if (u.is_it) { box.appendChild(ui.el('span', 'hub-pill', 'IT admin')); }
    if (u.temp_expired) { box.appendChild(ui.el('span', 'hub-pill', 'Temporary password too old')); }
    else if (u.must_change) { box.appendChild(ui.el('span', 'hub-pill', 'Must choose a password')); }
    return box;
  }

  function personRow(body, u) {
    var open = ui.el('button', 'dame-btn hub-small', 'Open');
    open.type = 'button';
    open.setAttribute('data-user', u.id);
    open.addEventListener('click', function () { openPerson(u.id); });
    var who = ui.el('span', null, u.name + (u.is_me ? ' (you)' : ''));
    var job = [u.job_title, u.department].filter(Boolean).join(', ');
    if (job) { who.appendChild(ui.el('span', 'hub-row-sub', job)); }
    ui.addRow(body, [who, shown(u.email), pills(ui.el('span'), u), buttons([open])]);
  }

  // ---- the window of one person
  function closePerson() {
    if (!pwin) { return; }
    var id = pwin.id;
    pwin.back.remove();
    document.removeEventListener('keydown', pwin.onKey);
    pwin = null;
    var btn = document.querySelector('#people [data-user="' + id + '"]');
    if (btn) { btn.focus(); }
  }

  // One action inside the window: do it, read the lists and the person again, say what happened.
  async function inPerson(name, args, done) {
    var w = pwin;
    ui.say(w.msg, '');
    var failed = null;
    try { await api.rpc(name, args); } catch (err) { failed = err; }
    await load().catch(function () {});
    if (pwin !== w) { return !failed; }
    if (failed) { ui.sayError(w.msg, failed); } else { ui.say(w.msg, done, 'ok'); }
    // In the middle of the window: at its lower edge the Done bar would cover it.
    w.msg.scrollIntoView({ block: 'center' });
    return !failed;
  }

  function fact(list, label, value) {
    var li = ui.el('li');
    li.appendChild(ui.el('span', null, label));
    li.appendChild(ui.el('strong', null, value));
    list.appendChild(li);
  }

  function field(box, label, id, value, max) {
    var l = ui.el('label', 'hub-field', label);
    var i = ui.el('input', 'dame-input');
    i.type = 'text';
    i.id = id;
    i.maxLength = max;
    i.autocomplete = 'off';
    i.spellcheck = false;
    i.value = value || '';
    l.appendChild(i);
    box.appendChild(l);
    return i;
  }

  // u: the line from the people list. card: the full account (null until db/core/010 is run).
  function drawPerson(u, card) {
    var w = pwin;
    var body = ui.clear(w.body);
    var c = card || u;
    var title = ui.el('h2', null, c.name + (u.is_me ? ' (you) ' : ' '));
    pills(title, c);
    body.appendChild(title);
    body.appendChild(ui.el('p', 'dame-muted', 'Signs in with ' + (c.username ? 'the username ' + c.username : shown(u.email)) + '.'));

    if (card) {
      var facts = ui.el('ul', 'hub-list hub-facts');
      fact(facts, 'Account since', ui.when(card.created_at));
      fact(facts, 'Last sign-in', card.sign_ins && card.sign_ins.length ? ui.when(card.sign_ins[0]) : 'Never');
      fact(facts, 'Password last chosen', card.must_change ? 'Not yet: a temporary password is in place' + (card.temp_set_at ? ' since ' + ui.when(card.temp_set_at).toLowerCase() : '')
        : card.pw_changed_at ? ui.when(card.pw_changed_at) : 'When the account was made');
      fact(facts, 'Access', (card.spaces.length === 1 ? '1 space, ' : card.spaces.length + ' spaces, ') + (card.tools.length === 1 ? '1 tool' : card.tools.length + ' tools'));
      body.appendChild(facts);
      if (card.spaces.length) {
        body.appendChild(ui.el('p', 'dame-hint', 'Spaces: ' + card.spaces.map(function (s) { return s.name + (s.role === 'admin' ? ' (admin)' : ''); }).join(', ') + '.'));
      }

      // -- details
      body.appendChild(ui.el('p', 'hub-sub', 'Details'));
      var form = ui.el('form');
      form.method = 'post';
      form.noValidate = true;
      var two = ui.el('div', 'hub-two');
      var name = field(two, 'Name', 'pu-name', card.name, 80);
      var staff = field(two, 'Staff number', 'pu-staff', card.staff_no, 30);
      var job = field(two, 'Job title', 'pu-title', card.job_title, 80);
      var dept = field(two, 'Department', 'pu-dept', card.department, 80);
      var office = field(two, 'Office or site', 'pu-office', card.office, 80);
      var phone = field(two, 'Work phone', 'pu-phone', card.phone, 30);
      form.appendChild(two);
      var save = ui.el('button', 'dame-btn dame-btn-primary hub-small', 'Save details');
      save.type = 'submit';
      save.id = 'pu-save';
      form.appendChild(save);
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        save.disabled = true;
        inPerson('dame_user_details_set', { p_user: u.id, p_name: name.value, p_job_title: job.value, p_department: dept.value,
          p_office: office.value, p_phone: phone.value, p_staff_no: staff.value }, 'The details are saved.').then(function () { save.disabled = false; });
      });
      body.appendChild(form);

      // -- password
      body.appendChild(ui.el('p', 'hub-sub', 'Reset password'));
      if (u.is_me) {
        body.appendChild(ui.el('p', 'dame-hint', 'Your own password: change it on "My account" (the round button, top right). Forgot it? Another IT admin resets it.'));
      } else if (c.status !== 'active') {
        body.appendChild(ui.el('p', 'dame-hint', 'This account is ' + (c.status === 'pending' ? 'waiting for approval' : 'switched off') + '. A password can be reset only for an active account.'));
      } else {
        body.appendChild(ui.el('p', 'dame-hint', 'For a forgotten password, or when someone else may know it. You give a temporary password; the person is signed out everywhere, signs in with it and must choose a new one. It counts for 7 days. Be sure who is asking: call the person back.'));
        var row = ui.el('div', 'hub-temp');
        var temp = ui.el('input', 'dame-input');
        temp.type = 'text';
        temp.id = 'pu-temp';
        temp.maxLength = 72;
        temp.autocomplete = 'off';
        temp.spellcheck = false;
        temp.placeholder = 'Temporary password';
        temp.setAttribute('aria-label', 'Temporary password');
        temp.value = w.temp || '';
        temp.addEventListener('input', function () { w.temp = temp.value; });
        var gen = ui.el('button', 'dame-btn hub-small', 'Generate');
        gen.type = 'button';
        gen.addEventListener('click', function () { temp.value = generate(); w.temp = temp.value; temp.focus(); temp.select(); });
        row.appendChild(temp);
        row.appendChild(gen);
        body.appendChild(row);
        var reset = ui.confirmButton('Reset password', '', function () {
          if (!temp.value) { ui.say(w.msg, 'Press Generate, or type a temporary password.', 'warn'); w.msg.scrollIntoView({ block: 'center' }); reset.disabled = false; return; }
          inPerson('dame_user_password_reset', { p_user: u.id, p_temp_password: temp.value },
            'The password of ' + c.name + ' is reset. Tell the person the temporary password above by voice, not in writing. It is not shown again after you close this window.');
        });
        reset.id = 'pu-reset';
        body.appendChild(reset);
      }
    } else {
      body.appendChild(ui.el('p', 'dame-hint', 'Details and password reset are not switched on yet: the owner pastes db/core/010_accounts.sql into the database first.'));
    }

    // -- the account itself
    body.appendChild(ui.el('p', 'hub-sub', 'Account'));
    if (u.is_me) {
      body.appendChild(ui.el('p', 'dame-hint', 'Another IT admin changes your account: nobody switches himself off or changes his own role.'));
    } else if (c.status === 'active') {
      body.appendChild(ui.el('p', 'dame-hint', 'Switch off a leaver: he loses everything at his next click. Nothing of his is deleted.'));
      body.appendChild(buttons([
        ui.confirmButton('Switch off', '', function () { inPerson('dame_user_set_status', { p_user: u.id, p_status: 'disabled' }, c.name + ' is switched off.'); }),
        c.is_it ? ui.confirmButton('Remove IT admin', '', function () { inPerson('dame_user_set_it', { p_user: u.id, p_is_it: false }, c.name + ' is no longer an IT admin.'); })
          : ui.confirmButton('Make IT admin', '', function () { inPerson('dame_user_set_it', { p_user: u.id, p_is_it: true }, c.name + ' is now an IT admin.'); })]));
    } else {
      body.appendChild(ui.el('p', 'dame-hint', 'This account is switched off. Switched on, the person has again what he had.'));
      body.appendChild(buttons([ui.confirmButton('Switch on', '', function () { inPerson('dame_user_set_status', { p_user: u.id, p_status: 'active' }, c.name + ' is switched on again.'); })]));
    }
  }

  // Reads the person again and draws the window from what the database holds now.
  async function showPerson() {
    var w = pwin;
    var u = users.filter(function (x) { return x.id === w.id; })[0];
    if (!u) { closePerson(); return; }
    var card = null;
    try {
      card = await api.rpc('dame_user_get', { p_user: w.id });
    } catch (err) {
      if (!(err && err.code === 'server')) { if (pwin === w) { ui.sayError(w.msg, err); } }
    }
    if (pwin === w) { drawPerson(u, card); }
  }

  function openPerson(id) {
    var u = users.filter(function (x) { return x.id === id; })[0];
    if (!u) { return; }
    var back = ui.el('div', 'hub-focus-back');
    var box = ui.el('section', 'hub-focus');
    box.id = 'person-win';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Account of ' + u.name);
    var body = ui.el('div');
    body.appendChild(ui.el('p', 'dame-muted', 'One moment.'));
    var msg = ui.el('p', 'hub-msg');
    msg.id = 'person-win-msg';
    msg.hidden = true;
    msg.setAttribute('role', 'alert');
    var foot = ui.el('div', 'dame-row hub-focus-foot');
    var close = ui.el('button', 'dame-btn dame-btn-primary', 'Done');
    close.type = 'button';
    close.id = 'person-win-close';
    close.addEventListener('click', closePerson);
    back.addEventListener('mousedown', function (ev) { if (ev.target === back) { closePerson(); } });
    foot.appendChild(close);
    box.appendChild(body);
    box.appendChild(msg);
    box.appendChild(foot);
    back.appendChild(box);
    pwin = { id: id, back: back, body: body, msg: msg, temp: '', onKey: function (ev) { if (ev.key === 'Escape') { closePerson(); } } };
    document.addEventListener('keydown', pwin.onKey);
    document.body.appendChild(back);
    close.focus();
    showPerson();
  }

  // A space is one tile: name, what it holds, and "Switched off" when it is. Pressing it opens its window.
  function spaceTile(s) {
    var t = ui.el('button', 'hub-tile' + (s.active ? '' : ' hub-tile-off'));
    t.type = 'button';
    t.setAttribute('data-space', s.id);
    t.appendChild(ui.el('span', 'hub-tile-icon', (s.name.trim().charAt(0) || 'S').toUpperCase()));
    t.appendChild(ui.el('span', 'hub-tile-name', s.name));
    t.appendChild(ui.el('span', 'hub-tile-text', s.tools + (s.tools === 1 ? ' tool, ' : ' tools, ') + s.members + (s.members === 1 ? ' member' : ' members')));
    if (!s.active) { t.appendChild(ui.el('span', 'hub-pill', 'Switched off')); }
    t.addEventListener('click', function () { openSpace(s.id); });
    return t;
  }

  // The window of one space. Everything that changes a space is here and nowhere else on the page.
  // After each action the lists are read again and the window is drawn again from the database.
  function closeSpace() {
    if (!win) { return; }
    var id = win.id;
    win.back.remove();
    document.removeEventListener('keydown', win.onKey);
    win = null;
    var tile = document.querySelector('#spaces [data-space="' + id + '"]');
    if (tile) { tile.focus(); }
  }

  async function inSpace(name, args, done) {
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

  // ---- database quotas (db/core/011): one tile per space; a space's limits are changed, and its
  // request answered, only inside the window its tile opens. The default has its own small window.
  var quotas = null;   // what dame_quota_list gave, or null until 011 is run
  var qwin = null;     // the open quota window, or null

  function num(n) { return Number(n || 0).toLocaleString('en'); }

  function quotaOf(id) {
    return quotas ? quotas.spaces.filter(function (x) { return x.space === id; })[0] : null;
  }

  // Three boxes as whole numbers above zero, or null when one is not.
  function whole(values) {
    var out = values.map(function (v) { return Number(String(v).trim()); });
    return out.every(function (n) { return Number.isInteger(n) && n > 0; }) ? out : null;
  }

  function numberField(box, label, id, value, min, max) {
    var l = ui.el('label', 'hub-field', label);
    var i = ui.el('input', 'dame-input');
    i.type = 'number';
    i.id = id;
    i.min = min;
    i.max = max;
    i.step = 1;
    i.inputMode = 'numeric';
    i.autocomplete = 'off';
    i.value = value;
    l.appendChild(i);
    box.appendChild(l);
    return i;
  }

  // The tools limit arrives with db/core/012: until it is run, the pages show and send three numbers.
  function hasTools() { return !!quotas && quotas.defaults.tools !== undefined && quotas.defaults.tools !== null; }

  function limits(o) {
    return num(o.rows) + ' rows in the space, ' + (o.tools !== undefined && o.tools !== null ? num(o.tools) + ' tools in the space, ' : '') +
      num(o.tables) + ' tables in a tool, ' + num(o.columns) + ' columns in a table';
  }

  // The arguments of a call, with the tools number only where the database knows it.
  function withTools(args, value) {
    if (hasTools()) { args.p_tools = value; }
    return args;
  }

  function isFull(q) { return Number(q.rows_used) >= Number(q.max_rows); }
  function isNear(q) { return !isFull(q) && Number(q.rows_used) >= 0.8 * Number(q.max_rows); }

  // A space's quota is one tile: its name, what it uses, and what needs IT's eye.
  function quotaTile(q) {
    var t = ui.el('button', 'hub-tile' + (q.active ? '' : ' hub-tile-off'));
    t.type = 'button';
    t.setAttribute('data-quota', q.space);
    t.appendChild(ui.el('span', 'hub-tile-icon', (q.name.trim().charAt(0) || 'S').toUpperCase()));
    t.appendChild(ui.el('span', 'hub-tile-name', q.name));
    t.appendChild(ui.el('span', 'hub-tile-text', num(q.rows_used) + ' of ' + num(q.max_rows) + ' rows used' +
      (hasTools() ? ', ' + num(q.tools_used) + ' of ' + num(q.max_tools) + ' tools' : '')));
    if (q.request) { t.appendChild(ui.el('span', 'hub-pill', 'Request waiting')); }
    if (isFull(q)) { t.appendChild(ui.el('span', 'hub-pill', 'Full')); }
    else if (isNear(q)) { t.appendChild(ui.el('span', 'hub-pill', 'Nearly full')); }
    if (q.own) { t.appendChild(ui.el('span', 'hub-pill hub-pill-ok', 'Own limits')); }
    t.addEventListener('click', function () { openQuota(q.space); });
    return t;
  }

  function closeQuota() {
    if (!qwin) { return; }
    var id = qwin.id;
    qwin.back.remove();
    document.removeEventListener('keydown', qwin.onKey);
    qwin = null;
    var tile = document.querySelector('#q-tiles [data-quota="' + id + '"]');
    if (tile) { tile.focus(); }
  }

  // One action inside the window: do it, read everything again, draw the window again, say what happened.
  async function inQuota(name, args, done) {
    var w = qwin;
    ui.say(w.msg, '');
    var failed = null;
    // What was typed is kept: after a refusal the window is drawn again and the boxes get it back.
    var typed = {};
    Array.prototype.forEach.call(w.body.querySelectorAll('input[id]'), function (i) { typed[i.id] = i.value; });
    try { await api.rpc(name, args); } catch (err) { failed = err; }
    await load().catch(function () {});
    if (qwin !== w) { return; }
    if (failed) {
      Object.keys(typed).forEach(function (id) { var i = document.getElementById(id); if (i) { i.value = typed[id]; } });
      ui.sayError(w.msg, failed);
    } else {
      ui.say(w.msg, done, 'ok');
    }
    w.msg.scrollIntoView({ block: 'center' });
  }

  function drawQuota(q) {
    var body = ui.clear(qwin.body);
    var title = ui.el('h2', null, q.name + ' ');
    title.appendChild(ui.el('span', 'hub-pill', q.space));
    title.appendChild(ui.el('span', 'hub-pill' + (q.own ? ' hub-pill-ok' : ''), q.own ? 'Own limits' : 'Site default'));
    body.appendChild(title);
    body.appendChild(ui.el('p', 'dame-muted', num(q.rows_used) + ' of ' + num(q.max_rows) + ' rows used' +
      (isFull(q) ? ': the space is full, its tools take no new rows. ' : '. ') +
      (hasTools() ? num(q.tools_used) + ' of ' + num(q.max_tools) + ' tools. ' : '') +
      'It has ' + num(q.tables) + (Number(q.tables) === 1 ? ' table' : ' tables') + '; the tool with most has ' + num(q.most_tables) + ' of ' + num(q.max_tables) + '.'));

    var r = q.request;
    if (r) {
      body.appendChild(ui.el('p', 'hub-sub', 'Request from the space\'s admin'));
      var card = ui.el('div', 'hub-edit');
      card.setAttribute('data-request', q.space);
      card.appendChild(ui.el('p', null, r.asked_by.name + ' asked on ' + ui.when(r.asked_at) + ' for ' + limits(r) + '.'));
      card.appendChild(ui.el('p', null, 'Reason: ' + r.reason));
      card.appendChild(ui.el('p', 'dame-hint', 'Change a number to give less or more than asked. Granting sets the limits of this space to these numbers.'));
      var two = ui.el('div', 'hub-two');
      var rows = numberField(two, 'Rows to give', 'rq-rows', r.rows, 100, 10000000);
      var rTools = hasTools() ? numberField(two, 'Tools in the space', 'rq-tools', r.tools, 1, 200) : null;
      var tables = numberField(two, 'Tables in one tool', 'rq-tables', r.tables, 1, 100);
      var cols = numberField(two, 'Columns in one table', 'rq-columns', r.columns, 1, 200);
      card.appendChild(two);
      var noteLabel = ui.el('label', 'hub-field', 'Note to the space\'s admin (needed when you decline)');
      var note = ui.el('input', 'dame-input');
      note.type = 'text';
      note.id = 'rq-note';
      note.maxLength = 500;
      note.autocomplete = 'off';
      noteLabel.appendChild(note);
      card.appendChild(noteLabel);
      var answer = ui.el('div', 'dame-row');
      var grant = ui.confirmButton('Grant', 'dame-btn-primary', function (btn) {
        var n = whole([rows.value, tables.value, cols.value, rTools ? rTools.value : 1]);
        if (!n) { ui.say(qwin.msg, 'Write whole numbers in all the boxes.', 'warn'); btn.disabled = false; btn.textContent = 'Grant'; btn.classList.remove('hub-armed'); return; }
        inQuota('dame_quota_answer', withTools({ p_request: r.id, p_grant: true, p_rows: n[0], p_tables: n[1], p_columns: n[2], p_note: note.value }, n[3]),
          q.name + ' now has ' + limits({ rows: n[0], tables: n[1], columns: n[2], tools: rTools ? n[3] : null }) + '.');
      });
      grant.id = 'rq-grant';
      var decline = ui.confirmButton('Decline', '', function () {
        inQuota('dame_quota_answer', { p_request: r.id, p_grant: false, p_rows: null, p_tables: null, p_columns: null, p_note: note.value },
          'The request is declined. The admin of ' + q.name + ' reads your note.');
      });
      decline.id = 'rq-decline';
      answer.appendChild(grant);
      answer.appendChild(decline);
      card.appendChild(answer);
      body.appendChild(card);
    }

    body.appendChild(ui.el('p', 'hub-sub', 'Limits of this space'));
    body.appendChild(ui.el('p', 'dame-hint', 'A limit below what is used deletes nothing: only new rows, tools, tables or columns are refused until there is room again.'));
    var form = ui.el('form', 'hub-edit');
    form.id = 'sq-form';
    form.noValidate = true;
    var three = ui.el('div', 'hub-two');
    var qRows = numberField(three, 'Rows in the space (100 to 10,000,000)', 'sq-rows', q.max_rows, 100, 10000000);
    var qTools = hasTools() ? numberField(three, 'Tools in the space (1 to 200)', 'sq-tools', q.max_tools, 1, 200) : null;
    var qTables = numberField(three, 'Tables in one tool (1 to 100)', 'sq-tables', q.max_tables, 1, 100);
    var qCols = numberField(three, 'Columns in one table (1 to 200)', 'sq-columns', q.max_columns, 1, 200);
    form.appendChild(three);
    var row = ui.el('div', 'dame-row');
    var save = ui.el('button', 'dame-btn hub-small', 'Save these limits');
    save.type = 'submit';
    row.appendChild(save);
    if (q.own) {
      var back = ui.confirmButton('Back to the site\'s default', '', function () {
        inQuota('dame_quota_set', withTools({ p_space: q.space, p_rows: null, p_tables: null, p_columns: null }, null), q.name + ' is back on the site\'s default.');
      });
      back.id = 'sq-default';
      row.appendChild(back);
    }
    form.appendChild(row);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var n = whole([qRows.value, qTables.value, qCols.value, qTools ? qTools.value : 1]);
      if (!n) { ui.say(qwin.msg, 'Write whole numbers in all the boxes.', 'warn'); return; }
      inQuota('dame_quota_set', withTools({ p_space: q.space, p_rows: n[0], p_tables: n[1], p_columns: n[2] }, n[3]), 'The limits of ' + q.name + ' are saved.');
    });
    body.appendChild(form);
  }

  function openQuota(id) {
    var q = quotaOf(id);
    if (!q) { return; }
    var back = ui.el('div', 'hub-focus-back');
    var box = ui.el('section', 'hub-focus hub-focus-small');
    box.id = 'quota-win';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Database quota of ' + q.name);
    var body = ui.el('div');
    var msg = ui.el('p', 'hub-msg');
    msg.id = 'quota-win-msg';
    msg.hidden = true;
    msg.setAttribute('role', 'alert');
    var foot = ui.el('div', 'dame-row hub-focus-foot');
    var close = ui.el('button', 'dame-btn dame-btn-primary', 'Done');
    close.type = 'button';
    close.id = 'quota-win-close';
    close.addEventListener('click', closeQuota);
    back.addEventListener('mousedown', function (ev) { if (ev.target === back) { closeQuota(); } });
    foot.appendChild(close);
    box.appendChild(body);
    box.appendChild(msg);
    box.appendChild(foot);
    back.appendChild(box);
    qwin = { id: id, back: back, body: body, msg: msg, onKey: function (ev) { if (ev.key === 'Escape') { closeQuota(); } } };
    document.addEventListener('keydown', qwin.onKey);
    drawQuota(q);
    document.body.appendChild(back);
    close.focus();
  }

  function drawQuotas() {
    $('q-off').hidden = quotas !== null;
    $('q-body').hidden = quotas === null;
    if (!quotas) { return; }
    var d = quotas.defaults;
    $('q-default-text').textContent = 'Default: ' + limits(d) + '.';
    var waiting = quotas.spaces.filter(function (q) { return q.request; }).length;
    $('q-tiles').closest('section').dataset.badge = String(waiting);
    // Spaces that wait for an answer come first, then full ones, then by name.
    var order = quotas.spaces.slice().sort(function (x, y) {
      return (y.request ? 2 : 0) + (isFull(y) ? 1 : 0) - (x.request ? 2 : 0) - (isFull(x) ? 1 : 0) || x.name.localeCompare(y.name);
    });
    var box = ui.clear($('q-tiles'));
    order.forEach(function (q) { box.appendChild(quotaTile(q)); });
    $('q-tiles-empty').hidden = order.length > 0;
    // An open window shows what the database holds now; a space that is gone closes its window.
    if (qwin) {
      var open = quotaOf(qwin.id);
      if (open) { drawQuota(open); } else { closeQuota(); }
    }
  }

  function showDefault(on) {
    $('quota-default').hidden = !on;
    ui.say($('qd-msg'), '');
    if (on && quotas) {
      $('qd-rows').value = quotas.defaults.rows;
      $('qd-tables').value = quotas.defaults.tables;
      $('qd-columns').value = quotas.defaults.columns;
      $('qd-tools').value = hasTools() ? quotas.defaults.tools : '';
      $('qd-tools-field').hidden = !hasTools();
      $('qd-rows').focus();
    } else if (!on) {
      $('q-default').focus();
    }
  }

  function drawSpace(s) {
    var body = ui.clear(win.body);
    var title = ui.el('h2', null, s.name + ' ');
    title.appendChild(ui.el('span', 'hub-pill', s.id));
    title.appendChild(ui.el('span', 'hub-pill' + (s.active ? ' hub-pill-ok' : ''), s.active ? 'On' : 'Switched off'));
    body.appendChild(title);
    body.appendChild(ui.el('p', 'dame-muted', (s.description ? s.description + ' ' : '') +
      s.tools + (s.tools === 1 ? ' tool, ' : ' tools, ') + s.members + (s.members === 1 ? ' member.' : ' members.')));

    body.appendChild(ui.el('p', 'hub-sub', 'Admins'));
    var list = ui.el('ul', 'hub-list');
    ui.people(list, s.admins, 'No admin.', 'Remove', function (person) {
      inSpace('dame_space_admin_remove', { p_space: s.id, p_user: person.id }, person.name + ' is no longer an admin of ' + s.name + '.');
    });
    body.appendChild(list);
    body.appendChild(ui.picker('Find a person to name as admin of ' + s.name, 'Name as admin', function (person) {
      inSpace('dame_space_admin_add', { p_space: s.id, p_user: person.id }, person.name + ' is now an admin of ' + s.name + '.');
    }));

    body.appendChild(ui.el('p', 'hub-sub', s.active ? 'Switch off' : 'Switch on'));
    body.appendChild(ui.el('p', 'dame-hint', s.active ? 'Nothing is deleted. Only its admins can open the space until it is switched on again.'
      : 'Its members can open the space again.'));
    var row = ui.el('div', 'dame-row');
    row.appendChild(s.active
      ? ui.confirmButton('Switch space off', '', function () { inSpace('dame_space_set_active', { p_space: s.id, p_active: false }, s.name + ' is switched off. Only its admins can open it.'); })
      : ui.confirmButton('Switch space on', '', function () { inSpace('dame_space_set_active', { p_space: s.id, p_active: true }, s.name + ' is switched on.'); }));
    body.appendChild(row);

    body.appendChild(ui.el('p', 'hub-sub', 'Delete'));
    body.appendChild(ui.el('p', 'dame-hint', 'Deletes the space, its tools and their data for good. The id ' + s.id + ' can never be used again.'));
    body.appendChild(ui.typedDelete(s.id, 'Delete space and its tools', async function (typed) {
      var w = win;
      try {
        await api.rpc('dame_space_delete', { p_space: s.id, p_confirm: typed });
        closeSpace();
        await load();
        ui.say($('msg'), s.name + ' is deleted. Its id ' + s.id + ' will never be used again.', 'ok');
        $('msg').scrollIntoView({ block: 'nearest' });
      } catch (err) {
        await load().catch(function () {});
        if (win === w) { ui.sayError(w.msg, err); }
      }
    }));

    var mine = s.admins.some(function (a) { return a.id === me.id; });
    win.link.hidden = !mine;
    win.link.href = api.href('admin/space.html') + '?space=' + encodeURIComponent(s.id);
  }

  function openSpace(id) {
    var s = spaces.filter(function (x) { return x.id === id; })[0];
    if (!s) { return; }
    var back = ui.el('div', 'hub-focus-back');
    var box = ui.el('section', 'hub-focus hub-focus-small');
    box.id = 'space-win';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Space ' + s.name);
    var body = ui.el('div');
    var msg = ui.el('p', 'hub-msg');
    msg.id = 'space-win-msg';
    msg.hidden = true;
    msg.setAttribute('role', 'alert');
    var foot = ui.el('div', 'dame-row hub-focus-foot');
    var close = ui.el('button', 'dame-btn dame-btn-primary', 'Done');
    close.type = 'button';
    close.id = 'space-win-close';
    var link = ui.el('a', 'dame-btn', 'Open its admin page');
    close.addEventListener('click', closeSpace);
    back.addEventListener('mousedown', function (ev) { if (ev.target === back) { closeSpace(); } });
    foot.appendChild(close);
    foot.appendChild(link);
    box.appendChild(body);
    box.appendChild(msg);
    box.appendChild(foot);
    back.appendChild(box);
    win = { id: id, back: back, body: body, msg: msg, link: link, onKey: function (ev) { if (ev.key === 'Escape') { closeSpace(); } } };
    document.addEventListener('keydown', win.onKey);
    drawSpace(s);
    document.body.appendChild(back);
    close.focus();
  }

  // The "Add a space" window.
  function showNewSpace(on) {
    $('space-new').hidden = !on;
    ui.say($('sp-msg'), '');
    if (on) { $('sp-name').focus(); } else { $('space-add').focus(); }
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
    box.id = 'user-new';
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
      api.rpc('dame_users_added').catch(function () { return null; }),
      // Quotas need db/core/011: until it is run, that card says so and the rest of the page works.
      api.rpc('dame_quota_list').catch(function () { return null; })];
    var audit = loadAudit();
    audit.catch(function () {});
    var got = await Promise.all(asked);
    users = got[0] || [];
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

    quotas = got[4];
    drawQuotas();

    spaces = got[1] || [];
    var box = ui.clear($('spaces'));
    spaces.forEach(function (s) { box.appendChild(spaceTile(s)); });
    $('spaces-empty').hidden = spaces.length > 0;
    var hasTest = spaces.some(function (x) { return x.id === 'test-space'; });
    $('test-make').hidden = hasTest;
    $('test-text').hidden = hasTest;
    // An open window shows what the database holds now; a space that is gone closes its window.
    if (win) {
      var open = spaces.filter(function (x) { return x.id === win.id; })[0];
      if (open) { drawSpace(open); } else { closeSpace(); }
    }

    // An open person window is read again; a person who is gone closes it.
    if (pwin) { await showPerson(); }

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
    $('q-default').addEventListener('click', function () { showDefault(true); });
    $('qd-cancel').addEventListener('click', function () { showDefault(false); });
    $('quota-default').addEventListener('mousedown', function (ev) { if (ev.target === $('quota-default')) { showDefault(false); } });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !$('quota-default').hidden) { showDefault(false); } });
    $('form-quota').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var n = whole([$('qd-rows').value, $('qd-tables').value, $('qd-columns').value, hasTools() ? $('qd-tools').value : 1]);
      if (!n) { ui.say($('qd-msg'), 'Write whole numbers in all the boxes.', 'warn'); return; }
      $('qd-save').disabled = true;
      try {
        await api.rpc('dame_quota_default_set', withTools({ p_rows: n[0], p_tables: n[1], p_columns: n[2] }, n[3]));
        showDefault(false);
        await load();
        ui.say($('msg'), 'The default is saved. It holds now for every space without limits of its own.', 'ok');
        $('msg').scrollIntoView({ block: 'nearest' });
      } catch (err) {
        ui.sayError($('qd-msg'), err);
      }
      $('qd-save').disabled = false;
    });
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
    $('space-add').addEventListener('click', function () { showNewSpace(true); });
    $('sp-cancel').addEventListener('click', function () { showNewSpace(false); });
    $('space-new').addEventListener('mousedown', function (ev) { if (ev.target === $('space-new')) { showNewSpace(false); } });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !$('space-new').hidden) { showNewSpace(false); } });
    $('form-space').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var form = ev.currentTarget;
      var msg = $('sp-msg');
      if (!firstAdmin) {
        ui.say(msg, 'Choose the first admin of the new space.', 'warn');
        msg.scrollIntoView({ block: 'nearest' });
        return;
      }
      var name = $('sp-name').value.trim();
      $('sp-create').disabled = true;
      ui.say(msg, '');
      try {
        await api.rpc('dame_space_create', { p_id: $('sp-id').value.trim(), p_name: name, p_description: $('sp-desc').value, p_admin: firstAdmin.id });
        form.reset();
        firstAdmin = null;
        idTouched = false;
        showFirstAdmin();
        showNewSpace(false);
        await load();
        ui.say($('msg'), 'Space ' + name + ' is created. Its admin can now add tools and people. Press its tile to change it.', 'ok');
        $('msg').scrollIntoView({ block: 'nearest' });
      } catch (err) {
        ui.sayError(msg, err);
        msg.scrollIntoView({ block: 'nearest' });
      }
      $('sp-create').disabled = false;
    });

    // The test space: the same three calls a person makes by hand, in one press.
    $('test-make').addEventListener('click', async function () {
      $('test-make').disabled = true;
      ui.say($('msg'), '');
      try {
        await api.rpc('dame_space_create', { p_id: 'test-space', p_name: 'Test space', p_description: 'Two example tools to try the site.', p_admin: me.id });
        await api.rpc('dame_tool_create', { p_space: 'test-space', p_id: 'converter', p_name: 'Converter', p_description: 'Stand-alone example: it calculates and saves nothing.',
          p_icon: 'i-calc', p_colour: '#0a7d6c', p_open_to_space: true, p_open_level: 'read' });
        await api.rpc('dame_tool_create', { p_space: 'test-space', p_id: 'tracker', p_name: 'Tracker', p_description: 'Example that saves rows in a table.',
          p_icon: 'i-clip', p_colour: '#b45309', p_open_to_space: true, p_open_level: 'contribute' });
        await load();
        ui.say($('msg'), 'The test space is made, with two empty tools. Press its tile, then "Open its admin page", and press "Build and access" on each tool.', 'ok');
      } catch (err) {
        await load().catch(function () {});
        ui.say($('msg'), (err && err.code === 'bad_request')
          ? 'The test space exists already, or was deleted before (an id is never used twice). Press its tile, or make a space by hand with "Add a space".'
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
