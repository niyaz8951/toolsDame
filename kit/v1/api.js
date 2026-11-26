/*
 * kit/v1/api.js - the platform pages' one door to the server.
 * Serves: contract 1 (Identity: one sign-in, one session) and contract 3
 * (Access: pages only ask, the database decides).
 * Must not change: the base path is worked out from this file's own address
 * at run time (no account or repo name in code); only dame_* functions are
 * called, never a table; the publishable key travels in the apikey header and
 * the user's own token in Authorization; nothing here ever holds a secret key;
 * a database message is shown to the user only when the platform wrote it.
 */
(function () {
  'use strict';

  // This file lives at <base>/kit/v1/api.js, so the site root is two folders up.
  var base = new URL('../../', document.currentScript.src);
  var cfg = window.DAME_CONFIG || {};
  var url = String(cfg.supabaseUrl || '').replace(/\/+$/, '');
  var key = String(cfg.publishableKey || '');
  var STORE = 'dame.session';
  var NOTICE = 'dame.notice';
  var MAX_AGE = 12 * 60 * 60 * 1000;   // the database enforces this too

  // ---------------------------------------------------------------- config

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
    var real = /^https:\/\/[a-z0-9]{10,40}\.supabase\.co$/.test(url);
    // A test server on this computer is accepted only when the page itself is served from this computer.
    var local = location.hostname === '127.0.0.1' && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(url);
    if (!(real || local) || !key) { return 'wrong'; }
    return 'set';
  }

  // ---------------------------------------------------------------- errors

  function DameError(code, message, status) {
    this.name = 'DameError';
    this.code = code;
    this.message = message;
    this.status = status || 0;
  }
  DameError.prototype = Object.create(Error.prototype);

  var AUTH_TEXT = {
    invalid_credentials: 'Email or password is wrong. Try again, or ask an IT admin to reset your password.',
    email_not_confirmed: 'Confirm your email first: open the link in the email you received, then sign in.',
    user_already_exists: 'This email already has an account. Sign in instead.',
    email_exists: 'This email already has an account. Sign in instead.',
    weak_password: 'This password is too easy to guess. Use at least 12 characters, mixing words, digits and signs.',
    email_address_invalid: 'This email address is not accepted. Check it and try again.',
    validation_failed: 'Check the email address and the password, then try again.',
    over_email_send_rate_limit: 'Too many emails were sent in the last hour. Wait an hour and try again, or ask an IT admin.',
    over_request_rate_limit: 'Too many tries. Wait a few minutes and try again.',
    signup_disabled: 'New accounts are closed at the moment. Ask an IT admin.',
    user_banned: 'This account is blocked. Ask an IT admin.'
  };

  function authError(status, body) {
    var code = String((body && (body.error_code || body.error)) || 'http_' + status);
    if (code === 'invalid_grant') { code = 'invalid_credentials'; }
    if (status === 429 && !AUTH_TEXT[code]) { code = 'over_request_rate_limit'; }
    return new DameError(code, AUTH_TEXT[code] ||
      'That did not work. Try again; if it happens again, tell an IT admin this code: ' + code.slice(0, 40), status);
  }

  // ---------------------------------------------------------------- session

  function readSession() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE));
      if (s && typeof s.access_token === 'string' && typeof s.refresh_token === 'string' &&
          typeof s.expires_at === 'number' && typeof s.started_at === 'number') { return s; }
    } catch (e) { /* unreadable: treated as signed out */ }
    return null;
  }

  function writeSession(body, startedAt) {
    var s = {
      access_token: String(body.access_token),
      refresh_token: String(body.refresh_token),
      expires_at: Date.now() + Number(body.expires_in || 3600) * 1000,
      started_at: startedAt
    };
    localStorage.setItem(STORE, JSON.stringify(s));
    return s;
  }

  function clearSession() {
    try { localStorage.removeItem(STORE); } catch (e) { /* nothing to clear */ }
  }

  // A sentence for the start page to show once, after a redirect.
  function setNotice(text) { try { sessionStorage.setItem(NOTICE, text); } catch (e) { /* not shown */ } }
  function takeNotice() {
    try {
      var text = sessionStorage.getItem(NOTICE);
      sessionStorage.removeItem(NOTICE);
      return text || '';
    } catch (e) { return ''; }
  }

  // ---------------------------------------------------------------- calls

  async function post(path, body, token) {
    if (state() !== 'set') {
      throw new DameError('not_connected', 'The site is not connected to its database. Tell an IT admin.');
    }
    var headers = { 'apikey': key, 'Content-Type': 'application/json' };
    if (token) { headers.Authorization = 'Bearer ' + token; }
    var res;
    try {
      res = await fetch(url + path, {
        method: 'POST', headers: headers, body: JSON.stringify(body || {}),
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
      });
    } catch (e) {
      throw new DameError('offline', 'The server cannot be reached. Check your connection and try again.');
    }
    var data = null;
    try { data = await res.json(); } catch (e) { /* empty answer */ }
    return { ok: res.ok, status: res.status, data: data };
  }

  async function refresh(old) {
    var res = await post('/auth/v1/token?grant_type=refresh_token', { refresh_token: old.refresh_token });
    if (!res.ok || !res.data || !res.data.access_token) {
      if (res.status >= 500 || res.status === 429) { throw authError(res.status, res.data); }
      clearSession();
      throw new DameError('session_ended', 'Your session has ended. Sign in again.', 401);
    }
    return writeSession(res.data, old.started_at);
  }

  // The user's token, renewed when it is about to run out. One renewal at a
  // time across all open tabs, because a renewal token works only once.
  async function token(force) {
    var s = readSession();
    if (!s) { throw new DameError('signed_out', 'You are not signed in. Sign in and try again.', 401); }
    if (Date.now() - s.started_at > MAX_AGE) {
      clearSession();
      throw new DameError('session_ended', 'Your session has ended. Sign in again.', 401);
    }
    if (!force && s.expires_at - Date.now() > 60000) { return s.access_token; }
    var renew = async function () {
      var now = readSession();
      if (!now) { throw new DameError('signed_out', 'You are not signed in. Sign in and try again.', 401); }
      if (now.access_token !== s.access_token && now.expires_at - Date.now() > 60000) { return now.access_token; }
      return (await refresh(now)).access_token;
    };
    return (navigator.locks && navigator.locks.request)
      ? navigator.locks.request('dame.refresh', renew) : renew();
  }

  // Calls one dame_* function. Returns its answer, or throws a DameError whose
  // message can be shown to the user as it is.
  async function rpc(name, args) {
    if (!/^dame_[a-z_]{1,60}$/.test(name)) { throw new DameError('bad_request', 'Unknown action.'); }
    var res = await post('/rest/v1/rpc/' + name, args, await token());
    var data = res.data || {};
    // The token ran out between the check and the call: renew once and try again.
    if (!res.ok && res.status === 401 && /^PGRST30/.test(String(data.code))) {
      res = await post('/rest/v1/rpc/' + name, args, await token(true));
      data = res.data || {};
    }
    if (res.ok) { return res.data; }

    var code = String(data.code || '');
    if (/^PT\d{3}$/.test(code)) {            // written by the platform's own functions
      var reason = String(data.details || 'refused');
      if (reason === 'signed_out' || reason === 'session_ended') { clearSession(); }
      throw new DameError(reason, String(data.message || 'This was refused.'), res.status);
    }
    if (res.status === 401) {
      clearSession();
      throw new DameError('session_ended', 'Your session has ended. Sign in again.', 401);
    }
    if (code === '42501') { throw new DameError('not_allowed', 'You are not allowed to do this.', res.status); }
    throw new DameError('server', 'Something went wrong on the server. Try again; if it happens again, tell an IT admin this code: ' +
      (code || 'http_' + res.status).slice(0, 40), res.status);
  }

  // ---------------------------------------------------------------- files
  // A tool's pages live in the private store "tools". The store asks the
  // database, for every single file, whether this user may read or write it.

  function filePath(path) {
    return '/storage/v1/object/' + String(path).split('/').map(encodeURIComponent).join('/');
  }

  async function fileCall(method, route, body) {
    if (state() !== 'set') {
      throw new DameError('not_connected', 'The site is not connected to its database. Tell an IT admin.');
    }
    var headers = { 'apikey': key, 'Authorization': 'Bearer ' + await token() };
    if (body) { headers['Content-Type'] = 'text/html'; headers['x-upsert'] = 'false'; }
    try {
      return await fetch(url + route, {
        method: method, headers: headers, body: body || undefined,
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
      });
    } catch (e) {
      throw new DameError('offline', 'The server cannot be reached. Check your connection and try again.');
    }
  }

  // Stores one page of a version that is being uploaded. path: space/tool/version/page.html
  async function fileSend(path, blob) {
    var res = await fileCall('POST', filePath('tools/' + path), blob);
    if (!res.ok) {
      var data = null;
      try { data = await res.json(); } catch (e) { /* no details */ }
      throw new DameError('upload', 'The page ' + String(path).split('/').pop() + ' could not be stored. Try the upload again; ' +
        'if it happens again, tell an IT admin this code: ' + String((data && (data.error || data.statusCode)) || 'http_' + res.status).slice(0, 40), res.status);
    }
  }

  // Reads one stored page as bytes, if this user may.
  async function fileBytes(path) {
    var res = await fileCall('GET', filePath('authenticated/tools/' + path));
    if (!res.ok) {
      throw new DameError('file', 'This page of the tool could not be loaded. Reload; if it happens again, ask the tool\'s manager.', res.status);
    }
    return res.arrayBuffer();
  }

  // ---------------------------------------------------------------- sign-in

  async function signIn(email, password) {
    var res = await post('/auth/v1/token?grant_type=password', { email: email, password: password });
    if (!res.ok || !res.data || !res.data.access_token) { throw authError(res.status, res.data); }
    writeSession(res.data, Date.now());
  }

  // Returns 'signed_in', or 'confirm_email' when the person must open the link first.
  async function signUp(name, email, password) {
    var back = encodeURIComponent(new URL('index.html', base).href);
    var res = await post('/auth/v1/signup?redirect_to=' + back, { email: email, password: password, data: { name: name } });
    if (!res.ok) { throw authError(res.status, res.data); }
    if (res.data && res.data.access_token) {
      writeSession(res.data, Date.now());
      return 'signed_in';
    }
    return 'confirm_email';
  }

  async function signOut() {
    var s = readSession();
    if (s) {
      try { await rpc('dame_sign_out'); } catch (e) { /* signing out anyway */ }
      try { await post('/auth/v1/logout?scope=local', {}, s.access_token); } catch (e) { /* signing out anyway */ }
    }
    clearSession();
  }

  window.DameApi = Object.freeze({
    base: base.pathname,
    href: function (path) { return new URL(String(path), base).href; },
    state: state,
    keyProblem: keyProblem,
    signedIn: function () { return readSession() !== null; },
    signIn: signIn,
    signUp: signUp,
    signOut: signOut,
    rpc: rpc,
    fileSend: fileSend,
    fileBytes: fileBytes,
    setNotice: setNotice,
    takeNotice: takeNotice
  });
})();
