/*
 * kit/v1/dame.js - the tool kit script, version 1 (contract 4).
 * A tool loads it with the kit line for /_dame/v1/dame.js (see docs/BEDROCK.md);
 * the shell puts this file in its place when it loads the tool into the sealed
 * frame. For that reason this file must never contain a closing script tag,
 * not even inside a comment or a string.
 * Must not change: v1 only gets additions. The Dame object below is the whole
 * promise made to tools (docs/BEDROCK.md). This file runs INSIDE the sealed
 * frame, next to untrusted code: it holds no token, no address and no key, and
 * everything it asks for is checked again by the shell and by the database.
 */
(function () {
  'use strict';

  if (window.Dame) { return; }

  // Calls that could reach outside without the page policy seeing them.
  ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCSessionDescription', 'RTCIceCandidate'].forEach(function (name) {
    try {
      Object.defineProperty(window, name, { value: undefined, writable: false, configurable: false });
    } catch (e) { /* already locked */ }
  });

  var port = null;
  var seq = 0;
  var waiting = {};

  function fail(message, code) {
    var err = new Error(message || 'That did not work. Try again.');
    err.code = code || 'error';
    return err;
  }

  // The shell hands over one private line (a message port) when the page has loaded.
  var connected = new Promise(function (resolve) {
    function onInit(ev) {
      if (ev.source !== window.top || !ev.data || ev.data.dame !== 'init' || !ev.ports || !ev.ports[0]) { return; }
      window.removeEventListener('message', onInit);
      port = ev.ports[0];
      port.onmessage = function (m) {
        var d = m.data || {};
        var w = waiting[d.id];
        if (!w) { return; }
        delete waiting[d.id];
        if (d.ok) { w.resolve(d.result); } else { w.reject(fail(d.message, d.code)); }
      };
      resolve();
    }
    window.addEventListener('message', onInit);
  });

  function call(action, args) {
    return connected.then(function () {
      return new Promise(function (resolve, reject) {
        seq += 1;
        waiting[seq] = { resolve: resolve, reject: reject };
        try {
          port.postMessage({ id: seq, action: action, args: args || {} });
        } catch (e) {
          delete waiting[seq];
          reject(fail('This cannot be sent: it holds something that is not plain data.', 'bad_request'));
        }
      });
    });
  }

  // When the tool's own code stops with an error, the site is told, so that the
  // person who builds the tool sees why instead of a page that does nothing.
  var reported = 0;
  function report(message) {
    if (reported >= 3) { return; }
    reported += 1;
    connected.then(function () {
      try { port.postMessage({ id: 0, action: 'error', args: { message: String(message || 'unknown problem').slice(0, 500) } }); } catch (e) { /* not told */ }
    });
  }
  window.addEventListener('error', function (ev) { report(ev.message); });
  window.addEventListener('unhandledrejection', function (ev) { report((ev.reason && ev.reason.message) || ev.reason); });

  // Marks the page as a tool, so plain HTML gets the site's look (see dame.css).
  document.documentElement.classList.add('dame-tool');

  var ready = null;

  function table(name) {
    name = String(name);
    return Object.freeze({
      list: function (options) { return call('table.list', { table: name, options: options || {} }); },
      get: function (id) { return call('table.get', { table: name, id: id }); },
      add: function (row) { return call('table.add', { table: name, row: row }); },
      update: function (id, patch) { return call('table.update', { table: name, id: id, patch: patch }); },
      remove: function (id) { return call('table.remove', { table: name, id: id }); }
    });
  }

  var toastBox = null;
  var toastTimer = null;
  function toast(text) {
    if (!document.body) { return; }
    if (!toastBox) {
      toastBox = document.createElement('div');
      toastBox.className = 'dame-toast';
      toastBox.setAttribute('role', 'status');
      document.body.appendChild(toastBox);
    }
    toastBox.textContent = String(text);
    toastBox.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastBox.hidden = true; }, 3500);
  }

  // Links: another page of this tool is opened by the shell; an outside link
  // is opened only after the person confirms; a file the tool made itself is
  // saved; anything else stays put.
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a) { return; }
    var href = a.getAttribute('href') || '';
    if (href.charAt(0) === '#') { return; }
    ev.preventDefault();
    if (/^[a-z0-9][a-z0-9._-]{0,59}\.html$/.test(href)) {
      call('page', { name: href }).catch(function (e) { toast(e.message); });
    } else if (/^(https?:\/\/|mailto:)/i.test(href)) {
      call('link', { url: href }).catch(function (e) { toast(e.message); });
    } else {
      toast('This link cannot be opened from inside a tool.');
    }
  }, true);

  // Saves a file the tool made (text, bytes or a Blob) to the person's computer.
  // The tool cannot download by itself: the site's page does it, for harmless kinds of file.
  function download(name, data) {
    var ready = (typeof Blob !== 'undefined' && data instanceof Blob) ? data.arrayBuffer() : Promise.resolve(data);
    return ready.then(function (bytes) {
      return call('download', { name: String(name || 'download'), data: bytes });
    }).catch(function (e) {
      toast(e.message);
      throw e;
    });
  }

  // Lets the screen catch up during long work: await Dame.pause();
  function pause() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  // Makes an element a place to drop files or press to choose them.
  // options: { accept: ['.xlsx', '.csv'], multiple: true }; onFiles gets an array of File.
  function drop(element, options, onFiles) {
    if (typeof options === 'function') { onFiles = options; options = {}; }
    options = options || {};
    var accept = (options.accept || []).map(function (x) { return String(x).toLowerCase(); });
    var input = document.createElement('input');
    input.type = 'file';
    input.hidden = true;
    input.multiple = options.multiple !== false;
    if (accept.length) { input.accept = accept.join(','); }
    element.parentNode.insertBefore(input, element.nextSibling);
    if (!element.hasAttribute('tabindex')) { element.setAttribute('tabindex', '0'); }
    if (!element.hasAttribute('role')) { element.setAttribute('role', 'button'); }

    function give(list) {
      var files = Array.prototype.filter.call(list || [], function (f) {
        var name = f.name.toLowerCase();
        return name.indexOf('~$') !== 0 && (!accept.length || accept.some(function (x) { return name.slice(-x.length) === x; }));
      });
      if (!input.multiple) { files = files.slice(0, 1); }
      if (files.length) { onFiles(files); }
      else if (list && list.length) { toast('Choose ' + (accept.join(', ') || 'a file') + '.'); }
    }
    element.addEventListener('click', function () { input.click(); });
    element.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); input.click(); }
    });
    element.addEventListener('dragover', function (ev) { ev.preventDefault(); element.classList.add('is-over'); });
    element.addEventListener('dragleave', function () { element.classList.remove('is-over'); });
    element.addEventListener('drop', function (ev) {
      ev.preventDefault();
      element.classList.remove('is-over');
      give(ev.dataTransfer && ev.dataTransfer.files);
    });
    input.addEventListener('change', function () { give(input.files); input.value = ''; });
  }

  // Sets a progress bar (<div class="dame-progress"><span></span></div>) to 0..1.
  function progress(element, fraction) {
    var f = Math.max(0, Math.min(1, Number(fraction) || 0));
    var bar = element.firstElementChild;
    if (bar) { bar.style.width = (f * 100).toFixed(1) + '%'; }
    element.setAttribute('role', 'progressbar');
    element.setAttribute('aria-valuemin', '0');
    element.setAttribute('aria-valuemax', '100');
    element.setAttribute('aria-valuenow', String(Math.round(f * 100)));
  }

  window.Dame = Object.freeze({
    version: 1,
    ready: function () {
      if (!ready) { ready = call('ready'); }
      return ready;
    },
    table: table,
    files: Object.freeze({
      upload: function (file) { return call('files.upload', { file: file }); },
      url: function (id) { return call('files.url', { id: id }); }
    }),
    // The people who have this tool: [{ id, name }]. For showing who added a row and for choosing a person.
    people: function () { return call('people'); },
    toast: toast,
    download: download,
    pause: pause,
    drop: drop,
    progress: progress
  });
})();
