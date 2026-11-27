/*
 * pages/book.js - the site book: chapters to read, and the same text as a
 * presentation (one part of a chapter per slide). Shown to IT admins only.
 * Serves: "On every page" (help). Must not change: chapters come from
 * book/index.json and book/*.md of this site only; their text is written to
 * the page with DameShell.rich (as text, never as HTML); for a person who is
 * not an IT admin the page loads no chapter. That is show and hide: on IT's
 * own servers the folder book/ is closed by the web server.
 */
(function () {
  'use strict';

  var api = window.DameApi;
  var ui = window.DameShell;
  if (!ui) { return; }

  var chapters = [];       // { file, title, text, body, part } in reading order
  var parts = [];          // { title, text, present }
  var at = 0;
  var show = null;         // the presentation, while it runs: { slides, i, node }

  function $(id) { return document.getElementById(id); }

  async function text(path) {
    var res = await fetch(api.href(path), { cache: 'no-cache', credentials: 'omit' });
    if (!res.ok) { throw new Error('The site could not load ' + path + '. Reload the page.'); }
    return res.text();
  }

  function open(i, quiet) {
    at = Math.max(0, Math.min(chapters.length - 1, i));
    var c = chapters[at];
    ui.clear($('page')).appendChild(ui.rich(c.body));
    Array.prototype.forEach.call($('chapters').querySelectorAll('.hub-book-link'), function (b, n) {
      b.setAttribute('aria-current', n === at ? 'true' : 'false');
      if (n === at && !quiet) { b.scrollIntoView({ block: 'nearest' }); }
    });
    $('prev').hidden = at === 0;
    $('next').hidden = at === chapters.length - 1;
    document.title = c.title + ' - Site book - DAME';
    if (!quiet) {
      history.replaceState(history.state, '', '#' + c.file.replace(/\.md$/, ''));
      $('page').scrollIntoView({ block: 'start' });
    }
  }

  function inOverview(c) { return !parts[c.part] || parts[c.part].present; }

  // A chapter as slides: its title with the opening lines, then one slide per "## " part.
  function slidesOf(c, n) {
    var parts = c.body.split(/\n(?=## )/);
    var head = parts.shift().replace(/^# .*\n?/, '').trim();
    var dense = !inOverview(c);   // the chapters of detail hold more per slide: smaller letters, and the slide scrolls
    var out = [{ kind: 'title', chapter: n + 1, of: c.title, title: c.title, body: head || c.text }];
    parts.forEach(function (p) {
      var title = (/^## (.*)/.exec(p) || [])[1] || '';
      out.push({ kind: 'part', chapter: n + 1, of: c.title, title: title, body: p.replace(/^## .*\n?/, ''), dense: dense });
    });
    return out;
  }

  // ---- pointing: a laser dot, a spotlight, a pen. Only on the presenter's screen; nothing is kept.
  function tool(name) {
    if (!show) { return; }
    show.tool = show.tool === name ? '' : name;
    ['laser', 'spot', 'pen'].forEach(function (t) {
      show.wrap.classList.toggle('is-' + t, show.tool === t);
      show.tools[t].setAttribute('aria-pressed', show.tool === t ? 'true' : 'false');
    });
  }

  function wipe() {
    if (!show) { return; }
    var c = show.ink;
    c.width = c.clientWidth;
    c.height = c.clientHeight;
    show.wipe.hidden = true;
  }

  function pointing(wrap, ink) {
    var pen = null;
    wrap.addEventListener('pointermove', function (ev) {
      var r = wrap.getBoundingClientRect();
      wrap.style.setProperty('--px', (ev.clientX - r.left) + 'px');
      wrap.style.setProperty('--py', (ev.clientY - r.top) + 'px');
    });
    ink.addEventListener('pointerdown', function (ev) {
      if (!show || show.tool !== 'pen') { return; }
      var r = ink.getBoundingClientRect();
      if (ink.width !== ink.clientWidth || ink.height !== ink.clientHeight) { ink.width = ink.clientWidth; ink.height = ink.clientHeight; }
      pen = ink.getContext('2d');
      pen.lineWidth = 4;
      pen.lineCap = 'round';
      pen.lineJoin = 'round';
      pen.strokeStyle = '#ff2d3d';
      pen.beginPath();
      pen.moveTo(ev.clientX - r.left, ev.clientY - r.top);
      ink.setPointerCapture(ev.pointerId);
      show.wipe.hidden = false;
    });
    ink.addEventListener('pointermove', function (ev) {
      if (!pen) { return; }
      var r = ink.getBoundingClientRect();
      pen.lineTo(ev.clientX - r.left, ev.clientY - r.top);
      pen.stroke();
    });
    function lift() { pen = null; }
    ink.addEventListener('pointerup', lift);
    ink.addEventListener('pointercancel', lift);
  }

  // ---- the topics on the left: one node per chapter of this presentation. A press jumps there;
  // hovering shows its name. Under the slide: one mark per slide of the chapter that is open.
  function tip(text, small) {
    var t = ui.el('span', 'hub-rail-tip', text);
    if (small) { t.appendChild(ui.el('small', null, small)); }
    return t;
  }

  function rail() {
    var box = ui.clear(show.rail);
    var seen = {};
    var lastPart = null;
    show.slides.forEach(function (s, i) {
      if (seen[s.chapter]) { return; }
      seen[s.chapter] = true;
      var c = chapters[s.chapter - 1];
      if (lastPart !== null && c && c.part !== lastPart) { box.appendChild(ui.el('span', 'hub-rail-part')); }
      lastPart = c ? c.part : lastPart;
      var count = show.slides.filter(function (x) { return x.chapter === s.chapter; }).length;
      var b = ui.el('button', 'hub-rail-node');
      b.type = 'button';
      b.setAttribute('aria-label', s.chapter + '. ' + s.of);
      b.setAttribute('data-chapter', String(s.chapter));
      b.appendChild(tip(s.chapter + '. ' + s.of, (c && parts[c.part] ? parts[c.part].title + ' - ' : '') + count + (count === 1 ? ' slide' : ' slides')));
      b.addEventListener('click', function () { go(i); });
      box.appendChild(b);
    });
  }

  function marks() {
    var s = show.slides[show.i];
    Array.prototype.forEach.call(show.rail.querySelectorAll('.hub-rail-node'), function (b) {
      var n = Number(b.getAttribute('data-chapter'));
      b.setAttribute('aria-current', n === s.chapter ? 'true' : 'false');
      b.classList.toggle('is-done', n < s.chapter);
    });
    var dots = ui.clear(show.dots);
    var mine = [];
    show.slides.forEach(function (x, i) { if (x.chapter === s.chapter) { mine.push(i); } });
    if (mine.length < 2 || mine.length > 24) { return; }
    mine.forEach(function (i) {
      var b = ui.el('button');
      b.type = 'button';
      b.setAttribute('aria-label', show.slides[i].title);
      b.setAttribute('aria-current', i === show.i ? 'true' : 'false');
      b.appendChild(tip(show.slides[i].title));
      b.addEventListener('click', function () { go(i); });
      dots.appendChild(b);
    });
  }

  function draw() {
    var s = show.slides[show.i];
    var stage = ui.clear(show.stage);
    stage.className = 'hub-slide' + (s.kind === 'title' ? ' hub-slide-title' : '') + (s.dense ? ' hub-slide-dense' : '');
    stage.appendChild(ui.el('p', 'hub-kicker', s.kind === 'title' ? 'Chapter ' + s.chapter : s.chapter + '. ' + s.of));
    stage.appendChild(ui.el(s.kind === 'title' ? 'h1' : 'h2', null, s.title));
    stage.appendChild(ui.rich(s.body));
    show.count.textContent = (show.i + 1) + ' of ' + show.slides.length;
    show.bar.style.setProperty('--done', (100 * (show.i + 1) / show.slides.length) + '%');
    show.back.disabled = show.i === 0;
    show.next.textContent = show.i === show.slides.length - 1 ? 'End' : 'Next';
    stage.scrollTop = 0;
    wipe();
    marks();
  }

  function go(i) {
    if (!show) { return; }
    show.i = Math.max(0, Math.min(show.slides.length - 1, i));
    draw();
  }

  function step(by) {
    if (!show) { return; }
    if (by > 0 && show.i === show.slides.length - 1) { stop(); return; }
    go(show.i + by);
  }

  // The first slide of the chapter before or after the one that is open.
  function hop(by) {
    if (!show) { return; }
    var now = show.slides[show.i].chapter;
    var firsts = [];
    show.slides.forEach(function (s, i) { if (i === 0 || show.slides[i - 1].chapter !== s.chapter) { firsts.push(i); } });
    var at = 0;
    firsts.forEach(function (i, k) { if (show.slides[i].chapter === now) { at = k; } });
    go(firsts[Math.max(0, Math.min(firsts.length - 1, at + by))]);
  }

  function stop() {
    if (!show) { return; }
    if (document.fullscreenElement && document.exitFullscreen) { document.exitFullscreen().catch(function () {}); }
    show.node.remove();
    show = null;
  }

  function present(list) {
    stop();
    if (!list.length) { return; }
    var node = ui.el('div', 'hub-present');
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-modal', 'true');
    node.setAttribute('aria-label', 'Presentation');
    var body = ui.el('div', 'hub-present-body');
    var railBox = ui.el('nav', 'hub-rail');
    railBox.setAttribute('aria-label', 'Topics');
    var wrap = ui.el('div', 'hub-stage');
    var stage = ui.el('div', 'hub-slide');
    var ink = ui.el('canvas', 'hub-ink');
    var dots = ui.el('div', 'hub-dots');
    wrap.appendChild(stage);
    wrap.appendChild(ui.el('div', 'hub-spot'));
    wrap.appendChild(ink);
    wrap.appendChild(ui.el('div', 'hub-laser'));
    wrap.appendChild(dots);
    body.appendChild(railBox);
    body.appendChild(wrap);

    var bar = ui.el('div', 'hub-present-bar');
    function button(label, key, cls) {
      var b = ui.el('button', 'dame-btn' + (cls ? ' ' + cls : ''), label);
      b.type = 'button';
      if (key) { b.appendChild(ui.el('kbd', null, key)); }
      return b;
    }
    var back = button('Back');
    var next = button('Next', null, 'dame-btn-primary');
    var count = ui.el('span', 'hub-present-count');
    var tools = ui.el('div', 'hub-tools');
    var laser = button('Laser', 'L');
    var spot = button('Spotlight', 'S');
    var pen = button('Pen', 'P');
    var clean = button('Wipe', 'C');
    clean.hidden = true;
    [laser, spot, pen].forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
    var full = button('Full screen', 'F');
    var close = button('Close', 'Esc', 'hub-present-close');
    back.addEventListener('click', function () { step(-1); });
    next.addEventListener('click', function () { step(1); });
    laser.addEventListener('click', function () { tool('laser'); });
    spot.addEventListener('click', function () { tool('spot'); });
    pen.addEventListener('click', function () { tool('pen'); });
    clean.addEventListener('click', wipe);
    close.addEventListener('click', stop);
    function screen() {
      if (document.fullscreenElement) { document.exitFullscreen().catch(function () {}); }
      else if (node.requestFullscreen) { node.requestFullscreen().catch(function () {}); }
    }
    full.addEventListener('click', screen);
    [laser, spot, pen, clean].forEach(function (b) { tools.appendChild(b); });
    bar.appendChild(ui.el('span', 'hub-progress'));
    [back, next, count, tools, full, close].forEach(function (b) { bar.appendChild(b); });
    node.appendChild(body);
    node.appendChild(bar);
    document.body.appendChild(node);
    show = { slides: list, i: 0, node: node, stage: stage, wrap: wrap, ink: ink, dots: dots, rail: railBox, bar: bar, count: count,
      back: back, next: next, wipe: clean, tool: '', tools: { laser: laser, spot: spot, pen: pen }, screen: screen };
    pointing(wrap, ink);
    rail();
    draw();
    next.focus();
  }

  // The slides of the chapters a test lets through, numbered as in the book.
  function slides(test) {
    return chapters.reduce(function (out, c, n) { return test(c) ? out.concat(slidesOf(c, n)) : out; }, []);
  }
  function overview() { return slides(inOverview); }
  // The detail: every part that is not in the overview, without the last part (the log).
  function detail() { return slides(function (c) { return !inOverview(c) && c.part < parts.length - 1; }); }

  async function start() {
    var me = await ui.guard();
    $('main').hidden = false;
    // The book is for IT admins. For anyone else the page says so and loads no chapter.
    if (!me.is_it) { $('closed').hidden = false; return; }
    $('book').hidden = false;
    $('foot').hidden = false;
    $('present-row').hidden = false;
    var index = JSON.parse(await text('book/index.json'));
    var bodies = await Promise.all(index.chapters.map(function (c) { return text('book/' + c.file); }));
    parts = (index.parts || []).map(function (p) { return { title: String(p.title), text: String(p.text || ''), present: !!p.present }; });
    chapters = index.chapters.map(function (c, i) { return { file: String(c.file), title: String(c.title), text: String(c.text || ''), body: bodies[i], part: Number(c.part) || 0, pitch: !!c.pitch }; });
    $('present-pitch').hidden = !chapters.some(function (c) { return c.pitch; });

    var list = ui.clear($('chapters'));
    chapters.forEach(function (c, i) {
      if (parts[c.part] && (i === 0 || chapters[i - 1].part !== c.part)) {
        var head = ui.el('li', 'hub-book-part');
        head.appendChild(ui.el('strong', null, parts[c.part].title));
        head.appendChild(ui.el('span', null, parts[c.part].text));
        list.appendChild(head);
      }
      var li = ui.el('li');
      var b = ui.el('button', 'hub-book-link');
      b.type = 'button';
      b.appendChild(ui.el('strong', null, (i + 1) + '. ' + c.title));
      b.appendChild(ui.el('span', null, c.text));
      b.addEventListener('click', function () { open(i); });
      li.appendChild(b);
      list.appendChild(li);
    });

    var wanted = location.hash.slice(1);
    var first = chapters.map(function (c) { return c.file.replace(/\.md$/, ''); }).indexOf(wanted);
    open(first < 0 ? 0 : first, true);

    window.addEventListener('hashchange', function () {
      var i = chapters.map(function (c) { return c.file.replace(/\.md$/, ''); }).indexOf(location.hash.slice(1));
      if (i >= 0 && i !== at) { open(i, true); }
    });
    $('prev').addEventListener('click', function () { open(at - 1); });
    $('next').addEventListener('click', function () { open(at + 1); });
    $('present-all').addEventListener('click', function () { present(overview()); });
    $('present-detail').addEventListener('click', function () { present(detail()); });
    $('present-one').addEventListener('click', function () { present(slidesOf(chapters[at], at)); });
    $('present-pitch').addEventListener('click', function () { present(slides(function (c) { return c.pitch; })); });
    document.addEventListener('keydown', function (ev) {
      if (!show) { return; }
      var k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) { return; }
      if (k === 'Escape') { if (show.tool) { tool(show.tool); } else { stop(); } }
      else if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') { ev.preventDefault(); step(1); }
      else if (k === 'ArrowLeft' || k === 'PageUp') { ev.preventDefault(); step(-1); }
      else if (k === 'ArrowDown') { ev.preventDefault(); hop(1); }
      else if (k === 'ArrowUp') { ev.preventDefault(); hop(-1); }
      else if (k === 'Home') { go(0); }
      else if (k === 'End') { go(show.slides.length - 1); }
      else if (k === 'l') { tool('laser'); }
      else if (k === 's') { tool('spot'); }
      else if (k === 'p') { tool('pen'); }
      else if (k === 'c') { wipe(); }
      else if (k === 'f') { show.screen(); }
    });
    var wish = new URLSearchParams(location.search).get('present');
    if (wish === 'pitch') { present(slides(function (c) { return c.pitch; })); }
    else if (wish === '1') { present(overview()); }
  }

  start().catch(function (err) {
    $('main').hidden = false;
    ui.sayError($('msg'), err);
  });
})();
