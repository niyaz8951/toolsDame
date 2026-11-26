/*
 * pages/index.js - the start page: sign in, request access, wait for approval.
 * Serves: contract 1 (Identity).
 * Must not change: a password is only ever handed to DameApi.signIn / signUp,
 * never stored, logged or put in an address; a sign-in link that carries a
 * token in the address is not used to sign in (the person signs in himself);
 * what the page shows decides nothing: the database approves or refuses.
 */
(function () {
  'use strict';

  var api = window.DameApi;
  var ui = window.DameShell;
  if (!ui) { return; }

  function $(id) { return document.getElementById(id); }

  var panels = ['panel-signin', 'panel-request', 'panel-wait', 'panel-newpw', 'panel-busy'];
  function show(id) {
    panels.forEach(function (p) { $(p).hidden = (p !== id); });
    var first = $(id).querySelector('input, button');
    if (first && id !== 'panel-busy') { first.focus(); }
  }

  function busy(form, on) {
    Array.prototype.forEach.call(form.querySelectorAll('button, input'), function (n) { n.disabled = on; });
  }

  // Where the signed-in person goes next: the hub, or the waiting panel.
  async function next() {
    show('panel-busy');
    var res = await api.rpc('dame_request_access');
    if (res && res.status === 'active' && res.must_change) {
      // An account made by IT: the temporary password must be replaced before anything opens.
      show('panel-newpw');
      return;
    }
    if (res && res.status === 'active') {
      location.replace(api.href('hub.html'));
      return;
    }
    var off = res && res.status === 'disabled';
    $('wait-title').textContent = off ? 'Account switched off' : 'Waiting for approval';
    $('wait-text').textContent = off
      ? 'Your account is switched off. Ask an IT admin if this is a mistake.'
      : 'Your request has reached IT. An IT admin must approve it before you can open anything. Come back later and press Check again.';
    $('wait-check').hidden = off;
    ui.say($('wait-msg'), '');
    show('panel-wait');
  }

  async function start() {
    // 1. Is the site connected?
    var st = api.state();
    if (st !== 'set') {
      var text = {
        empty: 'The site is not connected to a database yet. Nobody can sign in.',
        wrong: 'The database address or key in config.js is not in the expected form. Tell an IT admin.',
        unsafe: api.keyProblem() + ' Remove it from config.js now and rotate it in Supabase.'
      }[st];
      ui.say($('notice'), text, 'warn');
      $('panel-busy').hidden = true;
      return;
    }

    // 2. Arrived from the link in the confirmation email? Never sign in from
    //    the address: clear it and ask the person to sign in himself.
    var hash = location.hash;
    if (hash.length > 1) {
      history.replaceState(null, '', location.pathname + location.search);
      if (/error/.test(hash)) {
        ui.say($('notice'), 'That link did not work or is too old. Sign in; if that fails, request access again.', 'warn');
      } else if (/access_token|type=signup/.test(hash)) {
        ui.say($('notice'), 'Your email is confirmed. Sign in to continue.', 'ok');
      }
    } else {
      var note = api.takeNotice();
      if (note) { ui.say($('notice'), note, ''); }
    }

    // 3. Already signed in?
    if (api.signedIn()) {
      try {
        await next();
        return;
      } catch (err) {
        if (err.code === 'not_allowed') {
          // An address the site does not accept (see "who may ask for access"): signed out again, told why.
          await api.signOut();
          ui.sayError($('notice'), err);
        } else if (err.code !== 'signed_out' && err.code !== 'session_ended') {
          ui.sayError($('notice'), err);
        } else {
          ui.say($('notice'), err.message, '');
        }
      }
    }
    show('panel-signin');
  }

  $('form-newpw').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var form = ev.currentTarget;
    var pw = $('np-password').value;
    var problem = pw !== $('np-password2').value ? 'The two passwords differ. Type the same password twice.'
      : !/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{10,72}$/.test(pw) ? 'Use at least 10 characters, with a small letter, a capital letter and a digit.' : '';
    if (problem) { ui.say($('np-msg'), problem, 'warn'); return; }
    busy(form, true);
    ui.say($('np-msg'), '');
    try {
      await api.setPassword(pw);
      await api.rpc('dame_password_done');
      $('np-password').value = '';
      $('np-password2').value = '';
      await next();
    } catch (err) {
      ui.sayError($('np-msg'), err);
      show('panel-newpw');
    } finally {
      busy(form, false);
    }
  });
  $('np-out').addEventListener('click', async function () {
    await api.signOut();
    show('panel-signin');
  });

  $('form-signin').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var form = ev.currentTarget;
    var email = $('si-email').value.trim();
    var password = $('si-password').value;
    if (!email || !password) {
      ui.say($('si-msg'), 'Type your email or username, and your password.', 'warn');
      return;
    }
    busy(form, true);
    ui.say($('si-msg'), '');
    try {
      await api.signIn(email, password);
      $('si-password').value = '';
      ui.say($('notice'), '');
      await next();
    } catch (err) {
      if (err && err.code === 'not_allowed') { await api.signOut(); }
      ui.sayError($('si-msg'), err);
      show('panel-signin');
    } finally {
      busy(form, false);
    }
  });

  $('form-request').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var form = ev.currentTarget;
    var name = $('rq-name').value.trim();
    var email = $('rq-email').value.trim();
    var p1 = $('rq-password').value;
    var p2 = $('rq-password2').value;
    var problem = !name ? 'Type your name.'
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'Type your work email address, like name@company.com.'
      : p1.length < 12 ? 'The password needs 12 characters or more.'
      : p1 !== p2 ? 'The two passwords are not the same. Type them again.' : '';
    if (problem) {
      ui.say($('rq-msg'), problem, 'warn');
      return;
    }
    busy(form, true);
    ui.say($('rq-msg'), '');
    try {
      var result = await api.signUp(name, email, p1);
      $('rq-password').value = '';
      $('rq-password2').value = '';
      if (result === 'signed_in') {
        await next();
      } else {
        $('si-email').value = email;
        ui.say($('notice'), 'Almost done. Open the email we sent to ' + email + ' and press the link in it. Then sign in here. ' +
          'No email after a few minutes? Check the spam folder, or you may already have an account: try to sign in.', 'ok');
        show('panel-signin');
      }
    } catch (err) {
      ui.sayError($('rq-msg'), err);
      show('panel-request');
    } finally {
      busy(form, false);
    }
  });

  $('to-request').addEventListener('click', function () { show('panel-request'); });
  $('to-signin').addEventListener('click', function () { show('panel-signin'); });

  $('wait-check').addEventListener('click', async function () {
    try {
      await next();
      ui.say($('wait-msg'), 'Not approved yet. Try again later.', '');
    } catch (err) {
      if (err.code === 'signed_out' || err.code === 'session_ended') {
        ui.say($('notice'), err.message, '');
        show('panel-signin');
      } else {
        show('panel-wait');
        ui.sayError($('wait-msg'), err);
      }
    }
  });

  $('wait-out').addEventListener('click', async function () {
    await api.signOut();
    ui.say($('notice'), 'You are signed out.', '');
    show('panel-signin');
  });

  start().catch(function (err) {
    ui.sayError($('notice'), err);
    show('panel-signin');
  });
})();
