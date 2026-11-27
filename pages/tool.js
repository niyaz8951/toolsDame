/*
 * pages/tool.js - the shell: loads one tool into the sealed frame and answers it.
 * Serves: contract 4 (Tool kit), 6 (Releases) and SECURITY "Browser".
 * Must not change:
 *  - the tool's code is never put into this page, only into a frame that is
 *    sealed (no same-origin rights) inside frame.html, whose policy allows no
 *    network at all; POLICY below is the same text as in frame.html;
 *  - the tool gets no token, no address and no key: it gets one private
 *    message line, and every message on it is checked here (known action,
 *    this page's own tool only, size capped) and again by the database;
 *  - a page is run only if its fingerprint equals the one recorded at upload;
 *  - an outside link opens only after the person confirms;
 *  - a file the tool made is saved by this page, not by the tool, and only if
 *    it is of a harmless kind; the sealed frame itself cannot download;
 *  - a tool that asks too fast is slowed down, so it cannot flood the database.
 */
(function () {
  'use strict';

  var api = window.DameApi;
  var ui = window.DameShell;
  if (!ui) { return; }

  var POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; " +
    "media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; child-src 'none'; " +
    "worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
  var SANDBOX = 'allow-scripts allow-forms allow-modals';
  var MAX_MESSAGE = 262144;
  var MAX_FILE = 100 * 1024 * 1024;
  // A tool may hand the person a file it made, of these kinds only. Nothing that runs when opened.
  var FILE_OK = /\.(xlsx|xlsm|csv|txt|json|pdf|png|jpg|jpeg|docx|pptx|xml|md)$/i;
  var stamps = [];       // times of the tool's recent requests
  var saved = [];        // times of recent file saves
  var reports = 0;       // problems the tool reported

  var space = '';
  var tool = '';
  var info = null;
  var kitCss = '';
  var kitJs = '';
  var inner = null;
  var line = null;

  function $(id) { return document.getElementById(id); }

  function hex(buffer) {
    return Array.prototype.map.call(new Uint8Array(buffer), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  async function kit(path) {
    var res = await fetch(api.href(path), { cache: 'no-cache', credentials: 'omit' });
    if (!res.ok) { throw new Error('kit'); }
    return res.text();
  }

  // The stored page, as text, only if it is byte for byte what was uploaded.
  async function page(name) {
    var file = info.files.filter(function (f) { return f.name === name; })[0];
    if (!file) { throw { name: 'DameError', message: 'This tool has no page named ' + name + '.' }; }
    var bytes = await api.fileBytes(space + '/' + tool + '/' + info.version + '/' + name);
    if (hex(await crypto.subtle.digest('SHA-256', bytes)) !== file.sha256) {
      throw { name: 'DameError', message: 'The stored page ' + name + ' is not the one that was uploaded. It was not opened. Tell an IT admin.' };
    }
    return new TextDecoder('utf-8').decode(bytes);
  }

  var LIB_LINE = /<script\b[^>]*\bsrc=["']\/_dame\/v1\/lib\/([a-z0-9-]{2,30})\.js["'][^>]*>\s*<\/script>/gi;
  var shelf = null;      // id -> file name, from kit/v1/lib/index.json
  var libs = {};         // id -> the library's text, once fetched

  // Fetches the shelf libraries this page asks for. Only ids listed on the shelf.
  async function fetchLibs(html) {
    var wanted = [];
    html.replace(LIB_LINE, function (all, id) { if (wanted.indexOf(id) < 0) { wanted.push(id); } return all; });
    if (!wanted.length) { return; }
    if (!shelf) {
      shelf = {};
      JSON.parse(await kit('kit/v1/lib/index.json')).libraries.forEach(function (l) { shelf[l.id] = l.file; });
    }
    for (var i = 0; i < wanted.length; i += 1) {
      var id = wanted[i];
      if (!Object.prototype.hasOwnProperty.call(shelf, id)) {
        throw { name: 'DameError', message: 'This tool asks for a library the site does not have: ' + id + '. Tell the tool\'s manager.' };
      }
      if (!libs[id]) { libs[id] = await kit('kit/v1/lib/' + shelf[id]); }
    }
  }

  // Puts the kit in place of the two kit lines, shelf libraries in place of
  // their lines, and the policy at the very top.
  function build(html) {
    html = html.replace(/^\s*<!doctype[^>]*>/i, '');
    html = html.replace(/<link\b[^>]*\bhref=["']\/_dame\/v1\/dame\.css["'][^>]*>/i, function () {
      return '<style>' + kitCss.replace(/<\/style/gi, '<\\/style') + '</style>';
    });
    html = html.replace(/<script\b[^>]*\bsrc=["']\/_dame\/v1\/dame\.js["'][^>]*>\s*<\/script>/i, function () {
      return '<script>' + kitJs.replace(/<\/script/gi, '<\\/script') + '</script>';
    });
    html = html.replace(LIB_LINE, function (all, id) {
      return libs[id] ? '<script>' + libs[id].replace(/<\/script/gi, '<\\/script') + '</script>' : '';
    });
    // The tool starts in the person's theme (day or night); a later change comes over the line.
    var theme = document.documentElement.getAttribute('data-theme');
    if (theme === 'day' || theme === 'night') {
      html = /<html\b/i.test(html) ? html.replace(/<html\b(?![^>]*\bdata-theme=)/i, '<html data-theme="' + theme + '"') : html;
    }
    return '<!doctype html><meta http-equiv="Content-Security-Policy" content="' + POLICY + '">' + html;
  }

  // The day and night button of the bar: the tool is told, it changes its own colours.
  window.addEventListener('dame-theme', function (ev) {
    if (line && (ev.detail === 'day' || ev.detail === 'night')) { line.postMessage({ event: 'theme', value: ev.detail }); }
  });

  function answer(id, result) { if (line) { line.postMessage({ id: id, ok: true, result: result }); } }
  function refuse(id, message, code) { if (line) { line.postMessage({ id: id, ok: false, message: message, code: code || 'refused' }); } }

  // Saves a file the tool made. The tool cannot save by itself: the frame has no download right.
  function save(id, args) {
    var name = String(args.name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120);
    var data = args.data;
    var size = typeof data === 'string' ? data.length : (data && data.byteLength);
    var now = Date.now();
    saved = saved.filter(function (t) { return now - t < 60000; });
    if (!FILE_OK.test(name)) { refuse(id, 'A tool can save these kinds of file only: xlsx, csv, txt, json, pdf, png, jpg, docx, pptx, xml, md.', 'bad_request'); return; }
    if (!(typeof data === 'string' || data instanceof ArrayBuffer || ArrayBuffer.isView(data)) || !(size >= 0)) { refuse(id, 'This cannot be saved as a file.', 'bad_request'); return; }
    if (size > MAX_FILE) { refuse(id, 'This file is larger than 100 MB.', 'too_large'); return; }
    if (saved.length >= 20) { refuse(id, 'Too many files at once. Wait a minute.', 'too_many'); return; }
    saved.push(now);
    var url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
    var a = ui.el('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    answer(id, true);
  }

  // The tool's own script failed. Its manager is told what, in words he can hand to the AI.
  var lastProblem = '';
  function problem(args) {
    reports += 1;
    if (reports > 1) { return; }
    lastProblem = String(args.message || 'unknown problem').slice(0, 500);
    var builderSees = info.is_manager;
    $('oops-text').textContent = builderSees
      ? 'The tool\'s own code stopped with this problem: ' + lastProblem
      : 'Something in this tool did not work. If it does not do what you expect, tell its manager.';
    $('oops-copy').hidden = !builderSees;
    $('oops').hidden = false;
  }

  var asked = null;
  function ask(url) {
    asked = url;
    $('ask-text').textContent = 'This tool wants to open an outside address:';
    $('ask-url').textContent = url.length > 200 ? url.slice(0, 200) + '...' : url;
    $('ask').hidden = false;
    $('ask-no').focus();
  }

  // Every message from the tool arrives here. Nothing in it is trusted.
  function onMessage(ev) {
    var d = ev.data;
    if (!d || typeof d !== 'object' || typeof d.id !== 'number' || typeof d.action !== 'string') { return; }
    var now = Date.now();
    stamps = stamps.filter(function (t) { return now - t < 10000; });
    if (stamps.length >= 300) { refuse(d.id, 'This tool is asking too fast. Wait a moment.', 'too_many'); return; }
    stamps.push(now);
    if (d.action === 'download') { save(d.id, (d.args && typeof d.args === 'object') ? d.args : {}); return; }
    if (d.action === 'error') { problem((d.args && typeof d.args === 'object') ? d.args : {}); return; }
    var size = 0;
    try { size = JSON.stringify(d).length; } catch (e) { size = MAX_MESSAGE + 1; }
    if (size > MAX_MESSAGE) { refuse(d.id, 'This is too much to send at once.', 'too_large'); return; }
    var args = (d.args && typeof d.args === 'object') ? d.args : {};

    if (d.action === 'ready') {
      answer(d.id, { id: info.me.id, name: info.me.name, level: info.level });
    } else if (d.action === 'page') {
      var name = String(args.name || '');
      if (!/^[a-z0-9][a-z0-9._-]{0,59}\.html$/.test(name)) { refuse(d.id, 'This page name is not valid.', 'bad_request'); return; }
      answer(d.id, true);
      show(name);
    } else if (d.action === 'link') {
      var url = String(args.url || '');
      if (!/^(https?:\/\/|mailto:)[^\s]{1,2000}$/i.test(url)) { refuse(d.id, 'This link cannot be opened.', 'bad_request'); return; }
      if (asked) { refuse(d.id, 'Another link is waiting for an answer.', 'too_many'); return; }
      answer(d.id, true);
      ask(url);
    } else if (/^table\.(list|get|add|update|remove)$/.test(d.action)) {
      rows(d.id, d.action.slice(6), args);
    } else if (d.action === 'people') {
      ask2(d.id, 'dame_tool_people', { p_space: space, p_tool: tool });
    } else if (/^files\.(upload|url)$/.test(d.action)) {
      refuse(d.id, 'File upload from a tool is not built yet.', 'not_built');
    } else {
      refuse(d.id, 'Unknown request.', 'bad_request');
    }
  }

  // Calls the database for the tool and hands the answer, or the refusal, back to it.
  function ask2(id, name, params) {
    api.rpc(name, params).then(function (result) { answer(id, result === undefined ? null : result); },
      function (err) { refuse(id, (err && err.message) || 'That did not work. Try again.', (err && err.code) || 'error'); });
  }

  // The data service. The tool names only a table of ITS OWN tool: space, tool
  // and preview come from this page, never from the message. The database
  // checks the table, the columns, the values and the person's level again.
  function rows(id, what, args) {
    var table = String(args.table || '');
    var isId = function (v) { return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v); };
    var isObject = function (v) { return !!v && typeof v === 'object' && !Array.isArray(v); };
    // A field left empty on a form arrives as "": for the database that means "no value", for a date or a number too.
    var blank = function (row) {
      var out = {};
      Object.keys(row).forEach(function (k) { out[k] = (typeof row[k] === 'string' && row[k].trim() === '') ? null : row[k]; });
      return out;
    };
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(table)) { refuse(id, 'This table name is not valid.', 'bad_request'); return; }
    var p = { p_space: space, p_tool: tool, p_table: table, p_preview: info.preview };
    if (what === 'list') {
      p.p_options = isObject(args.options) ? args.options : {};
    } else if (what === 'add') {
      if (!isObject(args.row)) { refuse(id, 'A row is given as { column: value }.', 'bad_request'); return; }
      p.p_row = blank(args.row);
    } else {
      if (!isId(args.id)) { refuse(id, 'This row was not found.', 'bad_request'); return; }
      p.p_id = args.id;
      if (what === 'update') {
        if (!isObject(args.patch)) { refuse(id, 'A change is given as { column: value }.', 'bad_request'); return; }
        p.p_patch = blank(args.patch);
      }
    }
    ask2(id, 'dame_rows_' + what, p);
  }

  // Each load of the sealed frame gets a fresh private line; the old one dies.
  function connect() {
    if (line) { line.onmessage = null; line.close(); }
    var channel = new MessageChannel();
    line = channel.port1;
    line.onmessage = onMessage;
    inner.contentWindow.postMessage({ dame: 'init' }, '*', [channel.port2]);
    var theme = document.documentElement.getAttribute('data-theme');
    if (theme === 'day' || theme === 'night') { line.postMessage({ event: 'theme', value: theme }); }
  }

  async function show(name) {
    try {
      var source = await page(name);
      await fetchLibs(source);
      var html = build(source);
      var host = $('frame').contentDocument;
      if (inner) { inner.remove(); }
      inner = host.createElement('iframe');
      inner.setAttribute('sandbox', SANDBOX);
      inner.setAttribute('title', info.name);
      inner.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;';
      inner.addEventListener('load', connect);
      inner.srcdoc = html;
      host.body.appendChild(inner);
      $('frame').hidden = false;
      $('main').hidden = true;
    } catch (err) {
      $('frame').hidden = true;
      $('main').hidden = false;
      ui.sayError($('msg'), err);
    }
  }

  function hostReady() {
    return new Promise(function (resolve, reject) {
      var frame = $('frame');
      frame.addEventListener('load', function () { resolve(); }, { once: true });
      frame.addEventListener('error', function () { reject(new Error('frame')); }, { once: true });
      frame.src = api.href('frame.html');
    });
  }

  async function start() {
    space = ui.param('space');
    tool = ui.param('tool');
    var preview = new URLSearchParams(location.search).get('preview') === '1';
    // Asked at the same moment as the sign-in check: the tool, the kit and the frame are fetched together.
    var opening = (space && tool) ? api.rpc('dame_tool_open', { p_space: space, p_tool: tool, p_preview: preview }) : Promise.resolve(null);
    var kitFiles = Promise.all([kit('kit/v1/dame.css'), kit('kit/v1/dame.js'), hostReady()]);
    opening.catch(function () {});
    kitFiles.catch(function () {});
    await ui.guard();
    var spaceUrl = api.href('space.html') + '?space=' + encodeURIComponent(space);
    var adminUrl = api.href('admin/tool.html') + '?space=' + encodeURIComponent(space) + '&tool=' + encodeURIComponent(tool);
    $('back').href = space ? spaceUrl : api.href('hub.html');
    $('crumb-hub').href = api.href('hub.html');
    $('back2').href = $('back').href;
    if (!space || !tool) {
      $('main').hidden = false;
      ui.say($('msg'), 'This address names no tool. Go back to the hub and open the tool from its space.', 'warn');
      return;
    }

    // The information button: the guide of this tool. A tool that is not built yet explains to its manager how to build it.
    var building = false;
    ui.info(async function () {
      if (building) {
        var res = await fetch(api.href('help/admin-tool.md'), { cache: 'no-cache', credentials: 'omit' });
        return res.ok ? { title: 'How to build this tool', text: await res.text() } : null;
      }
      var h = null;
      try { h = await api.rpc('dame_tool_help_get', { p_space: space, p_tool: tool }); } catch (e) { /* the guide is not switched on yet: the site's general text is shown */ }
      if (!h) { return null; }
      return { title: 'How to use ' + h.name, text: h.text || ui.toolGuide(h),
        note: h.text ? 'Written by ' + (h.by || 'the tool\'s manager') + (h.at ? ', ' + ui.when(h.at) : '') + '.'
          : 'This guide was written by the site. The tool\'s manager can write a better one on the tool admin page.' };
    });

    try {
      info = await opening;
    } catch (err) {
      $('main').hidden = false;
      if (err && err.code === 'not_live' && !preview) {
        // Not an error: the tile exists, the tool is not built yet.
        var mine = null;
        try { mine = await api.rpc('dame_tool_admin_get', { p_space: space, p_tool: tool }); } catch (e) { /* not its manager */ }
        $('notbuilt-title').textContent = mine ? mine.name + ' is not built yet' : 'This tool is being prepared';
        $('notbuilt-text').textContent = mine
          ? 'You look after this tool. The site guides you one step at a time, with no programming: say what it should do, give the starter kit to the AI, paste the answer, let the site check it, make it live.'
          : 'It will open here as soon as its manager makes it live.';
        $('notbuilt-go').href = adminUrl;
        $('notbuilt-go').hidden = !mine;
        building = !!mine;
        if (mine) { document.querySelector('.hub-info').classList.add('hub-info-new'); }
        $('notbuilt').hidden = false;
        return;
      }
      ui.sayError($('msg'), err);
      return;
    }
    document.title = info.name + ' - DAME';
    var title = document.querySelector('.hub-title');
    if (title) { ui.titled(title, info.icon, info.name); }
    $('back').textContent = info.space_name;
    $('crumb-tool').textContent = info.name;
    $('admin').href = adminUrl;
    $('admin').hidden = !info.is_manager;
    $('preview-pill').textContent = 'Preview of version ' + info.version + ': only admins and managers see this';
    $('preview-pill').hidden = !info.preview;
    $('strip').hidden = false;

    $('ask-yes').addEventListener('click', function () {
      $('ask').hidden = true;
      if (asked) { window.open(asked, '_blank', 'noopener,noreferrer'); }
      asked = null;
    });
    $('ask-no').addEventListener('click', function () { $('ask').hidden = true; asked = null; });
    $('oops-close').addEventListener('click', function () { $('oops').hidden = true; });
    $('oops-copy').addEventListener('click', function () {
      var text = 'When the index.html you gave me runs on the DAME site, its script stops with this problem:\n\n' + lastProblem +
        '\n\nRemember the rules of the starter kit (no browser storage, no outside calls, no workers; data only through Dame.table). ' +
        'Correct it and give me the complete index.html again, in one code block.';
      navigator.clipboard.writeText(text).then(function () { $('oops-copy').textContent = 'Copied. Paste it into the AI.'; },
        function () { $('oops-text').textContent = text; });
    });

    var loaded = await kitFiles;
    kitCss = loaded[0];
    kitJs = loaded[1];
    await show('index.html');
  }

  start().catch(function (err) {
    $('frame').hidden = true;
    $('main').hidden = false;
    ui.sayError($('msg'), err);
  });
})();
