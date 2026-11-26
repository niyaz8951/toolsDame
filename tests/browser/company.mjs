/*
 * tests/browser/company.mjs - the dress rehearsal: seven departments, each
 * with its own admin and member, each building two tools (one stand-alone,
 * one that keeps rows), then every person trying everything that is not his.
 * Serves: the questions an IT review asks before a first demo: does one
 * department stay out of another, does a role stay inside its rights, what
 * happens to a leaver, to a space switched off, to a deleted tool.
 * Must not change: the pages are used exactly as they are in the repo; only
 * the database address is pointed at the stand-in. A later phase may add
 * departments and probes, never remove one.
 *
 * Needs once:  npm install --no-save @electric-sql/pglite playwright-core
 * Run:         node tests/browser/company.mjs        (exit code 0 = all passed)
 */
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { start } from '../../tools/serve.mjs';
import { startMock, KEY } from './mock-supabase.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.env.SHOTS || '';
const SITE_PORT = 8191;
const MOCK_PORT = 8192;
const SITE = 'http://127.0.0.1:' + SITE_PORT + '/toolsDame/';
const MOCK = 'http://127.0.0.1:' + MOCK_PORT;
const CONFIG = await readFile(join(ROOT, 'kit/v1/config.js'), 'utf8');
const REAL = (CONFIG.match(/supabaseUrl:\s*'([^']*)'/) || [])[1];
const REAL_KEY = (CONFIG.match(/publishableKey:\s*'([^']*)'/) || [])[1];
const PW = 'correct horse battery 42';
const NOBODY = '00000000-0000-4000-8000-000000000001';

// Every data tool calls its table "entries": the same name in seven departments must never mix.
const DEPTS = [
  { id: 'marketing', name: 'Marketing', page: 'examples/departments/marketing-campaign-roi.html', tool: 'campaign-return', data: 'event-leads', sharing: 'team', mark: 'event',
    columns: { event: 'text', held_on: 'date', segment: { choice: ['consultant', 'contractor', 'owner'] }, interest: { choice: ['low', 'medium', 'high'] }, follow_up: 'bool', notes: 'longtext' },
    row: { held_on: '2026-11-01', segment: 'owner', interest: 'high', follow_up: true } },
  { id: 'dx-team', name: 'DX', page: 'examples/departments/dx-csv-viewer.html', tool: 'csv-viewer', data: 'automation-ideas', sharing: 'team', mark: 'idea',
    columns: { idea: 'text', status: { choice: ['new', 'building', 'done'] }, lead: 'person', hours_saved: 'number' }, row: { status: 'new', hours_saved: 4.5 } },
  { id: 'applied', name: 'Applied', page: 'examples/departments/applied-part-load.html', tool: 'part-load', data: 'selection-log', sharing: 'team', mark: 'project',
    columns: { project: 'text', unit_model: 'text', capacity_kw: 'number', selected_on: 'date', engineer: 'person' }, row: { unit_model: 'ZX-120-H-A2', capacity_kw: 120, selected_on: '2026-11-20' } },
  { id: 'product', name: 'Product team', page: 'examples/departments/product-code-reader.html', tool: 'code-reader', data: 'spec-changes', sharing: 'reference', mark: 'model',
    columns: { model: 'text', change: 'longtext', effective: 'date' }, row: { change: 'Sample change', effective: '2027-01-01' } },
  { id: 'factory', name: 'Factory', page: 'examples/departments/factory-lead-time.html', tool: 'delivery-date', data: 'stoppage-log', sharing: 'team', mark: 'note',
    columns: { note: 'text', line: { choice: ['line 1', 'line 2'] }, minutes: 'number', cause: { choice: ['material', 'machine', 'people'] } }, row: { line: 'line 1', minutes: 35, cause: 'machine' } },
  { id: 'finance', name: 'Finance', page: 'examples/departments/finance-currency.html', tool: 'currency', data: 'expense-notes', sharing: 'private', mark: 'note',
    columns: { note: 'text', spent_on: 'date', amount: 'number', category: { choice: ['travel', 'meals', 'other'] } }, row: { spent_on: '2026-11-25', amount: 42.5, category: 'travel' } },
  { id: 'spare-parts', name: 'Spare Parts', page: 'examples/parts-extractor/index.html', tool: 'parts-extractor', data: 'part-requests', sharing: 'team', mark: 'part_no',
    columns: { part_no: 'text', qty: 'number', urgent: 'bool', status: { choice: ['asked', 'ordered', 'arrived'] }, requested_for: 'person', extra: 'json' }, row: { qty: 3, urgent: true, status: 'asked', extra: { bin: 'A-1' } } }
];

