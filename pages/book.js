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
    var out = [{ kind: 'title', chapter: n + 1, title: c.title, body: head || c.text }];
    parts.forEach(function (p) {
      var title = (/^## (.*)/.exec(p) || [])[1] || '';
      out.push({ kind: 'part', chapter: n + 1, of: c.title, title: title, body: p.replace(/^## .*\n?/, ''), dense: dense });
    });
    return out;
  }

  function draw() {
    var s = show.slides[show.i];
    var stage = ui.clear(show.stage);
    stage.className = 'hub-slide' + (s.kind === 'title' ? ' hub-slide-title' : '') + (s.dense ? ' hub-slide-dense' : '');
    stage.appendChild(ui.el('p', 'hub-kicker', s.kind === 'title' ? 'Chapter ' + s.chapter : s.chapter + '. ' + s.of));
    stage.appendChild(ui.el(s.kind === 'title' ? 'h1' : 'h2', null, s.title));
    stage.appendChild(ui.rich(s.body));
    show.count.textContent = (show.i + 1) + ' of ' + show.slides.length;
    show.back.disabled = show.i === 0;
    show.next.textContent = show.i === show.slides.length - 1 ? 'End' : 'Next';
    stage.scrollTop = 0;
  }

  function step(by) {
    if (!show) { return; }
    if (by > 0 && show.i === show.slides.length - 1) { stop(); return; }
    show.i = Math.max(0, Math.min(show.slides.length - 1, show.i + by));
    draw();
  }

  function stop() {
    if (!show) { return; }
    if (document.fullscreenElement && document.exitFullscreen) { document.exitFullscreen().catch(function () {}); }
    show.node.remove();
    show = null;
  }

  function present(list) {
    stop();
    var node = ui.el('div', 'hub-present');
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-modal', 'true');
    node.setAttribute('aria-label', 'Presentation');
    var stage = ui.el('div', 'hub-slide');
    var bar = ui.el('div', 'hub-present-bar');
    var back = ui.el('button', 'dame-btn', 'Back');
    var next = ui.el('button', 'dame-btn dame-btn-primary', 'Next');
    var count = ui.el('span', 'hub-present-count');
    var full = ui.el('button', 'dame-btn', 'Full screen');
    var close = ui.el('button', 'dame-btn', 'Close');
    [back, next, full, close].forEach(function (b) { b.type = 'button'; });
    back.addEventListener('click', function () { step(-1); });
    next.addEventListener('click', function () { step(1); });
    close.addEventListener('click', stop);
    full.addEventListener('click', function () {
      if (document.fullscreenElement) { document.exitFullscreen().catch(function () {}); }
      else if (node.requestFullscreen) { node.requestFullscreen().catch(function () {}); }
    });
    bar.appendChild(back);
    bar.appendChild(next);
    bar.appendChild(count);
    bar.appendChild(full);
    bar.appendChild(close);
    node.appendChild(stage);
    node.appendChild(bar);
    document.body.appendChild(node);
    show = { slides: list, i: 0, node: node, stage: stage, count: count, back: back, next: next };
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
    chapters = index.chapters.map(function (c, i) { return { file: String(c.file), title: String(c.title), text: String(c.text || ''), body: bodies[i], part: Number(c.part) || 0 }; });

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
    document.addEventListener('keydown', function (ev) {
      if (!show) { return; }
      if (ev.key === 'Escape') { stop(); }
      else if (ev.key === 'ArrowRight' || ev.key === 'PageDown' || ev.key === ' ') { ev.preventDefault(); step(1); }
      else if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') { ev.preventDefault(); step(-1); }
    });
    if (new URLSearchParams(location.search).get('present') === '1') { present(overview()); }
  }

  start().catch(function (err) {
    $('main').hidden = false;
    ui.sayError($('msg'), err);
  });
})();
