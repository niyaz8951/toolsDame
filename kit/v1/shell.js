/*
 * kit/v1/shell.js - the platform bar on every hub page.
 * Serves: "On every page" (bar now; info icon, notes, ideas, AI prompt in phase 5)
 * and SECURITY "Browser".
 * Must not change: data reaches the page with textContent only, never innerHTML;
 * a hub page refuses to run inside a frame (GitHub Pages cannot send the header
 * that would forbid it).
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
    if (text) { node.textContent = text; }
    return node;
  }

  function bar() {
    var header = el('header', 'hub-bar');
    var brand = el('a', 'hub-brand', 'DAME');
    brand.href = api.href('index.html');
    header.appendChild(brand);
    header.appendChild(el('span', 'hub-title', document.body.dataset.title || ''));
    header.appendChild(el('span', 'hub-tag', 'Demo'));
    document.body.insertBefore(header, document.body.firstChild);
  }

  var STATES = {
    empty: ['Database: not connected yet. The pages open, nothing can be saved.', ''],
    set: ['Database address is set. Sign-in arrives in phase 1.', 'hub-ok'],
    wrong: ['The database address or key in config.js is not in the expected form. Check both values.', 'hub-warn'],
    unsafe: ['Remove the key from config.js now and rotate it in Supabase.', 'hub-warn']
  };

  function status() {
    var box = document.querySelector('[data-hub-status]');
    if (!box) { return; }
    var s = STATES[api.state()];
    var problem = api.keyProblem();
    box.textContent = (problem ? problem + ' ' : '') + s[0];
    if (s[1]) { box.classList.add(s[1]); }
  }

  bar();
  status();
})();
