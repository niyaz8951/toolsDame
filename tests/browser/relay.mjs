/*
 * tests/browser/relay.mjs - Relay in a real browser, at desktop width and at
 * 390 px: IT sets up the MTO flow from the Daikin example, Sales starts a query,
 * Application sends it back because something is missing, it goes up to the
 * Factory (the Product team skipped) and the answer comes back down, level by
 * level, until Sales closes it. Someone on no stage sees nothing of it.
 * Serves: the Relay rules ("only the team holding it moves it", "each level
 * answers only the level that asked it") and SECURITY "Browser" (text only).
 * Must not change: it uses the pages exactly as they are in the repo; only the
 * database address is pointed at the stand-in.
 *
 * Needs once:  npm install --no-save @electric-sql/pglite playwright-core
 * Run:         node tests/browser/relay.mjs      (exit code 0 = all passed)
 *              SHOTS=/some/folder node tests/browser/relay.mjs   also saves screenshots
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
const SITE_PORT = 8181;
const MOCK_PORT = 8182;
const SITE = 'http://127.0.0.1:' + SITE_PORT + '/toolsDame/';
const MOCK = 'http://127.0.0.1:' + MOCK_PORT;
const REAL = ((await readFile(join(ROOT, 'kit/v1/config.js'), 'utf8')).match(/supabaseUrl:\s*'([^']*)'/) || [])[1];
const REAL_KEY = ((await readFile(join(ROOT, 'kit/v1/config.js'), 'utf8')).match(/publishableKey:\s*'([^']*)'/) || [])[1];
const PW = 'Correct-Horse-42';
const EVIL = 'AHU <img src=x onerror=alert(1)> double skin';

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
  const winFits = async (page) => page.evaluate(() => { const b = document.querySelector('.hub-focus'); return !b || b.getBoundingClientRect().right <= window.innerWidth + 1; });
  const shot = async (page, name) => {
    if (SHOTS) { await mkdir(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, label + '-' + name + '.png'), fullPage: true }); }
  };
  const call = (page, name, args) => page.evaluate(([n, a]) => window.DameApi.rpc(n, a).then(() => 'ALLOWED', (e) => e.code), [name, args || {}]);
  async function relay(page, extra) {
    await page.goto(SITE + 'relay.html' + (extra || ''));
    await page.waitForSelector('#body:not([hidden])');
  }
  async function item(page, ref) {
    await page.click('.relay-card:has(.relay-ref:text-is("' + ref + '"))');
    await page.waitForSelector('#item-win h2');
  }
  async function tickAll(page) {
    // Each tick is saved and the window drawn again; wait for that before the next one, as a person would.
    for (let i = 0; i < 10; i += 1) {
      const done = await page.locator('#item-win .relay-tick input:checked').count();
      const box = page.locator('#item-win .relay-tick input:not(:checked)').first();
      if (!(await box.count())) { return; }
      await box.click();
      await page.waitForFunction((n) => document.querySelectorAll('#item-win .relay-tick input:checked').length === n + 1
        && !document.querySelector('#item-win .relay-tick input:disabled'), done);
    }
  }
  async function words(page, button, text, go) {
    await page.click(button);
    await page.waitForSelector('#relay-words');
    if (text) { await page.fill('#relay-words', text); }
    await page.click('#relay-words-go');
    await page.waitForSelector('#item-win-msg.hub-ok');
    return page.textContent('#item-win-msg');
  }
  const close = async (page) => { await page.click('#item-win-close'); await page.waitForSelector('#item-win', { state: 'detached' }); };

  try {
    await mock.addUser('ada@work.test', 'Ada IT', PW, true);
    const ids = {};
    for (const [mail, name] of [['sam', 'Sam Sales'], ['abe', 'Abe Application'], ['hal', 'Hal HQ'], ['fay', 'Fay Factory'], ['xan', 'Xan Outside']]) {
      ids[mail] = await mock.addUser(mail + '@work.test', name, PW);
    }
    const ada = (await mock.sql("select id::text as id from core.profiles where email = 'ada@work.test'")).rows[0].id;
    await mock.sql("insert into core.spaces (id, name, created_by) values ('sales', 'Sales', '" + ada + "'), ('applied', 'Application', '" + ada + "'), ('hq-aes', 'HQ-AES', '" + ada + "'), ('product', 'Product team', '" + ada + "'), ('factory', 'Factory', '" + ada + "'), ('finance', 'Finance', '" + ada + "')");
    await mock.sql("insert into core.space_members (space, user_id, added_by) values ('sales', '" + ids.sam + "', '" + ada + "'), ('applied', '" + ids.abe + "', '" + ada + "'), ('hq-aes', '" + ids.hal + "', '" + ada + "'), ('finance', '" + ids.xan + "', '" + ada + "')");
    await mock.sql("insert into core.space_admins (space, user_id, added_by) values ('factory', '" + ids.fay + "', '" + ada + "')");
    await mock.sql("insert into core.tools (space, id, name, open_to_space, open_level, created_by) values ('applied', 'selector', 'Selection tool', true, 'read', '" + ada + "')");

    // ------------------------------------------------ IT sets up the flow from the example
    const it = await person('ada@work.test');
    check(!(await it.isHidden('#relay-setup')) && (await it.locator('.hub-tag').count()) === 0, T + 'IT has "Set up a flow" on the hub; no page carries a Demo tag');
    await relay(it, '#set-up');
    check(!(await it.isHidden('#part-set-up')), T + 'IT has the Set up part');
    await it.click('[data-example="mto"]');
    await it.waitForSelector('#flow-win #fl-stages');
    const teams = await it.$$eval('#fl-stages select', (s) => s.map((x) => x.value).join(','));
    check(teams === 'sales,applied,hq-aes,product,factory', T + 'the MTO example picks the five teams by name (' + teams + ')');
    check((await it.inputValue('#fl-prefix')) === 'MTO' && (await it.locator('#fl-stages .relay-stage-edit').count()) === 5, T + 'the example fills the number letters and five stages');
    await it.waitForSelector('#fl-stages .relay-stage-edit:nth-child(2) .relay-tool-list input[value="selector"]');
    await it.check('#fl-stages .relay-stage-edit:nth-child(2) .relay-tool-list input[value="selector"]');
    check(await winFits(it), T + 'the setup window fits the screen');
    await shot(it, '1-setup-window');
    await it.click('#fl-save');
    await it.waitForSelector('#msg.hub-ok');
    check((await it.locator('#flow-tiles [data-setup="mto-query"]').count()) === 1, T + 'the flow is made and has its tile');
    check(Number((await mock.sql("select count(*) as n from core.relay_stages where flow = 'mto-query' and optional")).rows[0].n) === 1, T + 'the Product team stage may be skipped, as in the example');
    check((await mock.sql("select tools::text as t from core.relay_stages where flow = 'mto-query' and pos = 2")).rows[0].t === '["selector"]', T + 'the Selection tool hangs on the Application stage');

    // ------------------------------------------------ Sales starts a query
    const sam = await person('sam@work.test');
    await sam.waitForSelector('#chain-part:not([hidden])');
    check(/Nothing waits/.test(await sam.textContent('#summary')) && (await sam.locator('#chains .relay-step').count()) === 5 && !(await sam.isHidden('#work-empty')), T + 'the hub of Sales opens on My work (nothing yet) and the chain of five teams');
    check(await fits(sam), T + 'the hub fits the screen');
    await relay(sam, '#flows');
    await sam.waitForSelector('#b-chain .relay-step');
    check((await sam.locator('#b-chain .relay-step').count()) === 5 && !(await sam.isHidden('#b-start')), T + 'Sales sees the chain of five teams and may start an MTO query');
    await sam.click('#b-start');
    await sam.waitForSelector('#st-title');
    await sam.fill('#st-title', EVIL);
    await sam.fill('#st-project', 'Stadium, Riyadh');
    await sam.fill('#st-details', 'Spec 23 73 13, clause 2.3.1: 50 mm double skin panels.');
    await sam.selectOption('#st-priority', 'urgent');
    await sam.click('#st-go');
    await sam.waitForSelector('#item-win .relay-tick');
    check(/MTO-0001 is started/.test(await sam.textContent('#item-win-msg')), T + 'the query is started and opens at once: MTO-0001');
    check((await sam.textContent('#item-win h2')) === EVIL && (await sam.locator('#item-win img').count()) === 0, T + 'a title with markup is shown as text');
    check(await sam.isDisabled('#relay-pass-2'), T + '"Pass on" waits until the checklist is done');
    await tickAll(sam);
    check(!(await sam.isDisabled('#relay-pass-2')), T + 'with four ticks, "Pass on" can be pressed');
    check(await winFits(sam), T + 'the item window fits the screen');
    await shot(sam, '2-item-window');
    const passed = await words(sam, '#relay-pass-2', 'Please check the panel option', true);
    check(/Passed on to Technical review/.test(passed), T + 'Sales passes it to Application');
    await close(sam);

    // ------------------------------------------------ Application: something is missing
    const abe = await person('abe@work.test');
    await abe.waitForSelector('#work .relay-card');
    check(/1 waits for your teams/.test(await abe.textContent('#summary')) && /^1/.test(await abe.textContent('#chains .relay-step:nth-child(2) .relay-step-count')), T + 'the hub tells Application: 1 waits for your teams, and the chain shows 1 at its stage');
    await shot(abe, '0-hub');
    await abe.click('#work .relay-card');
    await abe.waitForSelector('#item-win h2');
    check(/MTO-0001/.test(await abe.textContent('#item-win')), T + 'a press on the hub card opens the item');
    await relay(abe);
    check((await abe.locator('#waiting .relay-card').count()) === 1, T + 'it is in Application\'s inbox, waiting');
    await shot(abe, '3-inbox');
    await item(abe, 'MTO-0001');
    await abe.click('#relay-pick');
    await abe.waitForSelector('#item-win .relay-tick');
    const back = await words(abe, '#relay-missing', 'Send the GA drawing with the panel sizes', true);
    check(/Sent back to Raise the query, to Sam Sales/.test(back), T + 'Application sends it back to Sam himself: the drawing is missing');
    await close(abe);

    await relay(sam);
    check((await sam.locator('#mine .relay-card .relay-move-missing').count()) === 1, T + 'Sam finds it with him, marked "something is missing"');
    await item(sam, 'MTO-0001');
    check(/Send the GA drawing/.test(await sam.textContent('#item-win .relay-history')), T + 'the history says what is missing');
    check(await sam.isDisabled('#relay-pass-2'), T + 'the checklist starts again');
    await tickAll(sam);
    await words(sam, '#relay-pass-2', 'Drawing attached in the project folder', true);
    await close(sam);

    // ------------------------------------------------ up the chain
    await relay(abe);
    await item(abe, 'MTO-0001');
    await abe.click('#relay-pick');
    await abe.waitForSelector('#item-win .relay-tick');
    await tickAll(abe);
    check((await abe.locator('#relay-pass-4').count()) === 0, T + 'Application cannot skip HQ-AES');
    await words(abe, '#relay-pass-3', '', false);
    await close(abe);

    const hal = await person('hal@work.test');
    await relay(hal);
    await item(hal, 'MTO-0001');
    await hal.click('#relay-pick');
    await hal.waitForSelector('#item-win .relay-tick');
    await tickAll(hal);
    check((await hal.locator('#relay-pass-4').count()) === 1 && (await hal.locator('#relay-pass-5').count()) === 1, T + 'HQ-AES may pass to the Product team or skip to the Factory');
    const skip = await words(hal, '#relay-pass-5', 'Product team not needed: standard option exists at the factory', true);
    check(/Passed on to Factory answer/.test(skip), T + 'HQ-AES skips straight to the Factory');
    await close(hal);

    // ------------------------------------------------ and the answer back down, level by level
    const fay = await person('fay@work.test');
    await relay(fay);
    await item(fay, 'MTO-0001');
    await fay.click('#relay-pick');
    await fay.waitForSelector('#relay-answer');
    check((await fay.locator('#relay-close').count()) === 1, T + 'the Factory, the last stage, could close it');
    check(/to Engineering support, to Hal HQ/.test(await words(fay, '#relay-answer', 'Feasible. 6 weeks extra lead time, adder 4%.', true)), T + 'the Factory answers back to HQ-AES, to Hal');
    await close(fay);
    await relay(hal);
    check((await hal.locator('#mine .relay-move-answer').count()) === 1, T + 'Hal has it again, marked "the answer came back"');
    await item(hal, 'MTO-0001');
    check(/to Technical review, to Abe Application/.test(await words(hal, '#relay-answer', 'Factory confirms: feasible, 6 weeks extra.', true)), T + 'HQ-AES answers back to Application, to Abe');
    await close(hal);
    await relay(abe);
    await item(abe, 'MTO-0001');
    check(/to Raise the query, to Sam Sales/.test(await words(abe, '#relay-answer', 'Yes: double skin 50 mm, 6 weeks extra.', true)), T + 'Application answers back to Sales, to Sam');
    await close(abe);
    await relay(sam);
    await item(sam, 'MTO-0001');
    check(/Closed/.test(await words(sam, '#relay-close', 'Offer revised and sent to the consultant', false)), T + 'Sales closes it');
    check(/Closed/.test(await sam.textContent('#item-win .relay-pills')) && (await sam.locator('#relay-pick, #relay-pass-2, #relay-answer').count()) === 0, T + 'a closed query has no buttons that move it');
    check((await sam.locator('#item-win .relay-history li').count()) === 14, T + 'the history has every step (14)');
    await close(sam);

    // ------------------------------------------------ the board tells how the chain is doing
    await relay(abe, '?flow=mto-query#flows');
    await abe.waitForSelector('#b-chain .relay-step');
    check(/sent back 1x/.test(await abe.textContent('#b-chain .relay-step:nth-child(2)')), T + 'the chain shows that Application sent one back');
    check((await abe.locator('#b-chain .relay-step:nth-child(2) a.relay-tool').count()) === 1, T + 'Application has its Selection tool on its stage, as a link');
    await relay(sam, '?flow=mto-query#flows');
    await sam.waitForSelector('#b-chain .relay-step');
    check((await sam.locator('#b-chain .relay-step:nth-child(2) span.relay-tool-off').count()) === 1 && (await sam.locator('#b-chain a.relay-tool').count()) === 0, T + 'Sales sees the tool named, without a link');
    await abe.goto(SITE + 'space.html?space=applied');
    await abe.waitForSelector('[data-pin="selector"]');
    await abe.click('[data-pin="selector"]');
    await abe.waitForSelector('#msg.hub-ok');
    check(/On your hub/.test(await abe.textContent('[data-pin="selector"]')), T + 'Application pins the tool in its space');
    check((await call(sam, 'dame_shortcut_set', { p_space: 'applied', p_tool: 'selector', p_on: true })) === 'not_allowed', T + 'Sales cannot pin a tool it does not have');
    await abe.goto(SITE + 'hub.html');
    await abe.waitForSelector('#shorts .hub-short');
    check(/Selection tool/.test(await abe.textContent('#shorts')) && (await abe.isHidden('#shorts-empty')), T + 'the shortcut is on his hub');
    await relay(abe, '?flow=mto-query#flows');
    await abe.waitForSelector('#b-chain .relay-step');
    check(/usually/.test(await abe.textContent('#b-chain .relay-step:nth-child(1)')), T + 'the chain shows how long a stage usually takes');
    check(/1/.test(await abe.textContent('#b-figures .dame-stat:nth-child(3)')), T + 'one closed in 30 days');
    check(await fits(abe), T + 'the board fits the screen');
    await shot(abe, '4-board');

    // ------------------------------------------------ someone on no stage
    const xan = await person('xan@work.test');
    await xan.waitForSelector('#shorts-empty:not([hidden])');
    check((await xan.isHidden('#work-part')) && (await xan.isHidden('#chain-part')), T + 'someone on no stage has no My work and no chain on his hub');
    check((await call(xan, 'dame_relay_item', { p_item: 1 })) === 'not_allowed' && (await call(xan, 'dame_relay_board', { p_flow: 'mto-query' })) === 'not_allowed', T + 'and the database refuses him the item and the board');
    check((await call(sam, 'dame_relay_flow_save', { p_flow: 'mine', p_name: 'x', p_word: 'x x', p_prefix: 'XX', p_description: '', p_stages: [] })) === 'not_allowed', T + 'a member cannot set up a flow, whatever the page shows');
    await relay(xan);
    check(!(await xan.isHidden('#no-flows')) && (await xan.locator('#part-set-up').isHidden()), T + 'his Relay page says none of his teams is on a flow, and has no Set up');

    const audit = (await mock.sql("select string_agg(distinct action, ',' order by action) as a from core.audit where action like 'relay.%'")).rows[0].a;
    check(audit === 'relay.answered,relay.closed,relay.flow_created,relay.passed,relay.picked,relay.sent_back,relay.started', T + 'every step is in the audit (' + audit + ')');
    check(problems.length === 0, T + 'no script error, no dialog' + (problems.length ? ' -> ' + problems.join(' | ') : ''));
  } catch (err) {
    check(false, T + 'the test ran to the end -> ' + String(err && err.stack || err).slice(0, 900));
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
