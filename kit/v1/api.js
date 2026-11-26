/*
 * kit/v1/api.js - the platform pages' one door to the server.
 * Serves: contract 3 (Access): pages only ask, the database decides.
 * Must not change: the base path is worked out from this file's own address
 * at run time (no account or repo name in code); nothing here ever holds a
 * secret key. Phase 0 has no server calls yet: dame_* calls arrive in phase 1.
 */
(function () {
  'use strict';

  // This file lives at <base>/kit/v1/api.js, so the site root is two folders up.
  var base = new URL('../../', document.currentScript.src);
  var cfg = window.DAME_CONFIG || {};
  var url = String(cfg.supabaseUrl || '');
  var key = String(cfg.publishableKey || '');

  // Returns a plain sentence if the key looks like one that must never be public.
  function keyProblem() {
    if (!key) { return ''; }
    if (key.indexOf('sb_secret_') === 0) { return 'A secret key is in config.js.'; }
    var parts = key.split('.');
    if (parts.length === 3) {
      try {
        var body = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (body && body.role && body.role !== 'anon') {
          return 'A ' + body.role + ' key is in config.js.';
        }
      } catch (e) { return 'The key in config.js cannot be read.'; }
    }
    return '';
  }

  function state() {
    if (keyProblem()) { return 'unsafe'; }
    if (!url && !key) { return 'empty'; }
    if (!/^https:\/\/[a-z0-9]{10,40}\.supabase\.co$/.test(url) || !key) { return 'wrong'; }
    return 'set';
  }

  window.DameApi = Object.freeze({
    base: base.pathname,
    href: function (path) { return new URL(String(path), base).href; },
    state: state,
    keyProblem: keyProblem
  });
})();
