/*
 * tests/browser/phase2.mjs - the phase 2 test in a real browser, at desktop
 * width and at 390 px: IT admin makes spaces; an admin builds his space; a
 * manager and a member see only what is theirs; everything outside is refused.
 * Serves: phase 2 test ("an admin acts alone inside his space; every action
 * outside it is refused"). Must not change: it uses the pages exactly as they
 * are in the repo; only the database address is pointed at the stand-in.
 *
 * Needs once:  npm install --no-save @electric-sql/pglite playwright-core
 * Run:         node tests/browser/phase2.mjs        (exit code 0 = all passed)
 */
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { start } from '../../tools/serve.mjs';
import { startMock, KEY } from './mock-supabase.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.env.SHOTS || '';
const SITE_PORT = 8151;
const MOCK_PORT = 8152;
const SITE = 'http://127.0.0.1:' + SITE_PORT + '/toolsDame/';
const MOCK = 'http://127.0.0.1:' + MOCK_PORT;
const CONFIG = await readFile(join(ROOT, 'kit/v1/config.js'), 'utf8');
const REAL = (CONFIG.match(/supabaseUrl:\s*'([^']*)'/) || [])[1];
const REAL_KEY = (CONFIG.match(/publishableKey:\s*'([^']*)'/) || [])[1];
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
  const T = label + ': ';

  async function person(email, name, isIt) {
    await mock.addUser(email, name, PW, isIt);
    const ctx = await browser.newContext({ viewport: { width, height } });
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
    return page;
  }
  const fits = async (page) => (await page.evaluate(() => document.documentElement.scrollWidth)) <= width;
  const shot = async (page, name) => {
    if (SHOTS) { await mkdir(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, label + '-' + name + '.png'), fullPage: true }); }
  };
  const open = async (page, path, ready = '#body:not([hidden])') => { await page.goto(SITE + path); await page.waitForSelector(ready); };
  const refusedPage = async (page, path) => {
    await page.goto(SITE + path);
    await page.waitForSelector('#msg:not([hidden])');
    const body = await page.locator('#body').count() ? await page.locator('#body').isVisible() : false;
    return (await page.textContent('#msg')) + (body ? ' [BODY SHOWN]' : '');
  };
  const pick = async (page, box, query, choose) => {
    await page.fill(box + ' input[type=search]', query);
    await page.click(box + ' button:has-text("Find")');
    await page.click(box + ' .hub-person button:has-text("' + choose + '")');
  };
  const said = (page, text) => page.waitForSelector('#msg.hub-ok:has-text("' + text + '")');
  const twice = async (page, box, labelText) => {
    await page.click(box + ' button:text-is("' + labelText + '")');
    await page.click(box + ' button:text-is("Press again to confirm")');
  };
  const tryRpc = (page, name, args) => page.evaluate(([n, a]) => window.DameApi.rpc(n, a).then(() => 'ALLOWED', (e) => e.code), [name, args]);

  try {
    const ita = await person('ita@test.dame', 'Ita Admin', true);
    const ben = await person('ben@test.dame', 'Ben Sales', false);
    const cy = await person('cy@test.dame', 'Cy Member', false);
    const di = await person('di@test.dame', 'Di Manager', false);
    const eve = await person('eve@test.dame', 'Eve Service', false);

    // --- IT admin makes two spaces
    await open(ita, 'admin/it.html');
    check(await ita.locator('#spaces-empty').isVisible(), T + 'IT admin sees "no spaces yet"');
    await ita.fill('#sp-name', 'Sales Team');
    check((await ita.inputValue('#sp-id')) === 'sales-team', T + 'the id is suggested from the name');
    await ita.click('#form-space button[type=submit]');
    await ita.waitForSelector('#msg.hub-warn');
    check(/Choose the first admin/.test(await ita.textContent('#msg')), T + 'a space cannot be created without a first admin');
    await pick(ita, '#sp-picker', 'ben', 'Choose');
    check(/Ben Sales/.test(await ita.textContent('#sp-admin')), T + 'the chosen first admin is shown');
    await ita.click('#form-space button[type=submit]');
    await said(ita, 'Sales Team is created');
    check((await ita.textContent('[data-space="sales-team"]')).includes('Ben Sales'), T + 'the new space lists its admin');
    check((await ita.inputValue('#sp-name')) === '', T + 'the form is emptied after creating');
    await ita.fill('#sp-name', 'Service');
    await ita.fill('#sp-id', 'service');
    await pick(ita, '#sp-picker', 'eve@', 'Choose');
    await ita.click('#form-space button[type=submit]');
    await said(ita, 'Service is created');
    await ita.fill('#sp-name', 'Service again');
    await ita.fill('#sp-id', 'service');
    await ita.click('#sp-me');
    await ita.click('#form-space button[type=submit]');
    await ita.waitForSelector('#msg.hub-warn');
    check(/taken or was used before/.test(await ita.textContent('#msg')), T + 'the same id twice is refused in plain words');
    check(await fits(ita), T + 'IT admin page fits the screen');
    await shot(ita, '1-it-spaces');

    // --- the admin builds his space
    await open(ben, 'hub.html', '#spaces a');
    check((await ben.locator('#spaces a').count()) === 1 && /Sales Team/.test(await ben.textContent('#spaces')), T + 'the admin sees only his space on the hub');
    await ben.click('#spaces a');
    await ben.waitForSelector('#admin-card:not([hidden])');
    check(await ben.locator('#empty').isVisible(), T + 'a new space says it has no tools yet');
    await ben.click('#admin-link');
    await ben.waitForSelector('#body:not([hidden])');
    await ben.click('.hub-section:text-is("Audit")');
    await ben.waitForSelector('.hub-section[aria-current="true"]:text-is("Audit")');
    check((await ben.locator('.hub-section').count()) >= 3, T + 'a long admin page has a strip of its parts; a press goes to the part and lights its name');
    await ben.evaluate(() => window.scrollTo(0, 0));
    await ben.fill('#tl-name', 'Bid Tracker');
    check((await ben.inputValue('#tl-id')) === 'bid-tracker', T + 'the tool id is suggested from the name');
    await ben.fill('#tl-icon', 'B');
    await ben.check('#tl-open');
    await ben.selectOption('#tl-level', 'contribute');
    await ben.click('#form-tool button[type=submit]');
    await said(ben, 'Bid Tracker is created');
    await ben.fill('#tl-name', 'Price List');
    await ben.click('#form-tool button[type=submit]');
    await said(ben, 'Price List is created');
    await ben.fill('#tl-name', EVIL);
    await ben.fill('#tl-id', 'odd-name');
    await ben.click('#form-tool button[type=submit]');
    await said(ben, 'is created');
    check((await ben.locator('#tools [data-tool]').count()) === 3, T + 'three tools are listed');
    check((await ben.textContent('[data-tool="odd-name"] h3')).includes(EVIL) && (await ben.locator('#tools img').count()) === 0, T + 'a hostile tool name is shown as plain text');
    await pick(ben, '#member-picker', 'cy', 'Add to space');
    await said(ben, 'Cy Member is added');
    await pick(ben, '[data-tool="price-list"] .hub-picker', 'di man', 'Name as manager');
    await said(ben, 'Di Manager now manages');
    check((await ben.textContent('[data-tool="price-list"]')).includes('Di Manager'), T + 'the manager is listed on his tool');
    await ben.click('[data-tool="bid-tracker"] button:text-is("Change name, icon or colour")');
    await ben.fill('[data-tool="bid-tracker"] form.hub-edit input[type=text] >> nth=0', 'Bid Tracker 2');
    await ben.click('[data-tool="bid-tracker"] form button[type=submit]');
    await said(ben, 'bid-tracker is changed');
    check(/Bid Tracker 2/.test(await ben.textContent('[data-tool="bid-tracker"] h3')), T + 'a tool can be renamed; its id stays');
    check((await ben.locator('#audit tr').count()) >= 6, T + 'the space audit lists the admin\'s actions');
    check(await fits(ben), T + 'space admin page fits the screen');
    await shot(ben, '2-space-admin');

    // --- outside his space: refused
    check(/do not have this space/.test(await refusedPage(ben, 'admin/space.html?space=service')), T + 'admin opening another space\'s admin page is refused');
    check(/do not have this space/.test(await refusedPage(ben, 'space.html?space=service')), T + 'admin opening another space is refused');
    check(/Only an IT admin/.test(await refusedPage(ben, 'admin/it.html')), T + 'space admin cannot use the IT page');
    const outside = [
      await tryRpc(ben, 'dame_tool_create', { p_space: 'service', p_id: 'intruder', p_name: 'x', p_description: '', p_icon: '', p_colour: '', p_open_to_space: true, p_open_level: 'approve' }),
      await tryRpc(ben, 'dame_space_member_add', { p_space: 'service', p_user: '00000000-0000-4000-8000-000000000001' }),
      await tryRpc(ben, 'dame_space_admin_add', { p_space: 'service', p_user: '00000000-0000-4000-8000-000000000001' }),
      await tryRpc(ben, 'dame_space_delete', { p_space: 'service', p_confirm: 'service' }),
      await tryRpc(ben, 'dame_space_set_active', { p_space: 'sales-team', p_active: false }),
      await tryRpc(ben, 'dame_spaces_all', {})
    ].join(',');
    check(outside === Array(6).fill('not_allowed').join(','), T + 'admin calling functions outside his space is refused (' + outside + ')');
    check(/names no space/.test(await refusedPage(ben, 'admin/space.html?space=../hub')), T + 'an address with a bad id is not sent to the server');

    // --- the manager: his tool only
    await open(di, 'hub.html', '#spaces a');
    await di.click('#spaces a');
    await di.waitForSelector('#tools a');
    check((await di.locator('#tools a').count()) === 1 && /Price List/.test(await di.textContent('#tools')) && /You manage it/.test(await di.textContent('#tools')), T + 'manager sees only his tool in the space');
    check(!(await di.locator('#admin-card').isVisible()), T + 'manager does not see the space admin card');
    await open(di, 'admin/tool.html?space=sales-team&tool=price-list');
    await di.selectOption('#new-level', 'edit');
    await pick(di, '#access-picker', 'cy', 'Give access');
    await said(di, 'Cy Member now has the level edit');
    await di.selectOption('#access select', 'approve');
    await said(di, 'Cy Member now has the level approve');
    check((await di.inputValue('#access select')) === 'approve', T + 'manager gives and raises access on his tool');
    check(await fits(di), T + 'tool admin page fits the screen');
    await shot(di, '3-tool-admin');
    check(/do not look after this tool/.test(await refusedPage(di, 'admin/tool.html?space=sales-team&tool=bid-tracker')), T + 'manager opening another tool\'s admin page is refused');
    check(/do not have this space/.test(await refusedPage(di, 'admin/space.html?space=sales-team')), T + 'manager opening the space admin page is refused');
    const beyond = [
      await tryRpc(di, 'dame_tool_access_set', { p_space: 'sales-team', p_tool: 'bid-tracker', p_user: '00000000-0000-4000-8000-000000000001', p_level: 'approve' }),
      await tryRpc(di, 'dame_tool_update', { p_space: 'sales-team', p_tool: 'price-list', p_name: 'x', p_description: '', p_icon: '', p_colour: '', p_open_to_space: true, p_open_level: 'approve' }),
      await tryRpc(di, 'dame_tool_delete', { p_space: 'sales-team', p_tool: 'price-list', p_confirm: 'price-list' }),
      await tryRpc(di, 'dame_tool_manager_add', { p_space: 'sales-team', p_tool: 'price-list', p_user: '00000000-0000-4000-8000-000000000001' })
    ].join(',');
    check(beyond === Array(4).fill('not_allowed').join(','), T + 'manager calling functions beyond his tool is refused (' + beyond + ')');

    // --- the member
    await open(cy, 'hub.html', '#spaces a');
    await cy.click('#spaces a');
    await cy.waitForSelector('#tools a');
    const tiles = await cy.textContent('#tools');
    check((await cy.locator('#tools a').count()) === 2 && /Bid Tracker 2.*You can add/.test(tiles) && /Price List.*You can approve/.test(tiles), T + 'member sees the open tool and the tool given by name, with his levels');
    check((await cy.locator('#tools a >> nth=0').getAttribute('href')).endsWith('tool.html?space=sales-team&tool=bid-tracker'), T + 'a tile\'s address is built from the two ids');
    check(await fits(cy), T + 'space page fits the screen');
    await shot(cy, '4-space');
    check(/do not have this space/.test(await refusedPage(cy, 'admin/space.html?space=sales-team')), T + 'member opening the space admin page is refused');
    const member = [
      await tryRpc(cy, 'dame_tool_access_set', { p_space: 'sales-team', p_tool: 'price-list', p_user: '00000000-0000-4000-8000-000000000001', p_level: 'approve' }),
      await tryRpc(cy, 'dame_people_find', { p_query: 'ben' }),
      await tryRpc(cy, 'dame_space_admin_get', { p_space: 'sales-team' }),
      await tryRpc(cy, 'dame_audit_scope_list', { p_space: 'sales-team', p_tool: null, p_limit: 10, p_before: null })
    ].join(',');
    check(member === Array(4).fill('not_allowed').join(','), T + 'member calling admin functions is refused (' + member + ')');

    // --- switch off, delete
    await open(ben, 'admin/space.html?space=sales-team');
    await ben.click('[data-tool="bid-tracker"] button:text-is("Switch off")');
    check(/On/.test(await ben.textContent('[data-tool="bid-tracker"] h3 .hub-pill-ok')), T + 'one press on Switch off changes nothing');
    await ben.click('[data-tool="bid-tracker"] button:text-is("Press again to confirm")');
    await said(ben, 'is switched off');
    await open(cy, 'space.html?space=sales-team', '#tools a');
    check((await cy.locator('#tools a').count()) === 1, T + 'a tool switched off disappears for members');
    check(await ben.locator('[data-tool="price-list"] .hub-delete button').isDisabled(), T + 'Delete is locked until the id is typed');
    await ben.fill('[data-tool="price-list"] .hub-delete input', 'price');
    check(await ben.locator('[data-tool="price-list"] .hub-delete button').isDisabled(), T + 'a partly typed id keeps Delete locked');
    await ben.fill('[data-tool="price-list"] .hub-delete input', 'price-list');
    await ben.click('[data-tool="price-list"] .hub-delete button');
    await said(ben, 'Price List is deleted');
    check((await ben.locator('[data-tool="price-list"]').count()) === 0, T + 'the deleted tool is gone');
    await ben.fill('#tl-name', 'Price List');
    await ben.click('#form-tool button[type=submit]');
    await ben.waitForSelector('#msg.hub-warn');
    check(/never reused/.test(await ben.textContent('#msg')), T + 'the id of a deleted tool cannot be used again');
    check(/do not look after this tool/.test(await refusedPage(di, 'admin/tool.html?space=sales-team&tool=price-list')), T + 'the old manager is outside at once');

    // --- a space always has an admin
    await open(eve, 'admin/space.html?space=service');
    await twice(eve, '#admins', 'Remove');
    await eve.waitForSelector('#msg.hub-warn');
    check(/at least one admin/.test(await eve.textContent('#msg')), T + 'the last admin cannot remove himself');

    // --- IT admin: switch off and delete a space
    await open(ita, 'admin/it.html');
    await twice(ita, '[data-space="sales-team"]', 'Switch space off');
    await said(ita, 'Sales Team is switched off');
    check(/do not have this space/.test(await refusedPage(cy, 'space.html?space=sales-team')), T + 'members cannot open a space that is switched off');
    await open(ben, 'space.html?space=sales-team', '#admin-card:not([hidden])');
    check(/switched off by IT/.test(await ben.textContent('#msg')), T + 'its admin still opens it and is told it is off');
    await ita.fill('[data-space="sales-team"] .hub-delete input[type=text]', 'sales-team');
    await ita.click('[data-space="sales-team"] .hub-delete button.hub-danger');
    await said(ita, 'Sales Team is deleted');
    check((await ita.locator('[data-space="sales-team"]').count()) === 0 && (await ita.locator('[data-space="service"]').count()) === 1, T + 'the deleted space is gone, the other stays');
    check(/deleted the space/.test(await ita.textContent('#audit tr >> nth=0')), T + 'the deletion is at the top of the audit');
    await open(ben, 'hub.html', '#empty:not([hidden])');
    check((await ben.locator('#spaces a').count()) === 0, T + 'the old admin has no space left on his hub');
    await shot(ita, '5-it-after');

    check(problems.length === 0, T + 'no page error, blocked load or dialog' + (problems.length ? ' -> ' + problems.join(' | ') : ''));
  } catch (err) {
    check(false, label + ': the test stopped: ' + String(err).split('\n').slice(0, 3).join(' ') + (problems.length ? ' | ' + problems.join(' | ') : ''));
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
