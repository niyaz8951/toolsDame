/*
 * tests/browser/quotas.mjs - database quotas in a real browser, at desktop
 * width and at 390 px: the space admin sees what his space uses, the space
 * fills up, he asks IT for more, IT grants less than asked, declines, sets one
 * space's limits and the site's default.
 * Serves: the quotas rule ("nobody raises his own limit") and SECURITY "Database".
 * Must not change: it uses the pages exactly as they are in the repo; only the
 * database address is pointed at the stand-in.
 *
 * Needs once:  npm install --no-save @electric-sql/pglite playwright-core
 * Run:         node tests/browser/quotas.mjs      (exit code 0 = all passed)
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
const SITE_PORT = 8171;
const MOCK_PORT = 8172;
const SITE = 'http://127.0.0.1:' + SITE_PORT + '/toolsDame/';
const MOCK = 'http://127.0.0.1:' + MOCK_PORT;
const REAL = ((await readFile(join(ROOT, 'kit/v1/config.js'), 'utf8')).match(/supabaseUrl:\s*'([^']*)'/) || [])[1];
const REAL_KEY = ((await readFile(join(ROOT, 'kit/v1/config.js'), 'utf8')).match(/publishableKey:\s*'([^']*)'/) || [])[1];
const PW = 'Correct-Horse-42';
const EVIL = 'We need more room <img src=x onerror=alert(1)>';

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

  async function person(who) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource.*(40[013]|422)/.test(m.text())) { problems.push(m.text()); }
    });
    page.on('pageerror', (e) => problems.push(String(e)));
    page.on('dialog', (d) => { problems.push('dialog opened: ' + d.message()); d.dismiss(); });
    await page.goto(SITE);
    await page.waitForSelector('#panel-signin:not([hidden])');
    await page.fill('#si-email', who);
    await page.fill('#si-password', PW);
    await page.click('#form-signin button[type=submit]');
    await page.waitForURL(SITE + 'hub.html');
    await page.waitForSelector('#main:not([hidden])');
    return page;
  }
  const fits = async (page) => (await page.evaluate(() => document.documentElement.scrollWidth)) <= width;
  const shot = async (page, name) => {
    if (SHOTS) { await mkdir(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, label + '-' + name + '.png'), fullPage: true }); }
  };
  async function twice(page, selector) {
    await page.click(selector);
    await page.click(selector);
  }
  const call = (page, name, args) => page.evaluate(([n, a]) => window.DameApi.rpc(n, a).then(() => 'ALLOWED', (e) => e.code), [name, args || {}]);
  async function open(page, address, ready) {
    await page.goto(SITE + address);
    await page.waitForSelector('#body:not([hidden])');
    await page.waitForSelector(ready);
  }
  const text = async (page, selector) => { await page.part(selector); return page.textContent(selector); };

  try {
    await mock.addUser('ada@work.test', 'Ada IT', PW, true);
    const beaId = await mock.addUser('bea@work.test', 'Bea Admin', PW);
    const calId = await mock.addUser('cal@work.test', 'Cal Member', PW);
    const adaId = (await mock.sql("select id::text as id from core.profiles where email = 'ada@work.test'")).rows[0].id;
    await mock.sql("insert into core.spaces (id, name, created_by) values ('sales', 'Sales', '" + adaId + "'), ('finance', 'Finance', '" + adaId + "')");
    await mock.sql("insert into core.space_admins (space, user_id, added_by) values ('sales', '" + beaId + "', '" + adaId + "')");
    await mock.sql("insert into core.space_members (space, user_id, added_by) values ('sales', '" + calId + "', '" + adaId + "')");
    await mock.sql("insert into core.tools (space, id, name, open_to_space, open_level, created_by) values ('sales', 'quotes', 'Quotes', true, 'contribute', '" + adaId + "')");
    const cols = [{ name: 'title', type: 'text' }, { name: 'qty', type: 'number' }];
    const add = (page) => call(page, 'dame_rows_add', { p_space: 'sales', p_tool: 'quotes', p_table: 'lines', p_row: { title: 'a line' } });

    // ------------------------------------------------ the space admin looks
    const bea = await person('bea@work.test');
    check((await call(bea, 'dame_table_create', { p_space: 'sales', p_tool: 'quotes', p_name: 'lines', p_sharing: 'team', p_columns: cols })) === 'ALLOWED', T + 'the admin makes a table');
    await open(bea, 'admin/space.html?space=sales', '#q-stats .dame-stat');
    check(/0 of 10,000/.test(await text(bea, '#q-stats')) && /1 of 10\s*tools/.test(await text(bea, '#q-stats')) && /1 of 10\s*tables/.test(await text(bea, '#q-stats')) && /60/.test(await text(bea, '#q-stats')), T + 'a new space shows the default: 10,000 rows, 10 tools, 10 tables a tool, 60 columns');
    check(/default/.test(await text(bea, '#q-state')) && (await bea.inputValue('#qr-rows')) === '10000', T + 'the page says the space is on the default and offers to ask for more');
    check(await fits(bea), T + 'the quota part fits the screen');

    // ------------------------------------------------ IT gives the space its own limits
    const ada = await person('ada@work.test');
    await open(ada, 'admin/it.html', '#q-tiles [data-quota]');
    check((await ada.locator('#q-tiles .hub-tile').count()) === 2 && /Sales/.test(await text(ada, '#q-tiles')) && /0 of 10,000 rows/.test(await text(ada, '#q-tiles')), T + 'IT sees one tile per space with what it uses');
    check(/10,000 rows in the space, 10 tools in the space, 10 tables in a tool, 60 columns in a table/.test(await text(ada, '#q-default-text')), T + 'the default is 10,000 rows, 10 tools, 10 tables a tool, 60 columns');
    check(await fits(ada), T + 'IT\'s quota part fits the screen');
    await shot(ada, '1-it-quotas');
    await ada.click('#q-tiles [data-quota="sales"]');
    await ada.waitForSelector('#sq-rows');
    check(/Site default/.test(await ada.textContent('#quota-win')), T + 'the tile opens the window of that space');
    await ada.fill('#sq-rows', '50');
    await ada.click('#sq-form button[type=submit]');
    await ada.waitForSelector('#quota-win-msg.hub-warn');
    check(/100 to 10000000/.test(await ada.textContent('#quota-win-msg')) && (await ada.inputValue('#sq-rows')) === '50', T + 'a limit below 100 rows is refused by the database, in words; the typed number stays');
    await ada.fill('#sq-rows', '100');
    await ada.fill('#sq-tools', '1');
    await ada.fill('#sq-tables', '2');
    await ada.fill('#sq-columns', '5');
    await ada.click('#sq-form button[type=submit]');
    await ada.waitForSelector('#quota-win-msg.hub-ok');
    check(/Own limits/.test(await ada.textContent('#quota-win')), T + 'IT gives Sales 100 rows, 1 tool, 2 tables a tool, 5 columns');
    check(await fits(ada), T + 'the quota window fits the screen');
    await shot(ada, '2-it-quota-window');
    await ada.click('#quota-win-close');
    check(/Own limits/.test(await text(ada, '#q-tiles [data-quota="sales"]')) && !/Own limits/.test(await text(ada, '#q-tiles [data-quota="finance"]')), T + 'the tile says that Sales has limits of its own');

    // ------------------------------------------------ the space fills up
    const cal = await person('cal@work.test');
    const filled = await bea.evaluate(async () => {
      for (let i = 0; i < 100; i += 1) {
        await window.DameApi.rpc('dame_rows_add', { p_space: 'sales', p_tool: 'quotes', p_table: 'lines', p_row: { title: 'line ' + i } });
      }
      return 'ok';
    });
    check(filled === 'ok', T + '100 rows are added');
    check((await add(cal)) === 'quota_full' && (await add(bea)) === 'quota_full', T + 'row 101 is refused, for the member and for the admin');
    const said = await cal.evaluate(() => window.DameApi.rpc('dame_rows_add', { p_space: 'sales', p_tool: 'quotes', p_table: 'lines', p_row: { title: 'x' } }).then(() => '', (e) => e.message));
    check(/limit of 100 rows/.test(said) && /admin of the space/.test(said), T + 'the refusal says what happened and whom to tell');
    check((await call(cal, 'dame_rows_list', { p_space: 'sales', p_tool: 'quotes', p_table: 'lines', p_options: {} })) === 'ALLOWED', T + 'a full space still reads');
    check((await call(bea, 'dame_table_create', { p_space: 'sales', p_tool: 'quotes', p_name: 'wide', p_sharing: 'team', p_columns: [1, 2, 3, 4, 5, 6].map((n) => ({ name: 'c' + n, type: 'text' })) })) === 'quota_full', T + 'a table with 6 columns is refused where 5 are allowed');
    check((await call(bea, 'dame_table_create', { p_space: 'sales', p_tool: 'quotes', p_name: 'second', p_sharing: 'team', p_columns: cols })) === 'ALLOWED'
      && (await call(bea, 'dame_table_create', { p_space: 'sales', p_tool: 'quotes', p_name: 'third', p_sharing: 'team', p_columns: cols })) === 'quota_full', T + 'the second table is made, the third is refused');

    const tool = (id) => call(bea, 'dame_tool_create', { p_space: 'sales', p_id: id, p_name: 'Second tool', p_description: '', p_icon: '', p_colour: '', p_open_to_space: false, p_open_level: 'read' });
    check((await tool('second')) === 'quota_full', T + 'a second tool is refused where one is allowed');

    // ------------------------------------------------ nobody raises his own limit
    for (const [who, page] of [['the member', cal], ['the space admin', bea]]) {
      check((await call(page, 'dame_quota_set', { p_space: 'sales', p_rows: 5000000, p_tables: 50, p_columns: 100 })) === 'not_allowed'
        && (await call(page, 'dame_quota_default_set', { p_rows: 5000000, p_tables: 50, p_columns: 100 })) === 'not_allowed'
        && (await call(page, 'dame_quota_list')) === 'not_allowed', T + who + ' cannot set a limit, the default, or list the spaces');
    }
    check((await call(cal, 'dame_quota_get', { p_space: 'sales' })) === 'not_allowed'
      && (await call(cal, 'dame_quota_request', { p_space: 'sales', p_rows: 5000, p_tables: 2, p_columns: 5, p_reason: 'I would like more room.' })) === 'not_allowed', T + 'the member cannot see the quota or ask for more');
    check((await call(bea, 'dame_quota_get', { p_space: 'finance' })) === 'not_allowed'
      && (await call(bea, 'dame_quota_request', { p_space: 'finance', p_rows: 50000, p_tables: 10, p_columns: 60, p_reason: 'Not my space at all.' })) === 'not_allowed', T + 'an admin has nothing to say about another space');

    // ------------------------------------------------ asking IT for more
    await open(bea, 'admin/space.html?space=sales', '#q-stats .dame-stat');
    check(/100 of 100/.test(await text(bea, '#q-stats')) && /1 of 1\s*tools/.test(await text(bea, '#q-stats')) && /2 of 2/.test(await text(bea, '#q-stats')) && /full/.test(await text(bea, '#q-state')), T + 'the admin sees that the space is full');
    await bea.click('#tool-add');
    await bea.fill('#tl-name', 'One too many');
    await bea.click('#tl-create');
    await bea.waitForSelector('#tl-msg.hub-warn');
    check(/1 tools, the limit IT set/.test(await bea.textContent('#tl-msg')), T + '"Add a tool" says in words that the space has its limit of tools');
    await bea.click('#tl-cancel');
    check(/Quotes/.test(await text(bea, '#q-tools')) && /100/.test(await text(bea, '#q-tools')), T + 'and in which tool the rows are');
    await shot(bea, '3-space-full');
    await bea.fill('#qr-rows', '500');
    await bea.fill('#qr-reason', 'more');
    await bea.click('#form-quota button[type=submit]');
    await bea.waitForSelector('#msg.hub-warn');
    check(/why the space needs more/.test(await bea.textContent('#msg')) && (await bea.inputValue('#qr-rows')) === '500', T + 'a request without a real reason is refused, in words; the typed number stays');
    await bea.fill('#qr-tools', '3');
    await bea.fill('#qr-reason', EVIL);
    await bea.click('#form-quota button[type=submit]');
    await bea.waitForSelector('#msg.hub-ok');
    check(/waiting for IT/.test(await text(bea, '#q-open')) && /500 rows/.test(await text(bea, '#q-open-text')) && /3 tools/.test(await text(bea, '#q-open-text')) && !(await bea.locator('#q-ask').isVisible()), T + 'the request is sent and shown as waiting');
    check((await add(bea)) === 'quota_full', T + 'asking gives nothing by itself');
    const reqId = Number((await mock.sql("select id from core.quota_requests where status = 'open'")).rows[0].id);
    check((await call(bea, 'dame_quota_answer', { p_request: reqId, p_grant: true, p_rows: null, p_tables: null, p_columns: null, p_note: null })) === 'not_allowed'
      && (await call(cal, 'dame_quota_answer', { p_request: reqId, p_grant: true, p_rows: null, p_tables: null, p_columns: null, p_note: null })) === 'not_allowed', T + 'the admin cannot grant his own request, nor can a member');

    // ------------------------------------------------ IT answers
    await open(ada, 'admin/it.html', '#q-tiles [data-quota]');
    check((await ada.locator('#part-quotas').textContent()).includes('1'), T + 'the Quotas tab shows one waiting request');
    check(/Request waiting/.test(await text(ada, '#q-tiles [data-quota="sales"]')) && /Full/.test(await text(ada, '#q-tiles [data-quota="sales"]'))
      && (await ada.locator('#q-tiles .hub-tile').first().getAttribute('data-quota')) === 'sales', T + 'the tile of the space says a request waits and the space is full, and comes first');
    await shot(ada, '3-it-tiles');
    await ada.click('#q-tiles [data-quota="sales"]');
    await ada.waitForSelector('#rq-rows');
    check(/Bea Admin/.test(await ada.textContent('#quota-win')) && /500 rows/.test(await ada.textContent('#quota-win')) && (await ada.locator('#quota-win img').count()) === 0, T + 'IT reads who asks, for what and why; hostile text stays text');
    check(await fits(ada), T + 'a waiting request fits the screen');
    await shot(ada, '4-it-request');
    await ada.fill('#rq-rows', '300');
    await ada.fill('#rq-note', 'Half for now.');
    await twice(ada, '#rq-grant');
    await ada.waitForSelector('#quota-win-msg.hub-ok');
    check(/300 rows/.test(await ada.textContent('#quota-win-msg')) && (await ada.locator('#rq-rows').count()) === 0 && (await ada.inputValue('#sq-rows')) === '300' && (await ada.inputValue('#sq-tools')) === '3', T + 'IT grants 300 rows where 500 were asked, and the 3 tools');
    await ada.click('#quota-win-close');
    check((await add(cal)) === 'ALLOWED', T + 'the member adds rows again');
    check((await tool('second')) === 'ALLOWED', T + 'and the admin makes a second tool');
    await open(bea, 'admin/space.html?space=sales', '#q-stats .dame-stat');
    check(/101 of 300/.test(await text(bea, '#q-stats')) && /Granted/.test(await text(bea, '#q-answers')) && /Half for now/.test(await text(bea, '#q-answers')) && /Ada IT/.test(await text(bea, '#q-answers')), T + 'the admin sees the new limit and IT\'s answer');
    check(await bea.locator('#q-ask').isVisible() && (await bea.inputValue('#qr-rows')) === '300', T + 'and can ask again');

    await bea.fill('#qr-rows', '9000');
    await bea.fill('#qr-reason', 'All of last year should go in too.');
    await bea.click('#form-quota button[type=submit]');
    await bea.waitForSelector('#msg.hub-ok');
    await open(ada, 'admin/it.html', '#q-tiles [data-quota]');
    await ada.click('#q-tiles [data-quota="sales"]');
    await ada.waitForSelector('#rq-rows');
    await twice(ada, '#rq-decline');
    await ada.waitForSelector('#quota-win-msg.hub-warn');
    check(/why the request is declined/.test(await ada.textContent('#quota-win-msg')), T + 'declining without a word is refused');
    await ada.fill('#rq-note', 'Archive last year first.');
    await twice(ada, '#rq-decline');
    await ada.waitForSelector('#quota-win-msg.hub-ok');
    await ada.click('#quota-win-close');
    await open(bea, 'admin/space.html?space=sales', '#q-stats .dame-stat');
    check(/of 300/.test(await text(bea, '#q-stats')) && /Declined/.test(await text(bea, '#q-answers')) && /Archive last year first/.test(await text(bea, '#q-answers')), T + 'IT declines with a reason; the limit stays and the admin reads why');
    await bea.fill('#qr-rows', '9000');
    await bea.fill('#qr-reason', 'Asked by mistake, will take it back.');
    await bea.click('#form-quota button[type=submit]');
    await bea.waitForSelector('#q-open:not([hidden])');
    await twice(bea, '#q-open-act button');
    await bea.waitForSelector('#q-ask:not([hidden])');
    check(Number((await mock.sql("select count(*) as n from core.quota_requests where status = 'open'")).rows[0].n) === 0, T + 'the admin takes a request back');

    // ------------------------------------------------ the default
    await open(ada, 'admin/it.html', '#q-tiles [data-quota]');
    await ada.click('#q-default');
    await ada.waitForSelector('#quota-default:not([hidden])');
    check((await ada.inputValue('#qd-rows')) === '10000' && (await ada.inputValue('#qd-tools')) === '10' && (await ada.inputValue('#qd-tables')) === '10' && (await ada.inputValue('#qd-columns')) === '60', T + '"Change the default" opens its window with the numbers of now');
    await ada.fill('#qd-rows', '5');
    await ada.click('#qd-save');
    await ada.waitForSelector('#qd-msg.hub-warn');
    check(/100 to 10000000/.test(await ada.textContent('#qd-msg')), T + 'a default outside the bounds is refused, in words');
    check(await fits(ada), T + 'the default window fits the screen');
    await ada.fill('#qd-rows', '20000');
    await ada.click('#qd-save');
    await ada.waitForSelector('#msg.hub-ok');
    check(/of 20,000 rows/.test(await text(ada, '#q-tiles [data-quota="finance"]')) && /of 300 rows/.test(await text(ada, '#q-tiles [data-quota="sales"]')), T + 'a new default holds for Finance, not for Sales with its own limits');
    await ada.click('#q-tiles [data-quota="sales"]');
    await ada.waitForSelector('#sq-default');
    await twice(ada, '#sq-default');
    await ada.waitForSelector('#quota-win-msg.hub-ok');
    await ada.click('#quota-win-close');
    check(/of 20,000 rows/.test(await text(ada, '#q-tiles [data-quota="sales"]')) && !/Own limits/.test(await text(ada, '#q-tiles [data-quota="sales"]')), T + 'IT puts Sales back on the default');
    const audit = (await mock.sql("select string_agg(distinct action, ',' order by action) as a from core.audit where action like 'quota.%'")).rows[0].a;
    check(audit === 'quota.declined,quota.default_set,quota.granted,quota.request_taken_back,quota.requested,quota.set', T + 'every step is in the audit (' + audit + ')');

    check(problems.length === 0, T + 'no script error, no dialog' + (problems.length ? ' -> ' + problems.join(' | ') : ''));
  } catch (err) {
    check(false, T + 'the test ran to the end -> ' + String(err && err.stack || err).slice(0, 700));
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
