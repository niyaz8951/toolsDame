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

  var header = el('header', 'hub-bar');
  var userBox = el('span', 'hub-user');

  function bar() {
    var brand = el('a', 'hub-brand', 'DAME');
    brand.href = api.href(api.signedIn() ? 'hub.html' : 'index.html');
    header.appendChild(brand);
    header.appendChild(el('span', 'hub-title', document.body.dataset.title || ''));
    header.appendChild(userBox);
    header.appendChild(el('span', 'hub-tag', 'Demo'));
    document.body.insertBefore(header, document.body.firstChild);
  }

  function showUser(me) {
    clear(userBox);
    userBox.appendChild(el('span', 'hub-user-name', me.name));
    var out = el('button', 'dame-btn hub-small', 'Sign out');
    out.type = 'button';
    out.addEventListener('click', async function () {
      out.disabled = true;
      await api.signOut();
      leave('You are signed out.');
    });
    userBox.appendChild(out);
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
      var gone = ['signed_out', 'session_ended', 'pending', 'disabled', 'no_profile'];
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

  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return ''; }
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  bar();

  window.DameShell = Object.freeze({
    el: el, clear: clear, say: say, sayError: sayError, guard: guard,
    showUser: showUser, confirmButton: confirmButton, when: when
  });
})();
