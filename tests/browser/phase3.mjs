/*
 * tests/browser/phase3.mjs - the phase 3 test in a real browser, at desktop
 * width and at 390 px: upload, checks, preview, make live, roll back, and
 * THE HOSTILE-TOOL TEST: a tool written to break out cannot read a token,
 * reach the network, the shell or another tool, or move the page.
 * Serves: phase 3 test and SECURITY "Browser". Must not change: a later
 * phase may add attempts to the hostile tool, never remove one. The pages are
 * used exactly as they are in the repo; only the database address is pointed
 * at the stand-in.
 *
 * Needs once:  npm install --no-save @electric-sql/pglite playwright-core
 * Run:         node tests/browser/phase3.mjs        (exit code 0 = all passed)
 */
import { readFile, mkdir } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { start } from '../../tools/serve.mjs';
import { startMock, KEY } from './mock-supabase.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SHOTS = process.env.SHOTS || '';
const SITE_PORT = 8161;
const MOCK_PORT = 8162;
const SITE = 'http://127.0.0.1:' + SITE_PORT + '/toolsDame/';
const MOCK = 'http://127.0.0.1:' + MOCK_PORT;
const CONFIG = await readFile(join(ROOT, 'kit/v1/config.js'), 'utf8');
const REAL = (CONFIG.match(/supabaseUrl:\s*'([^']*)'/) || [])[1];
const REAL_KEY = (CONFIG.match(/publishableKey:\s*'([^']*)'/) || [])[1];
const PW = 'correct horse battery 42';
const ExcelJS = createRequire(import.meta.url)(join(ROOT, 'kit/v1/lib/exceljs.js'));   // the shelf file itself

let failed = 0;
function check(ok, what) {
  if (!ok) { failed += 1; }
  console.log((ok ? 'ok    ' : 'FAIL  ') + what);
}

// ------------------------------------------------------------------ fixtures

async function example() {
  const out = [];
  for (const name of ['index.html', 'about.html', 'style.css', 'app.js']) {
    out.push({ name, mimeType: 'text/plain', buffer: await readFile(join(ROOT, 'examples/hello-tool', name)) });
  }
  return out;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) { c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  }
  return ~c >>> 0;
}