let failed = 0;
let passed = 0;
function check(ok, what) {
  if (ok) { passed += 1; } else { failed += 1; }
  console.log((ok ? 'ok    ' : 'FAIL  ') + what);
}

const mock = await startMock(MOCK_PORT);
const site = await start(SITE_PORT, (rel, text) => text.split(REAL).join(MOCK).split(REAL_KEY).join(KEY));
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const problems = [];
const figures = {};

async function signIn(page, email) {
  await page.goto(SITE);
  await page.waitForSelector('#panel-signin:not([hidden])');
  await page.fill('#si-email', email);
  await page.fill('#si-password', PW);
  await page.click('#form-signin button[type=submit]');
}
async function person(email, name, isIt) {
  const id = await mock.addUser(email, name, PW, !!isIt);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource.*(40[013])/.test(m.text())) { problems.push(email + ': ' + m.text().slice(0, 200)); }
  });
  page.on('pageerror', (e) => problems.push(email + ': ' + String(e).slice(0, 200)));
  page.on('dialog', (d) => { problems.push('dialog opened: ' + d.message()); d.dismiss(); });
  await signIn(page, email);
  await page.waitForURL(SITE + 'hub.html');
  await page.waitForSelector('#main:not([hidden])');
  return { page, id, name, email };
}
// One dame_* call with the person's own session; the answer, or the refusal's code.
const rpc = (who, name, args) => who.page.evaluate(([n, a]) => window.DameApi.rpc(n, a).then((v) => ({ ok: true, value: v }), (e) => ({ ok: false, code: e.code, message: e.message })), [name, args || {}]);
// Many calls at once; returns the codes ('ALLOWED' when a call went through).
const probes = (who, list) => who.page.evaluate(async (calls) => {
  const out = [];
  for (const [n, a] of calls) {
    if (n === 'file') { out.push(await window.DameApi.fileBytes(a).then(() => 'ALLOWED', (e) => e.code)); }
    else { out.push(await window.DameApi.rpc(n, a).then(() => 'ALLOWED', (e) => e.code)); }
  }
  return out;
}, list);
async function sealed(page, selector) {
  for (let i = 0; i < 150; i += 1) {
    for (const f of page.frames()) {
      if (f.url() === 'about:srcdoc' && await f.locator(selector).count().catch(() => 0)) { return f; }
    }
    await page.waitForTimeout(100);
  }
  throw new Error('the tool did not show ' + selector);
}
const kit = (frame, code) => frame.evaluate((c) => new Function('return (' + c + ')')().then((v) => v === undefined ? 'done' : v, (e) => 'REFUSED: ' + e.message), code);
const said = async (page, text) => {
  try { await page.waitForSelector('#msg.hub-ok:has-text("' + text + '")', { timeout: 15000 }); }
  catch (e) { throw new Error('expected "' + text + '", the page says: ' + (await page.textContent('#msg')) + ' / ' + (await page.textContent('#up-report').catch(() => ''))); }
};
// The builder, as a person uses it: bring the page, read the check, make tables if asked, upload, make live.
async function build(who, space, tool, bring) {
  await who.page.goto(SITE + 'admin/tool.html?space=' + space + '&tool=' + tool);
  await who.page.waitForSelector('#needs input[value="exceljs"]');
  await bring(who.page);
  await who.page.waitForSelector('#up-report li.hub-ok, #up-report li.hub-warn');
  const lines = await who.page.locator('#up-report li').allTextContents();
  const stops = lines.filter((l) => /^Fix this/.test(l));
  const notes = lines.filter((l) => /^Note/.test(l));
  if (stops.length) { return { stops, notes }; }
  if (await who.page.locator('#tables-need').isVisible()) {
    await who.page.click('#tables-create');
    await said(who.page, 'The tables are made');
  }
  await who.page.click('#up-send');
  await who.page.waitForSelector('#after-upload:not([hidden])');
  await who.page.click('#after-live button');
  await who.page.click('#after-live button');
  await said(who.page, 'is live');
  return { stops, notes };
}

