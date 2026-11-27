/*
 * pages/relay.js - Relay: the caller's work, the flows as chains of teams, one
 * item in its window, and for IT the setting up of flows.
 * Serves: contracts 1 (Identity), 2 (Structure), 3 (Access), 7 (Audit).
 * Must not change: everything from the database is written with textContent;
 * each button calls one dame_relay_* function and then reads again what the
 * database holds, so the page never shows what it only assumes. Who may pick
 * up, pass on, answer, send back, close or cancel is decided by the database;
 * the page only leaves out the buttons it would refuse. The examples of flows
 * are text in this file: they fill the setup window, nothing more.
 */
(function () {
  'use strict';

  var api = window.DameApi;
  var ui = window.DameShell;
  if (!ui) { return; }

  var home = null;       // what dame_relay_home gave
  var flowId = '';       // the flow on the board
  var board = null;      // what dame_relay_board gave for it
  var spaces = [];       // IT only: every space, for the stage teams
  var flowsAll = [];     // IT only: every flow
  var me = null;         // who is signed in (dame_me)
  var iwin = null;       // the open item window, or null
  var fwin = null;       // the open flow setup window, or null

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { return ui.el(tag, cls, text); }

  // ---------------------------------------------------------------- words

  function hoursText(h) {
    h = Math.abs(h);
    if (h < 1) { return Math.max(1, Math.round(h * 60)) + ' min'; }
    if (h < 48) { return Math.round(h) + ' h'; }
    return Math.round(h / 24) + ' days';
  }

  // "due in 5 h" or "late by 2 days", from the card's due time.
  function dueText(card) {
    var h = (new Date(card.due).getTime() - Date.now()) / 3600000;
    return card.late ? 'late by ' + hoursText(h) : 'due in ' + hoursText(h);
  }

  function dateText(iso) {
    var d = new Date(String(iso) + 'T00:00:00');
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  var MOVE = { missing: 'Sent back: something is missing', answer: 'The answer came back' };

  function story(e) {
    var to = e.to ? ' to ' + e.to : '';
    switch (e.kind) {
      case 'started': return 'started it';
      case 'picked': return 'picked it up';
      case 'released': return 'put it back for the team';
      case 'taken_over': return 'took it over';
      case 'passed': return 'passed it on' + to;
      case 'answered': return 'answered back' + to;
      case 'sent_back': return 'sent it back' + to + ': something is missing';
      case 'closed': return 'closed it';
      case 'cancelled': return 'cancelled it';
      case 'note': return 'wrote a note';
      default: return e.kind;
    }
  }

  // ---------------------------------------------------------------- windows

  // A window over the page, the same as the admin pages use. Escape or a press outside closes it.
  function makeWindow(id, label, onClose) {
    var back = el('div', 'hub-focus-back');
    var box = el('section', 'hub-focus relay-win');
    box.id = id;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', label);
    var body = el('div');
    var msg = el('p', 'hub-msg');
    msg.id = id + '-msg';
    msg.hidden = true;
    msg.setAttribute('role', 'alert');
    var foot = el('div', 'dame-row hub-focus-foot');
    var close = el('button', 'dame-btn', 'Close');
    close.type = 'button';
    close.id = id + '-close';
    foot.appendChild(close);
    box.appendChild(body);
    box.appendChild(msg);
    box.appendChild(foot);
    back.appendChild(box);
    var w = { back: back, box: box, body: body, msg: msg, foot: foot, close: close };
    w.onKey = function (ev) { if (ev.key === 'Escape') { onClose(); } };
    close.addEventListener('click', onClose);
    back.addEventListener('mousedown', function (ev) { if (ev.target === back) { onClose(); } });
    document.addEventListener('keydown', w.onKey);
    document.body.appendChild(back);
    return w;
  }

  function dropWindow(w) {
    if (!w) { return; }
    w.back.remove();
    document.removeEventListener('keydown', w.onKey);
  }

  function setAddress(key, value) {
    var q = new URLSearchParams(location.search);
    if (value) { q.set(key, value); } else { q.delete(key); }
    var s = q.toString();
    history.replaceState(history.state, '', location.pathname + (s ? '?' + s : '') + location.hash);
  }

  // ---------------------------------------------------------------- cards

  function card(c, showFlow) {
    var b = el('button', 'relay-card' + (c.priority === 'urgent' ? ' relay-urgent' : '') + (c.late ? ' relay-late' : ''));
    b.type = 'button';
    b.setAttribute('data-item', String(c.id));
    var top = el('span', 'relay-card-top');
    top.appendChild(el('span', 'relay-ref', c.ref));
    if (c.priority === 'urgent') { top.appendChild(el('span', 'relay-pill relay-pill-urgent', 'Urgent')); }
    if (c.status === 'closed') { top.appendChild(el('span', 'relay-pill relay-pill-ok', 'Closed')); }
    else if (c.status === 'cancelled') { top.appendChild(el('span', 'relay-pill', 'Cancelled')); }
    else if (c.late) { top.appendChild(el('span', 'relay-pill relay-pill-late', 'Late')); }
    b.appendChild(top);
    b.appendChild(el('span', 'relay-card-title', c.title));
    if (c.project) { b.appendChild(el('span', 'relay-card-text', c.project)); }
    if (c.status === 'waiting' || c.status === 'working') {
      // On the board the column already names the stage.
      if (showFlow !== 'board') { b.appendChild(el('span', 'relay-card-where', (showFlow ? c.flow_name + ': ' : '') + c.stage + ' (' + c.space_name + ')')); }
      var who = c.status === 'working' ? (c.mine ? 'With you' : 'With ' + c.picked_by) : 'Waiting to be picked up';
      b.appendChild(el('span', 'relay-card-text', who + ', ' + dueText(c)));
      if (MOVE[c.last_move]) { b.appendChild(el('span', 'relay-move relay-move-' + c.last_move, MOVE[c.last_move])); }
    } else if (c.closed_at) {
      b.appendChild(el('span', 'relay-card-text', (c.status === 'closed' ? 'Closed ' : 'Cancelled ') + ui.when(c.closed_at)));
    }
    b.addEventListener('click', function () { openItem(c.id); });
    return b;
  }

  function fill(box, list, showFlow) {
    ui.clear(box);
    list.forEach(function (c) { box.appendChild(card(c, showFlow)); });
    return list.length;
  }

  // ---------------------------------------------------------------- my work

  function drawWork() {
    var inbox = home.inbox || [];
    var mine = inbox.filter(function (c) { return c.mine; });
    var waiting = inbox.filter(function (c) { return !c.mine && c.status === 'waiting'; });
    var nMine = fill($('mine'), mine, true);
    var nWait = fill($('waiting'), waiting, true);
    var nStart = fill($('started'), home.started || [], true);
    $('g-mine').hidden = !nMine;
    $('g-waiting').hidden = !nWait;
    $('g-started').hidden = !nStart;
    $('no-flows').hidden = (home.flows || []).length > 0;
    $('work-empty').hidden = !!(nMine + nWait + nStart) || !(home.flows || []).length;
    $('work-card').dataset.badge = String(nMine + nWait);
  }

  // ---------------------------------------------------------------- the board

  function drawChips() {
    var box = ui.clear($('flow-chips'));
    var flows = home.flows || [];
    flows.forEach(function (f) {
      var b = el('button', 'relay-chip', f.name);
      b.type = 'button';
      b.setAttribute('data-flow', f.id);
      b.setAttribute('aria-pressed', String(f.id === flowId));
      if (Number(f.open)) { b.appendChild(el('span', 'relay-chip-n', String(f.open))); }
      if (!f.active) { b.appendChild(el('span', 'relay-chip-off', 'off')); }
      b.addEventListener('click', function () { chooseFlow(f.id); });
      box.appendChild(b);
    });
    $('flows-empty').hidden = flows.length > 0;
  }

  async function chooseFlow(id) {
    flowId = id;
    setAddress('flow', id);
    drawChips();
    await loadBoard();
  }

  async function loadBoard() {
    if (!flowId) { $('board').hidden = true; return; }
    try {
      board = await api.rpc('dame_relay_board', { p_flow: flowId });
    } catch (err) {
      board = null;
      $('board').hidden = true;
      ui.sayError($('msg'), err);
      return;
    }
    drawBoard();
  }

  function figure(box, value, label) {
    var f = el('div', 'dame-stat');
    f.appendChild(el('b', null, value));
    f.appendChild(el('span', null, label));
    box.appendChild(f);
  }

  function drawBoard() {
    var b = board;
    var f = b.flow;
    $('board').hidden = false;
    $('b-name').textContent = f.name + (f.active ? '' : ' (switched off: nothing new starts)');
    $('b-text').textContent = f.description || ('A ' + f.word + ' moves along these teams, from left to right.');
    var start = $('b-start');
    start.hidden = !f.can_start;
    start.textContent = 'Start a new ' + f.word;

    var figs = ui.clear($('b-figures'));
    var late = b.stats.reduce(function (n, s) { return n + Number(s.late || 0); }, 0);
    figure(figs, String(b.open.length), 'open now');
    figure(figs, String(late), 'late now');
    figure(figs, String(b.closed_30 || 0), 'closed in 30 days');
    figure(figs, b.avg_days === null || b.avg_days === undefined ? '-' : hoursText(Number(b.avg_days) * 24), 'start to close, usually');

    var chain = ui.clear($('b-chain'));
    var cols = ui.clear($('b-columns'));
    var stats = {};
    b.stats.forEach(function (s) { stats[s.pos] = s; });
    var n = b.stages.length;
    b.stages.forEach(function (s, i) {
      var st = stats[s.pos] || {};
      var li = el('li', 'relay-step' + (s.optional ? ' relay-step-optional' : '') + (s.team_ok ? '' : ' relay-step-broken'));
      li.style.setProperty('--relay-hue', String(Math.round(48 - (i / Math.max(1, n - 1)) * 48)));
      li.appendChild(el('span', 'relay-step-no', String(s.pos)));
      li.appendChild(el('span', 'relay-step-name', s.name));
      li.appendChild(el('span', 'relay-step-team', s.space_name + (s.optional ? ', if needed' : '')));
      var facts = el('span', 'relay-step-facts');
      facts.appendChild(el('span', null, (st.open || 0) + ' open' + (Number(st.late) ? ', ' + st.late + ' late' : '')));
      facts.appendChild(el('span', null, st.avg_hours === null || st.avg_hours === undefined ? 'target ' + hoursText(s.hours) : 'usually ' + hoursText(Number(st.avg_hours)) + ' (target ' + hoursText(s.hours) + ')'));
      if (Number(st.sent_back)) { facts.appendChild(el('span', 'relay-step-back', 'sent back ' + st.sent_back + 'x in 90 days')); }
      if (!s.team_ok) { facts.appendChild(el('span', 'relay-step-back', s.team_gone ? 'its team was deleted: ask IT' : 'its team is switched off')); }
      li.appendChild(facts);
      chain.appendChild(li);

      var col = el('div', 'relay-col');
      col.setAttribute('data-stage', String(s.pos));
      col.appendChild(el('h4', null, s.pos + '. ' + s.name));
      var here = b.open.filter(function (c) { return c.pos === s.pos; });
      if (here.length) { here.forEach(function (c) { col.appendChild(card(c, 'board')); }); }
      else { col.classList.add('relay-col-none'); col.appendChild(el('p', 'relay-col-empty', 'Nothing here')); }
      cols.appendChild(col);
    });
    cols.style.setProperty('--relay-cols', String(n));
    var done = fill($('b-done'), b.done || [], false);
    $('b-done-box').hidden = !done;
  }

  // ---------------------------------------------------------------- starting

  function openStart() {
    var f = board && board.flow;
    if (!f) { return; }
    if (iwin) { closeItem(); }
    var w = makeWindow('start-win', 'Start a new ' + f.word, function () { dropWindow(w); iwin = null; });
    iwin = w;
    w.box.classList.add('hub-focus-small');
    var form = el('form');
    form.id = 'start-form';
    form.method = 'post';
    form.noValidate = true;
    form.appendChild(el('h2', null, 'Start a new ' + f.word));
    form.appendChild(el('p', 'dame-muted', 'It starts with you, at the first stage: ' + board.stages[0].name + '. You tick its checklist and pass it on to ' + board.stages[1].name + '.'));
    function field(label, input) {
      var l = el('label', 'hub-field', label);
      l.appendChild(input);
      form.appendChild(l);
      return input;
    }
    var title = field('Title (what is asked, in a few words)', el('input', 'dame-input'));
    title.id = 'st-title'; title.type = 'text'; title.maxLength = 120; title.autocomplete = 'off';
    title.placeholder = 'For example: AHU with 50 mm double skin';
    var project = field('Project or customer (optional)', el('input', 'dame-input'));
    project.id = 'st-project'; project.type = 'text'; project.maxLength = 120; project.autocomplete = 'off';
    var details = field('Details (optional)', el('textarea', 'dame-input'));
    details.id = 'st-details'; details.rows = 5; details.maxLength = 4000;
    details.placeholder = 'What the customer or the specification asks for. No prices or personal data beyond what the work needs.';
    var two = el('div', 'hub-two');
    form.appendChild(two);
    var lp = el('label', 'hub-field', 'Priority');
    var prio = el('select', 'dame-input');
    prio.id = 'st-priority';
    [['normal', 'Normal'], ['urgent', 'Urgent']].forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; prio.appendChild(op); });
    lp.appendChild(prio);
    two.appendChild(lp);
    var ln = el('label', 'hub-field', 'Needed by (optional)');
    var need = el('input', 'dame-input');
    need.id = 'st-needed'; need.type = 'date';
    ln.appendChild(need);
    two.appendChild(ln);
    var go = el('button', 'dame-btn dame-btn-primary', 'Start it');
    go.type = 'submit';
    go.id = 'st-go';
    w.foot.insertBefore(go, w.close);
    w.close.textContent = 'Cancel';
    go.setAttribute('form', 'start-form');
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      ui.say(w.msg, '');
      if (title.value.trim().length < 3) { ui.say(w.msg, 'Give it a title of at least 3 characters.', 'warn'); title.focus(); return; }
      go.disabled = true;
      try {
        var got = await api.rpc('dame_relay_start', { p_flow: f.id, p_title: title.value, p_project: project.value,
          p_details: details.value, p_priority: prio.value, p_needed_by: need.value || null });
        dropWindow(w);
        iwin = null;
        await load();
        await openItem(got.id, got.ref + ' is started. Tick the checklist, then pass it on.');
      } catch (err) {
        go.disabled = false;
        ui.sayError(w.msg, err);
      }
    });
    w.body.appendChild(form);
    title.focus();
  }

  // ---------------------------------------------------------------- one item

  function closeItem() {
    if (!iwin) { return; }
    var id = iwin.item;
    dropWindow(iwin);
    iwin = null;
    setAddress('item', '');
    var c = document.querySelector('.relay-card[data-item="' + id + '"]');
    if (c) { c.focus(); }
  }

  async function openItem(id, said) {
    if (iwin) { dropWindow(iwin); iwin = null; }
    var w = makeWindow('item-win', 'Item', closeItem);
    iwin = w;
    w.item = id;
    setAddress('item', String(id));
    w.body.appendChild(el('p', 'dame-muted', 'One moment.'));
    await showItem(w, said);
    w.close.focus();
  }

  async function showItem(w, said, kind) {
    var it;
    try {
      it = await api.rpc('dame_relay_item', { p_item: w.item });
    } catch (err) {
      if (iwin !== w) { return; }
      ui.clear(w.body);
      ui.sayError(w.msg, err);
      return;
    }
    if (iwin !== w) { return; }
    drawItem(w, it);
    if (said) { ui.say(w.msg, said, kind || 'ok'); } else { ui.say(w.msg, ''); }
  }

  // Runs one action on the open item, reads it again and the lists behind it.
  async function act(w, name, args, done) {
    ui.say(w.msg, '');
    Array.prototype.forEach.call(w.body.querySelectorAll('button'), function (b) { b.disabled = true; });
    try {
      var got = await api.rpc(name, args);
      await load();
      if (iwin === w) { await showItem(w, typeof done === 'function' ? done(got) : done); }
    } catch (err) {
      if (iwin === w) { await showItem(w); ui.sayError(w.msg, err); }
    }
    if (iwin === w) { w.msg.scrollIntoView({ block: 'nearest' }); }
  }

  function fact(list, label, value) {
    if (!value) { return; }
    var li = el('li');
    li.appendChild(el('span', 'relay-fact-label', label));
    li.appendChild(el('span', null, value));
    list.appendChild(li);
  }

  // The stages as a small chain: done, here, still to come.
  function miniChain(it) {
    var ol = el('ol', 'relay-mini');
    ol.setAttribute('aria-label', 'Where it is');
    var seen = {};
    it.path.forEach(function (p) { seen[p] = true; });
    it.stages.forEach(function (s) {
      var here = it.status !== 'closed' && it.status !== 'cancelled' && s.pos === it.pos;
      var li = el('li', here ? 'relay-mini-here' : (seen[s.pos] ? 'relay-mini-done' : (s.optional ? 'relay-mini-optional' : '')));
      li.appendChild(el('span', 'relay-mini-dot', String(s.pos)));
      li.appendChild(el('span', 'relay-mini-name', s.name));
      if (here) { li.setAttribute('aria-current', 'step'); }
      ol.appendChild(li);
    });
    return ol;
  }

  // A step that asks for words first: a text box, then the button that acts. One step at a time.
  function wordsStep(w, box, title, hint, button, cls, required, run) {
    ui.clear(box);
    box.hidden = false;
    box.appendChild(el('h4', null, title));
    if (hint) { box.appendChild(el('p', 'dame-hint', hint)); }
    var t = el('textarea', 'dame-input');
    t.rows = 3;
    t.maxLength = 2000;
    t.id = 'relay-words';
    t.setAttribute('aria-label', title);
    box.appendChild(t);
    var row = el('div', 'dame-row');
    var go = el('button', 'dame-btn ' + (cls || 'dame-btn-primary'), button);
    go.type = 'button';
    go.id = 'relay-words-go';
    var no = el('button', 'dame-btn', 'Not now');
    no.type = 'button';
    no.addEventListener('click', function () { box.hidden = true; ui.clear(box); });
    go.addEventListener('click', function () {
      if (required && t.value.trim().length < 3) { ui.say(w.msg, 'Write at least a few words first.', 'warn'); t.focus(); return; }
      run(t.value);
    });
    row.appendChild(go);
    row.appendChild(no);
    box.appendChild(row);
    t.focus();
  }

  function btn(text, cls, id, onClick) {
    var b = el('button', 'dame-btn ' + (cls || ''), text);
    b.type = 'button';
    if (id) { b.id = id; }
    b.addEventListener('click', onClick);
    return b;
  }

  function drawItem(w, it) {
    var body = ui.clear(w.body);
    var open = it.status === 'waiting' || it.status === 'working';
    w.box.setAttribute('aria-label', it.ref + ': ' + it.title);
    body.appendChild(el('p', 'relay-win-kicker', it.ref + '  |  ' + it.flow_name));
    body.appendChild(el('h2', null, it.title));
    var pills = el('p', 'relay-pills');
    if (it.priority === 'urgent') { pills.appendChild(el('span', 'relay-pill relay-pill-urgent', 'Urgent')); }
    if (it.status === 'closed') { pills.appendChild(el('span', 'relay-pill relay-pill-ok', 'Closed')); }
    if (it.status === 'cancelled') { pills.appendChild(el('span', 'relay-pill', 'Cancelled')); }
    if (open && it.late) { pills.appendChild(el('span', 'relay-pill relay-pill-late', 'Late')); }
    if (Number(it.sent_back)) { pills.appendChild(el('span', 'relay-pill', 'Sent back ' + it.sent_back + 'x')); }
    if (pills.firstChild) { body.appendChild(pills); }
    body.appendChild(miniChain(it));

    // Where it is and who has it: the one sentence that matters most.
    if (open) {
      var now = el('p', 'relay-now');
      var who = it.status === 'working' ? (it.mine ? 'You are working on it' : it.picked_by + ' is working on it') : 'Nobody has picked it up yet';
      now.appendChild(el('strong', null, 'At ' + it.stage + ' (' + it.space_name + '). '));
      now.appendChild(document.createTextNode(who + '; ' + dueText(it) + '.'));
      body.appendChild(now);
      if (MOVE[it.last_move]) { body.appendChild(el('p', 'relay-move relay-move-' + it.last_move, MOVE[it.last_move] + '. Read the last line of the history below.')); }
    }

    var facts = el('ul', 'relay-facts');
    fact(facts, 'Project or customer', it.project);
    fact(facts, 'Needed by', it.needed_by ? dateText(it.needed_by) : '');
    fact(facts, 'Started', it.started_by + ', ' + ui.when(it.started_at));
    body.appendChild(facts);
    if (it.details) { body.appendChild(el('p', 'relay-details', it.details)); }

    // ---- what the caller may do now
    var can = it.can || {};
    var holds = !!can.tick;
    var panel = el('div', 'relay-act');
    var step = el('div', 'relay-step-box');
    step.hidden = true;

    if (can.pick || can.take_over) {
      panel.appendChild(el('h3', null, 'Your team has it'));
      panel.appendChild(el('p', 'dame-muted', can.pick ? 'Pick it up so the others know you are on it. Then the checklist and the buttons to pass it on appear.'
        : it.picked_by + ' has it. As admin of the team you may take it over.'));
      panel.appendChild(can.pick
        ? btn('Pick it up', 'dame-btn-primary', 'relay-pick', function () { act(w, 'dame_relay_pick', { p_item: it.id }, 'It is yours now. Do the checklist, then pass it on.'); })
        : ui.confirmButton('Take it over', '', function () { act(w, 'dame_relay_pick', { p_item: it.id }, 'You took it over.'); }));
    }

    if (holds) {
      panel.appendChild(el('h3', null, 'Before you pass it on'));
      var checks = it.checks || [];
      var ticks = {};
      (it.ticks || []).forEach(function (n) { ticks[n] = true; });
      var nDone = 0;
      if (!checks.length) { panel.appendChild(el('p', 'dame-muted', 'This stage has no checklist.')); }
      checks.forEach(function (line, i) {
        var l = el('label', 'dame-check relay-tick');
        var box = el('input');
        box.type = 'checkbox';
        box.checked = !!ticks[i + 1];
        if (box.checked) { nDone += 1; }
        box.setAttribute('data-line', String(i + 1));
        box.addEventListener('change', async function () {
          box.disabled = true;
          try {
            await api.rpc('dame_relay_tick', { p_item: it.id, p_line: i + 1, p_done: box.checked });
            await showItem(w);
          } catch (err) {
            box.checked = !box.checked;
            box.disabled = false;
            ui.sayError(w.msg, err);
          }
        });
        l.appendChild(box);
        l.appendChild(el('span', null, line));
        panel.appendChild(l);
      });
      var ready = nDone === checks.length;
      if (checks.length) { panel.appendChild(el('p', 'dame-hint', ready ? 'All done. Saved as you tick.' : nDone + ' of ' + checks.length + ' done. Saved as you tick.')); }

      panel.appendChild(el('h3', null, 'Then'));
      var row = el('div', 'relay-buttons');
      var targets = can.pass || [];
      if (targets.length) {
        targets.forEach(function (t, i) {
          var label = (i === 0 ? 'Pass on to ' : 'Skip to ') + t.name + ' (' + t.team + ')';
          var b = btn(label, i === 0 ? 'dame-btn-primary' : '', 'relay-pass-' + t.pos, function () {
            wordsStep(w, step, label, 'A note for the next team (optional): what you did, what they should look at.', 'Pass it on', 'dame-btn-primary', false, function (text) {
              act(w, 'dame_relay_pass', { p_item: it.id, p_to: t.pos, p_note: text }, function (got) { return 'Passed on to ' + got.to + '. It is in their inbox now.'; });
            });
          });
          b.disabled = !ready || !t.team_ok;
          if (!t.team_ok) { b.title = 'The team of this stage is switched off or deleted. Ask IT.'; }
          row.appendChild(b);
        });
      }
      if (can.back && it.back_to) {
        var to = it.back_to.name + (it.back_to.person ? ' (' + it.back_to.person + ')' : ' (' + it.back_to.space_name + ')');
        row.appendChild(btn('Answer back to ' + it.back_to.name, '', 'relay-answer', function () {
          wordsStep(w, step, 'Answer back to ' + to, 'Write the answer. It goes back to the team that passed it to you, and only to them.', 'Send the answer', 'dame-btn-primary', true, function (text) {
            act(w, 'dame_relay_back', { p_item: it.id, p_kind: 'answer', p_note: text }, function (got) { return 'The answer went back to ' + got.to + (got.person ? ', to ' + got.person : '') + '.'; });
          });
        }));
        row.appendChild(btn('Something is missing', '', 'relay-missing', function () {
          wordsStep(w, step, 'Send back to ' + to, 'Say exactly what is missing, so they can fix it at once.', 'Send it back', 'dame-btn-primary', true, function (text) {
            act(w, 'dame_relay_back', { p_item: it.id, p_kind: 'missing', p_note: text }, function (got) { return 'Sent back to ' + got.to + (got.person ? ', to ' + got.person : '') + '.'; });
          });
        }));
      }
      if (can.close) {
        row.appendChild(btn('Close it', targets.length ? '' : 'dame-btn-primary', 'relay-close', function () {
          wordsStep(w, step, 'Close ' + it.ref, 'How it ended (optional), for example "Offer revised and sent".', 'Close it', 'dame-btn-primary', false, function (text) {
            act(w, 'dame_relay_close', { p_item: it.id, p_note: text }, 'Closed. It stays in the history of the flow.');
          });
        }));
      }
      if (!targets.length && !can.back && !can.close) { panel.appendChild(el('p', 'dame-muted', 'Nothing to pass on from here.')); }
      panel.appendChild(row);
      panel.appendChild(step);
      var rel = btn('Put it back for the team', 'hub-small dame-btn-quiet', 'relay-release', function () {
        act(w, 'dame_relay_release', { p_item: it.id }, 'It waits for your team again.');
      });
      panel.appendChild(el('p', 'relay-release-row')).appendChild(rel);
    } else if (open && !can.pick && !can.take_over) {
      panel.appendChild(el('p', 'dame-muted', 'It is with ' + it.space_name + '. Only that team can move it. You can follow it here and write a note.'));
    }
    if (panel.firstChild) { body.appendChild(panel); }

    // ---- the history
    body.appendChild(el('h3', null, 'History'));
    var hist = el('ol', 'relay-history');
    (it.history || []).forEach(function (e) {
      var li = el('li', 'relay-h-' + e.kind);
      var head = el('p', 'relay-h-head');
      head.appendChild(el('strong', null, e.who + (e.as_it ? ' (IT)' : '')));
      head.appendChild(document.createTextNode(' ' + story(e)));
      head.appendChild(el('span', 'relay-h-when', ui.when(e.at) + (e.held_hours !== null && e.held_hours !== undefined && e.from ? ', after ' + hoursText(Number(e.held_hours)) + ' at ' + e.from : '')));
      li.appendChild(head);
      if (e.text) { li.appendChild(el('p', 'relay-h-text', e.text)); }
      hist.appendChild(li);
    });
    body.appendChild(hist);

    // ---- a note, and cancelling
    var more = el('div', 'relay-more');
    var noteBox = el('div', 'relay-step-box');
    noteBox.hidden = true;
    more.appendChild(btn('Add a note', '', 'relay-note', function () {
      wordsStep(w, noteBox, 'A note for everyone on this ' + it.word, 'It is added to the history. It does not move the item.', 'Add the note', 'dame-btn-primary', false, function (text) {
        if (!text.trim()) { ui.say(w.msg, 'Write the note first.', 'warn'); return; }
        act(w, 'dame_relay_note', { p_item: it.id, p_text: text }, 'The note is added.');
      });
    }));
    if (can.cancel) {
      more.appendChild(btn('Cancel this ' + it.word, 'hub-danger', 'relay-cancel', function () {
        wordsStep(w, noteBox, 'Cancel ' + it.ref, 'Why is it no longer needed? Every team on it can read this.', 'Cancel it', 'hub-danger', true, function (text) {
          act(w, 'dame_relay_cancel', { p_item: it.id, p_reason: text }, 'Cancelled.');
        });
      }));
    }
    body.appendChild(more);
    body.appendChild(noteBox);
  }

  // ---------------------------------------------------------------- set up (IT)

  // Examples of flows in a company like Daikin. Each stage names the kind of team it needs;
  // the window picks the space whose name fits, and IT checks every choice before saving.
  var EXAMPLES = [
    { key: 'mto', title: 'MTO query (chiller, AHU, FCU)', id: 'mto-query', name: 'MTO query escalation', word: 'MTO query', prefix: 'MTO',
      description: 'A sales query on a made-to-order unit. Each level answers only the level that asked it; Product team and Factory only when needed.',
      stages: [
        { team: /sales/i, name: 'Raise the query', hours: 8, checks: ['Customer, project and consultant named', 'Unit type, model and quantity given', 'The special requirement and its spec clause quoted', 'Target price and needed-by date given'] },
        { team: /applic|applied/i, name: 'Technical review', hours: 24, checks: ['Selection run in the selection software', 'Standard options and accessories checked first', 'Deviations from the specification listed', 'Selection report attached or linked'] },
        { team: /hq|aes/i, name: 'Engineering support', hours: 48, checks: ['Checked against product data and earlier answers', 'Question written up for the product team or the factory'] },
        { team: /product/i, name: 'Product decision', hours: 48, optional: true, checks: ['Option approved, or an alternative proposed', 'Cost impact stated'] },
        { team: /factor/i, name: 'Factory answer', hours: 72, checks: ['Feasibility confirmed', 'Lead time confirmed', 'Price adder or cost given'] }] },
    { key: 'mts', title: 'MTS query (DX, VRV)', id: 'mts-query', name: 'MTS query escalation', word: 'MTS query', prefix: 'MTS',
      description: 'A sales query on a standard DX or VRV unit. Most are answered by Application; HQ-AES only when needed.',
      stages: [
        { team: /sales/i, name: 'Raise the query', hours: 8, checks: ['Customer and project named', 'Model, capacity and quantity given', 'The question written in full'] },
        { team: /applic|applied|dx/i, name: 'Technical answer', hours: 24, checks: ['Checked in the selection software and the data book', 'Answer or question for HQ written'] },
        { team: /hq|aes/i, name: 'Engineering support', hours: 48, checks: ['Checked against product data and earlier answers'] }] },
    { key: 'order', title: 'Order to delivery', id: 'order-delivery', name: 'Order to delivery', word: 'order', prefix: 'ORD',
      description: 'A won project, from the customer\'s purchase order to the hand-over on site.',
      stages: [
        { team: /sales/i, name: 'Order received', hours: 24, checks: ['Purchase order checked against the offer', 'Final selections and technical data attached', 'Payment terms agreed'] },
        { team: /financ/i, name: 'Credit and payment', hours: 24, checks: ['Credit limit checked', 'Advance payment or letter of credit received'] },
        { team: /product/i, name: 'Order confirmation', hours: 48, checks: ['Models and options checked against the selections', 'Order placed with the factory'] },
        { team: /factor/i, name: 'Production and shipping', hours: 720, checks: ['Production slot confirmed', 'Ex-works date confirmed', 'Shipping documents ready'] },
        { team: /service|install/i, name: 'Delivery and commissioning', hours: 240, checks: ['Delivered to site', 'Start-up and commissioning report done', 'Handed over to the customer'] }] },
    { key: 'parts', title: 'Spare parts request', id: 'spare-parts', name: 'Spare parts request', word: 'parts request', prefix: 'SPR',
      description: 'A part for a unit on site: identified, quoted, paid when needed, and dispatched.',
      stages: [
        { team: /service|sales/i, name: 'Request', hours: 8, checks: ['Unit model and serial number given', 'Part described, with a photo or the part number'] },
        { team: /spare|parts/i, name: 'Identify and quote', hours: 24, checks: ['Part number confirmed', 'Stock or factory lead time checked', 'Price quoted'] },
        { team: /financ/i, name: 'Payment', hours: 48, optional: true, checks: ['Payment or purchase order received'] },
        { team: /spare|parts/i, name: 'Dispatch', hours: 48, checks: ['Part packed and dispatched', 'Delivery note sent'] }] }
  ];

  function guessSpace(re) {
    var hit = spaces.filter(function (s) { return re.test(s.name) || re.test(s.id); })[0];
    return hit ? hit.id : '';
  }

  function drawSetup() {
    var card = $('setup-card');
    card.hidden = !home.is_it;
    if (!home.is_it) { return; }
    var ex = ui.clear($('examples'));
    EXAMPLES.forEach(function (x) {
      var b = el('button', 'relay-example');
      b.type = 'button';
      b.setAttribute('data-example', x.key);
      b.appendChild(el('strong', null, x.title));
      b.appendChild(el('span', null, x.stages.map(function (s) { return s.name; }).join(' > ')));
      b.addEventListener('click', function () { openFlow(null, x); });
      ex.appendChild(b);
    });
    var tiles = ui.clear($('flow-tiles'));
    flowsAll.forEach(function (f) {
      var t = el('button', 'hub-tile' + (f.active ? '' : ' hub-tile-off'));
      t.type = 'button';
      t.setAttribute('data-setup', f.id);
      t.appendChild(el('span', 'hub-tile-icon', f.prefix.slice(0, 3)));
      t.appendChild(el('span', 'hub-tile-name', f.name));
      t.appendChild(el('span', 'hub-tile-text', f.stages.map(function (s) { return s.space_name; }).join(' > ')));
      var pills = el('span');
      pills.appendChild(el('span', 'hub-pill', f.open + ' open, ' + f.items + ' in all'));
      if (!f.active) { pills.appendChild(el('span', 'hub-pill', 'Switched off')); }
      if (f.stages.some(function (s) { return !s.team_ok; })) { pills.appendChild(el('span', 'hub-pill relay-pill-late', 'A team is off or deleted')); }
      t.appendChild(pills);
      t.addEventListener('click', function () { openFlow(f, null); });
      tiles.appendChild(t);
    });
    $('flow-tiles-empty').hidden = flowsAll.length > 0;
  }

  function slug(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/g, '');
  }

  function closeFlow() {
    if (!fwin) { return; }
    var id = fwin.flow;
    dropWindow(fwin);
    fwin = null;
    var t = document.querySelector('#flow-tiles [data-setup="' + id + '"]');
    if (t) { t.focus(); }
  }

  // The window of one flow: its name and its stages. f = an existing flow, x = an example, both null = empty.
  function openFlow(f, x) {
    if (fwin) { closeFlow(); }
    var w = makeWindow('flow-win', f ? 'Flow ' + f.name : 'Add a flow', closeFlow);
    fwin = w;
    w.flow = f ? f.id : '';
    var locked = !!f && Number(f.open) > 0;
    var body = w.body;
    var form = el('form');
    form.id = 'flow-form';
    form.method = 'post';
    form.noValidate = true;
    body.appendChild(form);
    form.appendChild(el('h2', null, f ? f.name : (x ? x.title : 'Add a flow')));
    if (x) { form.appendChild(el('p', 'dame-muted', 'An example to start from. Check each team: the window chose the space whose name fits, where there is one. Change anything before you save.')); }
    if (locked) { form.appendChild(el('p', 'hub-msg hub-warn relay-locked', f.open + ' items are open in this flow. Until they are closed, stages cannot be added, removed, moved or given to another team. Names, checklists and hours can change.')); }

    function input(label, id, value, max, hint) {
      var l = el('label', 'hub-field', label);
      var i = el('input', 'dame-input');
      i.id = id; i.type = 'text'; i.maxLength = max; i.autocomplete = 'off'; i.value = value || '';
      l.appendChild(i);
      if (hint) { l.appendChild(el('span', 'dame-hint', hint)); }
      form.appendChild(l);
      return i;
    }
    var src = f || x || {};
    var name = input('Name of the flow', 'fl-name', src.name, 80);
    var id = input('Id (permanent)', 'fl-id', f ? f.id : (x ? x.id : ''), 30, 'Lower-case letters, digits and single dashes. It never changes.');
    id.disabled = !!f;
    var touched = !!(f || x);
    name.addEventListener('input', function () { if (!touched) { id.value = slug(name.value); } });
    id.addEventListener('input', function () { touched = true; });
    var two = el('div', 'hub-two');
    form.appendChild(two);
    var word = input('What one item is called', 'fl-word', src.word || 'request', 30, 'For example "MTO query", "order".');
    var prefix = input('Letters of its number', 'fl-prefix', src.prefix, 6, 'For example MTO gives MTO-0001.');
    two.appendChild(word.parentNode);
    two.appendChild(prefix.parentNode);
    prefix.disabled = !!f && Number(f.items) > 0;
    var desc = input('What it is for (optional)', 'fl-desc', src.description, 400);

    form.appendChild(el('h3', null, 'Stages, in order'));
    form.appendChild(el('p', 'dame-hint', 'Each stage is done by one team: the admins and members of a space. The checklist is what that team must tick before it passes the item on. A stage "if needed" may be skipped by the team before it.'));
    var list = el('ol', 'relay-stage-list');
    list.id = 'fl-stages';
    form.appendChild(list);

    var rows = [];
    function stageRow(s) {
      var li = el('li', 'relay-stage-edit');
      var head = el('div', 'relay-stage-head');
      var no = el('span', 'relay-step-no', '');
      head.appendChild(no);
      var up = el('button', 'dame-btn hub-small', 'Up'); up.type = 'button';
      var down = el('button', 'dame-btn hub-small', 'Down'); down.type = 'button';
      var rm = el('button', 'dame-btn hub-small hub-danger', 'Remove'); rm.type = 'button';
      [up, down, rm].forEach(function (b) { b.disabled = locked; head.appendChild(b); });
      li.appendChild(head);
      var g = el('div', 'hub-two');
      var lt = el('label', 'hub-field', 'Team (space)');
      var team = el('select', 'dame-input');
      team.setAttribute('data-k', 'space');
      var none = el('option', null, 'Choose the team');
      none.value = '';
      team.appendChild(none);
      spaces.forEach(function (sp) {
        var o = el('option', null, sp.name + (sp.active ? '' : ' (switched off)'));
        o.value = sp.id;
        team.appendChild(o);
      });
      var want = s.space || (s.team ? guessSpace(s.team) : '');
      if (want && !spaces.some(function (sp) { return sp.id === want; })) {
        var gone = el('option', null, want + ' (deleted)'); gone.value = want; team.appendChild(gone);
      }
      team.value = want;
      team.disabled = locked;
      lt.appendChild(team);
      g.appendChild(lt);
      var ln = el('label', 'hub-field', 'Name of the stage');
      var sname = el('input', 'dame-input');
      sname.type = 'text'; sname.maxLength = 60; sname.value = s.name || ''; sname.setAttribute('data-k', 'name');
      ln.appendChild(sname);
      g.appendChild(ln);
      var lh = el('label', 'hub-field', 'Hours it should take at most');
      var hours = el('input', 'dame-input');
      hours.type = 'number'; hours.min = '1'; hours.max = '2000'; hours.step = '1'; hours.inputMode = 'numeric';
      hours.value = String(s.hours || 24); hours.setAttribute('data-k', 'hours');
      lh.appendChild(hours);
      g.appendChild(lh);
      var lo = el('label', 'dame-check relay-optional');
      var opt = el('input');
      opt.type = 'checkbox'; opt.checked = !!s.optional; opt.setAttribute('data-k', 'optional');
      lo.appendChild(opt);
      lo.appendChild(el('span', null, 'If needed: the team before may skip it'));
      g.appendChild(lo);
      li.appendChild(g);
      var lc = el('label', 'hub-field', 'Checklist before passing it on: one line each, up to 10');
      var checks = el('textarea', 'dame-input');
      checks.rows = 3; checks.maxLength = 1700; checks.value = (s.checks || []).join('\n'); checks.setAttribute('data-k', 'checks');
      lc.appendChild(checks);
      li.appendChild(lc);
      var r = { li: li, no: no, team: team, name: sname, hours: hours, opt: opt, optBox: lo, checks: checks };
      up.addEventListener('click', function () { move(r, -1); });
      down.addEventListener('click', function () { move(r, 1); });
      rm.addEventListener('click', function () { rows.splice(rows.indexOf(r), 1); li.remove(); number(); });
      return r;
    }
    function number() {
      rows.forEach(function (r, i) {
        r.no.textContent = String(i + 1);
        var edge = i === 0 || i === rows.length - 1;
        r.optBox.hidden = edge;
        if (edge) { r.opt.checked = false; }
      });
      addStage.disabled = locked || rows.length >= 12;
    }
    function move(r, by) {
      var i = rows.indexOf(r);
      var j = i + by;
      if (j < 0 || j >= rows.length) { return; }
      rows.splice(i, 1);
      rows.splice(j, 0, r);
      ui.clear(list);
      rows.forEach(function (x) { list.appendChild(x.li); });
      number();
    }
    var addStage = el('button', 'dame-btn', 'Add a stage');
    addStage.type = 'button';
    addStage.id = 'fl-add-stage';
    addStage.addEventListener('click', function () {
      var r = stageRow({});
      rows.push(r);
      list.appendChild(r.li);
      number();
      r.team.focus();
    });
    form.appendChild(addStage);
    (src.stages && src.stages.length ? src.stages : [{}, {}]).forEach(function (s) {
      var r = stageRow(s);
      rows.push(r);
      list.appendChild(r.li);
    });
    number();

    var save = el('button', 'dame-btn dame-btn-primary', f ? 'Save the flow' : 'Create the flow');
    save.type = 'submit';
    save.id = 'fl-save';
    save.setAttribute('form', 'flow-form');
    w.foot.insertBefore(save, w.close);
    if (f) {
      w.foot.appendChild(f.active
        ? ui.confirmButton('Switch it off', '', function () { flowAct(w, 'dame_relay_flow_active', { p_flow: f.id, p_active: false }, 'Switched off. Nothing new starts; open items can still finish.'); })
        : ui.confirmButton('Switch it on', '', function () { flowAct(w, 'dame_relay_flow_active', { p_flow: f.id, p_active: true }, 'Switched on.'); }));
    }

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      ui.say(w.msg, '');
      var stages = rows.map(function (r) {
        return { space: r.team.value, name: r.name.value, hours: Number(r.hours.value), optional: r.opt.checked,
          checks: r.checks.value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean) };
      });
      var bad = stages.findIndex(function (s) { return !s.space; });
      if (bad !== -1) { ui.say(w.msg, 'Stage ' + (bad + 1) + ': choose the team (a space) that does it.', 'warn'); rows[bad].team.focus(); return; }
      bad = stages.findIndex(function (s) { return s.checks.length > 10; });
      if (bad !== -1) { ui.say(w.msg, 'Stage ' + (bad + 1) + ': at most 10 checklist lines.', 'warn'); rows[bad].checks.focus(); return; }
      save.disabled = true;
      try {
        await api.rpc('dame_relay_flow_save', { p_flow: id.value.trim(), p_name: name.value, p_word: word.value,
          p_prefix: prefix.value, p_description: desc.value, p_stages: stages });
        w.flow = id.value.trim();
        await load();
        if (fwin === w) {
          closeFlow();
          ui.say($('msg'), (f ? 'The flow is saved.' : 'The flow is made. Its first team can start items under Flows.'), 'ok');
        }
      } catch (err) {
        save.disabled = false;
        ui.sayError(w.msg, err);
        w.msg.scrollIntoView({ block: 'nearest' });
      }
    });
    name.focus();
  }

  async function flowAct(w, fn, args, done) {
    ui.say(w.msg, '');
    try {
      await api.rpc(fn, args);
      await load();
      if (fwin === w) { closeFlow(); }
      ui.say($('msg'), done, 'ok');
    } catch (err) {
      if (fwin === w) { ui.sayError(w.msg, err); }
    }
  }

  // ---------------------------------------------------------------- loading

  async function load() {
    var asked = [api.rpc('dame_relay_home')];
    if (me.is_it) { asked.push(api.rpc('dame_relay_flows_all'), api.rpc('dame_spaces_all')); }
    var got = await Promise.all(asked);
    home = got[0];
    if (home.is_it) { flowsAll = got[1] || []; spaces = got[2] || []; }
    var flows = home.flows || [];
    if (!flows.some(function (f) { return f.id === flowId; })) { flowId = flows.length ? flows[0].id : ''; }
    drawWork();
    drawChips();
    drawSetup();
    await loadBoard();
  }

  async function start() {
    var first = api.rpc('dame_relay_home');
    first.catch(function () {});
    me = await ui.guard();
    $('main').hidden = false;
    flowId = ui.param('flow');
    try {
      await first;
    } catch (err) {
      ui.sayError($('msg'), err);
      return;
    }
    await load();
    $('body').hidden = false;
    $('b-start').addEventListener('click', openStart);
    $('flow-add').addEventListener('click', function () { openFlow(null, null); });
    var item = Number(new URLSearchParams(location.search).get('item'));
    if (Number.isInteger(item) && item > 0) { await openItem(item); }
  }

  start().catch(function (err) {
    $('main').hidden = false;
    ui.sayError($('msg'), err);
  });
})();
