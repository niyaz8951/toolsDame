/*
 * tests/browser/accounts.mjs - accounts in a real browser, at desktop width
 * and at 390 px: "My account" (details, password, access, sign-ins), IT opening
 * a person, correcting the details and resetting a forgotten password.
 * Serves: db/core/010 test ("a reset opens nothing without the temporary
 * password; one person never reaches another") and SECURITY "Browser".
 * Must not change: it uses the pages exactly as they are in the repo; only the
 * database address is pointed at the stand-in.
 *
 * Needs once:  npm install --no-save @electric-sql/pglite playwright-core
 * Run:         node tests/browser/accounts.mjs      (exit code 0 = all passed)
 */
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { follow } from './parts.mjs';
import { start } from '../../tools/serve.mjs';
import { startMock, KEY } from './mock-supabase.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.env.SHOTS || '';
const SITE_PORT = 8161;
const MOCK_PORT = 8162;
const SITE = 'http://127.0.0.1:' + SITE_PORT + '/toolsDame/';
const MOCK = 'http://127.0.0.1:' + MOCK_PORT;
const REAL = ((await readFile(join(ROOT, 'kit/v1/config.js'), 'utf8')).match(/supabaseUrl:\s*'([^']*)'/) || [])[1];
const REAL_KEY = ((await readFile(join(ROOT, 'kit/v1/config.js'), 'utf8')).match(/publishableKey:\s*'([^']*)'/) || [])[1];
const PW = 'Correct-Horse-42';
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
  follow(browser);
  const problems = [];
  const T = label + ': ';

  async function person() {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource.*(40[013]|422)/.test(m.text())) { problems.push(m.text()); }
    });
    page.on('pageerror', (e) => problems.push(String(e)));
    page.on('dialog', (d) => { problems.push('dialog opened: ' + d.message()); d.dismiss(); });
    return page;
  }
  const fits = async (page) => (await page.evaluate(() => document.documentElement.scrollWidth)) <= width;
  const shot = async (page, name) => {
    if (SHOTS) { await mkdir(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, label + '-' + name + '.png'), fullPage: true }); }
  };
  async function signIn(page, who, password) {
    await page.goto(SITE);
    await page.waitForSelector('#panel-signin:not([hidden])');
    await page.fill('#si-email', who);
    await page.fill('#si-password', password);
    await page.click('#form-signin button[type=submit]');
  }
  async function twice(page, selector) {
    await page.click(selector);
    await page.click(selector);
  }
  const call = (page, name, args) => page.evaluate(([n, a]) => window.DameApi.rpc(n, a).then(() => 'ALLOWED', (e) => e.code), [name, args || {}]);

  try {
    await mock.addUser('ada@work.test', 'Ada IT', PW, true);
    const beaId = await mock.addUser('bea@work.test', 'Bea Member', PW);
    const calId = await mock.addUser('cal@work.test', 'Cal Other', PW);
    const adaId = (await mock.sql("select id::text as id from core.profiles where email = 'ada@work.test'")).rows[0].id;
    await mock.sql("insert into core.spaces (id, name, created_by) values ('sales', 'Sales', '" + adaId + "')");
    await mock.sql("insert into core.space_members (space, user_id, added_by) values ('sales', '" + beaId + "', '" + adaId + "')");
    await mock.sql("insert into core.tools (space, id, name, open_to_space, open_level, created_by) values ('sales', 'quotes', 'Quotes', true, 'contribute', '" + adaId + "')");

    // ------------------------------------------------ my account
    const bea = await person();
    await signIn(bea, 'bea@work.test', PW);
    await bea.waitForURL(SITE + 'hub.html');
    await bea.waitForSelector('#main:not([hidden])');
    await bea.click('.hub-account');
    check(await bea.locator('.hub-menu .hub-myaccount').isVisible(), T + 'the account button offers "My account"');
    await bea.click('.hub-menu .hub-myaccount');
    await bea.waitForURL(SITE + 'account.html');
    await bea.waitForSelector('#body:not([hidden])');
    check(/Bea Member/.test(await bea.textContent('#title')) && /bea@work\.test/.test(await bea.textContent('#facts')) && /Member/.test(await bea.textContent('#facts')), T + 'my account shows my name, my sign-in and my role');
    check((await bea.locator('#form-details input').count()) === 4 && (await bea.locator('#facts input').count()) === 0, T + 'I can change four work details; name, sign-in and staff number are not fields');
    check(await fits(bea), T + 'my account fits the screen');
    await shot(bea, '1-account');
    await bea.fill('#d-title', EVIL);
    await bea.fill('#d-dept', 'Sales');
    await bea.fill('#d-office', 'Dubai');
    await bea.fill('#d-phone', 'call me');
    await bea.click('#d-save');
    await bea.waitForSelector('#d-msg.hub-warn');
    check(/phone number/.test(await bea.textContent('#d-msg')), T + 'a phone that is no phone is refused by the database, in words');
    await bea.fill('#d-phone', '+971 4 123 4567');
    await bea.click('#d-save');
    await bea.waitForSelector('#d-msg.hub-ok');
    await bea.reload();
    await bea.waitForSelector('#body:not([hidden])');
    check((await bea.inputValue('#d-title')) === EVIL && (await bea.inputValue('#d-dept')) === 'Sales' && (await bea.locator('#main img').count()) === 0, T + 'details are saved and come back; hostile text stays text');

    await bea.click('#part-my-access');
    check(/Sales/.test(await bea.textContent('#spaces')) && /Member/.test(await bea.textContent('#spaces')) && /Quotes/.test(await bea.textContent('#tools')) && /Contribute/.test(await bea.textContent('#tools')), T + 'my access lists my space, my tool and my level');
    check(await fits(bea), T + 'my access fits the screen');
    await bea.click('#part-sign-ins');
    check((await bea.locator('#signins li').count()) >= 1 && /This one/.test(await bea.textContent('#signins')), T + 'my sign-ins are listed, this one marked');

    // ------------------------------------------------ changing my password
    await bea.click('#part-password');
    await bea.fill('#pw-now', 'not my password 1A');
    await bea.fill('#pw-new', 'My-New-Pass-2027');
    await bea.fill('#pw-new2', 'My-New-Pass-2027');
    await bea.click('#pw-save');
    await bea.waitForSelector('#pw-msg.hub-warn');
    check(/not right/.test(await bea.textContent('#pw-msg')), T + 'without the password I have now, nothing is changed');
    await bea.fill('#pw-now', PW);
    await bea.fill('#pw-new2', 'something else 1A');
    await bea.click('#pw-save');
    await bea.waitForSelector('#pw-msg.hub-warn:has-text("differ")');
    await bea.fill('#pw-new', 'weak');
    await bea.fill('#pw-new2', 'weak');
    await bea.click('#pw-save');
    await bea.waitForSelector('#pw-msg.hub-warn:has-text("at least 12")');
    await bea.fill('#pw-new', 'Short-Pass1');
    await bea.fill('#pw-new2', 'Short-Pass1');
    await bea.click('#pw-save');
    await bea.waitForSelector('#pw-msg.hub-warn:has-text("at least 12")');
    check(true, T + 'two different new passwords and a weak one are refused');
    await bea.fill('#pw-new', 'My-New-Pass-2027');
    await bea.fill('#pw-new2', 'My-New-Pass-2027');
    await bea.click('#pw-save');
    await bea.waitForSelector('#pw-msg.hub-ok');
    check(/is changed/.test(await bea.textContent('#pw-msg')) && (await bea.inputValue('#pw-now')) === '' && (await bea.inputValue('#pw-new')) === '', T + 'the password is changed and the fields are emptied');
    check((await call(bea, 'dame_me')) === 'ALLOWED', T + 'I stay signed in after changing it');
    check(/last chose your password today/i.test(await bea.textContent('#pw-last')), T + 'the page says when I last chose it');
    await shot(bea, '2-password');
    const stored = await bea.evaluate(() => JSON.stringify([localStorage, sessionStorage].map((s) => Object.keys(s).map((k) => s.getItem(k)))));
    check(!stored.includes('My-New-Pass-2027') && !stored.includes(PW) && !bea.url().includes('Pass'), T + 'no password is kept in the browser or in the address');

    // ------------------------------------------------ a member reaches nobody else
    const tries = [
      await call(bea, 'dame_user_get', { p_user: calId }),
      await call(bea, 'dame_user_get', { p_user: beaId }),
      await call(bea, 'dame_user_details_set', { p_user: beaId, p_name: 'Boss', p_job_title: '', p_department: '', p_office: '', p_phone: '', p_staff_no: '' }),
      await call(bea, 'dame_user_password_reset', { p_user: calId, p_temp_password: 'Temp-Pass-12345' }),
      await call(bea, 'dame_account_get', { p_user: calId }),
      await call(bea, 'dame_account_set', { p_user: calId, p_job_title: 'x', p_department: '', p_office: '', p_phone: '' })
    ].join(',');
    check(tries === 'not_allowed,not_allowed,not_allowed,not_allowed,server,server', T + 'a member cannot open, correct or reset anyone, and the account functions take no other person (' + tries + ')');
    check((await mock.sql("select name || '|' || job_title as v from core.profiles where email = 'cal@work.test'")).rows[0].v === 'Cal Other|', T + 'the other person is untouched');

    // ------------------------------------------------ IT opens a person and corrects the account
    const ada = await person();
    await signIn(ada, 'ada@work.test', PW);
    await ada.waitForURL(SITE + 'hub.html');
    await ada.goto(SITE + 'admin/it.html#people');
    await ada.waitForSelector('#body:not([hidden])');
    check((await ada.locator('#people tr:has-text("Bea Member") button').count()) === 1 && /Sales/.test(await ada.textContent('#people tr:has-text("Bea Member")')), T + 'a person is one line with one button, and shows the department');
    check((await ada.locator('#people img').count()) === 0, T + 'a hostile job title in the list creates no element');
    await ada.click('#people tr:has-text("Bea Member") button:text-is("Open")');
    await ada.waitForSelector('#person-win #pu-name');
    check(/1 space, 1 tool/.test(await ada.textContent('#person-win')) && /Last sign-in/.test(await ada.textContent('#person-win')), T + 'the window shows sign-in, password and access facts');
    check(await fits(ada), T + 'the person window fits the screen');
    await shot(ada, '3-person');
    await ada.fill('#pu-name', 'Bea Member-Smith');
    await ada.fill('#pu-staff', 'E-1042');
    await ada.click('#pu-save');
    await ada.waitForSelector('#person-win-msg.hub-ok');
    check(/Bea Member-Smith/.test(await ada.textContent('#person-win h2')) && /Bea Member-Smith/.test(await ada.textContent('#people')), T + 'IT corrects the name and the staff number; window and list show it');
    await ada.fill('#pu-staff', 'no spaces; drop');
    await ada.click('#pu-save');
    await ada.waitForSelector('#person-win-msg.hub-warn');
    check(/staff number/.test(await ada.textContent('#person-win-msg')), T + 'a bad staff number is refused, in words');

    // ------------------------------------------------ IT resets the password
    await ada.click('#pu-reset');
    await ada.click('#pu-reset');
    await ada.waitForSelector('#person-win-msg.hub-warn:has-text("Generate")');
    check((await call(bea, 'dame_me')) === 'ALLOWED', T + 'a reset without a temporary password does nothing');
    await ada.fill('#pu-temp', 'weak');
    await twice(ada, '#pu-reset');
    await ada.waitForSelector('#person-win-msg.hub-warn:has-text("at least 10")');
    await ada.click('#person-win button:text-is("Generate")');
    const temp = await ada.inputValue('#pu-temp');
    check(/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{14,}$/.test(temp), T + 'Generate writes a temporary password that can be read out');
    await ada.click('#pu-reset');
    check((await call(bea, 'dame_me')) === 'ALLOWED', T + 'one press on Reset password changes nothing');
    await ada.click('#pu-reset');
    await ada.waitForSelector('#person-win-msg.hub-ok');
    check(/is reset/.test(await ada.textContent('#person-win-msg')) && (await ada.inputValue('#pu-temp')) === temp, T + 'the reset says so; the temporary password stays readable in the window');
    check(/Must choose a password/.test(await ada.textContent('#person-win h2')) && /Must choose a password/.test(await ada.textContent('#people tr:has-text("Bea Member-Smith")')), T + 'window and list show that the person must choose a password');
    await shot(ada, '4-reset');
    await ada.click('#person-win-close');
    check(!(await ada.content()).includes(temp), T + 'after Done the temporary password is nowhere on the page');
    await ada.click('#part-audit');
    check(/reset the password of/.test(await ada.textContent('#audit')) && !(await ada.textContent('#audit')).includes(temp), T + 'the reset is in the audit, without the password');
    await ada.click('#part-people');
    await ada.click('#people tr:has-text("(you)") button:text-is("Open")');
    await ada.waitForSelector('#person-win #pu-name');
    check((await ada.locator('#person-win #pu-reset, #person-win #pu-temp').count()) === 0, T + 'IT has no reset for his own password');
    check((await call(ada, 'dame_user_password_reset', { p_user: adaId, p_temp_password: 'Temp-Pass-12345' })) === 'not_allowed', T + 'and the database refuses it too');
    await ada.click('#person-win-close');

    // ------------------------------------------------ the person after the reset
    check((await call(bea, 'dame_me')) === 'session_ended', T + 'the person is signed out at once');
    // A stranger who still held the old sign-in tries to finish the reset himself, without the temporary password.
    const stranger = await bea.evaluate(async () => {
      const out = [];
      out.push(await window.DameApi.rpc('dame_password_done', {}).then(() => 'ALLOWED', (e) => e.code));
      out.push(await window.DameApi.rpc('dame_password_done', { p_temp_password: 'Guess-Pass-12345' }).then(() => 'ALLOWED', (e) => e.code));
      return out.join(',');
    });
    check(!/ALLOWED/.test(stranger), T + 'an old sign-in cannot finish the reset (' + stranger + ')');
    await bea.goto(SITE + 'account.html');
    await bea.waitForSelector('#panel-signin:not([hidden])');
    await signIn(bea, 'bea@work.test', 'My-New-Pass-2027');
    await bea.waitForSelector('#si-msg:not([hidden])');
    check(/wrong/.test(await bea.textContent('#si-msg')), T + 'the old password no longer works');
    await signIn(bea, 'bea@work.test', temp);
    await bea.waitForSelector('#panel-newpw:not([hidden])');
    check(/Ada IT/.test(await bea.textContent('#np-text')) && /reset your password/.test(await bea.textContent('#np-text')), T + 'the person is told that IT reset the password, and who');
    check(!(await bea.locator('#np-temp').isVisible()), T + 'right after sign-in the temporary password is not asked a second time');
    check((await call(bea, 'dame_me')) === 'must_change' && (await call(bea, 'dame_account_get')) === 'must_change', T + 'nothing opens before the new password');
    check(await fits(bea), T + 'the new-password panel fits the screen');
    await shot(bea, '5-newpw');
    await bea.fill('#np-password', 'After-Reset-2027');
    await bea.fill('#np-password2', 'After-Reset-2027');
    await bea.click('#np-save');
    await bea.waitForURL(SITE + 'hub.html');
    await bea.waitForSelector('#main:not([hidden])');
    check(/Hello, Bea Member-Smith/.test(await bea.textContent('#hello')), T + 'with the new password the person is in, under the corrected name');
    check((await bea.locator('#spaces .hub-tile').count()) === 1, T + 'and has what he had before');

    // ------------------------------------------------ a stranger with a stolen sign-in changes the password first
    await ada.goto(SITE + 'admin/it.html#people');
    await ada.waitForSelector('#body:not([hidden])');
    await ada.click('#people tr:has-text("Cal Other") button:text-is("Open")');
    await ada.waitForSelector('#person-win #pu-temp');
    await ada.click('#person-win button:text-is("Generate")');
    const temp2 = await ada.inputValue('#pu-temp');
    await twice(ada, '#pu-reset');
    await ada.waitForSelector('#person-win-msg.hub-ok');
    await ada.click('#person-win-close');
    await mock.sql("update auth.users set encrypted_password = extensions.crypt('Stranger-Pass-666', extensions.gen_salt('bf')) where email = 'cal@work.test'");
    const thief = await person();
    await signIn(thief, 'cal@work.test', 'Stranger-Pass-666');
    await thief.waitForSelector('#panel-newpw:not([hidden])');
    await thief.fill('#np-password', 'Stranger-Pass-777');
    await thief.fill('#np-password2', 'Stranger-Pass-777');
    await thief.click('#np-save');
    await thief.waitForSelector('#np-msg:not([hidden])');
    check(await thief.locator('#np-temp').isVisible() && (await call(thief, 'dame_me')) === 'must_change', T + 'a stranger who changed the password behind IT\'s back is asked for the temporary password and gets nothing');
    await thief.fill('#np-temp', 'Stranger-Pass-666');
    await thief.click('#np-save');
    await thief.waitForSelector('#np-msg.hub-warn:has-text("not the one IT gave")');
    check((await call(thief, 'dame_me')) === 'must_change', T + 'a guessed temporary password opens nothing');
    await thief.fill('#np-temp', temp2);
    await thief.fill('#np-password', 'Cal-Own-Pass-2027');
    await thief.fill('#np-password2', 'Cal-Own-Pass-2027');
    await thief.click('#np-save');
    await thief.waitForURL(SITE + 'hub.html');
    check(true, T + 'the person who was told the temporary password by voice gets in');

    // ------------------------------------------------ a temporary password that is too old
    await ada.click('#part-add-a-person');
    await ada.click('#new-user');
    await ada.waitForSelector('#user-new');
    await ada.fill('#nu-username', 'tim.new');
    await ada.fill('#nu-name', 'Tim New');
    await ada.click('#user-new button:text-is("Generate")');
    const temp3 = await ada.inputValue('#nu-password');
    await ada.click('#nu-create');
    await ada.waitForSelector('#msg.hub-ok');
    await mock.sql("update core.profiles set temp_set_at = now() - interval '8 days' where username = 'tim.new'");
    const tim = await person();
    await signIn(tim, 'tim.new', temp3);
    await tim.waitForSelector('#panel-newpw:not([hidden])');
    check(/older than 7 days/.test(await tim.textContent('#np-text')) && !(await tim.locator('#np-save').isVisible()) && await tim.locator('#np-out').isVisible(), T + 'after 7 days the temporary password no longer counts: the person can only sign out and ask IT');
    await ada.reload();
    await ada.waitForSelector('#body:not([hidden])');
    await ada.click('#people tr:has-text("Tim New") button:text-is("Open")');
    await ada.waitForSelector('#person-win #pu-temp');
    check(/Temporary password too old/.test(await ada.textContent('#person-win h2')), T + 'IT sees that it is too old');
    await ada.click('#person-win button:text-is("Generate")');
    const temp4 = await ada.inputValue('#pu-temp');
    await twice(ada, '#pu-reset');
    await ada.waitForSelector('#person-win-msg.hub-ok');
    await ada.click('#person-win-close');
    await signIn(tim, 'tim.new', temp4);
    await tim.waitForSelector('#panel-newpw:not([hidden])');
    await tim.fill('#np-password', 'Tim-Own-Pass-2027');
    await tim.fill('#np-password2', 'Tim-Own-Pass-2027');
    await tim.click('#np-save');
    await tim.waitForURL(SITE + 'hub.html');
    await tim.waitForSelector('#main:not([hidden])');
    await tim.click('.hub-account');
    check(/tim\.new/.test(await tim.textContent('.hub-menu')) && !/users\.dame\.internal/.test(await tim.textContent('.hub-menu')), T + 'an account made by IT is shown by its username, never by its inner address');
    await tim.goto(SITE + 'account.html');
    await tim.waitForSelector('#body:not([hidden])');
    check(/Username/.test(await tim.textContent('#facts')) && /tim\.new/.test(await tim.textContent('#facts')) && !/users\.dame\.internal/.test(await tim.textContent('#main')), T + 'his account page shows the username');

    // ------------------------------------------------ signed out
    const nobody = await person();
    await nobody.goto(SITE + 'account.html');
    await nobody.waitForSelector('#panel-signin:not([hidden])');
    check(true, T + 'signed out: My account leads to the start page');
    check(/Forgot your password/.test(await nobody.textContent('#panel-signin')), T + 'the start page says what to do about a forgotten password');

    check(problems.length === 0, T + 'no script error, no dialog' + (problems.length ? ' -> ' + problems.join(' | ') : ''));
  } catch (err) {
    check(false, T + 'the test ran to the end -> ' + String(err && err.stack || err).slice(0, 600));
  } finally {
    await browser.close();
    site.close();
    mock.server.close();
  }
}

await run(1280, 900, 'desktop');
await run(390, 844, 'phone');
console.log(failed ? '\n' + failed + ' problem(s)' : '\nAll checks passed');
process.exit(failed ? 1 : 0);
