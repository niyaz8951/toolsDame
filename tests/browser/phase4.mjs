/*
 * tests/browser/phase4.mjs - the phase 4 test in a real browser, at desktop
 * width and at 390 px: the test space, a stand-alone tool, and a tool that
 * saves shared rows in a table made from the site, used by people of every
 * level.
 * Serves: phase 4 test ("a tracker saves shared rows; every refused case
 * fails correctly") and contract 5 (Data). Must not change: the pages are
 * used exactly as they are in the repo; only the database address is pointed
 * at the stand-in.
 *
 * Needs once:  npm install --no-save @electric-sql/pglite playwright-core
 * Run:         node tests/browser/phase4.mjs        (exit code 0 = all passed)
 */
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { start } from '../../tools/serve.mjs';
import { startMock, KEY } from './mock-supabase.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.env.SHOTS || '';
const SITE_PORT = 8171;
const MOCK_PORT = 8172;
const SITE = 'http://127.0.0.1:' + SITE_PORT + '/toolsDame/';
const MOCK = 'http://127.0.0.1:' + MOCK_PORT;
const CONFIG = await readFile(join(ROOT, 'kit/v1/config.js'), 'utf8');
const REAL = (CONFIG.match(/supabaseUrl:\s*'([^']*)'/) || [])[1];
const REAL_KEY = (CONFIG.match(/publishableKey:\s*'([^']*)'/) || [])[1];
const PW = 'correct horse battery 42';

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
  const T = label + ': ';

  async function person(email, name, isIt) {
    const id = await mock.addUser(email, name, PW, !!isIt);
    const ctx = await browser.newContext({ viewport: { width, height } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource.*(40[013])/.test(m.text())) { problems.push(m.text()); }
    });
    page.on('pageerror', (e) => problems.push(String(e)));
    page.on('dialog', (d) => { problems.push('dialog opened: ' + d.message()); d.dismiss(); });
    await page.goto(SITE);
    await page.waitForSelector('#panel-signin:not([hidden])');
    await page.fill('#si-email', email);
    await page.fill('#si-password', PW);
    await page.click('#form-signin button[type=submit]');
    await page.waitForURL(SITE + 'hub.html');
    await page.waitForSelector('#main:not([hidden])');
    return { page, id, name };
  }
  const fits = async (page) => (await page.evaluate(() => document.documentElement.scrollWidth)) <= width;
  const shot = async (page, name) => {
    if (SHOTS) { await mkdir(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, label + '-' + name + '.png'), fullPage: true }); }
  };
  const said = async (page, text) => {
    try { await page.waitForSelector('#msg.hub-ok:has-text("' + text + '")', { timeout: 10000 }); }
    catch (e) { throw new Error('expected "' + text + '", the page says: ' + (await page.textContent('#msg')) + ' / ' + (await page.textContent('#up-report').catch(() => ''))); }
  };
  async function sealed(page, selector) {
    for (let i = 0; i < 100; i += 1) {
      for (const f of page.frames()) {
        if (f.url() === 'about:srcdoc' && await f.locator(selector).count().catch(() => 0)) { return f; }
      }
      await page.waitForTimeout(100);
    }
    throw new Error('the tool did not show ' + selector);
  }
  const builder = async (page, tool) => { await page.goto(SITE + 'admin/tool.html?space=test-space&tool=' + tool); await page.waitForSelector('#body:not([hidden])'); };
  // The builder is a guide with one step on screen: these do what a person does to get to a step.
  const way = async (page, which) => { if (await page.locator('#wz-restart').isVisible()) { await page.click('#wz-restart'); } await page.click('#go-' + which); };
  const toUpload = async (page) => { if (await page.locator('#wz-next').isVisible()) { await page.click('#wz-next'); } };
  const openTool = async (page, tool, extra = '') => { await page.goto(SITE + 'tool.html?space=test-space&tool=' + tool + extra); };
  const twice = async (page, box, labelText) => {
    await page.click(box + ' button:text-is("' + labelText + '")');
    await page.click(box + ' button:text-is("Press again to confirm")');
  };
  // Asks the kit inside the tool, as the tool's own code would; returns the value or the refusal's sentence.
  const kit = (frame, code) => frame.evaluate((c) => new Function('return (' + c + ')')().then((v) => v === undefined ? 'done' : v, (e) => 'REFUSED: ' + e.message), code);

  try {
    const ita = await person('ita@test.dame', 'Ita Admin', true);
    const ray = await person('ray@test.dame', 'Ray Reader');
    const cat = await person('cat@test.dame', 'Cat Contributor');
    const edi = await person('edi@test.dame', 'Edi Editor');
    const app = await person('app@test.dame', 'App Approver');

    // --- the test space in one press
    await ita.page.goto(SITE + 'admin/it.html');
    await ita.page.waitForSelector('#body:not([hidden])');
    await ita.page.click('#test-make');
    await said(ita.page, 'The test space is made');
    check(await ita.page.locator('#test-open').isVisible() && !(await ita.page.locator('#test-make').isVisible()), T + 'the test space is made once, then offered to open');
    await ita.page.click('#test-open');
    await ita.page.waitForSelector('#body:not([hidden])');
    check((await ita.page.locator('#tools [data-tool]').count()) === 2 && /Converter/.test(await ita.page.textContent('#tools')) && /Tracker/.test(await ita.page.textContent('#tools')), T + 'it holds two empty tools: Converter and Tracker');
    for (const [who, level] of [[ray, 'read'], [cat, 'contribute'], [edi, 'edit'], [app, 'approve']]) {
      await mock.sql(`insert into core.tool_access (space, tool, user_id, level, added_by) values ('test-space', 'tracker', '${who.id}', '${level}', '${ita.id}'), ('test-space', 'converter', '${who.id}', 'read', '${ita.id}')`);
    }

    // --- sub tile 1: stand-alone, from a ready-made page
    await builder(ita.page, 'converter');
    check((await ita.page.inputValue('#example')) === 'converter', T + 'the builder offers a ready-made stand-alone page');
    await way(ita.page, 'ready');
    await ita.page.click('#example-load');
    await ita.page.waitForSelector('#up-report li.hub-ok');
    check(/The check passed: index\.html .*Next: upload/.test(await ita.page.textContent('#up-report')) && !(await ita.page.locator('#tables-need').isVisible()), T + 'stand-alone: the check passes and no table is asked for');
    await toUpload(ita.page); await ita.page.click('#up-send');
    await said(ita.page, 'Version 1 is uploaded');
    await twice(ita.page, '#versions', 'Make live');
    await said(ita.page, 'Version 1 is live');
    mock.calls.length = 0;
    await openTool(ray.page, 'converter');
    let f = await sealed(ray.page, '#fields input');
    await f.fill('#fields input >> nth=0', '35.168525');
    check((await f.inputValue('#fields input >> nth=1')) === '10' && /Hello, Ray Reader/.test(await f.textContent('#hello')), T + 'stand-alone: a reader uses it (35.17 kW = 10 TR); nothing is saved');
    check(mock.calls.every((c) => !/dame_rows|dame_table/.test(c.path)), T + 'stand-alone: it never touched the data service');
    // --- day and night: the button of the bar, kept in this browser, followed by the tool
    const before = await f.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await ray.page.click('.hub-theme');
    await f.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'night');
    const night = await f.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(before !== night && (await ray.page.evaluate(() => localStorage.getItem('dame.theme'))) === 'night' && (await f.inputValue('#fields input >> nth=0')) === '35.168525', T + 'the day and night button changes the site and the running tool; what was typed stays');
    await ray.page.reload();
    f = await sealed(ray.page, '#fields input');
    check((await ray.page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'night' && (await f.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'night', T + 'the choice is kept: the page and the tool open in night again');
    await ray.page.click('.hub-theme');
    await f.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'day');
    await f.fill('#fields input >> nth=0', '35.168525');
    await shot(ray.page, '1-converter');
    check(await fits(ray.page), T + 'the stand-alone tool fits the screen');

    // --- sub tile 2: saves rows. The page says which tables it needs; the site makes them.
    await builder(ita.page, 'tracker');
    check((await ita.page.inputValue('#example')) === 'tracker', T + 'for a tile named Tracker the ready-made tracker is offered first');
    await way(ita.page, 'ready');
    await ita.page.click('#example-load');
    await ita.page.waitForSelector('#tables-need:not([hidden])');
    const need = await ita.page.textContent('#tables-need');
    check(/One thing left/.test(await ita.page.textContent('#up-report')) && /New table bids \(team\): project text, capacity_kw number, due date, status choice \(open, won, lost\), lead person, notes longtext/.test(need), T + 'the site reads which table the page needs and lists it in plain words');
    check(await ita.page.locator('#up-send').isDisabled(), T + 'the page cannot be uploaded before its table exists');
    await shot(ita.page, '2-tables-needed');
    // The review window: the columns read from the page, and one more added before anything is made.
    await ita.page.waitForSelector('.hub-focus');
    const win = await ita.page.textContent('.hub-focus');
    check(/bids/.test(win) && /New table/.test(win) && /capacity_kw/.test(win) && /From your page/.test(win) && /Team: everyone with the tool sees all rows/.test(win), T + 'after the check a window shows the table and the columns read from the page');
    await ita.page.fill('.hub-focus-add input >> nth=0', 'id');
    await ita.page.click('.hub-focus-add button');
    check(/already has id by itself/.test(await ita.page.textContent('.hub-focus .hub-warn')), T + 'a column name the site keeps for itself is refused in words');
    await ita.page.fill('.hub-focus-add input >> nth=0', 'Unit Price!');
    await ita.page.selectOption('.hub-focus-add select', 'number');
    await ita.page.click('.hub-focus-add button');
    await ita.page.waitForSelector('.hub-focus li:has-text("unit_price")');
    check(/unit_price\s*Number\s*Added by you/.test((await ita.page.textContent('.hub-focus li:has-text("unit_price")')).replace(/\s+/g, ' ')), T + 'a column is added in the window: "Unit Price!" becomes unit_price, a number');
    check((await mock.sql("select to_regclass('t_test_space__tracker.bids') is null as none")).rows[0].none, T + 'nothing is made in the database before the button is pressed');
    await shot(ita.page, '2b-review-window');
    await ita.page.click('#tables-go');
    await said(ita.page, 'The tables are made');
    check(/shows the added columns by itself/.test(await ita.page.textContent('#msg')) && !(await ita.page.locator('.hub-focus').count()) && !(await ita.page.locator('#cols-copy').isVisible()), T + 'the ready-made tracker draws its form from the list, so no request for the AI is needed');
    check((await mock.sql("select count(*)::int as n from information_schema.columns where table_name = 'bids' and column_name = 'unit_price' and table_schema in ('t_test_space__tracker', 'p_test_space__tracker')")).rows[0].n === 2, T + 'the added column exists in the live table and in the preview copy');
    check(!(await ita.page.locator('#tables-need').isVisible()) && !(await ita.page.locator('#up-send').isDisabled()), T + 'one press makes the table; nobody typed SQL');
    check(/bids/.test(await ita.page.textContent('#data-tables')) && /0 rows/.test(await ita.page.textContent('[data-table="bids"]')), T + 'the Data section lists the new table with its columns');
    const made = await mock.sql("select (to_regclass('t_test_space__tracker.bids') is not null and to_regclass('p_test_space__tracker.bids') is not null) as both, (select relforcerowsecurity from pg_class where oid = to_regclass('t_test_space__tracker.bids')) as locked");
    check(made.rows[0].both && made.rows[0].locked, T + 'in the database: a live table and a preview copy, both locked');
    await toUpload(ita.page); await ita.page.click('#up-send');
    await said(ita.page, 'Version 1 is uploaded');

    // --- the preview has its own rows
    await openTool(ita.page, 'tracker', '&preview=1');
    f = await sealed(ita.page, '#form-card:not([hidden])');
    await f.fill('#fields input >> nth=0', 'Trial in preview');
    await f.click('#form-save');
    await f.waitForSelector('#body tr:has-text("Trial in preview")');
    check(/Ita Admin/.test(await f.textContent('#body')), T + 'in the preview a manager adds a row and sees who added it');
    await builder(ita.page, 'tracker');
    check(/0 rows/.test(await ita.page.textContent('[data-table="bids"]')) && /1 in the preview/.test(await ita.page.textContent('[data-table="bids"]')), T + 'the preview row is counted apart from the real rows');
    await twice(ita.page, '#versions', 'Make live');
    await said(ita.page, 'Version 1 is live');

    // --- contribute: add, change own
    await openTool(cat.page, 'tracker');
    f = await sealed(cat.page, '#form-card:not([hidden])');
    check((await f.locator('#body tr').count()) === 0 && await f.locator('#empty').isVisible(), T + 'the live tool starts empty: the preview row is not there');
    await f.fill('#fields input >> nth=0', 'Alpha');
    await f.fill('#fields input[type=number]', '120.5');
    await f.fill('#fields input[type=date]', '2026-12-31');
    await f.selectOption('#fields select >> nth=0', 'open');
    await f.selectOption('#fields select >> nth=1', { label: 'Edi Editor' });
    await f.fill('#fields textarea', 'first row');
    await f.click('#form-save');
    await f.waitForSelector('#body tr:has-text("Alpha")');
    const alpha = await f.textContent('#body tr:has-text("Alpha")');
    check(/120\.5/.test(alpha) && /2026-12-31/.test(alpha) && /open/.test(alpha) && /Edi Editor/.test(alpha) && /Cat Contributor,/.test(alpha), T + 'a contributor adds a row: number, date, choice and person are saved and shown');
    await shot(cat.page, '3-tracker');
    check(await fits(cat.page), T + 'the tracker fits the screen');

    await openTool(edi.page, 'tracker');
    let fe = await sealed(edi.page, '#body tr:has-text("Alpha")');
    check(true, T + 'another person sees the same row at once: the rows are shared');
    await fe.fill('#fields input >> nth=0', 'Beta');
    await fe.click('#form-save');
    await fe.waitForSelector('#body tr:has-text("Beta")');

    await openTool(cat.page, 'tracker');
    f = await sealed(cat.page, '#body tr:has-text("Beta")');
    check((await f.locator('#body tr:has-text("Alpha") button:text-is("Change")').count()) === 1 && (await f.locator('#body tr:has-text("Beta") button').count()) === 0 && (await f.locator('#body button:text-is("Delete")').count()) === 0, T + 'a contributor may change his own row, not another\'s, and delete none');
    const betaId = (await mock.sql("select id from t_test_space__tracker.bids where project = 'Beta'")).rows[0].id;
    const alphaId = (await mock.sql("select id from t_test_space__tracker.bids where project = 'Alpha'")).rows[0].id;
    check(/your own rows only/.test(await kit(f, `Dame.table('bids').update('${betaId}', { project: 'Mine now' })`)), T + 'changing another person\'s row is refused by the database, not just hidden');
    check(/needs the level "approve"/.test(await kit(f, `Dame.table('bids').remove('${alphaId}')`)), T + 'deleting is refused for a contributor, even his own row');

    // --- edit: change anyone's
    await fe.click('#body tr:has-text("Alpha") button:text-is("Change")');
    await fe.selectOption('#fields select >> nth=0', 'won');
    await fe.click('#form-save');
    await fe.waitForSelector('#body tr:has-text("Alpha"):has-text("won")');
    check((await fe.locator('#body button:text-is("Delete")').count()) === 0, T + 'an editor changes another person\'s row; he cannot delete');

    // --- read: sees, cannot change
    await openTool(ray.page, 'tracker');
    f = await sealed(ray.page, '#body tr:has-text("Alpha")');
    check(!(await f.locator('#form-card').isVisible()) && (await f.locator('#body button').count()) === 0 && (await f.locator('#body tr').count()) === 2, T + 'a reader sees both rows and has no form and no buttons');
    check(/lets you read, not add/.test(await kit(f, `Dame.table('bids').add({ project: 'Sneak' })`)), T + 'adding is refused for a reader by the database');
    await f.fill('#find', 'beta');
    check((await f.locator('#body tr').count()) === 1 && /rows found of 2/.test(await f.textContent('#stats')), T + 'the list can be searched');
    const [csv] = await Promise.all([ray.page.waitForEvent('download', { timeout: 15000 }), f.click('#csv')]);
    const csvText = await readFile(await csv.path(), 'utf8');
    check(csv.suggestedFilename() === 'bids.csv' && /Alpha,120\.5,2026-12-31,won,Edi Editor,first row,,Cat Contributor/.test(csvText) && /unit_price/i.test(csvText.split('\n')[0].replace(/ /g, '_')), T + 'the list is saved as a file the person can open in Excel, with the column that was added in the window');

    // --- approve: delete
    await openTool(app.page, 'tracker');
    f = await sealed(app.page, '#body tr:has-text("Beta")');
    await f.click('#body tr:has-text("Beta") button:text-is("Delete")');
    check((await f.locator('#body tr').count()) === 2, T + 'one press on Delete changes nothing');
    await f.click('#body tr:has-text("Beta") button:text-is("Press again to delete")');
    await f.waitForFunction(() => document.querySelectorAll('#body tr').length === 1);
    check(true, T + 'an approver deletes a row with two presses');

    // --- what a tool's own code cannot do, asked through the kit like any tool would
    f = await sealed(cat.page, '#body tr');
    const tries = [
      ['a table name that is SQL', `Dame.table('bids; drop table core.profiles; --').list()`, /not valid/],
      ['a table of the platform', `Dame.table('profiles').list()`, /no table named profiles/],
      ['a filter on a column that does not exist', `Dame.table('bids').list({ where: { 'project = \\'x\\' or 1=1 --': 'x' } })`, /cannot be filtered/],
      ['a sort that is SQL', `Dame.table('bids').list({ sort: 'project; drop table core.profiles' })`, /cannot be sorted/],
      ['a value that does not fit', `Dame.table('bids').add({ status: 'maybe' })`, /must be one of: open, won, lost/],
      ['a column that does not exist', `Dame.table('bids').add({ nosuch: 1 })`, /no column named nosuch/],
      ['a row id that is not an id', `Dame.table('bids').get('1 or 1=1')`, /not found/]
    ];
    for (const [what, code, expect] of tries) {
      const got = await kit(f, code);
      check(/^REFUSED/.test(got) && expect.test(got), T + 'refused with a plain sentence: ' + what);
    }
    const spoof = await kit(f, `Dame.table('bids').add({ project: 'Spoof', owner: '${ita.id}', id: '${alphaId}', updated_by: '${ita.id}', created_at: '2001-01-01' })`);
    check(spoof.owner === cat.id && spoof.updated_by === cat.id && spoof.id !== alphaId && !/^2001/.test(spoof.created_at), T + 'a tool cannot set who owns a row, its id or its dates: the site sets them');
    const quote = await kit(f, `Dame.table('bids').list({ where: { project: "x' or '1'='1" } })`);
    check(Array.isArray(quote) && quote.length === 0, T + 'a value that looks like SQL is only a value');
    const people = await kit(f, 'Dame.people()');
    check(people.length === 5 && Object.keys(people[0]).sort().join(',') === 'id,name', T + 'the tool gets the names of the people who have it, and no email');
    check((await mock.sql('select count(*)::int as n from core.profiles')).rows[0].n === 5, T + 'the platform\'s own tables are untouched');

    // --- making tables by hand on the Data page; a list and form for them without AI
    await builder(ita.page, 'tracker');
    await ita.page.fill('#tb-name', 'prices');
    await ita.page.selectOption('#tb-sharing', 'reference');
    await ita.page.fill('#tb-columns .hub-colline >> nth=0 >> input >> nth=0', 'item');
    await ita.page.fill('#tb-columns .hub-colline >> nth=1 >> input >> nth=0', 'unit');
    await ita.page.selectOption('#tb-columns .hub-colline >> nth=1 >> select', 'choice');
    await ita.page.fill('#tb-columns .hub-colline >> nth=1 >> input >> nth=1', 'each, metre');
    await ita.page.click('#form-table button[type=submit]');
    await said(ita.page, 'The table prices is made');
    check(/item \(text\), unit \(choice: each, metre\)/.test(await ita.page.textContent('[data-table="prices"]')), T + 'a table is made by filling a form: name, who shares, columns');
    await ita.page.fill('[data-table="prices"] .hub-colline input >> nth=0', 'price');
    await ita.page.selectOption('[data-table="prices"] .hub-colline select', 'number');
    await ita.page.click('[data-table="prices"] button:text-is("Add this column")');
    await said(ita.page, 'The column price is added');
    await ita.page.fill('#tb-name', 'Bad Name');
    await ita.page.fill('#tb-columns .hub-colline >> nth=0 >> input >> nth=0', 'a1');
    await ita.page.click('#form-table button[type=submit]');
    await ita.page.waitForSelector('#msg.hub-warn');
    check(/starts with a small letter/.test(await ita.page.textContent('#msg')), T + 'a bad table name is refused with the rule in plain words');
    check(await ita.page.locator('[data-table="prices"] .hub-delete button').isDisabled(), T + 'deleting a table is locked until its name is typed');
    await shot(ita.page, '4-data');
    check(await fits(ita.page), T + 'the builder with the Data section fits the screen');
    await way(ita.page, 'ai');
    await ita.page.fill('#brief', 'Keep a list of site visits with date, customer segment and outcome.');
    await ita.page.click('#wz-next');
    await ita.page.check('#need-data');
    await ita.page.click('#wz-next');
    await ita.page.click('#kit-copy');
    const kitText = await ita.page.evaluate(() => navigator.clipboard.readText());
    check(/id="dame-tables"/.test(kitText) && /Dame\.table\('bids'\)/.test(kitText) && /already has these tables.*bids \(team\).*prices \(reference\)/.test(kitText) && !/saves nothing/.test(kitText), T + 'the starter kit teaches the AI the tables, and names the ones this tool already has');
    check((await ita.page.locator('#example option[value="own"]').getAttribute('hidden')) === null, T + 'once a tool has tables, a list and form for them is offered without AI');
    await ita.page.fill('[data-table="prices"] .hub-delete input', 'prices');
    await ita.page.click('[data-table="prices"] .hub-delete button');
    await said(ita.page, 'The table prices and its rows are deleted');
    check((await ita.page.locator('[data-table="prices"]').count()) === 0, T + 'a table is deleted after its name is typed');

    // --- deleting the tool takes its tables with it
    await ita.page.goto(SITE + 'admin/space.html?space=test-space');
    await ita.page.waitForSelector('#body:not([hidden])');
    await ita.page.fill('[data-tool="tracker"] .hub-delete input', 'tracker');
    await ita.page.click('[data-tool="tracker"] .hub-delete button.hub-danger');
    await said(ita.page, 'Tracker is deleted');
    const gone = await mock.sql("select to_regnamespace('t_test_space__tracker') is null and to_regnamespace('p_test_space__tracker') is null as gone");
    check(gone.rows[0].gone, T + 'deleting the tool deletes its tables and rows');
    check((await mock.sql('select count(*)::int as n from core.security_check()')).rows[0].n === 0, T + 'the security check finds nothing after all of this');

    check(problems.length === 0, T + 'no page error, blocked load or dialog' + (problems.length ? ' -> ' + problems.slice(0, 4).join(' | ') : ''));
  } catch (err) {
    check(false, label + ': the test stopped: ' + String(err).split('\n').slice(0, 3).join(' ') + (problems.length ? ' | ' + problems.slice(0, 4).join(' | ') : ''));
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
