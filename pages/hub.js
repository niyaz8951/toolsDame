/*
 * pages/hub.js - fills the hub: the caller's work and the chain (Relay), his
 * shortcuts, and his spaces.
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
    return ui.tile({
      href: api.href('space.html') + '?space=' + encodeURIComponent(space.id),
      name: space.name, icon: space.icon, letter: (space.name.trim().charAt(0) || 'S').toUpperCase(), colour: space.colour,
      text: space.description || null,
      pills: [space.is_admin && 'You are admin', !space.active && 'Switched off']
    });
  }

  function hoursText(h) {
    h = Math.abs(h);
    if (h < 1) { return Math.max(1, Math.round(h * 60)) + ' min'; }
    if (h < 48) { return Math.round(h) + ' h'; }
    return Math.round(h / 24) + ' days';
  }

  // One item of Relay as a card that opens it.
  function workCard(c) {
    var a = ui.el('a', 'relay-card' + (c.priority === 'urgent' ? ' relay-urgent' : '') + (c.late ? ' relay-late' : ''));
    a.href = api.href('relay.html') + '?item=' + encodeURIComponent(c.id);
    var top = ui.el('span', 'relay-card-top');
    top.appendChild(ui.el('span', 'relay-ref', c.ref));
    if (c.priority === 'urgent') { top.appendChild(ui.el('span', 'relay-pill relay-pill-urgent', 'Urgent')); }
    if (c.blocked) { top.appendChild(ui.el('span', 'relay-pill relay-pill-blocked', 'Blocked')); }
    else if (c.late) { top.appendChild(ui.el('span', 'relay-pill relay-pill-late', 'Late')); }
    a.appendChild(top);
    a.appendChild(ui.el('span', 'relay-card-title', c.title));
    a.appendChild(ui.el('span', 'relay-card-where', c.stage + ' (' + c.space_name + ')'));
    var h = (new Date(c.due).getTime() - Date.now()) / 3600000;
    a.appendChild(ui.el('span', 'relay-card-text', (c.mine ? 'With you' : (c.picked_by ? 'With ' + c.picked_by : 'Waiting to be picked up')) + ', ' + (c.late ? 'late by ' : 'due in ') + hoursText(h)));
    if (c.last_move === 'missing') { a.appendChild(ui.el('span', 'relay-move relay-move-missing', 'Sent back: something is missing')); }
    if (c.last_move === 'answer') { a.appendChild(ui.el('span', 'relay-move relay-move-answer', 'The answer came back')); }
    return a;
  }

  // One flow as its chain of teams; each team opens the flow's board.
  function chain(f) {
    var box = ui.el('div', 'hub-chain');
    box.setAttribute('data-flow', f.id);
    box.appendChild(ui.el('h3', null, f.name));
    var ol = ui.el('ol', 'relay-chain');
    var counts = {};
    (f.counts || []).forEach(function (c) { counts[c.pos] = c; });
    var n = f.stages.length;
    f.stages.forEach(function (s, i) {
      var c = counts[s.pos] || {};
      var li = ui.el('li', 'relay-step' + (s.optional ? ' relay-step-optional' : '') + (s.team_ok ? '' : ' relay-step-broken'));
      li.style.setProperty('--relay-hue', String(Math.round(48 - (i / Math.max(1, n - 1)) * 48)));
      var a = ui.el('a', 'relay-step-link');
      a.href = api.href('relay.html') + '?flow=' + encodeURIComponent(f.id) + '#flows';
      a.appendChild(ui.el('span', 'relay-step-name', s.space_name));
      a.appendChild(ui.el('span', 'relay-step-team', s.name + (s.optional ? ', if needed' : '')));
      // Numbers only of the person's own teams; of the others the name, and whether they are full.
      if (counts[s.pos]) {
        a.appendChild(ui.el('span', 'relay-step-count', String(c.open || 0)));
        a.appendChild(ui.el('span', 'relay-step-facts', (Number(c.open) === 1 ? 'item' : 'items') + (Number(c.late) ? ', ' + c.late + ' late' : '') + (Number(c.blocked) ? ', ' + c.blocked + ' blocked' : '')));
      }
      if (s.full) { a.appendChild(ui.el('span', 'relay-step-facts relay-step-back', 'Full')); }
      li.appendChild(a);
      ol.appendChild(li);
    });
    box.appendChild(ol);
    return box;
  }

  function shortcut(t) {
    var a = ui.el('a', 'hub-short');
    a.href = api.href('tool.html') + '?space=' + encodeURIComponent(t.space) + '&tool=' + encodeURIComponent(t.id);
    if (/^#[0-9a-f]{6}$/.test(t.colour || '')) { a.style.setProperty('--dame-accent', t.colour); }
    a.appendChild(ui.icon(ui.el('span', 'hub-short-icon'), t.icon, (t.name.trim().charAt(0) || 'T').toUpperCase()));
    var text = ui.el('span', 'hub-short-text');
    text.appendChild(ui.el('strong', null, t.name));
    text.appendChild(ui.el('span', null, t.space_name));
    a.appendChild(text);
    return a;
  }

  async function start() {
    // All asked at the same moment as the sign-in check, so the page waits once.
    var asked = api.rpc('dame_spaces_list');
    asked.catch(function () {});
    var relay = api.rpc('dame_relay_home');
    relay.catch(function () {});
    var shorts = api.rpc('dame_shortcuts_list');
    shorts.catch(function () {});
    var me = await ui.guard();
    $('hello').textContent = 'Hello, ' + me.name;
    $('it-card').hidden = !me.is_it;
    $('main').hidden = false;

    var spaces = await asked;
    var box = ui.clear($('spaces'));
    (spaces || []).forEach(function (s) { box.appendChild(tile(s)); });
    $('empty').hidden = (spaces || []).length > 0;

    // My work and the chain. The rest of the hub works without them.
    relay.then(function (r) {
      var flows = (r && r.flows) || [];
      if (!flows.length) { return; }
      var inbox = (r.inbox || []).slice().sort(function (x, y) { return (y.mine ? 1 : 0) - (x.mine ? 1 : 0); });
      // Flags raised in teams he leads come first: someone is waiting for help.
      var flags = (r.flags || []).filter(function (f) { return !inbox.some(function (c) { return c.id === f.id; }); });
      inbox = flags.concat(inbox);
      var work = ui.clear($('work'));
      inbox.slice(0, 6).forEach(function (c) { work.appendChild(workCard(c)); });
      $('work-empty').hidden = inbox.length > 0;
      $('work-all').textContent = inbox.length > 6 ? 'See all ' + inbox.length + ' in Relay' : 'Open Relay';
      $('work-part').hidden = false;
      var parts = [];
      if (Number(r.working)) { parts.push(r.working + (Number(r.working) === 1 ? ' item is' : ' items are') + ' with you'); }
      if (Number(r.waiting)) { parts.push(r.waiting + (Number(r.waiting) === 1 ? ' waits' : ' wait') + ' for your teams'); }
      if (flags.length) { parts.push(flags.length + ' blocked in your teams'); }
      $('summary').textContent = parts.length ? parts.join(', ') + '.' : 'Nothing waits for you right now.';
      var chains = ui.clear($('chains'));
      flows.filter(function (f) { return f.active; }).forEach(function (f) { chains.appendChild(chain(f)); });
      $('chain-part').hidden = !chains.firstChild;
    }).catch(function () { /* the hub without Relay */ });

    shorts.then(function (list) {
      var sb = ui.clear($('shorts'));
      (list || []).forEach(function (t) { sb.appendChild(shortcut(t)); });
      $('shorts-empty').hidden = (list || []).length > 0;
    }).catch(function () { $('short-part').hidden = true; });

    // The site book is shown to IT admins only: its card, and its chapters as shortcuts.
    // The hub works without them.
    if (!me.is_it) { return; }
    $('book-card').hidden = false;
    fetch(api.href('book/index.json'), { cache: 'no-cache', credentials: 'omit' }).then(function (res) { return res.ok ? res.json() : null; }).then(function (index) {
      var chips = ui.clear($('book-chapters'));
      ((index && index.chapters) || []).filter(function (c) { return !c.part; }).forEach(function (c, i) {
        var a = ui.el('a', 'hub-chip', (i + 1) + '. ' + c.title);
        a.href = api.href('book.html') + '#' + String(c.file).replace(/\.md$/, '');
        chips.appendChild(a);
      });
    }).catch(function () { /* no shortcuts */ });
  }

  start().catch(function (err) {
    $('main').hidden = false;
    ui.sayError($('msg'), err);
  });
})();
