/*
 * tests/browser/phase1.mjs - the phase 1 test in a real browser, at desktop
 * width and at 390 px: sign in, request access, approval, the hub, IT admin.
 * Serves: phase 1 test ("pending and disabled users are refused") and
 * SECURITY "Browser". Must not change: it uses the pages exactly as they are
 * in the repo; only the database address is pointed at the stand-in.
 *
 * Needs once:  npm install --no-save @electric-sql/pglite playwright-core
 * Run:         node tests/browser/phase1.mjs        (exit code 0 = all passed)
 *              CHROME=/path/to/chrome node tests/browser/phase1.mjs
 */
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { start } from '../../tools/serve.mjs';
import { startMock, KEY } from './mock-supabase.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.env.SHOTS || '';
const SITE_PORT = 8141;
const MOCK_PORT = 8142;
const SITE = 'http://127.0.0.1:' + SITE_PORT + '/toolsDame/';
const MOCK = 'http://127.0.0.1:' + MOCK_PORT;
const REAL = ((await readFile(join(ROOT, 'kit/v1/config.js'), 'utf8')).match(/supabaseUrl:\s*'([^']*)'/) || [])[1];
const REAL_KEY = ((await readFile(join(ROOT, 'kit/v1/config.js'), 'utf8')).match(/publishableKey:\s*'([^']*)'/) || [])[1];
const PW = 'correct horse battery 42';
const EVIL = '<img src=x onerror=alert(1)>';

let failed = 0;
function check(ok, what) {
  if (!ok) { failed += 1; }
  console.log((ok ? 'ok    ' : 'FAIL  ') + what);
}

