/*
 * kit/v1/pack.js - turns the files a person chose (or one zip) into the pages
 * of a version: every page one self-contained HTML file, checked.
 * Serves: contract 6 (Releases: upload > check) and "Site rules every tool
 * follows" 3 (nothing from outside).
 * Must not change: the files are only READ here, with the browser's inert
 * parser: nothing in them is ever run or loaded by this page. A problem stops
 * the upload and is said in plain words with what to do. These checks help
 * the person; they protect nothing. The sealed frame does, whatever is uploaded.
 */
(function () {
  'use strict';

  var MAX_PAGE = 20 * 1024 * 1024;
  var MAX_VERSION = 200 * 1024 * 1024;
  var MAX_UNPACKED = 250 * 1024 * 1024;
  var MAX_FILES = 500;
  var PAGE = /^[a-z0-9][a-z0-9._-]{0,59}\.html$/;
  var KIT_CSS = '/_dame/v1/dame.css';
  var KIT_JS = '/_dame/v1/dame.js';
  var LIB = /^\/_dame\/v1\/lib\/([a-z0-9-]{2,30})\.js$/;
  var TYPES = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm'
  };

  function text(bytes) { return new TextDecoder('utf-8').decode(bytes); }

  function hex(buffer) {
    return Array.prototype.map.call(new Uint8Array(buffer), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  function base64(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 32768) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    }
    return btoa(out);
  }

  // ------------------------------------------------------------------ zip

  async function inflate(bytes, limit) {
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    var reader = stream.getReader();
    var chunks = [];
    var total = 0;
    for (;;) {
      var step = await reader.read();
      if (step.done) { break; }
      total += step.value.length;
      if (total > limit) { throw new Error('The zip unpacks to more than 250 MB.'); }
      chunks.push(step.value);
    }
    var out = new Uint8Array(total);
    var at = 0;
    chunks.forEach(function (c) { out.set(c, at); at += c.length; });
    return out;
  }

  // Reads a plain zip (stored or deflated entries, no password, under 4 GB).
  async function unzip(buffer) {
    var bytes = new Uint8Array(buffer);
    var view = new DataView(buffer);
    var end = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) { throw new Error('This zip cannot be read. Make the zip again, or choose the files themselves.'); }
    var count = view.getUint16(end + 10, true);
    var at = view.getUint32(end + 16, true);
    if (count > MAX_FILES) { throw new Error('The zip holds more than ' + MAX_FILES + ' files.'); }
    var files = [];
    var total = 0;
    for (var n = 0; n < count; n += 1) {
      if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) { throw new Error('This zip is damaged. Make it again.'); }
      var flags = view.getUint16(at + 8, true);
      var method = view.getUint16(at + 10, true);
      var packed = view.getUint32(at + 20, true);
      var size = view.getUint32(at + 24, true);
      var nameLen = view.getUint16(at + 28, true);
      var extraLen = view.getUint16(at + 30, true);
      var commentLen = view.getUint16(at + 32, true);
      var local = view.getUint32(at + 42, true);
      var name = text(bytes.subarray(at + 46, at + 46 + nameLen));
      at += 46 + nameLen + extraLen + commentLen;
      if (name.slice(-1) === '/') { continue; }
      if (flags & 1) { throw new Error('The zip is protected by a password. Make it again without one.'); }
      if (method !== 0 && method !== 8) { throw new Error('The zip uses a packing this site cannot read. Make it with the normal "compress" of your computer.'); }
      if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) { throw new Error('This zip is damaged. Make it again.'); }
      var start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      var raw = bytes.subarray(start, start + packed);
      var data = method === 0 ? raw.slice() : await inflate(raw, MAX_UNPACKED - total);
      if (method === 0 && data.length !== size) { throw new Error('This zip is damaged. Make it again.'); }
      total += data.length;
      if (total > MAX_UNPACKED) { throw new Error('The zip unpacks to more than 250 MB.'); }
      files.push({ path: name, bytes: data });
    }
    return files;
  }

  // ------------------------------------------------------------------ files

  // From what the person chose to a map path -> bytes, without a wrapping folder.
  async function collect(fileList) {
    var chosen = Array.prototype.slice.call(fileList);
    var files = [];
    if (chosen.length === 1 && /\.zip$/i.test(chosen[0].name)) {
      files = await unzip(await chosen[0].arrayBuffer());
    } else {
      if (chosen.some(function (f) { return /\.zip$/i.test(f.name); })) {
        throw new Error('Choose either one zip, or the files themselves, not both.');
      }
      if (chosen.length > MAX_FILES) { throw new Error('More than ' + MAX_FILES + ' files were chosen.'); }
      for (var i = 0; i < chosen.length; i += 1) {
        files.push({ path: chosen[i].webkitRelativePath || chosen[i].name, bytes: new Uint8Array(await chosen[i].arrayBuffer()) });
      }
    }
    files = files.filter(function (f) {
      var parts = f.path.replace(/\\/g, '/').split('/');
      f.path = parts.join('/');
      return parts.every(function (p) { return p && p.charAt(0) !== '.' && p !== '__MACOSX'; });
    });
    // If everything sits in one folder, that folder is dropped.
    while (files.length && files.every(function (f) { return f.path.indexOf('/') > 0 && f.path.split('/')[0] === files[0].path.split('/')[0]; })) {
      files.forEach(function (f) { f.path = f.path.slice(f.path.indexOf('/') + 1); });
    }
    var map = {};
    files.forEach(function (f) { map[f.path] = f.bytes; });
    // One page whatever it is called: "My Tool v2.HTML" or "tool.htm" is the tool's index.html.
    var htmls = Object.keys(map).filter(function (p) { return /\.html?$/i.test(p) && p.indexOf('/') < 0; });
    if (htmls.length === 1 && htmls[0] !== 'index.html') {
      map['index.html'] = map[htmls[0]];
      delete map[htmls[0]];
    }
    return map;
  }

  function outside(ref) { return /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(ref) && !/^data:/i.test(ref); }

  // A reference inside a page or style sheet -> the path of the chosen file.
  function resolve(fromPath, ref) {
    ref = ref.split('#')[0].split('?')[0];
    try { ref = decodeURIComponent(ref); } catch (e) { /* keep as typed */ }
    var parts = fromPath.split('/').slice(0, -1);
    if (ref.charAt(0) === '/') { parts = []; }
    ref.split('/').forEach(function (p) {
      if (p === '..') { parts.pop(); } else if (p && p !== '.') { parts.push(p); }
    });
    return parts.join('/');
  }

  function dataUri(path, bytes) {
    var ext = path.split('.').pop().toLowerCase();
    return TYPES[ext] ? 'data:' + TYPES[ext] + ';base64,' + base64(bytes) : '';
  }

  // ------------------------------------------------------------------ pack

  // The code a person pasted, as the one page index.html. An AI often wraps
  // its answer in ``` marks and adds a sentence before or after: only the code is kept.
  function fromCode(pasted) {
    var code = String(pasted || '');
    var blocks = [];
    code.replace(/```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)```/g, function (all, inner) { blocks.push(inner); return all; });
    var pages = blocks.filter(function (b) { return /<(!doctype|html|head|body|main|div|script)\b/i.test(b); });
    if (pages.length) { code = pages.sort(function (a, b) { return b.length - a.length; })[0]; }
    if (!/<[a-z!][\s\S]*>/i.test(code)) {
      throw new Error('This does not look like the code of a page. Paste everything the AI gave for index.html, from <!doctype html> to </html>.');
    }
    var start = code.search(/<!doctype|<html/i);
    if (start > 0) { code = code.slice(start); }
    return { 'index.html': new TextEncoder().encode(code.trim() + '\n') };
  }

  // options.libs: the ids of the libraries on the shelf (kit/v1/lib/index.json).
  async function pack(map, options) {
    var libs = (options && options.libs) || [];
    var problems = [];
    var notes = [];
    var pages = [];
    var paths = Object.keys(map);

    function problem(t) { if (problems.indexOf(t) < 0) { problems.push(t); } }
    function note(t) { if (notes.indexOf(t) < 0) { notes.push(t); } }

    // url(...) inside styles: a chosen file is put inside; an outside address is a problem.
    var colours = {};
    function lint(css, where) {
      if (/@font-face/i.test(css)) { problem(where + ' brings its own font (@font-face). Tools use the site\'s font: remove it.'); }
      css.replace(/font-family\s*:\s*([^;}]*)/gi, function (all, value) {
        if (!/^\s*(inherit|initial|unset|var\(|ui-monospace|monospace)/i.test(value)) {
          problem(where + ' sets its own font (font-family: ' + value.trim().slice(0, 40) + '). Tools use the site\'s font: remove that line. For numbers and codes use the class dame-mono.');
        }
        return all;
      });
      var own = css.replace(/--dame-accent\s*:[^;}]*/gi, '').match(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi);
      if (own) { colours[where] = (colours[where] || 0) + own.length; }
    }

    function styles(css, from, where) {
      lint(css, where);
      if (/@import/i.test(css)) { problem(where + ' uses @import. Put all styles in the style sheets you upload and remove @import.'); }
      return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, function (all, q, ref) {
        ref = ref.trim();
        if (/^data:/i.test(ref) || ref.charAt(0) === '#') { return all; }
        if (outside(ref)) { problem(where + ' loads ' + ref + ' from outside the site. Add that file to the upload and point to it by its name.'); return 'url("")'; }
        var target = resolve(from, ref);
        var uri = map[target] ? dataUri(target, map[target]) : '';
        if (!uri) { problem(where + ' points to ' + ref + ', which is not among the chosen files (or is not a picture or font). Add it or remove the line.'); return 'url("")'; }
        return 'url("' + uri + '")';
      }).replace(/<\/style/gi, '<\\/style');
    }

    function scan(js, where) {
      var m = js.match(/https?:\/\/[^\s'"`)<>]{4,80}/);
      if (m) { note(where + ' mentions the outside address ' + m[0] + '. Outside calls are blocked on this site; the tool must work without it.'); }
      if (/\b(localStorage|sessionStorage|indexedDB)\b/.test(js)) { problem(where + ' uses the browser\'s own storage (localStorage, sessionStorage or indexedDB). Inside a tool that stops the script at once. Remove it; to keep data use a table and Dame.table.'); }
      if (/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(js)) { note(where + ' tries to call a server. That is blocked; data goes only through Dame.table.'); }
      if (/\bnew\s+(Shared)?Worker\s*\(|\bimportScripts\s*\(/.test(js)) { problem(where + ' starts a background worker. Tools have none: do long work in small steps and write "await Dame.pause();" between them so the screen stays alive.'); }
      if (/(^|[^.\w])(alert|confirm|prompt)\s*\(/.test(js)) { note(where + ' uses a pop-up box (alert, confirm or prompt). Show messages with Dame.toast or a dame-note instead.'); }
    }

    var inlineTables = '';
    var pageNames = paths.filter(function (p) { return /\.html?$/i.test(p) && p.indexOf('/') < 0; });
    paths.filter(function (p) { return /\.html?$/i.test(p) && p.indexOf('/') >= 0; }).forEach(function (p) {
      problem('The page ' + p + ' is inside a folder. Put every page next to index.html.');
    });
    if (pageNames.indexOf('index.html') < 0) { problem('There is no page named index.html. A tool starts at index.html (small letters).'); }

    for (var i = 0; i < pageNames.length; i += 1) {
      var name = pageNames[i];
      if (!PAGE.test(name)) {
        problem('Rename the page ' + name + ': small letters, digits, dot, dash or underscore, ending in .html.');
        continue;
      }
      var doc = new DOMParser().parseFromString(text(map[name]), 'text/html');
      var head = doc.head;

      var block = doc.querySelector('script#dame-tables');
      if (block && !inlineTables) { inlineTables = block.textContent; }

      // Things a tool may not carry.
      Array.prototype.forEach.call(doc.querySelectorAll('base, meta[http-equiv], link[rel~="preload"], link[rel~="prefetch"], link[rel~="dns-prefetch"], link[rel~="preconnect"], link[rel~="modulepreload"], link[rel~="manifest"], link[rel~="icon"]'), function (n) { n.remove(); });
      Array.prototype.forEach.call(doc.querySelectorAll('iframe, frame, object, embed'), function (n) {
        problem(name + ' holds a <' + n.tagName.toLowerCase() + '>. A tool cannot show other pages or plug-ins inside itself: remove it.');
      });

      Array.prototype.forEach.call(doc.querySelectorAll('header, nav, footer'), function (n) {
        problem(name + ' has its own <' + n.tagName.toLowerCase() + '>. The site\'s bar already shows the tool\'s name, the way back and the user: remove it. For a title at the top use <div class="dame-head">.');
      });
      if (doc.querySelector('input[type="password"]')) {
        problem(name + ' asks for a password. A tool never signs anyone in and never asks for a password: remove that field.');
      }

      // The two kit lines: added if the page forgot them.
      var kitCss = doc.querySelector('link[href="' + KIT_CSS + '"]');
      var kitJs = doc.querySelector('script[src="' + KIT_JS + '"]');
      if (!kitCss) {
        kitCss = doc.createElement('link');
        kitCss.setAttribute('rel', 'stylesheet');
        kitCss.setAttribute('href', KIT_CSS);
      }
      if (!kitJs) {
        kitJs = doc.createElement('script');
        kitJs.setAttribute('src', KIT_JS);
      }

      // Libraries from the shelf: kept as they are, placed right after the kit.
      var shelfLines = [];
      Array.prototype.forEach.call(doc.querySelectorAll('script[src^="/_dame/v1/lib/"]'), function (n) {
        var id = (LIB.exec(n.getAttribute('src')) || [])[1];
        if (!id || libs.indexOf(id) < 0) {
          problem(name + ' asks for the library ' + n.getAttribute('src') + ', which the site does not provide. ' +
            (libs.length ? 'The shelf has: ' + libs.join(', ') + '.' : 'The shelf is empty.') + ' Ask IT to add it, or do without it.');
          n.remove();
          return;
        }
        ['defer', 'async', 'type', 'integrity', 'crossorigin'].forEach(function (a) { n.removeAttribute(a); });
        shelfLines.push(n);
      });

      // Style sheets.
      Array.prototype.forEach.call(doc.querySelectorAll('link[rel~="stylesheet"][href]'), function (n) {
        var ref = n.getAttribute('href');
        if (ref === KIT_CSS) { return; }
        if (outside(ref)) { problem(name + ' loads the style sheet ' + ref + ' from outside the site. Add the file to the upload and point to it by its name.'); n.remove(); return; }
        var target = resolve(name, ref);
        if (!map[target]) { problem(name + ' asks for the style sheet ' + ref + ', which is not among the chosen files. Add it.'); n.remove(); return; }
        var style = doc.createElement('style');
        style.textContent = styles(text(map[target]), target, target);
        n.replaceWith(style);
      });
      Array.prototype.forEach.call(doc.querySelectorAll('style'), function (n) {
        n.textContent = styles(n.textContent, name, name);
      });
      Array.prototype.forEach.call(doc.querySelectorAll('[style]'), function (n) {
        n.setAttribute('style', styles(n.getAttribute('style'), name, name));
      });

      // Scripts.
      var late = [];
      Array.prototype.forEach.call(doc.querySelectorAll('script'), function (n) {
        var ref = n.getAttribute('src');
        var type = (n.getAttribute('type') || '').toLowerCase();
        if (ref === KIT_JS || LIB.test(ref || '')) { return; }
        if (type && type !== 'module' && !/javascript|ecmascript/.test(type)) { return; }   // data blocks stay as they are
        var js = n.textContent;
        if (ref !== null) {
          if (outside(ref)) { problem(name + ' loads the script ' + ref + ' from outside the site. Add the file to the upload and point to it by its name.'); n.remove(); return; }
          var target = resolve(name, ref);
          if (!map[target]) { problem(name + ' asks for the script ' + ref + ', which is not among the chosen files. Add it.'); n.remove(); return; }
          js = text(map[target]);
          var wait = n.hasAttribute('defer') || type === 'module';
          ['src', 'defer', 'async', 'integrity', 'crossorigin', 'nomodule'].forEach(function (a) { n.removeAttribute(a); });
          n.textContent = js.replace(/<\/script/gi, '<\\/script');
          if (wait) { late.push(n); }
          scan(js, target);
        } else {
          scan(js, name);
        }
        if (type === 'module' && /(^|[\s;])import\s*[\w{*'"]|\bimport\s*\(/.test(js)) {
          problem((ref || name) + ' imports other script files. That cannot be packed: use plain scripts, one <script src> per file.');
        }
      });
      // A script that was to run after the page is read keeps that order.
      late.forEach(function (n) { doc.body.appendChild(n); });

      // Pictures, sound, film.
      Array.prototype.forEach.call(doc.querySelectorAll('img[src], source[src], audio[src], video[src], video[poster], input[type="image"][src], track[src]'), function (n) {
        ['src', 'poster'].forEach(function (attr) {
          var ref = n.getAttribute(attr);
          if (!ref || /^data:/i.test(ref)) { return; }
          if (outside(ref)) { problem(name + ' shows ' + ref + ' from outside the site. Add the file to the upload and point to it by its name.'); n.removeAttribute(attr); return; }
          var target = resolve(name, ref);
          var uri = map[target] ? dataUri(target, map[target]) : '';
          if (!uri) { problem(name + ' shows ' + ref + ', which is not among the chosen files (or is of a kind this site cannot pack). Add it or remove it.'); n.removeAttribute(attr); return; }
          n.setAttribute(attr, uri);
        });
      });
      Array.prototype.forEach.call(doc.querySelectorAll('[srcset]'), function (n) {
        n.removeAttribute('srcset');
        note(name + ' used "srcset" for a picture. It was removed; the plain "src" picture is shown.');
      });

      // Links to things that are not pages of this tool.
      Array.prototype.forEach.call(doc.querySelectorAll('a[href]'), function (n) {
        var ref = n.getAttribute('href');
        if (!ref || ref.charAt(0) === '#' || outside(ref)) { return; }
        if (!PAGE.test(ref) || pageNames.indexOf(ref) < 0) {
          problem(name + ' links to ' + ref + ', which is not a page of this tool. Link to a page next to index.html, or to a full outside address.');
        }
      });

      // The kit first, so it is in place before any of the tool's own code runs.
      shelfLines.reverse().forEach(function (n) { head.insertBefore(n, head.firstChild); });
      head.insertBefore(kitJs, head.firstChild);
      head.insertBefore(kitCss, head.firstChild);

      var html = '<!doctype html>\n' + doc.documentElement.outerHTML;
      var bytes = new TextEncoder().encode(html);
      if (bytes.length > MAX_PAGE) { problem(name + ' is larger than 20 MB once its pictures and scripts are packed in. Make the pictures smaller.'); }
      pages.push({ name: name, bytes: bytes, size: bytes.length, sha256: hex(await crypto.subtle.digest('SHA-256', bytes)) });
    }

    Object.keys(colours).forEach(function (where) {
      note(where + ' uses its own colours (' + colours[where] + ' places). Tools take their colours from the theme, for example var(--dame-text), var(--dame-line), var(--dame-ok), var(--dame-warn); a tool sets only --dame-accent.');
    });
    if (pages.length > 50) { problem('A version has 50 pages at most.'); }
    var total = pages.reduce(function (sum, p) { return sum + p.size; }, 0);
    if (total > MAX_VERSION) { problem('The version is larger than 200 MB in all.'); }

    // The tables the tool needs: in a file dame.json, or in the page itself in
    // <script type="application/json" id="dame-tables">. The site makes them
    // after the manager presses Create; this only reads the list.
    var manifest = null;
    var declared = map['dame.json'] ? text(map['dame.json']) : inlineTables;
    if (declared) {
      try {
        manifest = JSON.parse(declared);
        if (!manifest || typeof manifest !== 'object' || !manifest.tables || typeof manifest.tables !== 'object' || Array.isArray(manifest.tables)) { throw new Error('shape'); }
      } catch (e) {
        manifest = null;
        problem('The list of tables cannot be read. It must look like { "dame": 1, "tables": { "name": { "sharing": "team", "columns": { "column": "text" } } } }. Ask the AI to give it again.');
      }
    }

    return { pages: pages, problems: problems, notes: notes, manifest: manifest, total: total };
  }

  window.DamePack = Object.freeze({ collect: collect, fromCode: fromCode, pack: pack });
})();
