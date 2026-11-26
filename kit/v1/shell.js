/*
 * kit/v1/shell.js - the platform bar on every hub page, and the page guard.
 * Serves: "On every page" (bar now; info icon, notes, ideas, AI prompt in
 * phase 5), contract 1 (Identity) and SECURITY "Browser".
 * Must not change: data reaches the page with textContent only, never
 * innerHTML; a hub page refuses to run inside a frame (GitHub Pages cannot
 * send the header that would forbid it); the guard only decides what to show:
 * the database refuses the same things on its own.
 */
(function () {
  'use strict';

  if (window.top !== window.self) {
    document.documentElement.hidden = true;
    return;
  }

  var api = window.DameApi;

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) { node.className = cls; }
    if (text !== undefined && text !== null) { node.textContent = String(text); }
    return node;
  }

  function clear(node) {
    while (node.firstChild) { node.removeChild(node.firstChild); }
    return node;
  }

  // Shows a sentence in a message box. kind: 'warn', 'ok' or '' (neutral).
  function say(box, text, kind) {
    box.textContent = text || '';
    box.classList.remove('hub-warn', 'hub-ok');
    if (kind) { box.classList.add('hub-' + kind); }
    box.hidden = !text;
  }

  function sayError(box, err) {
    say(box, (err && err.name === 'DameError') ? err.message
      : 'Something went wrong on this page. Reload it; if it happens again, tell an IT admin.', 'warn');
  }

  function leave(notice) {
    if (notice) { api.setNotice(notice); }
    location.replace(api.href('index.html'));
  }

  var header = el('header', 'hub-bar');
  var userBox = el('span', 'hub-user');

  function bar() {
    var brand = el('a', 'hub-brand', 'DAME');
    brand.href = api.href(api.signedIn() ? 'hub.html' : 'index.html');
    header.appendChild(brand);
    header.appendChild(el('span', 'hub-title', document.body.dataset.title || ''));
    header.appendChild(userBox);
    header.appendChild(el('span', 'hub-tag', 'Demo'));
    document.body.insertBefore(header, document.body.firstChild);
  }

  function showUser(me) {
    clear(userBox);
    userBox.appendChild(el('span', 'hub-user-name', me.name));
    var out = el('button', 'dame-btn hub-small', 'Sign out');
    out.type = 'button';
    out.addEventListener('click', async function () {
      out.disabled = true;
      await api.signOut();
      leave('You are signed out.');
    });
    userBox.appendChild(out);
  }

  // For pages that need a signed-in, approved user. Returns who he is, or
  // sends him to the start page and never returns.
  async function guard() {
    if (api.state() !== 'set' || !api.signedIn()) {
      leave('');
      return new Promise(function () {});
    }
    try {
      var me = await api.rpc('dame_me');
      showUser(me);
      return me;
    } catch (err) {
      var gone = ['signed_out', 'session_ended', 'pending', 'disabled', 'no_profile'];
      if (err && gone.indexOf(err.code) !== -1) {
        leave(err.code === 'session_ended' ? err.message : '');
        return new Promise(function () {});
      }
      throw err;
    }
  }

  // A button that asks to be pressed twice before it acts.
  function confirmButton(label, cls, action) {
    var btn = el('button', 'dame-btn hub-small ' + (cls || ''), label);
    var timer = null;
    btn.type = 'button';
    btn.addEventListener('click', function () {
      if (timer === null) {
        btn.textContent = 'Press again to confirm';
        btn.classList.add('hub-armed');
        timer = setTimeout(function () {
          timer = null;
          btn.textContent = label;
          btn.classList.remove('hub-armed');
        }, 4000);
        return;
      }
      clearTimeout(timer);
      timer = null;
      btn.disabled = true;
      action(btn);
    });
    return btn;
  }

  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return ''; }
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  // A space or tool id from the page address, or '' when it is not a valid id.
  function param(name) {
    var v = new URLSearchParams(location.search).get(name) || '';
    return (v.length >= 3 && v.length <= 30 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v)) ? v : '';
  }

  // Runs one action, reloads the page's lists, and says what happened.
  function runner(msg, reload) {
    return async function (name, args, done) {
      say(msg, '');
      try {
        await api.rpc(name, args);
        await reload();
        say(msg, done, 'ok');
      } catch (err) {
        await reload().catch(function () {});
        sayError(msg, err);
      }
      msg.scrollIntoView({ block: 'nearest' });
    };
  }

  // Adds a table row and names each cell after its column (narrow-screen layout).
  function addRow(body, cells) {
    var tr = el('tr');
    var heads = body.parentNode.querySelectorAll('thead th');
    cells.forEach(function (c, i) {
      var td = el('td');
      if (c && c.nodeType) { td.appendChild(c); } else { td.textContent = (c === null || c === undefined) ? '' : String(c); }
      if (heads[i]) { td.setAttribute('data-label', heads[i].textContent); }
      tr.appendChild(td);
    });
    body.appendChild(tr);
    return tr;
  }

  // Look a person up by name or email and choose him. onPick gets { id, name, email }.
  function picker(label, choose, onPick) {
    var box = el('div', 'hub-picker');
    var row = el('div', 'dame-row');
    var input = el('input', 'dame-input hub-grow');
    var find = el('button', 'dame-btn', 'Find');
    var msg = el('p', 'hub-msg');
    var list = el('ul', 'hub-list');
    input.type = 'search';
    input.maxLength = 80;
    input.placeholder = 'Name or email';
    input.setAttribute('aria-label', label);
    find.type = 'button';
    msg.hidden = true;
    async function search() {
      clear(list);
      say(msg, '');
      if (input.value.trim().length < 2) {
        say(msg, 'Type at least 2 letters of the name or email.', 'warn');
        return;
      }
      find.disabled = true;
      try {
        var people = await api.rpc('dame_people_find', { p_query: input.value.trim() }) || [];
        if (!people.length) { say(msg, 'Nobody found. Only approved accounts can be chosen.', ''); }
        people.forEach(function (person) {
          var li = el('li', 'hub-person');
          var who = el('span', 'hub-grow', person.name);
          who.appendChild(el('span', null, person.email));
          var btn = el('button', 'dame-btn hub-small', choose);
          btn.type = 'button';
          btn.addEventListener('click', function () {
            clear(list);
            input.value = '';
            onPick(person);
          });
          li.appendChild(who);
          li.appendChild(btn);
          list.appendChild(li);
        });
      } catch (err) {
        sayError(msg, err);
      } finally {
        find.disabled = false;
      }
    }
    find.addEventListener('click', search);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); search(); }
    });
    row.appendChild(input);
    row.appendChild(find);
    box.appendChild(row);
    box.appendChild(msg);
    box.appendChild(list);
    return box;
  }

  // A list of people, each with an optional extra element and a two-press remove button.
  function people(list, persons, emptyText, removeLabel, onRemove, extra) {
    clear(list);
    if (!persons.length) {
      list.appendChild(el('li', 'dame-muted', emptyText));
      return;
    }
    persons.forEach(function (person) {
      var li = el('li', 'hub-person');
      var who = el('span', 'hub-grow', person.name + (person.active === false ? ' (switched off)' : ''));
      who.appendChild(el('span', null, person.email));
      li.appendChild(who);
      if (extra) { li.appendChild(extra(person)); }
      if (onRemove) { li.appendChild(confirmButton(removeLabel, '', function () { onRemove(person); })); }
      list.appendChild(li);
    });
  }

  // Deleting needs the id typed in full. Returns the box to put on the page.
  function typedDelete(id, label, action) {
    var box = el('div', 'dame-row hub-delete');
    var input = el('input', 'dame-input hub-grow');
    var btn = el('button', 'dame-btn hub-small hub-danger', label);
    input.type = 'text';
    input.maxLength = 30;
    input.autocomplete = 'off';
    input.placeholder = 'To delete, type ' + id;
    input.setAttribute('aria-label', 'To delete, type ' + id);
    btn.type = 'button';
    btn.disabled = true;
    input.addEventListener('input', function () { btn.disabled = input.value !== id; });
    btn.addEventListener('click', function () {
      btn.disabled = true;
      action(input.value);
    });
    box.appendChild(input);
    box.appendChild(btn);
    return box;
  }

  var ACTIONS = {
    'user.requested': 'asked for access', 'user.approved': 'approved', 'user.refused': 'refused',
    'user.switched_off': 'switched off', 'user.switched_on': 'switched on',
    'user.it_admin_on': 'made IT admin', 'user.it_admin_off': 'removed IT admin',
    'user.first_admin': 'made the first IT admin', 'user.email_changed': 'changed email',
    'setting.changed': 'changed a setting',
    'space.created': 'created the space, first admin', 'space.changed': 'changed the space',
    'space.switched_off': 'switched the space off', 'space.switched_on': 'switched the space on',
    'space.deleted': 'deleted the space', 'space.admin_added': 'named admin', 'space.admin_removed': 'removed admin',
    'space.member_added': 'added to the space', 'space.member_removed': 'removed from the space',
    'tool.created': 'created the tool', 'tool.changed': 'changed the tool',
    'tool.switched_off': 'switched the tool off', 'tool.switched_on': 'switched the tool on',
    'tool.deleted': 'deleted the tool', 'tool.manager_added': 'named manager', 'tool.manager_removed': 'removed manager',
    'tool.access_set': 'gave access', 'tool.access_removed': 'took access away'
  };

  // Fills an audit table page by page. fetchPage(beforeId) returns the rows.
  function audit(body, moreBtn, fetchPage) {
    var PAGE = 50;
    var oldest = null;
    async function load(more) {
      var rows = await fetchPage(PAGE, more ? oldest : null) || [];
      if (!more) { clear(body); }
      rows.forEach(function (a) {
        var where = [a.space, a.tool].filter(Boolean).join(' / ');
        var about = a.target || '';
        var d = a.detail || {};
        if (d.from !== undefined && d.to !== undefined) { about += (about ? ': ' : '') + d.from + ' > ' + d.to; }
        else if (d.name) { about += (about ? ', ' : '') + d.name; }
        addRow(body, [when(a.at), a.actor, ACTIONS[a.action] || a.action, where, about]);
      });
      if (rows.length) { oldest = rows[rows.length - 1].id; }
      moreBtn.hidden = rows.length < PAGE;
    }
    moreBtn.addEventListener('click', function () { load(true).catch(function () {}); });
    return function () { return load(false); };
  }

  bar();

  window.DameShell = Object.freeze({
    el: el, clear: clear, say: say, sayError: sayError, guard: guard,
    showUser: showUser, confirmButton: confirmButton, when: when,
    param: param, runner: runner, addRow: addRow, picker: picker, people: people,
    typedDelete: typedDelete, audit: audit
  });
})();
