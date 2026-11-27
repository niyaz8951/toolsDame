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

  // ---- the shared parts every page builds from: a window, a tile, a field, a fact, an id from a name.
  // One design language: "Add" on top, a tile per item, and the item's window opened from its tile.
  // Change these here and every page follows.

  // A window over the page: o.id, o.label (read out by screen readers), o.onClose (required),
  // o.small (the narrow window), o.cls (one more class), o.form (the window is a <form>),
  // o.closeText ('Close'), o.closeId (o.id + '-close'), o.primary (the close button is the main one),
  // o.outside (false: a press outside does not close it), o.escape (false: Escape does not close it).
  // Escape, the close button and a press outside call o.onClose; the page decides what closing means
  // and then calls w.drop(focusBack), focusBack being a CSS selector or a node to give the focus back to.
  // Returns { back, box, body, msg, foot, close, drop }.
  function dialog(o) {
    var back = el('div', 'hub-focus-back');
    var box = el(o.form ? 'form' : 'section', 'hub-focus' + (o.small ? ' hub-focus-small' : '') + (o.cls ? ' ' + o.cls : ''));
    if (o.id) { box.id = o.id; }
    if (o.form) { box.method = 'post'; box.noValidate = true; }
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', o.label || '');
    var body = el('div');
    var msg = el('p', 'hub-msg');
    if (o.id) { msg.id = o.id + '-msg'; }
    msg.hidden = true;
    msg.setAttribute('role', 'alert');
    var foot = el('div', 'dame-row hub-focus-foot');
    var close = el('button', 'dame-btn' + (o.primary ? ' dame-btn-primary' : ''), o.closeText || 'Close');
    close.type = 'button';
    if (o.closeId || o.id) { close.id = o.closeId || (o.id + '-close'); }
    foot.appendChild(close);
    box.appendChild(body);
    box.appendChild(msg);
    box.appendChild(foot);
    back.appendChild(box);
    function shut() { o.onClose(); }
    function onKey(ev) { if (ev.key === 'Escape') { shut(); } }
    close.addEventListener('click', shut);
    if (o.outside !== false) { back.addEventListener('mousedown', function (ev) { if (ev.target === back) { shut(); } }); }
    if (o.escape !== false) { document.addEventListener('keydown', onKey); }
    var w = { back: back, box: box, body: body, msg: msg, foot: foot, close: close };
    w.drop = function (focusBack) {
      back.remove();
      document.removeEventListener('keydown', onKey);
      var to = typeof focusBack === 'string' ? document.querySelector(focusBack) : focusBack;
      if (to && to.focus) { to.focus(); }
    };
    document.body.appendChild(back);
    return w;
  }

  // A tile: o.name, o.text (left out when null or undefined), o.href (a link) or o.onClick (a button),
  // o.icon (a picked icon or letters; leave it out for the plain first letter), o.letter (the fallback),
  // o.colour ('#rrggbb'), o.off (switched off), o.data ({ key: value } as data-key attributes),
  // o.pills (texts, or [text, class]; empty ones are skipped), o.pillBox (the pills sit in one span).
  function tile(o) {
    var t = el(o.href ? 'a' : 'button', 'hub-tile' + (o.off ? ' hub-tile-off' : ''));
    if (o.href) { t.href = o.href; } else { t.type = 'button'; }
    Object.keys(o.data || {}).forEach(function (k) { t.setAttribute('data-' + k, o.data[k]); });
    if (/^#[0-9a-f]{6}$/.test(o.colour || '')) { t.style.setProperty('--dame-accent', o.colour); }
    var letter = o.letter || (String(o.name || '').trim().charAt(0) || '?').toUpperCase();
    var ic = el('span', 'hub-tile-icon');
    if ('icon' in o) { icon(ic, o.icon, letter); } else { ic.textContent = letter; }
    t.appendChild(ic);
    t.appendChild(el('span', 'hub-tile-name', o.name));
    if (o.text !== undefined && o.text !== null) { t.appendChild(el('span', 'hub-tile-text', o.text)); }
    var pills = (o.pills || []).filter(Boolean);
    var holder = o.pillBox ? el('span') : t;
    pills.forEach(function (p) {
      holder.appendChild(el('span', 'hub-pill' + (Array.isArray(p) && p[1] ? ' ' + p[1] : ''), Array.isArray(p) ? p[0] : p));
    });
    if (o.pillBox) { t.appendChild(holder); }
    if (o.onClick) { t.addEventListener('click', o.onClick); }
    return t;
  }

  // A labelled one-line text field, put at the end of box. Returns the input.
  // o: id, value, max, hint (a line under the field).
  function textField(box, label, o) {
    o = o || {};
    var l = el('label', 'hub-field', label);
    var i = el('input', 'dame-input');
    i.type = 'text';
    if (o.id) { i.id = o.id; }
    if (o.max) { i.maxLength = o.max; }
    i.autocomplete = 'off';
    i.spellcheck = false;
    i.value = o.value || '';
    l.appendChild(i);
    box.appendChild(l);
    if (o.hint) { box.appendChild(el('p', 'dame-hint', o.hint)); }
    return i;
  }

  // One line of a fact list: "Label  value".
  function fact(list, label, value) {
    var li = el('li');
    li.appendChild(el('span', null, label));
    li.appendChild(el('strong', null, value));
    list.appendChild(li);
  }

  // An id made from a name, by the id rule (small letters, digits, single dashes, at most 30).
  // ending: added after a dash when the name gives fewer than 3 characters ("DX" gives "dx-team").
  function slug(text, ending) {
    var id = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
    return id && ending && id.length < 3 ? id + '-' + ending : id;
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
        // To night the dark page opens as a circle from the button (as it always did).
        // To day the same circle runs backwards: the dark page closes into the button
        // and the day page is left. The dark page is the one that moves both ways.
        // The way back is quicker (0.34 s against 0.48 s) and starts moving at once.
        var box = btn.getBoundingClientRect();
        var x = box.left + box.width / 2;
        var y = box.top + box.height / 2;
        var r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
        var small = 'circle(0px at ' + x + 'px ' + y + 'px)';
        var full = 'circle(' + r + 'px at ' + x + 'px ' + y + 'px)';
        var back = next === 'day';
        var run = null;
        var done = function () { root.classList.remove('hub-theme-back'); if (run) { try { run.cancel(); } catch (e) { /* already gone */ } } };
        if (back) { root.classList.add('hub-theme-back'); }   // shell.css lays the old, dark page on top
        var move = document.startViewTransition(function () { apply(next); });
        move.ready.then(function () {
          run = root.animate({ clipPath: back ? [full, small] : [small, full] },
            { duration: back ? 340 : 480, easing: back ? 'cubic-bezier(.3,0,.5,1)' : 'cubic-bezier(.2,.8,.2,1)', fill: back ? 'forwards' : 'none', pseudoElement: back ? '::view-transition-old(root)' : '::view-transition-new(root)' });
        }).catch(function () {});
        if (back) { move.finished.then(done, done); }
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

  // A picture drawn from a few lines of text, for the site book and the help texts. Every word is
  // put in as text. Each line is "a | b | c". The kinds:
  //   stats    number | what it counts                       big numbers side by side
  //   cards    title | text | tag                            a grid of cards; tag "ok", "warn" or a word
  //   chain    title | text                                  boxes in a row with arrows between them
  //   tree     depth title | text                            a tree; depth is 0, 1, 2
  //   walls    title | text                                  boxes inside boxes, the outermost first
  //   lanes    who | what he does                            numbered steps, each with who acts
  //   compare  (first line: left head | right head) then  what | left | right
  function picture(kind, rows, inline) {
    var fig = el('div', 'hub-dg hub-dg-' + kind + ' hub-dg-c' + Math.min(rows.length, 9));
    fig.setAttribute('role', 'group');
    function part(tag, cls, text) { return inline(el(tag, cls), text || ''); }
    if (kind === 'stats') {
      rows.forEach(function (r) {
        var b = el('div', 'hub-dg-stat');
        b.appendChild(part('strong', null, r[0]));
        b.appendChild(part('span', null, r[1]));
        fig.appendChild(b);
      });
    } else if (kind === 'cards') {
      rows.forEach(function (r) {
        var b = el('div', 'hub-dg-card' + (r[2] === 'ok' || r[2] === 'warn' ? ' hub-dg-' + r[2] : ''));
        if (r[2] && r[2] !== 'ok' && r[2] !== 'warn') { b.appendChild(part('em', 'hub-dg-tag', r[2])); }
        b.appendChild(part('strong', null, r[0]));
        if (r[1]) { b.appendChild(part('span', null, r[1])); }
        fig.appendChild(b);
      });
    } else if (kind === 'chain') {
      rows.forEach(function (r, i) {
        var b = el('div', 'hub-dg-link');
        b.appendChild(el('i', 'hub-dg-n', String(i + 1)));
        b.appendChild(part('strong', null, r[0]));
        if (r[1]) { b.appendChild(part('span', null, r[1])); }
        fig.appendChild(b);
      });
    } else if (kind === 'tree') {
      rows.forEach(function (r) {
        var m = /^([0-3])\s+(.*)$/.exec(r[0]) || [null, '0', r[0]];
        var b = el('div', 'hub-dg-node hub-dg-d' + m[1]);
        b.appendChild(part('strong', null, m[2]));
        if (r[1]) { b.appendChild(part('span', null, r[1])); }
        fig.appendChild(b);
      });
    } else if (kind === 'walls') {
      var into = fig;
      rows.forEach(function (r, i) {
        var b = el('div', 'hub-dg-wall' + (i === rows.length - 1 ? ' hub-dg-core' : ''));
        var head = el('div', 'hub-dg-wall-head');
        head.appendChild(part('strong', null, r[0]));
        if (r[1]) { head.appendChild(part('span', null, r[1])); }
        b.appendChild(head);
        into.appendChild(b);
        into = b;
      });
    } else if (kind === 'lanes') {
      rows.forEach(function (r, i) {
        var b = el('div', 'hub-dg-step');
        b.appendChild(el('i', 'hub-dg-n', String(i + 1)));
        b.appendChild(part('em', 'hub-dg-who', r[0]));
        b.appendChild(part('span', null, r[1]));
        fig.appendChild(b);
      });
    } else if (kind === 'compare') {
      rows.forEach(function (r, i) {
        var b = el('div', 'hub-dg-row' + (i === 0 ? ' hub-dg-heads' : ''));
        if (i === 0) { r = [''].concat(r); }
        b.appendChild(part('strong', null, r[0]));
        b.appendChild(part('span', 'hub-dg-left', r[1]));
        b.appendChild(part('span', 'hub-dg-right', r[2]));
        fig.appendChild(b);
      });
    } else {
      rows.forEach(function (r) { fig.appendChild(part('p', null, r.join(' | '))); });
    }
    return fig;
  }

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
    var block = null;   // a picture being read: { kind, rows }, between ":::kind" and ":::"
    String(text || '').split('\n').forEach(function (raw) {
      var line = raw.trim();
      var m;
      // ":::kind" ... ":::" is a picture made of the lines between them (see picture()).
      if (block) {
        if (line === ':::') { box.appendChild(picture(block.kind, block.rows, inline)); block = null; }
        else if (line) { block.rows.push(line.split(' | ').map(function (c) { return c.trim(); })); }
        return;
      }
      if ((m = /^:::([a-z]+)$/.exec(line))) { list = null; table = null; block = { kind: m[1], rows: [] }; return; }
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
    document.body.insertBefore(header, document.body.firstChild);
  }

  // The account button: the person's initials; a press opens his name, "My account" and "Sign out".
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
    // An account made by IT is shown by its username, not by its inner address.
    var inner = String(me.email || '').slice(-api.userDomain.length) === api.userDomain;
    var who = me.username || (inner ? String(me.email).slice(0, -api.userDomain.length) : me.email);
    if (who) { menu.appendChild(el('p', 'hub-menu-sub', who)); }
    var mine = el('a', 'dame-btn hub-small hub-myaccount', 'My account');
    mine.href = api.href('account.html');
    menu.appendChild(mine);
    out.type = 'button';
    function shut() { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    btn.addEventListener('click', function () {
      menu.hidden = !menu.hidden;
      btn.setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden) { mine.focus(); }
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
    input.maxLength = Math.max(30, String(id).length);
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
    'tool.help_set': 'wrote the usage guide', 'user.created': 'made an account', 'user.password_chosen': 'chose his own password', 'user.password_changed': 'changed his password', 'user.password_reset': 'reset the password of',
    'user.details_changed': 'changed his work details', 'user.details_set': 'corrected the account of', 'user.status_changed': 'let in', 'user.added': 'added a person', 'user.add_removed': 'took an added person back', 'version.uploaded': 'uploaded a version', 'version.made_live': 'made a version live', 'version.rolled_back': 'rolled back',
    'relay.started': 'started in Relay', 'relay.picked': 'picked up in Relay', 'relay.released': 'put back in Relay',
    'relay.taken_over': 'took over in Relay', 'relay.passed': 'passed on in Relay', 'relay.answered': 'answered back in Relay',
    'relay.sent_back': 'sent back in Relay', 'relay.closed': 'closed in Relay', 'relay.cancelled': 'cancelled in Relay',
    'relay.blocked': 'raised the flag in Relay', 'relay.unblocked': 'cleared the flag in Relay', 'relay.looked': 'looked at an item of other teams in Relay',
    'relay.flow_created': 'made a Relay flow', 'relay.flow_changed': 'changed a Relay flow',
    'relay.flow_on': 'switched a Relay flow on', 'relay.flow_off': 'switched a Relay flow off'
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

  // ---- the parts of a long page (body data-sections): one tab per card, under the bar, and one
  // card on screen at a time. A card may give a short name with data-nav and a count with
  // data-badge; a card the page hides has no tab. The open part is kept in the address (#name),
  // so a reload or a shared link opens the same part. Only how the page is shown: a hidden part
  // is still in the page, and the database decides what a person may do, as everywhere.
  function sections() {
    var host = document.getElementById('body');
    if (!host || document.body.dataset.sections === undefined) { return; }
    var cards = Array.prototype.filter.call(host.children, function (c) { return c.matches('section.dame-card') && c.querySelector('h2'); });
    if (cards.length < 3) { return; }
    var nav = el('nav', 'hub-sections');
    var at = -1;
    var wanted = decodeURIComponent(location.hash.slice(1));
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', 'Parts of this page');
    var chips = cards.map(function (card, i) {
      var label = card.dataset.nav || card.querySelector('h2').textContent;
      var key = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      var chip = el('button', 'hub-section');
      chip.type = 'button';
      chip.id = 'part-' + key;
      chip.dataset.part = key;
      chip.setAttribute('role', 'tab');
      chip.appendChild(el('span', 'hub-section-name', label));
      card.dataset.part = key;
      card.setAttribute('role', 'tabpanel');
      card.setAttribute('aria-labelledby', chip.id);
      chip.addEventListener('click', function () { open(i, true); });
      nav.appendChild(chip);
      return chip;
    });
    function open(i, byHand) {
      if (i < 0 || !cards[i]) { return; }
      at = i;
      cards.forEach(function (card, n) { card.classList.toggle('hub-part-off', n !== i); });
      chips.forEach(function (chip, n) {
        chip.setAttribute('aria-selected', String(n === i));
        chip.tabIndex = n === i ? 0 : -1;
        if (n === i) { chip.setAttribute('aria-current', 'true'); } else { chip.removeAttribute('aria-current'); }
      });
      // Keep the lit tab in view inside the strip, without moving the page.
      var c = chips[i];
      if (nav.scrollWidth > nav.clientWidth) { nav.scrollLeft = c.offsetLeft - (nav.clientWidth - c.offsetWidth) / 2; }
      if (byHand) {
        wanted = '';
        history.replaceState(history.state, '', location.pathname + location.search + '#' + c.dataset.part);
        // A new part starts at its top.
        var top = host.getBoundingClientRect().top + window.scrollY - 150;
        if (window.scrollY > top) { window.scrollTo(0, Math.max(0, top)); }
      }
    }
    function find(key) { return chips.findIndex(function (chip, n) { return chip.dataset.part === key && !cards[n].hidden; }); }
    function sync() {
      cards.forEach(function (card, i) {
        var chip = chips[i];
        var n = card.dataset.badge;
        var badge = chip.querySelector('.hub-badge');
        chip.hidden = card.hidden;
        if (n && n !== '0') {
          if (!badge) { badge = el('span', 'hub-badge'); chip.appendChild(badge); }
          if (badge.textContent !== n) { badge.textContent = n; }
        } else if (badge) { badge.remove(); }
      });
      // The part named in the address, as soon as the page shows it; otherwise the first part on show.
      var i = wanted ? find(wanted) : -1;
      if (i !== -1) { wanted = ''; open(i, false); return; }
      if (at === -1 || cards[at].hidden) { open(cards.findIndex(function (card) { return !card.hidden; }), false); }
    }
    var waiting = false;
    function soon() {
      if (waiting) { return; }
      waiting = true;
      requestAnimationFrame(function () { waiting = false; sync(); });
    }
    // Left and right arrows move along the tabs, as in any tab row.
    nav.addEventListener('keydown', function (ev) {
      if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') { return; }
      var step = ev.key === 'ArrowRight' ? 1 : -1;
      var n = at;
      do { n = (n + step + chips.length) % chips.length; } while (cards[n].hidden && n !== at);
      ev.preventDefault();
      open(n, true);
      chips[n].focus();
    });
    window.addEventListener('hashchange', function () {
      var i = find(decodeURIComponent(location.hash.slice(1)));
      if (i !== -1 && i !== at) { open(i, false); }
    });
    host.parentNode.insertBefore(nav, host);
    nav.hidden = host.hidden;
    new MutationObserver(function () { nav.hidden = host.hidden; soon(); })
      .observe(host, { attributes: true, attributeFilter: ['hidden', 'data-badge'], subtree: true });
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

  // ---- tile icons: a picture chosen from the site's own set (kit/v1/icons/tiles, Lucide, ISC licence),
  // or one or two letters. The database keeps one short text: "i-fan" for the picture "fan", anything
  // else is shown as the letters it is. Only names in this list become a picture; the picture itself is
  // a file of the site, drawn in the tile's colour. Nothing is loaded from elsewhere.
  var ICONS = [
    ['chart', 'Chart'], ['trend', 'Trend'], ['pie', 'Pie chart'], ['gauge', 'Gauge'],
    ['table', 'Table'], ['sheet', 'Sheet'], ['calc', 'Calculator'], ['money', 'Money'],
    ['coins', 'Coins'], ['wallet', 'Wallet'], ['bill', 'Bill'], ['cart', 'Cart'],
    ['box', 'Parcel'], ['boxes', 'Stock'], ['truck', 'Truck'], ['ship', 'Ship'],
    ['plane', 'Plane'], ['store', 'Shop'], ['tools', 'Wrench'], ['hammer', 'Hammer'],
    ['gear', 'Gear'], ['cog', 'Cog'], ['fact', 'Factory'], ['build', 'Building'],
    ['fan', 'Fan'], ['snow', 'Cooling'], ['flame', 'Heating'], ['temp', 'Temperature'],
    ['wind', 'Air'], ['drop', 'Water'], ['bolt', 'Power'], ['plug', 'Plug'],
    ['ruler', 'Ruler'], ['draft', 'Drawing'], ['layers', 'Layers'], ['puzzle', 'Part'],
    ['users', 'People'], ['user', 'Person'], ['shake', 'Deal'], ['case', 'Briefcase'],
    ['badge', 'Badge'], ['cap', 'Training'], ['mail', 'Mail'], ['phone', 'Phone'],
    ['chat', 'Chat'], ['horn', 'Announce'], ['bell', 'Bell'], ['globe', 'World'],
    ['doc', 'Document'], ['folder', 'Folder'], ['book', 'Book'], ['clip', 'Checklist'],
    ['check', 'Done'], ['list', 'Tasks'], ['cal', 'Calendar'], ['clock', 'Clock'],
    ['timer', 'Timer'], ['map', 'Map'], ['pin', 'Place'], ['home', 'Home'],
    ['search', 'Search'], ['filter', 'Filter'], ['link', 'Link'], ['db', 'Database'],
    ['server', 'Server'], ['cloud', 'Cloud'], ['code', 'Code'], ['cpu', 'Chip'],
    ['screen', 'Screen'], ['print', 'Printer'], ['camera', 'Camera'], ['image', 'Picture'],
    ['pen', 'Pencil'], ['brush', 'Brush'], ['bulb', 'Idea'], ['target', 'Target'],
    ['trophy', 'Trophy'], ['rocket', 'Rocket'], ['star', 'Star'], ['heart', 'Heart'],
    ['flag', 'Flag'], ['tag', 'Tag'], ['key', 'Key'], ['lock', 'Lock'],
    ['shield', 'Safe'], ['alert', 'Warning'], ['help', 'Help'], ['leaf', 'Leaf'],
    ['sun', 'Sun'], ['scale', 'Scale']
  ];
  var ICON_LABEL = {};
  ICONS.forEach(function (i) { ICON_LABEL[i[0]] = i[1]; });

  function iconName(value) {
    var m = /^i-([a-z]{2,6})$/.exec(value || '');
    return m && ICON_LABEL[m[1]] ? m[1] : '';
  }

  // Puts a tile's icon into node: the picture, or the letters, or the fallback letter.
  function icon(node, value, fallback) {
    var name = iconName(value);
    if (name) {
      var pic = el('span', 'hub-ic hub-ic-' + name);
      pic.setAttribute('aria-hidden', 'true');
      node.appendChild(pic);
    } else if (value || fallback) {
      node.appendChild(document.createTextNode(value || fallback));
    }
    return node;
  }

  // A heading that starts with the icon: "[fan] Tracker".
  function titled(node, value, text) {
    clear(node);
    icon(node, value, '');
    node.appendChild(document.createTextNode((value ? ' ' : '') + text));
    return node;
  }

  // The icon chooser: a box of pictures under a short text field for letters. One of the two holds:
  // pressing a picture empties the letters, typing letters lets the picture go.
  // Returns { node, get(), set(value) }; put node on the page after the field.
  function iconPicker(input) {
    var box = el('div', 'hub-icons');
    var chosen = '';
    var buttons = {};
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Pictures for the tile');
    function show() {
      ICONS.forEach(function (i) { buttons[i[0]].setAttribute('aria-pressed', String(i[0] === chosen)); });
      input.placeholder = chosen ? 'Picture chosen: ' + ICON_LABEL[chosen] : 'No picture: type letters, or leave empty';
    }
    ICONS.forEach(function (i) {
      var b = el('button', 'hub-icon-pick');
      b.type = 'button';
      b.title = i[1];
      b.setAttribute('aria-label', i[1]);
      b.setAttribute('data-icon', i[0]);
      icon(b, 'i-' + i[0], '');
      b.addEventListener('click', function () {
        chosen = chosen === i[0] ? '' : i[0];
        if (chosen) { input.value = ''; }
        show();
      });
      buttons[i[0]] = b;
      box.appendChild(b);
    });
    input.addEventListener('input', function () { if (input.value && chosen) { chosen = ''; show(); } });
    function set(value) {
      chosen = iconName(value);
      input.value = chosen ? '' : (value || '');
      show();
    }
    show();
    return { node: box, get: function () { return chosen ? 'i-' + chosen : input.value; }, set: set };
  }

  // ---- going back. A "Back to ..." button names the page above this one. When that page is also the
  // page the person just came from, the button steps back in the browser's own history instead of
  // opening the page a second time: the tab he was on is kept, and the browser's Back button does not
  // bounce him forward again. Where the trail does not know, the button is a plain link, as before.
  // The browser does not reliably tell a page which page came before it, so the site keeps its own
  // short trail for this browser tab: the addresses of its pages, in the order of the tab's history.
  // Each history step carries its place in the trail. Only addresses are kept, never data or a key.
  var trail = { at: -1, list: [] };
  (function () {
    try {
      var saved = JSON.parse(sessionStorage.getItem('dame.trail') || 'null');
      if (saved && Array.isArray(saved.list) && typeof saved.at === 'number') { trail = saved; }
      var st = history.state;
      var n = st && typeof st.dameN === 'number' && st.dameN <= trail.list.length ? st.dameN : -1;
      if (n < 0) {
        // A new step: it follows the step the tab was on, and what lay ahead of that is gone.
        n = trail.at + 1;
        trail.list = trail.list.slice(0, n);
        history.replaceState({ dameN: n }, '', location.href);
      }
      trail.list[n] = location.pathname + location.search;
      trail.at = n;
      sessionStorage.setItem('dame.trail', JSON.stringify(trail));
    } catch (err) { trail = { at: -1, list: [] }; }
  })();

  function before() {
    try {
      if (trail.at < 1 || history.length < 2 || !trail.list[trail.at - 1]) { return null; }
      return new URL(trail.list[trail.at - 1], location.origin);
    } catch (err) { return null; }
  }

  // True when the page the person came from is this page of the site (for example 'admin/it.html').
  function cameFrom(page) {
    var b = before();
    return !!b && b.origin === location.origin && b.pathname === new URL(api.href(page), location.href).pathname;
  }

  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a.hub-back') : null;
    if (!a || ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) { return; }
    var b = before();
    var to = new URL(a.href, location.href);
    if (b && b.origin === to.origin && b.pathname === to.pathname && b.search === to.search) {
      ev.preventDefault();
      history.back();
    }
  });

  // A page the browser kept in memory and shows again on Back is read again from the database:
  // it must show what is true now, and nothing at all to a person who has signed out since.
  window.addEventListener('pageshow', function (ev) { if (ev.persisted) { location.reload(); } });

  window.DameShell = Object.freeze({
    el: el, clear: clear, say: say, sayError: sayError, guard: guard,
    showUser: showUser, confirmButton: confirmButton, when: when,
    param: param, runner: runner, addRow: addRow, picker: picker, people: people,
    typedDelete: typedDelete, audit: audit, info: info, openInfo: openInfo, rich: rich, toolGuide: toolGuide,
    icon: icon, titled: titled, iconPicker: iconPicker, cameFrom: cameFrom,
    dialog: dialog, tile: tile, textField: textField, fact: fact, slug: slug
  });
})();
