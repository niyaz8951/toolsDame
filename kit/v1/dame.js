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
  // is opened only after the person confirms; anything else stays put.
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
    toast: toast
  });
})();
