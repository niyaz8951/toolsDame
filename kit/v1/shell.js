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

  // ---- day and night. The choice is one word kept in this browser; kit/v1/theme.js applies it before the page is drawn.
  var root = document.documentElement;
  function isNight() {
    var t = root.getAttribute('data-theme');
    return t ? t === 'night' : !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function themeButton() {
    var btn = el('button', 'hub-theme');
    btn.type = 'button';
    function label() {
      btn.setAttribute('data-night', String(isNight()));
      btn.setAttribute('aria-label', isNight() ? 'Switch to the day theme' : 'Switch to the night theme');
      btn.title = isNight() ? 'Day theme' : 'Night theme';
    }
    function apply(next) {
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('dame.theme', next); } catch (e) { /* kept for this page only */ }
      label();
      // A page that shows a tool passes the choice on to it.
      window.dispatchEvent(new CustomEvent('dame-theme', { detail: next }));
    }
    btn.addEventListener('click', function () {
      var next = isNight() ? 'day' : 'night';
      var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (document.startViewTransition && !calm) {
        // The new theme opens as a circle from the button.
        var box = btn.getBoundingClientRect();
        var x = box.left + box.width / 2;
        var y = box.top + box.height / 2;
        var r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
        document.startViewTransition(function () { apply(next); }).ready.then(function () {
          root.animate({ clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + r + 'px at ' + x + 'px ' + y + 'px)'] },
            { duration: 480, easing: 'cubic-bezier(.2,.8,.2,1)', pseudoElement: '::view-transition-new(root)' });
        }).catch(function () {});
      } else {
        root.classList.add('hub-theme-fade');
        apply(next);
        setTimeout(function () { root.classList.remove('hub-theme-fade'); }, 400);
      }
    });
    label();
    return btn;
  }

  // ---- the information button: how to use this page, in steps. Hub pages show help/<page>.md;
  // a page may give its own text with DameShell.info(fn), fn returning { title, text, note }.
  var infoSource = null;
  var infoBtn = null;
  var sheetBack = null;

  // Writes a small text format as page elements: "# title", "## title", "- item", "1. item",
  // empty line = new paragraph, **bold**. Everything is put in as text, never as HTML.
  function rich(text) {
    var box = el('div', 'hub-rich');
    var list = null;
    function inline(node, line) {
      line.split(/(\*\*[^*]+\*\*|`[^`]+`|\*\([^*]+\)\*)/).forEach(function (part) {
        if (/^\*\*[^*]+\*\*$/.test(part)) { node.appendChild(inline(el('strong'), part.slice(2, -2))); }
        else if (/^`[^`]+`$/.test(part)) { node.appendChild(el('code', null, part.slice(1, -1))); }
        else if (/^\*\([^*]+\)\*$/.test(part)) { node.appendChild(el('em', null, part.slice(1, -1))); }
        else if (part) { node.appendChild(document.createTextNode(part)); }
      });
      return node;
    }
    var table = null;
    String(text || '').split('\n').forEach(function (raw) {
      var line = raw.trim();
      var m;
      if (!/^\|.*\|$/.test(line)) { table = null; }
      if (!line) { list = null; return; }
      // "=> a | b | c": steps in a row with arrows between them.
      if (/^=>\s+/.test(line)) {
        list = null;
        var flow = el('div', 'hub-flow');
        line.replace(/^=>\s+/, '').split('|').forEach(function (step) { flow.appendChild(inline(el('span'), step.trim())); });
        box.appendChild(flow);
        return;
      }
      // "> text": a note that stands out.
      if (/^>\s+/.test(line)) { list = null; box.appendChild(inline(el('p', 'hub-callout'), line.replace(/^>\s+/, ''))); return; }
      // "| a | b |": a table; the first row is its head, a row of dashes is skipped.
      if (/^\|.*\|$/.test(line)) {
        list = null;
        var cells = line.slice(1, -1).split('|').map(function (c) { return c.trim(); });
        if (cells.every(function (c) { return /^:?-{2,}:?$/.test(c); })) { return; }
        var first = !table;
        if (first) {
          var wrap = el('div', 'hub-scroll');
          table = el('table', 'dame-table hub-book-table');
          table.appendChild(el('thead'));
          table.appendChild(el('tbody'));
          wrap.appendChild(table);
          box.appendChild(wrap);
        }
        var tr = el('tr');
        cells.forEach(function (c) { tr.appendChild(inline(el(first ? 'th' : 'td'), c)); });
        table.children[first ? 0 : 1].appendChild(tr);
        return;
      }
      if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { list = null; box.appendChild(inline(el(m[1].length === 1 ? 'h2' : 'h3'), m[2])); return; }
      if ((m = /^(-|\d+[.)])\s+(.*)$/.exec(line))) {
        var kind = m[1] === '-' ? 'UL' : 'OL';
        if (!list || list.tagName !== kind) { list = el(kind.toLowerCase()); box.appendChild(list); }
        list.appendChild(inline(el('li'), m[2]));
        return;
      }
      list = null;
      box.appendChild(inline(el('p'), line));
    });
    return box;
  }

  function closeInfo() {
    if (sheetBack) { sheetBack.remove(); sheetBack = null; if (infoBtn) { infoBtn.focus(); } }
  }

  async function openInfo() {
    if (sheetBack) { closeInfo(); return; }
    if (infoBtn) { infoBtn.classList.remove('hub-info-new'); }
    sheetBack = el('div', 'hub-sheet-back');
    var sheet = el('section', 'hub-sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'How to use this page');
    var head = el('div', 'hub-sheet-head');
    var title = el('h2', null, 'How to use this page');
    var close = el('button', 'dame-btn hub-small', 'Close');
    close.type = 'button';
    close.addEventListener('click', closeInfo);
    head.appendChild(title);
    head.appendChild(close);
    var body = el('div', 'hub-sheet-body');
    body.appendChild(el('p', 'dame-muted', 'One moment.'));
    sheet.appendChild(head);
    sheet.appendChild(body);
    sheetBack.appendChild(sheet);
    sheetBack.addEventListener('click', function (ev) { if (ev.target === sheetBack) { closeInfo(); } });
    // Tab stays inside the panel while it is open.
    sheet.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Tab') { return; }
      var stops = sheet.querySelectorAll('button, a[href], input, select, textarea');
      if (!stops.length) { return; }
      var first = stops[0];
      var last = stops[stops.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    });
    document.body.appendChild(sheetBack);
    close.focus();
    var mine = sheetBack;
    var got;
    try {
      got = infoSource ? await infoSource() : null;
      if (!got) {
        var res = await fetch(api.href('help/' + (document.body.dataset.page || 'hub') + '.md'), { cache: 'no-cache', credentials: 'omit' });
        if (!res.ok) { throw new Error('help'); }
        got = { text: await res.text() };
      }
    } catch (e) {
      got = { text: 'The help text of this page could not be loaded. Reload the page and try again.' };
    }
    if (sheetBack !== mine) { return; }
    clear(body);
    if (got.title) { title.textContent = got.title; }
    body.appendChild(rich(got.text));
    if (got.note) { body.appendChild(el('p', 'dame-muted hub-sheet-note', got.note)); }
  }

  function infoButton() {
    infoBtn = el('button', 'hub-info', 'i');
    infoBtn.type = 'button';
    infoBtn.setAttribute('aria-label', 'How to use this page');
    infoBtn.title = 'How to use this page';
    infoBtn.addEventListener('click', function () { openInfo(); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { closeInfo(); } });
    return infoBtn;
  }

  // A page gives its own help; "attention" makes the button ask to be pressed (a tool that is not built yet).
  function info(source, attention) {
    infoSource = source;
    if (infoBtn) { infoBtn.classList.toggle('hub-info-new', !!attention); }
  }

  // The guide the site writes by itself for a tool whose manager wrote none: from its name, description, tables and the reader's level.
  function toolGuide(h) {
    var SHARE = { team: 'everyone who has this tool sees all rows', 'private': 'each person sees only his own rows', reference: 'everyone reads, only the tool\'s managers change' };
    var LEVEL = { read: 'Read: you see what is there and cannot change it.', contribute: 'Contribute: you add rows and change your own.',
      edit: 'Edit: you add rows and change anyone\'s.', approve: 'Approve: you add, change and delete rows.' };
    var out = [];
    if (h.description) { out.push(h.description, ''); }
    out.push('## How to use it', '1. Fill in what the page asks, from top to bottom.', '2. Read the result on the page.');
    if (h.tables && h.tables.length) {
      out.push('3. Press the save button of the page to keep what you entered.', '', '## What is saved', 'This tool saves what you enter in the site\'s database:');
      h.tables.forEach(function (t) { out.push('- **' + t.name + '**: ' + (SHARE[t.sharing] || t.sharing) + '.'); });
    } else {
      out.push('', '## What is saved', 'Nothing. This tool only calculates or works with files you choose. When you close the page, what you typed is gone.');
    }
    if (LEVEL[h.level]) { out.push('', '## What you may do', LEVEL[h.level]); }
    out.push('', '## Something is wrong or missing', '- A button you expect is not there: your level does not allow it.', '- Anything else: tell the tool\'s manager.');
    return out.join('\n');
  }

  var header = el('header', 'hub-bar');
  var userBox = el('span', 'hub-user');

  function bar() {
    var brand = el('a', 'hub-brand');
    brand.appendChild(el('span', 'hub-mark'));
    brand.appendChild(el('span', 'hub-brand-text', 'DAME'));
    brand.setAttribute('aria-label', 'DAME, to the hub');
    brand.href = api.href(api.signedIn() ? 'hub.html' : 'index.html');
    header.appendChild(brand);
    header.appendChild(el('span', 'hub-title', document.body.dataset.title || ''));
    header.appendChild(infoButton());
    header.appendChild(themeButton());
    header.appendChild(userBox);
    header.appendChild(el('span', 'hub-tag', 'Demo'));
    document.body.insertBefore(header, document.body.firstChild);
  }

  // The account button: the person's initials; a press opens his name and "Sign out".
  // One round button keeps the bar on one line at any width.
  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    var a = parts[0] ? Array.from(parts[0])[0] : '';
    var b = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] : '';
    return ((a + b) || '?').toUpperCase();
  }

  function showUser(me) {
    clear(userBox);
    var btn = el('button', 'hub-account', initials(me.name));
    var menu = el('div', 'hub-menu');
    var out = el('button', 'dame-btn hub-small hub-signout', 'Sign out');
    btn.type = 'button';
    btn.title = 'Your account';
    btn.setAttribute('aria-label', 'Your account: ' + me.name);
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    menu.hidden = true;
    menu.appendChild(el('p', 'hub-menu-name hub-user-name', me.name));
    if (me.email) { menu.appendChild(el('p', 'hub-menu-sub', me.email)); }
    menu.appendChild(el('p', 'hub-menu-sub', 'Demo site'));
    out.type = 'button';
    function shut() { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    btn.addEventListener('click', function () {
      menu.hidden = !menu.hidden;
      btn.setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden) { out.focus(); }
    });
    document.addEventListener('click', function (ev) { if (!userBox.contains(ev.target)) { shut(); } });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !menu.hidden) { shut(); btn.focus(); }
    });
    out.addEventListener('click', async function () {
      out.disabled = true;
      await api.signOut();
      leave('You are signed out.');
    });
    menu.appendChild(out);
    userBox.appendChild(btn);
    userBox.appendChild(menu);
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
      var gone = ['signed_out', 'session_ended', 'pending', 'disabled', 'no_profile', 'must_change'];
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

  // "Today, 8:15 PM", "Yesterday, 4:02 PM", otherwise the date. The year only when it is not this year.
  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return ''; }
    var now = new Date();
    var day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var days = Math.round((day0 - day) / 86400000);
    var date = days === 0 ? 'Today' : days === 1 ? 'Yesterday'
      : d.toLocaleDateString(undefined, d.getFullYear() === now.getFullYear()
        ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
    return date + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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
    'user.signed_in': 'signed in', 'user.requested': 'asked for access', 'user.approved': 'approved', 'user.refused': 'refused',
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
    'tool.access_set': 'gave access', 'tool.access_removed': 'took access away',
    'table.created': 'made a table', 'table.column_added': 'added a column', 'table.deleted': 'deleted a table',
    'tool.help_set': 'wrote the usage guide', 'user.created': 'made an account', 'user.password_chosen': 'chose his own password', 'user.added': 'added a person', 'user.add_removed': 'took an added person back', 'version.uploaded': 'uploaded a version', 'version.made_live': 'made a version live', 'version.rolled_back': 'rolled back'
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
        if (d.from !== undefined && d.to !== undefined) { about += (about ? ': ' : '') + (/^version\./.test(a.action) ? 'version ' : '') + d.from + ' > ' + d.to; }
        else if (d.name) { about += (about ? ', ' : '') + d.name; }
        else if (d.version) { about += 'version ' + d.version + (d.note ? ': ' + d.note : ''); }
        else if (d.table) { about += d.table + (d.column ? '.' + d.column : '') + (d.rows !== undefined ? ' (' + d.rows + ' rows)' : ''); }
        addRow(body, [when(a.at), a.actor, ACTIONS[a.action] || a.action, where, about]);
      });
      if (rows.length) { oldest = rows[rows.length - 1].id; }
      moreBtn.hidden = rows.length < PAGE;
    }
    moreBtn.addEventListener('click', function () { load(true).catch(function () {}); });
    return function () { return load(false); };
  }

  // ---- the sections strip: on a long page (body data-sections), one button per card, under the bar.
  // A press scrolls to the card; the strip shows which card is on screen. A card may give a short
  // name with data-nav; a hidden card has no button.
  function sections() {
    var host = document.getElementById('body');
    if (!host || document.body.dataset.sections === undefined) { return; }
    var cards = Array.prototype.filter.call(host.children, function (c) { return c.matches('section.dame-card') && c.querySelector('h2'); });
    if (cards.length < 3) { return; }
    var nav = el('nav', 'hub-sections');
    nav.setAttribute('aria-label', 'Parts of this page');
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var pinned = -1;
    var chips = cards.map(function (card) {
      var chip = el('button', 'hub-section', card.dataset.nav || card.querySelector('h2').textContent);
      chip.type = 'button';
      chip.addEventListener('click', function () {
        // The pressed name stays lit until the person scrolls himself: a short last part can never reach the top.
        pinned = cards.indexOf(card);
        mark(pinned);
        card.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
      });
      nav.appendChild(chip);
      return chip;
    });
    function mark(i) {
      chips.forEach(function (chip, n) {
        if (n === i) { chip.setAttribute('aria-current', 'true'); } else { chip.removeAttribute('aria-current'); }
      });
      // Keep the lit button in view inside the strip, without moving the page.
      var c = chips[i];
      if (c && nav.scrollWidth > nav.clientWidth) { nav.scrollLeft = c.offsetLeft - (nav.clientWidth - c.offsetWidth) / 2; }
    }
    function sync() {
      var line = nav.getBoundingClientRect().bottom + 40;
      var at = -1;
      cards.forEach(function (card, i) {
        chips[i].hidden = card.hidden;
        if (!card.hidden && card.getBoundingClientRect().top <= line) { at = i; }
      });
      if (at === -1) { at = cards.findIndex(function (c) { return !c.hidden; }); }
      if (pinned !== -1 && !cards[pinned].hidden) { at = pinned; }
      mark(at);
    }
    var waiting = false;
    function soon() {
      if (waiting) { return; }
      waiting = true;
      requestAnimationFrame(function () { waiting = false; sync(); });
    }
    host.parentNode.insertBefore(nav, host);
    nav.hidden = host.hidden;
    ['wheel', 'touchmove', 'keydown'].forEach(function (name) { window.addEventListener(name, function () { pinned = -1; }, { passive: true }); });
    window.addEventListener('scroll', soon, { passive: true });
    window.addEventListener('resize', soon, { passive: true });
    new MutationObserver(function () { nav.hidden = host.hidden; soon(); })
      .observe(host, { attributes: true, attributeFilter: ['hidden'], subtree: true });
    sync();
  }

  // The colour the phone's browser paints around the page follows day and night.
  function tint() {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
    meta.content = getComputedStyle(root).getPropertyValue('--dame-bg').trim() || '#F3F7FA';
  }
  window.addEventListener('dame-theme', tint);
  if (window.matchMedia) {
    var scheme = window.matchMedia('(prefers-color-scheme: dark)');
    if (scheme.addEventListener) { scheme.addEventListener('change', tint); }
  }

  bar();
  sections();
  tint();

  window.DameShell = Object.freeze({
    el: el, clear: clear, say: say, sayError: sayError, guard: guard,
    showUser: showUser, confirmButton: confirmButton, when: when,
    param: param, runner: runner, addRow: addRow, picker: picker, people: people,
    typedDelete: typedDelete, audit: audit, info: info, openInfo: openInfo, rich: rich, toolGuide: toolGuide
  });
})();