async function run(width, height, label) {
  const mock = await startMock(MOCK_PORT);
  const site = await start(SITE_PORT, (rel, text) => text.split(REAL).join(MOCK).split(REAL_KEY).join(KEY));
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const problems = [];

  async function person() {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      // A refused call is expected in this test; anything else is a problem.
      if (m.type() === 'error' && !/Failed to load resource.*(40[013])/.test(m.text())) { problems.push(m.text()); }
    });
    page.on('pageerror', (e) => problems.push(String(e)));
    page.on('dialog', (d) => { problems.push('dialog opened: ' + d.message()); d.dismiss(); });
    return page;
  }
  const visible = (page, sel) => page.locator(sel).isVisible();
  const fits = async (page) => (await page.evaluate(() => document.documentElement.scrollWidth)) <= width;
  const shot = async (page, name) => {
    if (SHOTS) { await mkdir(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, label + '-' + name + '.png'), fullPage: true }); }
  };
  async function request(page, name, email) {
    await page.goto(SITE);
    await page.click('#to-request');
    await page.fill('#rq-name', name);
    await page.fill('#rq-email', email);
    await page.fill('#rq-password', PW);
    await page.fill('#rq-password2', PW);
    await page.click('#form-request button[type=submit]');
    await page.waitForSelector('#notice:not([hidden])');
  }
  async function signIn(page, email, password = PW) {
    await page.fill('#si-email', email);
    await page.fill('#si-password', password);
    await page.click('#form-signin button[type=submit]');
  }
  async function twice(page, selector) {
    await page.click(selector);
    await page.click(selector);
  }

  try {
    const T = label + ': ';
    const owner = await person();

    // --- signed out
    await owner.goto(SITE);
    await owner.waitForSelector('#panel-signin:not([hidden])');
    check(await visible(owner, '#form-signin'), T + 'start page shows the sign-in form');
    check(await fits(owner), T + 'start page fits the screen');
    await shot(owner, '1-signin');
    await owner.goto(SITE + 'hub.html');
    await owner.waitForURL(SITE + 'index.html');
    check(true, T + 'hub without sign-in goes to the start page');
    await owner.goto(SITE + 'admin/it.html');
    await owner.waitForURL(SITE + 'index.html');
    check(true, T + 'IT admin without sign-in goes to the start page');

    await signIn(owner, 'owner@test.dame');
    await owner.waitForSelector('#si-msg:not([hidden])');
    check(/Email or password is wrong/.test(await owner.textContent('#si-msg')), T + 'wrong sign-in says what to do');

    // --- request access
    await owner.click('#to-request');
    await owner.fill('#rq-name', 'Olga Owner');
    await owner.fill('#rq-email', 'owner@test.dame');
    await owner.fill('#rq-password', 'short');
    await owner.fill('#rq-password2', 'short');
    await owner.click('#form-request button[type=submit]');
    check(/12 characters/.test(await owner.textContent('#rq-msg')), T + 'short password refused with a plain sentence');
    await shot(owner, '2-request');
    await request(owner, 'Olga Owner', 'owner@test.dame');
    check(/Open the email/.test(await owner.textContent('#notice')), T + 'request tells the person to open the email');
    await signIn(owner, 'owner@test.dame');
    await owner.waitForSelector('#si-msg:not([hidden])');
    check(/Confirm your email first/.test(await owner.textContent('#si-msg')), T + 'sign-in before confirming is refused');
    mock.confirm('owner@test.dame');
    await signIn(owner, 'owner@test.dame');
    await owner.waitForSelector('#panel-wait:not([hidden])');
    check(/Waiting for approval/.test(await owner.textContent('#wait-title')), T + 'new account waits for approval');
    await shot(owner, '3-waiting');
    await owner.goto(SITE + 'hub.html');
    await owner.waitForURL(SITE + 'index.html');
    await owner.waitForSelector('#panel-wait:not([hidden])');
    check(true, T + 'pending user cannot open the hub');
    check((await owner.evaluate(() => window.DameApi.rpc('dame_me').catch((e) => e.code))) === 'pending', T + 'pending user is refused by the database');

    // --- first IT admin (the owner, in the SQL editor)
    await mock.sql("select core.make_first_admin('owner@test.dame')");
    await owner.click('#wait-check');
    await owner.waitForURL(SITE + 'hub.html');
    await owner.waitForSelector('#main:not([hidden])');
    check(/Hello, Olga Owner/.test(await owner.textContent('#hello')), T + 'approved user lands on the hub');
    check(await visible(owner, '#it-card'), T + 'IT admin sees the IT admin card');
    check(await visible(owner, '#empty'), T + 'hub says plainly that there are no spaces yet');
    check(await fits(owner), T + 'hub fits the screen');
    await shot(owner, '4-hub');

    // --- a second person, and one with a hostile name
    const bea = await person();
    await request(bea, 'Bea Member', 'bea@test.dame');
    mock.confirm('bea@test.dame');
    await signIn(bea, 'bea@test.dame');
    await bea.waitForSelector('#panel-wait:not([hidden])');
    const evil = await person();
    await request(evil, EVIL, 'evil@test.dame');
    mock.confirm('evil@test.dame');
    await signIn(evil, 'evil@test.dame');
    await evil.waitForSelector('#panel-wait:not([hidden])');

    // --- IT admin page
    await owner.goto(SITE + 'admin/it.html');
    await owner.waitForSelector('#body:not([hidden])');
    check((await owner.locator('#waiting tr').count()) === 2, T + 'IT admin sees the two waiting accounts');
    check((await owner.textContent('#waiting')).includes(EVIL), T + 'a hostile name is shown as plain text');
    check((await owner.locator('#waiting img').count()) === 0, T + 'a hostile name creates no element');
    check(await fits(owner), T + 'IT admin page fits the screen');
    await shot(owner, '5-it-admin');
    await owner.click('#waiting tr:has-text("Bea Member") button:has-text("Approve")');
    await owner.waitForSelector('#msg.hub-ok');
    check(/Bea Member is approved/.test(await owner.textContent('#msg')), T + 'approve works and says so');
    check((await owner.locator('#people tr:has-text("Bea Member")').count()) === 1, T + 'approved person moves to People');
    check((await owner.locator('#people tr:has-text("(you)") button').count()) === 0, T + 'IT admin has no buttons on his own row');
    await twice(owner, '#waiting tr:has-text("evil@test.dame") button:has-text("Refuse"), #waiting tr:has-text("evil@test.dame") button:has-text("Press again")');
    await owner.waitForSelector('#msg.hub-ok:has-text("refused")');
    check((await owner.locator('#waiting tr').count()) === 0, T + 'refuse needs two presses and empties the waiting list');

    await owner.selectOption('#ai-mode', 'prompt_all');
    await owner.click('#ai-save');
    await owner.waitForSelector('#msg.hub-ok:has-text("Setting saved")');
    check(/changed a setting/.test(await owner.textContent('#audit tr >> nth=0')), T + 'the change is at the top of the audit');
    check((await owner.locator('#audit tr').count()) >= 6, T + 'audit lists every action');
    await shot(owner, '6-it-admin-after');

    // --- the member
    await bea.click('#wait-check');
    await bea.waitForURL(SITE + 'hub.html');
    await bea.waitForSelector('#main:not([hidden])');
    check(!(await visible(bea, '#it-card')), T + 'member does not see the IT admin card');
    await bea.goto(SITE + 'admin/it.html');
    await bea.waitForSelector('#msg:not([hidden])');
    check(/Only an IT admin/.test(await bea.textContent('#msg')) && !(await visible(bea, '#body')), T + 'member opening the IT page sees nothing');
    const tries = await bea.evaluate(async () => {
      const out = [];
      for (const [name, args] of [['dame_users_list', {}], ['dame_audit_list', {}],
        ['dame_setting_set', { p_key: 'ai_mode', p_value: 'off' }],
        ['dame_user_set_it', { p_user: '00000000-0000-4000-8000-000000000001', p_is_it: true }]]) {
        out.push(await window.DameApi.rpc(name, args).then(() => 'ALLOWED', (e) => e.code));
      }
      return out.join(',');
    });
    check(tries === 'not_allowed,not_allowed,not_allowed,not_allowed', T + 'member calling IT functions directly is refused (' + tries + ')');
    check((await bea.evaluate(() => window.DameApi.rpc('dame_me').then((m) => m.ai_mode))) === 'prompt_all', T + 'member sees the site setting');

    // --- the token runs out: renewed without the person noticing
    mock.expireTokens();
    check((await bea.evaluate(() => window.DameApi.rpc('dame_me').then((m) => m.name, (e) => e.code))) === 'Bea Member', T + 'a token that ran out is renewed once');

    // --- switched off: loses everything at the next click
    await owner.goto(SITE + 'admin/it.html');
    await owner.waitForSelector('#body:not([hidden])');
    const off = '#people tr:has-text("Bea Member") button:has-text("Switch off"), #people tr:has-text("Bea Member") button:has-text("Press again")';
    await owner.click(off);
    check((await owner.locator('#people tr:has-text("Bea Member") .hub-pill-ok').count()) === 1, T + 'one press on Switch off changes nothing');
    await owner.click(off);
    await owner.waitForSelector('#msg.hub-ok:has-text("switched off")');
    await bea.goto(SITE + 'hub.html');
    await bea.waitForURL(SITE + 'index.html');
    await bea.waitForSelector('#panel-signin:not([hidden])');
    check(/session has ended/.test(await bea.textContent('#notice')), T + 'switched-off person is sent out at the next click');
    await signIn(bea, 'bea@test.dame');
    await bea.waitForSelector('#panel-wait:not([hidden])');
    check(/switched off/.test(await bea.textContent('#wait-title')) && !(await visible(bea, '#wait-check')), T + 'switched-off person is told so and can only sign out');
    await shot(bea, '7-switched-off');

    // --- one session per person
    const owner2 = await person();
    await owner2.goto(SITE);
    await owner2.waitForSelector('#panel-signin:not([hidden])');
    await signIn(owner2, 'owner@test.dame');
    await owner2.waitForURL(SITE + 'hub.html');
    await owner.goto(SITE + 'hub.html');
    await owner.waitForURL(SITE + 'index.html');
    await owner.waitForSelector('#panel-signin:not([hidden])');
    check(/session has ended/.test(await owner.textContent('#notice')), T + 'signing in elsewhere ends the older session');

    // --- sign out
    await owner2.waitForSelector('.hub-user button');
    const stored = await owner2.evaluate(() => JSON.stringify(Object.keys(localStorage)) + JSON.stringify(Object.keys(sessionStorage)) + localStorage.getItem('dame.session'));
    check(stored.startsWith('["dame.session"][]') && !stored.includes(PW), T + 'the browser keeps one session entry and no password');
    const before = await owner2.evaluate(() => JSON.parse(localStorage.getItem('dame.session')).access_token);
    await owner2.click('.hub-user button');
    await owner2.waitForURL(SITE + 'index.html');
    await owner2.waitForSelector('#panel-signin:not([hidden])');
    check((await owner2.evaluate(() => localStorage.getItem('dame.session'))) === null, T + 'sign out clears the session');
    const after = await owner2.evaluate(async ([mockUrl, key, token]) => {
      const r = await fetch(mockUrl + '/rest/v1/rpc/dame_me', { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}' });
      return r.status;
    }, [MOCK, KEY, before]);
    check(after === 401, T + 'the old token is useless after sign out');

    // --- how the pages talk to the server
    check(mock.calls.every((c) => /^\/(auth\/v1\/(signup|token|logout)|rest\/v1\/rpc\/dame_[a-z_]+)$/.test(c.path)), T + 'pages call only sign-in and dame_* functions');
    check(!owner2.url().includes(PW) && !owner.url().includes('password'), T + 'no password in any address');
    check(problems.length === 0, T + 'no page error, blocked load or dialog' + (problems.length ? ' -> ' + problems.join(' | ') : ''));
  } catch (err) {
    check(false, label + ': the test stopped: ' + String(err).split('\n')[0] + (problems.length ? ' | ' + problems.join(' | ') : ''));
  } finally {
    await browser.close();
    site.close();
    mock.server.close();
  }
}

await run(1280, 800, 'desktop');
await run(390, 844, 'phone');
console.log(failed ? '\n' + failed + ' check(s) FAILED' : '\nAll checks passed');
process.exit(failed ? 1 : 0);