try {
  const tracker = (await readFile(join(ROOT, 'kit/starter/tracker.html'), 'utf8')).replace(/<!--[\s\S]*?-->\s*/, '');
  const it = await person('it.admin@test.dame', 'Ivy IT', true);
  for (const d of DEPTS) {
    d.lead = await person(d.id + '.lead@test.dame', d.name + ' Lead');
    d.user = await person(d.id + '.user@test.dame', d.name + ' User');
  }
  figures.people = 1 + DEPTS.length * 2;

  // ------------------------------------------------------------------ IT sets the site up
  check((await rpc(it, 'dame_setting_set', { p_key: 'signup_domains', p_value: 'test.dame' })).ok, 'IT: only the work domain may ask for access');
  await it.page.goto(SITE + 'admin/it.html');
  await it.page.waitForSelector('#body:not([hidden])');
  await it.page.fill('#sp-name', 'DX');
  check((await it.page.inputValue('#sp-id')) === 'dx-team', 'IT: a two-letter name like DX gets an id that is long enough (dx-team)');
  check((await rpc(it, 'dame_space_create', { p_id: 'dx', p_name: 'DX', p_description: '', p_admin: it.id })).code === 'bad_request', 'IT: an id of two characters is refused by the database');
  for (const d of DEPTS) {
    const made = await rpc(it, 'dame_space_create', { p_id: d.id, p_name: d.name, p_description: 'Tools of ' + d.name, p_admin: d.lead.id });
    check(made.ok, 'IT: makes the space ' + d.name + ' and names its admin');
  }
  await it.page.goto(SITE + 'admin/it.html');
  await it.page.waitForSelector('#body:not([hidden])');
  check((await it.page.locator('#spaces [data-space]').count()) === DEPTS.length, 'IT: sees all ' + DEPTS.length + ' spaces on the IT admin page');
  if (SHOTS) { await mkdir(SHOTS, { recursive: true }); await it.page.screenshot({ path: join(SHOTS, 'it-spaces.png'), fullPage: true }); }

  // ------------------------------------------------------------------ each department builds its two tools
  let notesSeen = 0;
  for (const d of DEPTS) {
    const setup = await probes(d.lead, [
      ['dame_tool_create', { p_space: d.id, p_id: d.tool, p_name: d.tool, p_description: 'Stand-alone', p_icon: d.name[0], p_colour: '#0b63ce', p_open_to_space: true, p_open_level: 'read' }],
      ['dame_tool_create', { p_space: d.id, p_id: d.data, p_name: d.data, p_description: 'Keeps rows', p_icon: d.name[0], p_colour: '#0a7d6c', p_open_to_space: false, p_open_level: 'read' }],
      ['dame_space_member_add', { p_space: d.id, p_user: d.user.id }],
      ['dame_tool_access_set', { p_space: d.id, p_tool: d.data, p_user: d.user.id, p_level: 'contribute' }]
    ]);
    check(setup.join() === 'ALLOWED,ALLOWED,ALLOWED,ALLOWED', d.name + ': its admin makes two tools, adds a person and gives him the data tool');

    const pageFile = await readFile(join(ROOT, d.page));
    const alone = await build(d.lead, d.id, d.tool, (p) => p.setInputFiles('#up-files', [{ name: d.id + ' tool FINAL v3.html', mimeType: 'text/html', buffer: pageFile }]));
    check(alone.stops.length === 0, d.name + ': the stand-alone tool passes the check and goes live' + (alone.stops.length ? ' -> ' + alone.stops.join(' | ') : ''));
    notesSeen += alone.notes.length;

    const manifest = { dame: 1, tables: { entries: { sharing: d.sharing, columns: d.columns } } };
    const code = tracker.split('{{TOOL}}').join(d.data).split('{{TABLES}}').join(JSON.stringify(manifest, null, 1));
    const kept = await build(d.lead, d.id, d.data, async (p) => { await p.fill('#code', code); await p.click('#code-check'); });
    check(kept.stops.length === 0, d.name + ': the data tool passes, its table "entries" (' + d.sharing + ') is made by one press, and it goes live' + (kept.stops.length ? ' -> ' + kept.stops.join(' | ') : ''));
    notesSeen += kept.notes.length;
  }
  check(notesSeen === 0, 'all 14 tools pass the check without a single note (' + notesSeen + ' notes)');
  figures.tools = DEPTS.length * 2;

  // ------------------------------------------------------------------ each department uses its tools
  for (const d of DEPTS) {
    await d.user.page.goto(SITE + 'space.html?space=' + d.id);
    await d.user.page.waitForSelector('#tools a');
    check((await d.user.page.locator('#tools a').count()) === 2, d.name + ': its user sees both tools as tiles');

    await d.user.page.goto(SITE + 'tool.html?space=' + d.id + '&tool=' + d.tool);
    let f = await sealed(d.user.page, '.dame-head h1');
    await f.waitForFunction((n) => (document.getElementById('hello') || document.body).textContent.includes(n) || !document.getElementById('hello'), d.user.name, { timeout: 8000 }).catch(() => {});
    check((await d.user.page.textContent('.hub-trail')).replace(/\s+/g, '') === 'Hub/' + d.name.replace(/\s+/g, '') + '/' + d.tool, d.name + ': the stand-alone tool opens under the site\'s bar and trail');

    const row = { ...d.row, [d.mark]: d.id + ' row' };
    await d.user.page.goto(SITE + 'tool.html?space=' + d.id + '&tool=' + d.data);
    f = await sealed(d.user.page, '#list-title');
    if (d.sharing === 'reference') {
      check(/Only the tool's managers/.test(await kit(f, 'Dame.table("entries").add(' + JSON.stringify(row) + ')')) && !(await f.locator('#form-card').isVisible()), d.name + ': a reference table cannot be changed by a user, and the form is not shown');
      await d.lead.page.goto(SITE + 'tool.html?space=' + d.id + '&tool=' + d.data);
      const fl = await sealed(d.lead.page, '#list-title');
      check((await kit(fl, 'Dame.table("entries").add(' + JSON.stringify(row) + ')')).owner === d.lead.id, d.name + ': its admin adds the reference row');
      await d.user.page.reload();
      f = await sealed(d.user.page, '#body tr');
    } else {
      const added = await kit(f, 'Dame.table("entries").add(' + JSON.stringify(row) + ')');
      check(added.owner === d.user.id && added[d.mark] === d.id + ' row', d.name + ': its user adds a row (' + Object.keys(d.columns).length + ' columns, ' + d.sharing + ')');
      await d.user.page.reload();
      f = await sealed(d.user.page, '#body tr');
    }
    const seen = await kit(f, 'Dame.table("entries").list()');
    check(seen.length === 1 && seen[0][d.mark] === d.id + ' row' && (await f.textContent('#body')).includes(d.id + ' row'), d.name + ': the tool shows exactly its own row');
  }
  if (SHOTS) { await DEPTS[0].user.page.screenshot({ path: join(SHOTS, 'marketing-data-tool.png'), fullPage: true }); }

  // Control: the same tries by the right person go through, so a refusal below means something.
  const ctl = DEPTS[2];
  const control = await probes(ctl.user, [['dame_space_get', { p_space: ctl.id }], ['dame_tool_open', { p_space: ctl.id, p_tool: ctl.data, p_preview: false }],
    ['dame_rows_list', { p_space: ctl.id, p_tool: ctl.data, p_table: 'entries', p_options: {}, p_preview: false }], ['file', ctl.id + '/' + ctl.tool + '/1/index.html'], ['file', ctl.id + '/' + ctl.data + '/1/index.html']]);
  check(control.every((c) => c === 'ALLOWED'), 'control: the same five tries by the department\'s own user all go through (' + control.join(', ') + ')');

  // ------------------------------------------------------------------ one department against another: 7 x 6 pairs
  let memberProbes = 0;
  let memberHoles = [];
  let adminProbes = 0;
  let adminHoles = [];
  for (const a of DEPTS) {
    for (const b of DEPTS) {
      if (a === b) { continue; }
      const asUser = [
        ['dame_space_get', { p_space: b.id }],
        ['dame_tool_open', { p_space: b.id, p_tool: b.tool, p_preview: false }],
        ['dame_tool_open', { p_space: b.id, p_tool: b.data, p_preview: false }],
        ['dame_tool_open', { p_space: b.id, p_tool: b.data, p_preview: true }],
        ['dame_rows_list', { p_space: b.id, p_tool: b.data, p_table: 'entries', p_options: {}, p_preview: false }],
        ['dame_rows_add', { p_space: b.id, p_tool: b.data, p_table: 'entries', p_row: { [b.mark]: 'from ' + a.id }, p_preview: false }],
        ['dame_tool_people', { p_space: b.id, p_tool: b.data }],
        ['dame_space_admin_get', { p_space: b.id }],
        ['file', b.id + '/' + b.tool + '/1/index.html'],
        ['file', b.id + '/' + b.data + '/1/index.html']
      ];
      const u = await probes(a.user, asUser);
      memberProbes += u.length;
      u.forEach((code, i) => { if (code !== (asUser[i][0] === 'file' ? 'file' : 'not_allowed')) { memberHoles.push(a.id + ' user > ' + b.id + ' ' + asUser[i][0] + ': ' + code); } });

      const asAdmin = [
        ['dame_tool_create', { p_space: b.id, p_id: 'planted', p_name: 'x', p_description: '', p_icon: '', p_colour: '', p_open_to_space: true, p_open_level: 'approve' }],
        ['dame_tool_update', { p_space: b.id, p_tool: b.data, p_name: 'x', p_description: '', p_icon: '', p_colour: '', p_open_to_space: true, p_open_level: 'approve' }],
        ['dame_tool_delete', { p_space: b.id, p_tool: b.data, p_confirm: b.data }],
        ['dame_tool_access_set', { p_space: b.id, p_tool: b.data, p_user: a.lead.id, p_level: 'approve' }],
        ['dame_tool_manager_add', { p_space: b.id, p_tool: b.data, p_user: a.lead.id }],
        ['dame_space_member_add', { p_space: b.id, p_user: a.lead.id }],
        ['dame_space_admin_add', { p_space: b.id, p_user: a.lead.id }],
        ['dame_space_update', { p_space: b.id, p_name: 'Taken over', p_description: '' }],
        ['dame_table_create', { p_space: b.id, p_tool: b.data, p_name: 'planted', p_sharing: 'team', p_columns: [{ name: 'a1', type: 'text' }] }],
        ['dame_table_add_column', { p_space: b.id, p_tool: b.data, p_table: 'entries', p_column: { name: 'planted', type: 'text' } }],
        ['dame_table_drop', { p_space: b.id, p_tool: b.data, p_table: 'entries', p_confirm: 'entries' }],
        ['dame_tables_list', { p_space: b.id, p_tool: b.data }],
        ['dame_version_begin', { p_space: b.id, p_tool: b.data, p_note: '', p_files: [{ name: 'index.html', size: 10, sha256: 'ab'.repeat(32) }] }],
        ['dame_version_make_live', { p_space: b.id, p_tool: b.data, p_version: 1 }],
        ['dame_versions_list', { p_space: b.id, p_tool: b.data }],
        ['dame_audit_scope_list', { p_space: b.id, p_tool: null, p_limit: 10, p_before: null }],
        ['dame_rows_list', { p_space: b.id, p_tool: b.data, p_table: 'entries', p_options: {}, p_preview: false }],
        ['dame_rows_list', { p_space: b.id, p_tool: b.data, p_table: 'entries', p_options: {}, p_preview: true }]
      ];
      const ad = await probes(a.lead, asAdmin);
      adminProbes += ad.length;
      ad.forEach((code, i) => { if (code !== 'not_allowed') { adminHoles.push(a.id + ' admin > ' + b.id + ' ' + asAdmin[i][0] + ': ' + code); } });
    }
  }
  check(memberHoles.length === 0, 'a user of one department against the other six: ' + memberProbes + ' tries, all refused' + (memberHoles.length ? ' -> ' + memberHoles.slice(0, 5).join(' | ') : ''));
  check(adminHoles.length === 0, 'an admin of one department against the other six: ' + adminProbes + ' tries, all refused' + (adminHoles.length ? ' -> ' + adminHoles.slice(0, 5).join(' | ') : ''));
  figures.crossProbes = memberProbes + adminProbes;

  // Nothing was changed by all those tries.
  const after = await mock.sql("select (select count(*) from core.tools)::int as tools, (select count(*) from core.tool_tables)::int as tables, (select count(*) from core.space_admins)::int as admins, (select count(*) from core.tool_access)::int as access, (select count(*) from core.tool_versions where state = 'ready')::int as versions");
  check(JSON.stringify(after.rows[0]) === JSON.stringify({ tools: 14, tables: 7, admins: 7, access: 7, versions: 14 }), 'after all tries the site holds exactly what the departments made: 14 tools, 7 tables, 7 admins, 7 access entries, 14 versions');
  let mixed = 0;
  for (const d of DEPTS) {
    const rows = (await mock.sql(`select count(*)::int as n, count(*) filter (where ${d.mark} = '${d.id} row')::int as own from t_${d.id.replace(/-/g, '_')}__${d.data.replace(/-/g, '_')}.entries`)).rows[0];
    if (rows.n !== 1 || rows.own !== 1) { mixed += 1; }
  }
  check(mixed === 0, 'seven tables all named "entries": each holds only its own department\'s row');

  // ------------------------------------------------------------------ inside one role
  const fin = DEPTS.find((d) => d.id === 'finance');
  check((await rpc(fin.lead, 'dame_rows_list', { p_space: 'finance', p_tool: fin.data, p_table: 'entries', p_options: {}, p_preview: false })).value.length === 0, 'Finance (private rows): the department\'s own admin does not see a user\'s rows');
  const mk = DEPTS[0];
  const own = [
    ['dame_tool_create', { p_space: mk.id, p_id: 'user-made', p_name: 'x', p_description: '', p_icon: '', p_colour: '', p_open_to_space: true, p_open_level: 'read' }],
    ['dame_tool_access_set', { p_space: mk.id, p_tool: mk.data, p_user: mk.user.id, p_level: 'approve' }],
    ['dame_space_admin_add', { p_space: mk.id, p_user: mk.user.id }],
    ['dame_table_create', { p_space: mk.id, p_tool: mk.data, p_name: 'mine', p_sharing: 'team', p_columns: [{ name: 'a1', type: 'text' }] }],
    ['dame_table_drop', { p_space: mk.id, p_tool: mk.data, p_table: 'entries', p_confirm: 'entries' }],
    ['dame_version_begin', { p_space: mk.id, p_tool: mk.data, p_note: '', p_files: [{ name: 'index.html', size: 10, sha256: 'ab'.repeat(32) }] }],
    ['dame_tool_open', { p_space: mk.id, p_tool: mk.data, p_preview: true }],
    ['dame_people_find', { p_query: 'lead' }],
    ['dame_users_list', { p_status: null }], ['dame_audit_list', { p_limit: 5, p_before: null }], ['dame_spaces_all', {}],
    ['dame_setting_set', { p_key: 'signup_domains', p_value: '' }], ['dame_user_set_it', { p_user: mk.user.id, p_is_it: true }]
  ];
  const up = await probes(mk.user, own);
  check(up.every((c) => c === 'not_allowed'), 'a user trying to raise himself inside his own department: ' + up.length + ' tries, all refused (' + [...new Set(up)].join(', ') + ')');
  const leadUp = await probes(mk.lead, [['dame_users_list', { p_status: null }], ['dame_audit_list', { p_limit: 5, p_before: null }], ['dame_spaces_all', {}], ['dame_space_create', { p_id: 'my-own', p_name: 'x', p_description: '', p_admin: mk.lead.id }],
    ['dame_space_set_active', { p_space: mk.id, p_active: false }], ['dame_space_delete', { p_space: mk.id, p_confirm: mk.id }], ['dame_setting_set', { p_key: 'ai_mode', p_value: 'off' }], ['dame_user_set_it', { p_user: mk.lead.id, p_is_it: true }], ['dame_user_set_status', { p_user: mk.user.id, p_status: 'disabled' }], ['dame_settings_get', {}]]);
  check(leadUp.every((c) => c === 'not_allowed'), 'a department admin trying IT\'s work: ' + leadUp.length + ' tries, all refused');

  // ------------------------------------------------------------------ what IT itself can and cannot do
  const itData = await probes(it, [['dame_space_get', { p_space: 'finance' }], ['dame_rows_list', { p_space: 'finance', p_tool: fin.data, p_table: 'entries', p_options: {}, p_preview: false }],
    ['dame_tool_open', { p_space: 'finance', p_tool: fin.data, p_preview: false }], ['dame_tables_list', { p_space: 'finance', p_tool: fin.data }], ['file', 'finance/' + fin.data + '/1/index.html']]);
  check(itData.join() === 'not_allowed,not_allowed,not_allowed,not_allowed,file', 'IT admin is not inside a department by being IT admin: its tools, rows and files are refused');
  const all = (await rpc(it, 'dame_spaces_all')).value;
  const audit = (await rpc(it, 'dame_audit_list', { p_limit: 500, p_before: null })).value;
  const count = (action) => audit.filter((x) => x.action === action).length;
  check(all.length === 7 && count('space.created') === 7 && count('tool.created') === 14 && count('table.created') === 7 && count('version.made_live') === 14 && count('tool.access_set') === 7 && count('user.signed_in') >= 15,
    'IT reads the whole story in the audit: 7 spaces, 14 tools, 7 tables, 14 go-lives, 7 access grants, ' + count('user.signed_in') + ' sign-ins');
  figures.auditRows = audit.length;

  // ------------------------------------------------------------------ people come and go
  check((await rpc(it, 'dame_user_set_status', { p_user: mk.user.id, p_status: 'disabled' })).ok, 'IT switches a leaver off (Marketing user)');
  const gone = await probes(mk.user, [['dame_me', {}], ['dame_rows_list', { p_space: mk.id, p_tool: mk.data, p_table: 'entries', p_options: {}, p_preview: false }], ['file', mk.id + '/' + mk.tool + '/1/index.html']]);
  check(gone.join() === 'session_ended,signed_out,signed_out' || gone.every((c) => ['session_ended', 'signed_out', 'disabled', 'file'].includes(c)), 'the leaver is out at his next click: rows and files refused (' + gone.join(', ') + ')');
  const kept = (await rpc(mk.lead, 'dame_rows_list', { p_space: mk.id, p_tool: mk.data, p_table: 'entries', p_options: {}, p_preview: false })).value;
  check(kept.length === 1 && kept[0].owner === mk.user.id, 'the leaver\'s rows stay, still marked as his');
  await signIn(mk.user.page, mk.user.email);
  await mk.user.page.waitForSelector('#panel-wait:not([hidden])');
  check(/switched off/.test(await mk.user.page.textContent('#wait-title')), 'signing in again, the leaver is told the account is switched off');

  const outsider = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const op = await outsider.newPage();
  await op.goto(SITE);
  await op.click('#to-request');
  await op.fill('#rq-name', 'Out Sider');
  await op.fill('#rq-email', 'someone@private-mail.test');
  await op.fill('#rq-password', PW);
  await op.fill('#rq-password2', PW);
  await op.click('#form-request button[type=submit]');
  await op.waitForSelector('#notice:not([hidden])');
  mock.confirm('someone@private-mail.test');
  await op.fill('#si-email', 'someone@private-mail.test');
  await op.fill('#si-password', PW);
  await op.click('#form-signin button[type=submit]');
  await op.waitForSelector('#si-msg:not([hidden])');
  check(/work email addresses only \(test\.dame\)/.test(await op.textContent('#si-msg')) && (await op.evaluate(() => localStorage.getItem('dame.session'))) === null, 'a stranger with a private email address gets no access request and is signed out again');
  check((await mock.sql("select count(*)::int as n from core.profiles where email like '%private-mail%'")).rows[0].n === 0, 'and leaves no row behind for IT to clean up');

  const joiner = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const jp = await joiner.newPage();
  await jp.goto(SITE);
  await jp.click('#to-request');
  await jp.fill('#rq-name', 'New Joiner');
  await jp.fill('#rq-email', 'new.joiner@test.dame');
  await jp.fill('#rq-password', PW);
  await jp.fill('#rq-password2', PW);
  await jp.click('#form-request button[type=submit]');
  await jp.waitForSelector('#notice:not([hidden])');
  mock.confirm('new.joiner@test.dame');
  await jp.fill('#si-email', 'new.joiner@test.dame');
  await jp.fill('#si-password', PW);
  await jp.click('#form-signin button[type=submit]');
  await jp.waitForSelector('#panel-wait:not([hidden])');
  const waiting = await jp.evaluate(async (calls) => {
    const out = [];
    for (const [n, a] of calls) { out.push(await window.DameApi.rpc(n, a).then(() => 'ALLOWED', (e) => e.code)); }
    return out;
  }, [['dame_me', {}], ['dame_spaces_list', {}], ['dame_space_get', { p_space: 'marketing' }], ['dame_rows_list', { p_space: 'marketing', p_tool: mk.data, p_table: 'entries', p_options: {}, p_preview: false }], ['dame_people_find', { p_query: 'lead' }], ['dame_users_list', { p_status: null }]]);
  check(waiting.every((c) => c === 'pending'), 'a new joiner with a work address waits for IT: until approved, everything is refused (' + waiting.length + ' tries)');

  // ------------------------------------------------------------------ switching off and deleting
  const fa = DEPTS.find((d) => d.id === 'factory');
  check((await rpc(it, 'dame_space_set_active', { p_space: 'factory', p_active: false })).ok, 'IT switches the Factory space off');
  const off = await probes(fa.user, [['dame_space_get', { p_space: 'factory' }], ['dame_tool_open', { p_space: 'factory', p_tool: fa.tool, p_preview: false }], ['dame_rows_list', { p_space: 'factory', p_tool: fa.data, p_table: 'entries', p_options: {}, p_preview: false }], ['file', 'factory/' + fa.tool + '/1/index.html']]);
  check(off.join() === 'not_allowed,not_allowed,not_allowed,file', 'its users are out at once: tools, rows and files refused');
  check((await rpc(fa.lead, 'dame_rows_list', { p_space: 'factory', p_tool: fa.data, p_table: 'entries', p_options: {}, p_preview: false })).ok, 'its admin still gets in, to put things right');
  await rpc(it, 'dame_space_set_active', { p_space: 'factory', p_active: true });
  check((await rpc(fa.user, 'dame_rows_list', { p_space: 'factory', p_tool: fa.data, p_table: 'entries', p_options: {}, p_preview: false })).ok, 'switched on again, its users are back');

  const dx = DEPTS.find((d) => d.id === 'dx-team');
  check((await rpc(dx.lead, 'dame_tool_delete', { p_space: dx.id, p_tool: dx.data, p_confirm: 'wrong' })).code === 'bad_request', 'deleting a tool with its rows needs its id typed');
  check((await rpc(dx.lead, 'dame_tool_delete', { p_space: dx.id, p_tool: dx.data, p_confirm: dx.data })).ok, 'DX deletes its data tool');
  const left = (await mock.sql("select (select count(*) from pg_namespace where nspname like 't\\_%' or nspname like 'p\\_%')::int as schemas, (to_regnamespace('t_dx_team__automation_ideas') is null) as gone, (select count(*) from t_applied__selection_log.entries)::int as applied")).rows[0];
  check(left.gone && left.schemas === 12 && left.applied === 1, 'its table and rows are gone; the other six departments\' tables are untouched');
  check((await rpc(dx.lead, 'dame_tool_create', { p_space: dx.id, p_id: dx.data, p_name: 'again', p_description: '', p_icon: '', p_colour: '', p_open_to_space: false, p_open_level: 'read' })).code === 'bad_request', 'the deleted tool\'s id can never be used again');

  // ------------------------------------------------------------------ the end state
  check((await mock.sql('select count(*)::int as n from core.security_check()')).rows[0].n === 0, 'the database\'s own security check finds nothing after the whole rehearsal');
  const paths = [...new Set(mock.calls.map((c) => c.path.replace(/\/storage\/v1\/object\/.*/, '/storage/v1/object/...')))];
  check(paths.every((p) => /^\/(auth\/v1\/(signup|token|logout)|rest\/v1\/rpc\/dame_[a-z_]+|storage\/v1\/object\/\.\.\.)$/.test(p)), 'in the whole rehearsal the pages called only sign-in, dame_* functions and the file store (' + mock.calls.length + ' calls)');
  figures.calls = mock.calls.length;
  check(problems.length === 0, 'no page error, blocked load or dialog in any of the ' + figures.people + ' sessions' + (problems.length ? ' -> ' + problems.slice(0, 4).join(' | ') : ''));
} catch (err) {
  check(false, 'the rehearsal stopped: ' + String(err).split('\n').slice(0, 3).join(' ') + (problems.length ? ' | ' + problems.slice(0, 3).join(' | ') : ''));
} finally {
  await browser.close();
  site.close();
  mock.server.close();
}

console.log('\nFigures: ' + JSON.stringify(figures));
console.log(failed ? failed + ' check(s) FAILED, ' + passed + ' passed' : 'All ' + passed + ' checks passed');
process.exit(failed ? 1 : 0);
