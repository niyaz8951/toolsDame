/*
 * pages/account.js - "My account": the person's details, password, access and sign-ins.
 * Serves: contract 1 (Identity) and 3 (Access).
 * Must not change: everything from the database is written with textContent;
 * the page sends no user id (the database answers for the caller only); a
 * password is handed to DameApi.passwordOk / setPassword only, never stored,
 * logged or put in an address; the page checks nothing that the database does
 * not check again.
 */
(function () {
  'use strict';

  var api = window.DameApi;
  var ui = window.DameShell;
  if (!ui) { return; }

  var acc = null;
  var LEVEL = { read: 'Read: you see what is there', contribute: 'Contribute: you add rows and change your own',
    edit: 'Edit: you add rows and change anyone\'s', approve: 'Approve: you add, change and delete' };

  function $(id) { return document.getElementById(id); }

  function fact(list, label, value) {
    var li = ui.el('li');
    li.appendChild(ui.el('span', null, label));
    li.appendChild(ui.el('strong', null, value));
    list.appendChild(li);
  }

  function line(list, name, text, pills, href, go) {
    var li = ui.el('li', 'hub-person');
    var box = ui.el('div', 'hub-grow');
    var head = ui.el('strong', null, name);
    box.appendChild(head);
    (pills || []).forEach(function (p) { box.appendChild(document.createTextNode(' ')); box.appendChild(ui.el('em', 'hub-pill', p)); });
    if (text) { box.appendChild(ui.el('span', null, text)); }
    li.appendChild(box);
    if (href) {
      var a = ui.el('a', 'dame-btn hub-small', go);
      a.href = href;
      li.appendChild(a);
    }
    list.appendChild(li);
  }

  function draw() {
    $('title').textContent = acc.name;
    var facts = ui.clear($('facts'));
    fact(facts, 'Name', acc.name);
    fact(facts, acc.username ? 'Username (you sign in with it)' : 'Work email (you sign in with it)', acc.username || acc.email || '');
    fact(facts, 'Staff number', acc.staff_no || 'Not set');
    fact(facts, 'Role on the site', acc.is_it ? 'IT admin' : 'Member');
    fact(facts, 'Account since', ui.when(acc.created_at));
    if (document.activeElement !== $('d-title')) { $('d-title').value = acc.job_title || ''; }
    if (document.activeElement !== $('d-dept')) { $('d-dept').value = acc.department || ''; }
    if (document.activeElement !== $('d-office')) { $('d-office').value = acc.office || ''; }
    if (document.activeElement !== $('d-phone')) { $('d-phone').value = acc.phone || ''; }

    $('pw-last').textContent = acc.pw_changed_at
      ? 'You last chose your password ' + ui.when(acc.pw_changed_at).toLowerCase() + '. Change it whenever you think someone else may know it.'
      : 'You have not changed your password since the account was made. Change it whenever you think someone else may know it.';

    var spaces = ui.clear($('spaces'));
    (acc.spaces || []).forEach(function (s) {
      line(spaces, s.name, s.role === 'admin' ? 'You manage this space: its tools and who gets them.' : 'You are a member.',
        [s.role === 'admin' ? 'Admin' : 'Member'].concat(s.active ? [] : ['Switched off']),
        api.href('space.html') + '?space=' + encodeURIComponent(s.id), 'Open');
    });
    if (!(acc.spaces || []).length) { spaces.appendChild(ui.el('li', 'dame-muted', 'No space yet. A space\'s admin adds you.')); }

    var tools = ui.clear($('tools'));
    (acc.tools || []).forEach(function (t) {
      line(tools, t.name, t.space_name + '. ' + (LEVEL[t.level] || t.level) + '.', t.manager ? ['Manager'] : [],
        api.href('tool.html') + '?space=' + encodeURIComponent(t.space) + '&tool=' + encodeURIComponent(t.tool), 'Open');
    });
    if (!(acc.tools || []).length) { tools.appendChild(ui.el('li', 'dame-muted', 'No tool yet. A tool\'s manager or the space\'s admin gives you one.')); }

    var ins = ui.clear($('signins'));
    (acc.sign_ins || []).forEach(function (at, i) {
      var li = ui.el('li', null, ui.when(at));
      if (i === 0) { li.appendChild(document.createTextNode(' ')); li.appendChild(ui.el('em', 'hub-pill hub-pill-ok', 'This one')); }
      ins.appendChild(li);
    });
    if (!(acc.sign_ins || []).length) { ins.appendChild(ui.el('li', 'dame-muted', 'No sign-in is recorded yet.')); }
  }

  async function load() {
    acc = await api.rpc('dame_account_get');
    draw();
  }

  function busy(form, on) {
    Array.prototype.forEach.call(form.querySelectorAll('button, input'), function (n) { n.disabled = on; });
  }

  async function start() {
    await ui.guard();
    $('main').hidden = false;
    await load();

    $('form-details').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var form = ev.currentTarget;
      busy(form, true);
      ui.say($('d-msg'), '');
      try {
        await api.rpc('dame_account_set', { p_job_title: $('d-title').value, p_department: $('d-dept').value,
          p_office: $('d-office').value, p_phone: $('d-phone').value });
        document.activeElement.blur();
        await load();
        ui.say($('d-msg'), 'Saved.', 'ok');
      } catch (err) {
        ui.sayError($('d-msg'), err);
      }
      busy(form, false);
    });

    $('form-pw').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var form = ev.currentTarget;
      var now = $('pw-now').value;
      var pw = $('pw-new').value;
      var problem = !now ? 'Type the password you have now.'
        : pw !== $('pw-new2').value ? 'The two new passwords differ. Type the same password twice.'
        : !/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{12,72}$/.test(pw) ? 'Use at least 12 characters, with a small letter, a capital letter and a digit.'
        : pw === now ? 'The new password must differ from the one you have now.' : '';
      if (problem) { ui.say($('pw-msg'), problem, 'warn'); return; }
      busy(form, true);
      ui.say($('pw-msg'), '');
      try {
        if (!(await api.passwordOk(acc.username || acc.email, now))) {
          ui.say($('pw-msg'), 'The password you have now is not right. Nothing was changed.', 'warn');
        } else {
          try {
            await api.setPassword(pw);
          } catch (err) {
            if (err && err.code === 'same_password') { err.message = 'The new password must differ from the one you have now.'; }
            throw err;
          }
          await api.rpc('dame_password_changed');
          form.reset();
          await load();
          ui.say($('pw-msg'), 'Your password is changed. Use the new one at your next sign-in. You stay signed in here.', 'ok');
        }
      } catch (err) {
        ui.sayError($('pw-msg'), err);
      }
      busy(form, false);
    });

    $('body').hidden = false;
  }

  start().catch(function (err) {
    $('main').hidden = false;
    ui.sayError($('msg'), err);
  });
})();