// A plain zip, as a computer's "compress" makes it, with everything in one folder.
function zip(files, folder) {
  const parts = [];
  const central = [];
  let at = 0;
  for (const f of files) {
    const name = Buffer.from(folder + '/' + f.name);
    const data = deflateRawSync(f.buffer);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc32(f.buffer), 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(f.buffer.length, 22);
    head.writeUInt16LE(name.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(crc32(f.buffer), 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(f.buffer.length, 24);
    cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(at, 42);
    parts.push(head, name, data);
    central.push(cen, name);
    at += 30 + name.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(at, 16);
  return Buffer.concat([...parts, dir, end]);
}

// ------------------------------------------------------------------ the run

async function run(width, height, label) {
  const asked = [];                                   // every address either server was asked for
  const mock = await startMock(MOCK_PORT);
  const site = await start(SITE_PORT, (rel, text) => text.split(REAL).join(MOCK).split(REAL_KEY).join(KEY), (u) => asked.push('site ' + u));
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const problems = [];
  const popups = [];
  const downloads = [];                               // every file any page saved
  const T = label + ': ';
  let quiet = false;                                  // true while the hostile tool is expected to make noise

  async function person(email, name) {
    const id = await mock.addUser(email, name, PW, false);
    const ctx = await browser.newContext({ viewport: { width, height } });
    ctx.on('page', (p) => { if (ctx.pages().length > 1) { popups.push(p.url()); } });
    const page = await ctx.newPage();
    page.on('download', (d) => downloads.push(d.suggestedFilename()));
    page.on('console', (m) => {
      if (!quiet && m.type() === 'error' && !/Failed to load resource.*(40[013])/.test(m.text())) { problems.push(m.text()); }
    });
    page.on('pageerror', (e) => { if (!quiet) { problems.push(String(e)); } });
    page.on('dialog', (d) => { problems.push('dialog opened: ' + d.message()); d.dismiss(); });
    await page.goto(SITE);
    await page.waitForSelector('#panel-signin:not([hidden])');
    await page.fill('#si-email', email);
    await page.fill('#si-password', PW);
    await page.click('#form-signin button[type=submit]');
    await page.waitForURL(SITE + 'hub.html');
    await page.waitForSelector('#main:not([hidden])');
    return { page, id };
  }
  const fits = async (page) => (await page.evaluate(() => document.documentElement.scrollWidth)) <= width;
  const shot = async (page, name) => {
    if (SHOTS) { await mkdir(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, label + '-' + name + '.png'), fullPage: true }); }
  };
  const said = async (page, text) => {
    try { await page.waitForSelector('#msg.hub-ok:has-text("' + text + '")', { timeout: 10000 }); }
    catch (e) { throw new Error('expected "' + text + '", the page says: ' + (await page.textContent('#msg')) + ' / ' + (await page.textContent('#up-report').catch(() => ''))); }
  };
  const refused = async (page, path) => {
    await page.goto(SITE + path);
    await page.waitForSelector('#msg:not([hidden])');
    return (await page.textContent('#msg')) + ((await page.locator('#frame').isVisible().catch(() => false)) ? ' [TOOL SHOWN]' : '');
  };
  // The sealed frame of the tool, once it holds what we wait for.
  async function sealed(page, selector) {
    for (let i = 0; i < 100; i += 1) {
      for (const f of page.frames()) {
        if (f.url() === 'about:srcdoc' && await f.locator(selector).count().catch(() => 0)) { return f; }
      }
      await page.waitForTimeout(100);
    }
    throw new Error('the tool did not show ' + selector);
  }
  const openTool = async (page, tool, extra = '') => { await page.goto(SITE + 'tool.html?space=lab&tool=' + tool + extra); };
  // The builder is a guide with one step on screen: these do what a person does to get to a step.
  const way = async (page, which) => { if (await page.locator('#wz-restart').isVisible()) { await page.click('#wz-restart'); } await page.click('#go-' + which); };
  const toUpload = async (page) => { if (await page.locator('.hub-focus').count()) { await page.click('#tables-later'); } if (await page.locator('#wz-next').isVisible()) { await page.click('#wz-next'); } };
  async function upload(page, files, note) {
    if (await page.locator('#wz-start').isVisible()) { await page.click('#go-own'); }
    await page.setInputFiles('#up-files', files);
    await page.waitForSelector('#up-report li.hub-ok, #up-report li.hub-warn');
    if (note) { await toUpload(page); await page.fill('#up-note', note); }
  }
  const twice = async (page, box, labelText) => {
    await page.click(box + ' button:text-is("' + labelText + '")');
    await page.click(box + ' button:text-is("Press again to confirm")');
  };

  try {
    const ben = await person('ben@test.dame', 'Ben Admin');
    const di = await person('di@test.dame', 'Di Manager');
    const cy = await person('cy@test.dame', 'Cy Reader');
    const zed = await person('zed@test.dame', 'Zed Outside');
    await mock.sql(`insert into core.spaces (id, name, created_by) values ('lab', 'Lab', '${ben.id}')`);
    await mock.sql(`insert into core.space_admins (space, user_id, added_by) values ('lab', '${ben.id}', '${ben.id}')`);
    await mock.sql(`insert into core.tools (space, id, name, icon, created_by) values ('lab', 'hello', 'Hello', 'H', '${ben.id}'), ('lab', 'hostile', 'Hostile', '', '${ben.id}'), ('lab', 'secret', 'Secret Tool', '', '${ben.id}'), ('lab', 'parts', 'Parts', '', '${ben.id}')`);
    await mock.sql(`insert into core.tool_managers (space, tool, user_id, added_by) values ('lab', 'hello', '${di.id}', '${ben.id}'), ('lab', 'hostile', '${di.id}', '${ben.id}'), ('lab', 'parts', '${di.id}', '${ben.id}')`);
    await mock.sql(`insert into core.tool_access (space, tool, user_id, level, added_by) values ('lab', 'hello', '${cy.id}', 'read', '${ben.id}'), ('lab', 'hostile', '${cy.id}', 'read', '${ben.id}'), ('lab', 'parts', '${cy.id}', 'read', '${ben.id}')`);

    // --- nothing uploaded yet
    await di.page.goto(SITE + 'admin/tool.html?space=lab&tool=hello');
    await di.page.waitForSelector('#body:not([hidden])');
    check(/Not built yet/.test(await di.page.textContent('#ver-state')) && await di.page.locator('#versions-empty').isVisible(), T + 'a new tool has no version and says so');
    await cy.page.goto(SITE + 'tool.html?space=lab&tool=hello');
    await cy.page.waitForSelector('#notbuilt:not([hidden])');
    check(/being prepared/.test(await cy.page.textContent('#notbuilt')) && !(await cy.page.locator('#notbuilt-go').isVisible()), T + 'a reader is told the tool is being prepared, with nothing to press');
    await di.page.goto(SITE + 'tool.html?space=lab&tool=hello');
    await di.page.waitForSelector('#notbuilt:not([hidden])');
    check(/Hello is not built yet/.test(await di.page.textContent('#notbuilt')) && await di.page.locator('#notbuilt-go').isVisible(), T + 'its manager is told it is not built yet and gets a Build button');
    await di.page.click('#notbuilt-go');
    await di.page.waitForSelector('#body:not([hidden])');
    check(di.page.url().endsWith('admin/tool.html?space=lab&tool=hello'), T + 'the Build button opens the guided builder');

    // --- the checks before upload
    await di.page.goto(SITE + 'admin/tool.html?space=lab&tool=hello');
    await di.page.waitForSelector('#body:not([hidden])');
    const bad = '<!doctype html><html><head><title>x</title><script src="https://cdn.example.com/lib.js?LEAK-upload"></script>' +
      '<link rel="stylesheet" href="missing.css"></head><body><img src="//img.example.com/a.png"><iframe src="x.html"></iframe><a href="nowhere.html">x</a></body></html>';
    await upload(di.page, [{ name: 'index.html', mimeType: 'text/html', buffer: Buffer.from(bad) }]);
    const report = await di.page.textContent('#up-report');
    check(/from outside the site/.test(report) && /missing\.css, which is not among/.test(report) && /<iframe>/.test(report) && /nowhere\.html, which is not a page/.test(report), T + 'a bad upload is explained line by line');
    check(await di.page.locator('#up-send').isDisabled(), T + 'a version with a problem cannot be uploaded');
    await upload(di.page, [{ name: 'My Tool v2.HTML', mimeType: 'text/html', buffer: Buffer.from('<main class="dame-page"><p>x</p></main>') }]);
    check(/The check passed: index\.html/.test(await di.page.textContent('#up-report')), T + 'one page is accepted whatever its file is called');
    await upload(di.page, [{ name: 'home.html', mimeType: 'text/html', buffer: Buffer.from('<p>x</p>') }, { name: 'other.html', mimeType: 'text/html', buffer: Buffer.from('<p>y</p>') }]);
    check(/no page named index\.html/.test(await di.page.textContent('#up-report')), T + 'several pages with no index.html among them are refused');
    await upload(di.page, [{ name: 'index.html', mimeType: 'text/html', buffer: Buffer.from('<main class="dame-page"><script>localStorage.setItem("a", 1)</scr' + 'ipt></main>') }]);
    check(/stops the script at once/.test(await di.page.textContent('#up-report')) && await di.page.locator('#up-send').isDisabled(), T + 'a page that would break at once (browser storage) is stopped at the check');
    await upload(di.page, [{ name: 'tool.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip at all') }]);
    check(/zip cannot be read/.test(await di.page.textContent('#up-report')), T + 'a broken zip is refused in plain words');
    check(!asked.some((u) => /LEAK/.test(u)) && !mock.calls.some((c) => /LEAK/.test(c.path)), T + 'checking files loads nothing they point to');

    // --- upload version 1 from loose files
    await upload(di.page, await example(), 'first');
    check(/The check passed: (about\.html, index\.html|index\.html, about\.html)/.test(await di.page.textContent('#up-report')), T + 'the example tool passes the checks');
    await shot(di.page, '1-upload-ready');
    await toUpload(di.page); await di.page.click('#up-send');
    await said(di.page, 'Version 1 is uploaded and is the preview');
    check((await di.page.locator('#versions tr').count()) === 1 && /Preview/.test(await di.page.textContent('#versions')), T + 'version 1 is listed as the preview');
    check(mock.storedNames().sort().join(',') === 'lab/hello/1/about.html,lab/hello/1/index.html', T + 'each page is stored as one file under space/tool/version');
    check(await fits(di.page), T + 'tool admin page fits the screen');

    // --- preview: managers only
    await openTool(di.page, 'hello', '&preview=1');
    let f = await sealed(di.page, '#who:has-text("Hello, Di Manager")');
    check(/level on this tool: approve/.test(await f.textContent('#who')), T + 'the tool learns the user\'s name and level from the kit');
    check(await di.page.locator('#preview-pill').isVisible(), T + 'the preview is marked as a preview');
    check((await f.evaluate(() => getComputedStyle(document.querySelector('.dame-btn-primary')).backgroundImage)).includes('rgb(10, 125, 108)'), T + 'the kit theme and the tool\'s own style sheet are both in place');
    await f.fill('#kw', '35.17');
    check((await f.inputValue('#tr')) === '10', T + 'the tool\'s own script runs (35.17 kW = 10 TR)');
    await f.click('#toast');
    check(await f.locator('.dame-toast:has-text("A message from the tool.")').isVisible(), T + 'Dame.toast shows a message');
    await f.click('#save');
    await f.waitForSelector('#saved:has-text("This tool has no table named notes")');
    check(/Tables are made on the tool's admin page, under Data/.test(await f.textContent('#saved')), T + 'saving into a table that was never made is refused with what to do');
    await f.click('a:has-text("An outside link")');
    await di.page.waitForSelector('#ask:not([hidden])');
    check(/example\.org/.test(await di.page.textContent('#ask-url')) && popups.length === 0, T + 'an outside link asks first and opens nothing by itself');
    await di.page.click('#ask-no');
    await shot(di.page, '2-preview');
    await f.click('a:has-text("Second page")');
    f = await sealed(di.page, 'h1:has-text("Second page")');
    await f.click('a:has-text("Back to the first page")');
    f = await sealed(di.page, '#who:has-text("Hello, Di Manager")');
    check(true, T + 'the tool moves between its own pages');
    check(await fits(di.page), T + 'the tool page fits the screen');
    check(/do not look after this tool/.test(await refused(cy.page, 'tool.html?space=lab&tool=hello&preview=1')), T + 'a reader cannot open the preview');
    await cy.page.goto(SITE + 'tool.html?space=lab&tool=hello');
    await cy.page.waitForSelector('#notbuilt:not([hidden])');
    check(true, T + 'a preview is not live');
    const peek = await cy.page.evaluate(() => window.DameApi.fileBytes('lab/hello/1/index.html').then(() => 'READ', (e) => e.code));
    check(peek === 'file', T + 'a reader cannot fetch the preview files directly (' + peek + ')');

    // --- make live
    await di.page.goto(SITE + 'admin/tool.html?space=lab&tool=hello');
    await di.page.waitForSelector('#body:not([hidden])');
    await di.page.click('#versions button:text-is("Make live")');
    check(/Not built yet/.test(await di.page.textContent('#ver-state')), T + 'one press on Make live changes nothing');
    await di.page.click('#versions button:text-is("Press again to confirm")');
    await said(di.page, 'Version 1 is live');
    await openTool(cy.page, 'hello');
    f = await sealed(cy.page, '#who:has-text("Hello, Cy Reader")');
    check(/level on this tool: read/.test(await f.textContent('#who')), T + 'a reader opens the live tool with his own level');
    check(!(await cy.page.locator('#admin').isVisible()) && !(await cy.page.locator('#preview-pill').isVisible()), T + 'a reader sees no admin link and no preview mark');
    check((await cy.page.textContent('.hub-trail')).replace(/\s+/g, ' ').trim() === 'Hub/Lab/Hello', T + 'the bar shows where he is: Hub / Lab / Hello');
    await shot(cy.page, '3-live');
    check(/does not allow this/.test(await refused(zed.page, 'tool.html?space=lab&tool=hello')), T + 'a person without the tool cannot open it');
    const out1 = await zed.page.evaluate(() => window.DameApi.fileBytes('lab/hello/1/index.html').then(() => 'READ', (e) => e.code));
    const out2 = await zed.page.evaluate(() => window.DameApi.fileSend('lab/hello/1/evil.html', new Blob(['x'], { type: 'text/html' })).then(() => 'WRITTEN', (e) => e.code));
    const out3 = await cy.page.evaluate(() => window.DameApi.fileSend('lab/hello/1/index.html', new Blob(['x'], { type: 'text/html' })).then(() => 'WRITTEN', (e) => e.code));
    const out4 = await di.page.evaluate(() => window.DameApi.fileSend('lab/hello/1/index.html', new Blob(['x'], { type: 'text/html' })).then(() => 'WRITTEN', (e) => e.code));
    check([out1, out2, out3, out4].join(',') === 'file,upload,upload,upload', T + 'the file store refuses outsiders, readers writing, and any change to a ready version (' + [out1, out2, out3, out4].join(',') + ')');

    // --- version 2 from a zip, then roll back
    const v2 = (await example()).map((x) => x.name === 'index.html' ? { ...x, buffer: Buffer.from(x.buffer.toString().replace('<h1>Hello tool</h1>', '<h1>Hello tool, version two</h1>')) } : x);
    await upload(di.page, [{ name: 'hello.zip', mimeType: 'application/zip', buffer: zip(v2, 'hello-tool') }], 'second');
    check(/The check passed/.test(await di.page.textContent('#up-report')), T + 'a zip with the files in a folder is read');
    await toUpload(di.page); await di.page.click('#up-send');
    await said(di.page, 'Version 2 is uploaded and is the preview');
    await openTool(cy.page, 'hello');
    f = await sealed(cy.page, 'h1');
    check((await f.textContent('h1')) === 'Hello tool', T + 'readers keep version 1 while version 2 is only a preview');
    await twice(di.page, '#versions tr:has-text("second")', 'Make live');
    await said(di.page, 'Version 2 is live');
    await openTool(cy.page, 'hello');
    f = await sealed(cy.page, 'h1:has-text("version two")');
    check(true, T + 'after Make live readers get version 2');
    await twice(di.page, '#versions tr:has-text("first")', 'Roll back to this');
    await said(di.page, 'Rolled back: version 1 is live again');
    await openTool(cy.page, 'hello');
    f = await sealed(cy.page, 'h1');
    check((await f.textContent('h1')) === 'Hello tool', T + 'roll back brings version 1 back for everyone');
    check(/rolled back/.test(await di.page.textContent('#audit tr >> nth=0')) && /version 2 > 1/.test(await di.page.textContent('#audit tr >> nth=0')), T + 'the roll back is at the top of the tool\'s audit');
    await shot(di.page, '4-versions');

    // --- a stored file changed behind the platform's back is not run
    mock.tamper('lab/hello/1/index.html', '<!doctype html><html><body><h1 id="evil">changed</h1></body></html>');
    check(/is not the one that was uploaded/.test(await refused(cy.page, 'tool.html?space=lab&tool=hello')), T + 'a stored page that was changed is refused, not run');

    // --- THE HOSTILE TOOL
    const hostile = (await readFile(join(HERE, 'fixtures/hostile/index.html'), 'utf8')).split('__SITE__').join(SITE).split('__MOCK__').join(MOCK);
    await di.page.goto(SITE + 'admin/tool.html?space=lab&tool=hostile');
    await di.page.waitForSelector('#body:not([hidden])');
    await upload(di.page, [{ name: 'index.html', mimeType: 'text/html', buffer: Buffer.from(hostile) }]);
    const hostileReport = await di.page.textContent('#up-report');
    check(/starts a background worker/.test(hostileReport) && /tries to call a server/.test(hostileReport) && await di.page.locator('#up-send').isDisabled(), T + 'hostile tool: the checks refuse it and say why');
    // A manager who goes around the checks: the same three calls the page makes, with the file as it is.
    const around = await di.page.evaluate(async (html) => {
      const bytes = new TextEncoder().encode(html);
      const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((b) => ('0' + b.toString(16)).slice(-2)).join('');
      const v = await window.DameApi.rpc('dame_version_begin', { p_space: 'lab', p_tool: 'hostile', p_note: 'around the checks', p_files: [{ name: 'index.html', size: bytes.length, sha256: sha }] });
      await window.DameApi.fileSend('lab/hostile/' + v + '/index.html', new Blob([bytes], { type: 'text/html' }));
      await window.DameApi.rpc('dame_version_seal', { p_space: 'lab', p_tool: 'hostile', p_version: v });
      await window.DameApi.rpc('dame_version_make_live', { p_space: 'lab', p_tool: 'hostile', p_version: v });
      return v;
    }, hostile);
    check(around === 1, T + 'hostile tool: a manager can still upload it around the checks (the frame is the wall, not the checks)');

    asked.length = 0;
    mock.calls.length = 0;
    quiet = true;
    await openTool(cy.page, 'hostile');
    f = await sealed(cy.page, '#out[data-done]');
    const result = JSON.parse(await f.textContent('#out'));
    const info = result.nestedRealmInfo;
    delete result.nestedRealmInfo;
    const leaked = Object.keys(result).filter((k) => !/^blocked/.test(String(result[k])));
    check(Object.keys(result).length >= 33, T + 'hostile tool: ' + Object.keys(result).length + ' attempts were made');
    check(leaked.length === 0, T + 'hostile tool: every attempt is blocked' + (leaked.length ? ' -> ' + leaked.map((k) => k + ': ' + result[k]).join(' | ') : ''));
    for (const k of ['origin', 'localStorage', 'topStorage', 'topDocument', 'fetchApi', 'websocket', 'worker', 'portAbuse', 'portFiles', 'flood']) {
      console.log('        ' + k + ': ' + result[k]);
    }
    console.log('        (not asserted) ' + info);
    await cy.page.waitForTimeout(2500);                 // the page-replacing moves happen now
    const leaks = asked.filter((u) => /LEAK/.test(u)).concat(mock.calls.filter((c) => /LEAK/.test(c.path)).map((c) => 'api ' + c.path));
    check(leaks.length === 0, T + 'hostile tool: no request of the tool reached any server' + (leaks.length ? ' -> ' + leaks.join(' | ') : ''));
    check(cy.page.url() === SITE + 'tool.html?space=lab&tool=hostile', T + 'hostile tool: the page was not moved');
    check(popups.length === 0, T + 'hostile tool: no window was opened');
    check(!downloads.some((d) => /LEAK/.test(d)), T + 'hostile tool: no file reached the person\'s computer' + (downloads.some((d) => /LEAK/.test(d)) ? ' -> ' + downloads.join(', ') : ''));
    const rowCalls = mock.calls.filter((c) => /dame_rows_list/.test(c.path)).length;
    check(rowCalls <= 320, T + 'hostile tool: of 600 fast requests only ' + rowCalls + ' reached the database');
    check(await cy.page.locator('.hub-bar .hub-brand').isVisible() && (await cy.page.evaluate(() => typeof window.DameApi.rpc)) === 'function', T + 'hostile tool: the shell is untouched');
    check((await cy.page.evaluate(() => window.DameApi.rpc('dame_me').then((m) => m.name))) === 'Cy Reader', T + 'hostile tool: the user\'s session is still his own');
    const toolCalls = mock.calls.filter((c) => /rpc/.test(c.path));
    const names = [...new Set(toolCalls.map((c) => c.path.split('/').pop()))];
    check(names.every((n) => ['dame_me', 'dame_tool_open', 'dame_rows_list'].includes(n)) && toolCalls.filter((c) => /dame_rows/.test(c.path)).every((c) => c.body.p_space === 'lab' && c.body.p_tool === 'hostile' && c.body.p_preview === false),
      T + 'hostile tool: the only calls made for it name its own tool, whatever it asked for (' + names.join(', ') + ')');
    await shot(cy.page, '5-hostile');
    quiet = false;

    // --- the guided builder: starter kit, starter page, pasted code, fix request
    await ben.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await ben.page.goto(SITE + 'admin/tool.html?space=lab&tool=secret');
    await ben.page.waitForSelector('#body:not([hidden])');
    check(await ben.page.locator('#go-ai').isVisible() && !(await ben.page.locator('#wz').isVisible()), T + 'the builder starts with three choices and nothing else');
    await ben.page.click('#go-ai');
    check(await ben.page.locator('#brief').isVisible() && !(await ben.page.locator('#step-data').isVisible()) && !(await ben.page.locator('#kit-copy').isVisible()) && /Step 1 of 6/.test(await ben.page.textContent('#wz-where')), T + 'only step 1 is on screen');
    await ben.page.click('#wz-next');
    check(/First say what the tool should do/.test(await ben.page.textContent('#msg')) && await ben.page.locator('#brief').isVisible(), T + 'step 2 does not show until step 1 is done');
    await ben.page.fill('#brief', 'Turn a list of TEST-WIDGET codes into a table.');
    await ben.page.click('#wz-next');
    check(/save data in the database/.test(await ben.page.textContent('#step-data h3')) && !(await ben.page.locator('#brief').isVisible()), T + 'step 2 asks one thing: does it save data in the database');
    await ben.page.click('#wz-next');
    check(/Choose one of the two answers/.test(await ben.page.textContent('#msg')), T + 'the database question must be answered to go on');
    await ben.page.check('#need-data');
    check(/will go into this site's database/.test(await ben.page.textContent('#data-note')) && await ben.page.locator('#data-note').isVisible(), T + 'choosing Yes says plainly that the data goes into the database');
    await ben.page.check('#save-no');
    await ben.page.check('#needs input[value="exceljs"]');
    await ben.page.click('#wz-next');
    check(!(await ben.page.locator('#wz-next').isVisible()), T + 'the kit step has no Next until the kit is copied');
    await ben.page.click('#kit-copy');
    check(await ben.page.locator('#wz-next').isVisible(), T + 'after copying, Next appears');
    const kitText = await ben.page.evaluate(() => navigator.clipboard.readText());
    check(/Name: Secret Tool/.test(kitText) && /TEST-WIDGET codes/.test(kitText) && kitText.includes('<script src="/_dame/v1/lib/exceljs.js"></script>') && /Library: ExcelJS 4\.4\.0/.test(kitText) && /<title>Secret Tool<\/title>/.test(kitText) && /class="dame-drop"/.test(kitText), T + 'the starter kit holds the tool\'s name, the description, the chosen library, the blocks and the starting page');
    check(!kitText.includes(MOCK) && !kitText.includes(KEY) && !/test\.dame|supabase|at_[0-9a-f]{8}/.test(kitText) && !/\{\{[A-Z]+\}\}/.test(kitText), T + 'the starter kit holds no address, key, token or person, and no unfilled gap');
    await ben.page.reload();
    await ben.page.waitForSelector('#body:not([hidden])');
    check((await ben.page.inputValue('#brief')) === 'Turn a list of TEST-WIDGET codes into a table.' && await ben.page.isChecked('#needs input[value="exceljs"]') && await ben.page.isChecked('#save-no'), T + 'the description and answers survive a reload');
    await ben.page.click('#go-ai');
    await ben.page.click('#wz-next');
    await ben.page.click('#wz-next');
    await ben.page.click('#kit-skip');
    await ben.page.click('#code-check');
    check(/Nothing is pasted yet/.test(await ben.page.textContent('#msg')), T + 'checking with nothing pasted says what to do');
    const answer = 'Here is your tool!\n\n```html\n<!doctype html><html><head><title>x</title><style>body { font-family: Comic Sans MS; color: #ff0000; }</style></head>' +
      '<body><header><h1>My tool</h1></header><main class="dame-page"><input type="password"><p id="p">hi</p></main>' +
      '<script>new Worker("w.js"); alert("x");</scr' + 'ipt></body></html>\n```\n\nHelp text: it does things.';
    await ben.page.fill('#code', answer);
    await ben.page.click('#code-check');
    await ben.page.waitForSelector('#up-report li.hub-warn');
    const pasted = await ben.page.textContent('#up-report');
    check(/its own <header>/.test(pasted) && /asks for a password/.test(pasted) && /sets its own font/.test(pasted) && /background worker/.test(pasted) && /its own colours/.test(pasted) && /pop-up box/.test(pasted), T + 'a pasted answer that breaks the site rules is refused, each point in plain words');
    check(!/does not load the kit/.test(pasted) && !/Here is your tool/.test(pasted), T + 'the words around the code are ignored and the kit lines are added without asking');
    check(await ben.page.locator('#up-send').isDisabled() && await ben.page.locator('#fix-copy').isVisible(), T + 'nothing can be uploaded; a fix request is offered');
    await ben.page.click('#fix-copy');
    const fix = await ben.page.evaluate(() => navigator.clipboard.readText());
    check(/refused it/.test(fix) && /1\. index\.html has its own <header>/.test(fix) && /complete index\.html again/.test(fix), T + 'the fix request lists the points for the AI');
    await shot(ben.page, '6-builder-refused');
    await ben.page.click('#wz-back');
    await ben.page.click('#code-starter');
    await ben.page.waitForSelector('#up-report li.hub-ok');
    check(/The check passed: index\.html/.test(await ben.page.textContent('#up-report')) && !(await ben.page.locator('#fix-copy').isVisible()), T + 'the starter page passes the check as it is');
    await toUpload(ben.page); await ben.page.click('#up-send');
    await said(ben.page, 'Version 1 is uploaded and is the preview');
    await openTool(ben.page, 'secret', '&preview=1');
    f = await sealed(ben.page, '#hello:has-text("Hello, Ben Admin")');
    check((await f.textContent('h1')) === 'Secret Tool', T + 'the starter page runs with the tool\'s own name, minutes after the tile was made');
    check(await fits(ben.page), T + 'the builder page and the starter tool fit the screen');

    // --- a tool whose own code fails: its builder is told why, a user is not left guessing
    await ben.page.goto(SITE + 'admin/tool.html?space=lab&tool=secret');
    await ben.page.waitForSelector('#body:not([hidden])');
    await ben.page.click('#go-own');
    await ben.page.fill('#code', '<h2>Plain page</h2><label>kW <input id="kw"></label> <button id="go">Go</button><table><tr><td>a</td></tr></table><script>document.getElementById("go").onclick = function () { notThere.run(); };</scr' + 'ipt>');
    await ben.page.click('#code-check');
    await ben.page.waitForSelector('#up-report li.hub-ok');
    check(/uses none of the site's building blocks/.test(await ben.page.textContent('#up-report')), T + 'a page without building blocks passes, with a note that says so');
    await toUpload(ben.page); await ben.page.click('#up-send');
    await ben.page.waitForSelector('#after-upload:not([hidden])');
    check(await ben.page.locator('#after-preview').isVisible() && await ben.page.locator('#after-live button').isVisible(), T + 'after the upload, Open the preview and Make live are right there');
    await ben.page.click('#after-live button');
    await ben.page.click('#after-live button');
    await said(ben.page, 'Version 2 is live');
    await mock.sql(`insert into core.tool_access (space, tool, user_id, level, added_by) values ('lab', 'secret', '${cy.id}', 'read', '${ben.id}')`);
    quiet = true;
    await openTool(ben.page, 'secret');
    f = await sealed(ben.page, '#go');
    const plain = await f.evaluate(() => ({ pad: parseFloat(getComputedStyle(document.body).paddingLeft), border: getComputedStyle(document.getElementById('kw')).borderRadius, button: getComputedStyle(document.getElementById('go')).borderRadius }));
    check(plain.pad >= 16 && plain.border === '10px' && plain.button === '10px', T + 'plain HTML gets the site\'s spacing, fields and buttons by itself');
    await f.click('#go');
    await ben.page.waitForSelector('#oops:not([hidden])');
    check(/notThere is not defined/.test(await ben.page.textContent('#oops-text')) && await ben.page.locator('#oops-copy').isVisible(), T + 'when a tool\'s code fails, its builder sees the error in words');
    await ben.page.click('#oops-copy');
    check(/notThere is not defined/.test(await ben.page.evaluate(() => navigator.clipboard.readText())), T + 'and can copy it as a message for the AI');
    await openTool(cy.page, 'secret');
    f = await sealed(cy.page, '#go');
    await f.click('#go');
    await cy.page.waitForSelector('#oops:not([hidden])');
    check(/tell its manager/.test(await cy.page.textContent('#oops-text')) && !/notThere/.test(await cy.page.textContent('#oops-text')) && !(await cy.page.locator('#oops-copy').isVisible()), T + 'an ordinary user is told to tell the manager, without the technical words');
    quiet = false;

    // --- "I already have a page": the kit asks the AI to rebuild it
    await ben.page.goto(SITE + 'admin/tool.html?space=lab&tool=secret');
    await ben.page.waitForSelector('#body:not([hidden])');
    await ben.page.click('#go-own');
    await ben.page.fill('#code', '<html><body><h1>Duct OLDPAGE calculator</h1></body></html>');
    await ben.page.click('#code-check');
    await ben.page.waitForSelector('#to-ai:not([hidden])');
    await ben.page.click('#to-ai');
    await ben.page.fill('#brief', 'Rebuild my existing duct calculator for this site.');
    await ben.page.click('#wz-next');
    await ben.page.click('#wz-next');
    check(await ben.page.locator('#kit-convert').isVisible(), T + 'the kit step says the existing page is inside the kit');
    await ben.page.click('#kit-copy');
    const convertKit = await ben.page.evaluate(() => navigator.clipboard.readText());
    check(/The page I already have/.test(convertKit) && /Duct OLDPAGE calculator/.test(convertKit) && /Rebuild this page as a DAME tool/.test(convertKit), T + 'with a page pasted first, the starter kit asks the AI to rebuild that page');
    await ben.page.click('#wz-back');
    await ben.page.click('#wz-back');
    await ben.page.fill('#brief', 'short');
    await ben.page.click('#wz-next');
    await ben.page.waitForSelector('#msg.hub-warn');
    check(/First say what the tool should do/.test(await ben.page.textContent('#msg')) && await ben.page.locator('#brief').isVisible(), T + 'without a description the guide does not go on');
    await upload(ben.page, [
      { name: 'index.html', mimeType: 'text/html', buffer: Buffer.from('<main class="dame-page"><link rel="stylesheet" href="css/look.css"><img src="images/dot.png" alt=""><script src="js/run.js"></scr' + 'ipt></main>') },
      { name: 'look.css', mimeType: 'text/css', buffer: Buffer.from('.x{margin:0}') }, { name: 'run.js', mimeType: 'text/javascript', buffer: Buffer.from('document.title="x";') },
      { name: 'dot.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') }]);
    check(/The check passed/.test(await ben.page.textContent('#up-report')), T + 'files chosen without their folders are still found by name');

    // --- the reference tool: Excel in, Excel out, with the shelf library, inside the sealed frame
    await di.page.goto(SITE + 'admin/tool.html?space=lab&tool=parts');
    await di.page.waitForSelector('#body:not([hidden])');
    await upload(di.page, [{ name: 'index.html', mimeType: 'text/html', buffer: await readFile(join(ROOT, 'examples/parts-extractor/index.html')) }]);
    const partsReport = await di.page.textContent('#up-report');
    check(/The check passed/.test(partsReport) && !/Note:/.test(partsReport), T + 'the reference tool passes the check without a single note');
    await toUpload(di.page); await di.page.click('#up-send');
    await said(di.page, 'Version 1 is uploaded');
    await twice(di.page, '#versions', 'Make live');
    await said(di.page, 'Version 1 is live');
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Unit A');
    sheet.addRow(['Parts list issue 3']);
    sheet.addRow(['Item', 'Description', 'Part Number', 'TST 029.1', 'TST 033.1']);
    sheet.addRow(['COMPRESSOR']);
    sheet.addRow([1, 'Test compressor', 'P-100', 1, 2]);
    sheet.addRow([2, 'Test fan', 'P-200', '1pc each', null]);
    sheet.mergeCells('D5:E5');
    sheet.addRow([3, 'Test valve', 'P-300', '-', 1]);
    book.addWorksheet('Index').addRow(['nothing here']);
    const workbook = Buffer.from(await book.xlsx.writeBuffer());
    await openTool(cy.page, 'parts');
    f = await sealed(cy.page, '#dropzone');
    check((await f.evaluate(() => typeof window.ExcelJS)) === 'object', T + 'the shelf library is in place inside the tool');
    await f.setInputFiles('#dropzone + input[type=file]', [{ name: 'Parts List 12.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: workbook }]);
    await f.waitForSelector('#file-list li');
    await f.click('#run-btn');
    await f.waitForSelector('#result-panel:not([hidden])', { timeout: 20000 });
    const stats = (await f.textContent('#result-stats')).replace(/\s+/g, ' ');
    check(/6rows extracted/.test(stats) && /1sheets with data/.test(stats), T + 'the reference tool reads the workbook: 3 parts x 2 models = 6 rows, merged cell spread over both (' + stats.trim() + ')');
    check(/skipped \(blacklist\)/.test(await f.textContent('#log-body')), T + 'its rules are the old ones: the Index sheet is skipped');
    const [download] = await Promise.all([cy.page.waitForEvent('download', { timeout: 15000 }), f.click('#download-btn')]);
    const saved = new ExcelJS.Workbook();
    await saved.xlsx.load(await readFile(await download.path()));
    const long = saved.getWorksheet('Parts_Long');
    const values = [];
    long.eachRow((row) => values.push(row.values.slice(1).join('|')));
    check(download.suggestedFilename() === 'Parts_Database.xlsx' && saved.worksheets.map((w) => w.name).join(',').startsWith('Parts_Long,Extraction_Log') && long.rowCount === 7, T + 'the result is saved as a real Excel file with its sheets (' + saved.worksheets.map((w) => w.name).join(', ') + ')');
    check(values.some((v) => /Test fan\|.*TST 029\.1\|1pc each/.test(v)) && values.some((v) => /Test fan\|.*TST 033\.1\|1pc each/.test(v)) && values.some((v) => /COMPRESSOR/.test(v)), T + 'the saved table holds the right values, section and merged quantity');
    check(!asked.some((u) => /LEAK/.test(u)) && mock.calls.every((c) => !/Parts%20List|P-100/.test(c.path)), T + 'the workbook never left the browser');
    await shot(cy.page, '7-parts-extractor');
    check(await fits(cy.page), T + 'the reference tool fits the screen');

    // --- the building blocks page
    await cy.page.goto(SITE + 'blocks.html');
    await cy.page.waitForSelector('.hub-pre');
    check((await cy.page.locator('[data-block]').count()) >= 10 && /class="dame-drop"/.test(await cy.page.textContent('main')), T + 'the building blocks page shows each block with its code');
    check(await fits(cy.page), T + 'the building blocks page fits the screen');
    await shot(cy.page, '8-blocks');

    check(problems.length === 0, T + 'no page error, blocked load or dialog outside the hostile test' + (problems.length ? ' -> ' + problems.slice(0, 4).join(' | ') : ''));
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
